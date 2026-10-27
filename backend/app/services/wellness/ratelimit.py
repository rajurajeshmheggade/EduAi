"""Per-user sliding-window rate limits for the wellness AI endpoints (protects the AI quota and the DB).

In-process (per worker) — enough to stop runaway clients and scripted abuse; put a shared limiter (Redis / API
gateway) in front when running several workers."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status

# bucket → (max calls, window seconds)
LIMITS: dict[str, tuple[int, int]] = {
    "chat": (20, 60),
    "journal": (10, 600),
    "tips": (12, 600),
    "quiz": (20, 600),
    "transcribe": (30, 600),
    "activity": (120, 60),
    "teacher": (120, 60),
}
_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def check(user_key: str, bucket: str) -> None:
    limit, window = LIMITS[bucket]
    now = time.monotonic()
    with _lock:
        q = _hits[(bucket, user_key)]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            retry = int(window - (now - q[0])) + 1
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                                "You're going a little fast — please take a breath and try again shortly.",
                                headers={"Retry-After": str(retry)})
        q.append(now)


def reset() -> None:
    with _lock:
        _hits.clear()
