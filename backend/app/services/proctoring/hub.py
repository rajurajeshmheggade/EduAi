"""Real-time fan-out of proctoring updates to teachers' dashboards (Server-Sent Events).

In-process hub: every SSE connection subscribes to its teacher's channel with a bounded asyncio queue. Producers are
ordinary (threaded) request handlers, so delivery hops onto the subscriber's event loop with call_soon_threadsafe. A
slow client never blocks a producer: when its queue is full the oldest message is dropped and the next one carries
`overflow: true`, telling the dashboard to refetch.

With several API processes, set REDIS_URL: messages are then published to Redis and every process (including the
sender) delivers them to its own subscribers from one listener thread. If Redis is unreachable the hub falls back to
local delivery, so a single-process deployment keeps working.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections import defaultdict
from typing import Any

log = logging.getLogger("eduai.proctoring.hub")

QUEUE_SIZE = 200
REDIS_CHANNEL = "eduai:proctoring"


def teacher_channel(org_code: str, user_code: str) -> str:
    return f"{org_code}:teacher:{user_code}"


class Subscriber:
    def __init__(self, channel: str, loop: asyncio.AbstractEventLoop, maxsize: int = QUEUE_SIZE) -> None:
        self.channel = channel
        self.loop = loop
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize)
        self.dropped = 0

    def offer(self, message: dict) -> None:
        """Runs on the subscriber's loop."""
        if self.queue.full():
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            self.dropped += 1
            message = {**message, "overflow": True}
        self.queue.put_nowait(message)

    async def get(self) -> dict:
        return await self.queue.get()


class Hub:
    def __init__(self) -> None:
        self._subs: dict[str, set[Subscriber]] = defaultdict(set)
        self._lock = threading.Lock()
        self.bridge: RedisBridge | None = None

    def subscribe(self, channel: str, loop: asyncio.AbstractEventLoop | None = None) -> Subscriber:
        sub = Subscriber(channel, loop or asyncio.get_running_loop())
        with self._lock:
            self._subs[channel].add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            subs = self._subs.get(sub.channel)
            if subs is not None:
                subs.discard(sub)
                if not subs:
                    self._subs.pop(sub.channel, None)

    def subscribers(self, channel: str) -> int:
        with self._lock:
            return len(self._subs.get(channel, ()))

    def publish(self, channel: str, message: dict) -> None:
        """Safe to call from any thread. Goes through Redis when the bridge is up, else straight to local subscribers."""
        if self.bridge is not None and self.bridge.publish(channel, message):
            return
        self.deliver(channel, message)

    def deliver(self, channel: str, message: dict) -> int:
        with self._lock:
            subs = list(self._subs.get(channel, ()))
        delivered = 0
        for sub in subs:
            try:
                sub.loop.call_soon_threadsafe(sub.offer, message)
                delivered += 1
            except RuntimeError:  # the subscriber's loop is gone (client disconnected mid-shutdown)
                self.unsubscribe(sub)
        return delivered


class RedisBridge:
    """Cross-process delivery through Redis pub/sub (optional, REDIS_URL)."""

    def __init__(self, hub: Hub, client: Any) -> None:
        self.hub = hub
        self.client = client
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def publish(self, channel: str, message: dict) -> bool:
        try:
            self.client.publish(REDIS_CHANNEL, json.dumps({"channel": channel, "message": message}, default=str))
            return True
        except Exception as e:  # noqa: BLE001 — Redis down: deliver locally instead
            log.warning("proctoring redis publish failed (%s); delivering locally", type(e).__name__)
            return False

    def handle(self, raw: bytes | str) -> None:
        try:
            data = json.loads(raw)
            self.hub.deliver(str(data["channel"]), dict(data["message"]))
        except (ValueError, KeyError, TypeError):
            log.warning("proctoring redis: ignored a malformed message")

    def start(self) -> None:
        if self._thread is not None:
            return

        def run() -> None:
            while not self._stop.is_set():
                try:
                    pubsub = self.client.pubsub(ignore_subscribe_messages=True)
                    pubsub.subscribe(REDIS_CHANNEL)
                    while not self._stop.is_set():
                        m = pubsub.get_message(timeout=1.0)
                        if m and m.get("type") == "message":
                            self.handle(m["data"])
                except Exception as e:  # noqa: BLE001 — reconnect after a pause
                    log.warning("proctoring redis listener error (%s); retrying", type(e).__name__)
                    self._stop.wait(5)

        self._thread = threading.Thread(target=run, name="proctoring-redis", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()


hub = Hub()
_bridge_lock = threading.Lock()
_bridge_checked = False


def ensure_bridge() -> None:
    """Start the Redis bridge once, when REDIS_URL is set (called lazily by the stream and the producers)."""
    global _bridge_checked
    if _bridge_checked:
        return
    with _bridge_lock:
        if _bridge_checked:
            return
        _bridge_checked = True
        from ...config import get_settings

        url = get_settings().redis_url
        if not url:
            return
        try:
            import redis

            bridge = RedisBridge(hub, redis.Redis.from_url(url))
            bridge.start()
            hub.bridge = bridge
        except Exception as e:  # noqa: BLE001
            log.warning("proctoring redis bridge not started (%s); using in-process delivery", type(e).__name__)
