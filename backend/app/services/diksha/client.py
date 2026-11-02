"""DIKSHA source adapter: verified endpoints only, with throttling, caching, timeouts and safe errors.

Verified (anonymous, see docs/DIKSHA_API_DISCOVERY.md):
  POST /api/content/v1/search          Sunbird composite search (filters / query / facets / limit / offset)
  GET  /api/content/v1/read/{id}       content metadata (+ licenseDetails)
  GET  /api/course/v1/hierarchy/{id}   full collection (textbook) tree

DIKSHA's error messages can include internal infrastructure details, so they are never passed on to users.
"""
from __future__ import annotations

import json
import re
import threading
import time
from collections import OrderedDict
from typing import Any

import httpx

from ...config import get_settings

ID_RE = re.compile(r"^do_[A-Za-z0-9_]{4,80}$")
# Elasticsearch result window on DIKSHA: offset + limit must be <= 10000 (larger -> HTTP 500).
MAX_RESULT_WINDOW = 10_000


class DikshaError(Exception):
    """kind: disabled | invalid_id | timeout | rate_limited | not_found | bad_request | unavailable | invalid_response"""

    MESSAGES = {
        "disabled": "The DIKSHA library is turned off for this installation.",
        "invalid_id": "That is not a valid DIKSHA content id.",
        "timeout": "DIKSHA did not respond in time. Please try again.",
        "rate_limited": "DIKSHA is receiving too many requests right now. Please try again in a moment.",
        "not_found": "This item is no longer available on DIKSHA.",
        "bad_request": "DIKSHA could not process this search.",
        "unavailable": "DIKSHA is unavailable right now. Please try again later.",
        "invalid_response": "DIKSHA returned an unexpected response.",
    }

    def __init__(self, kind: str, status: int | None = None):
        super().__init__(self.MESSAGES.get(kind, "DIKSHA request failed."))
        self.kind = kind
        self.status = status


class _TokenBucket:
    def __init__(self, rate: float):
        self.rate = max(rate, 0.1)
        self.capacity = max(1.0, self.rate)
        self.tokens = self.capacity
        self.updated = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self, max_wait: float = 5.0) -> None:
        deadline = time.monotonic() + max_wait
        while True:
            with self.lock:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                wait = (1 - self.tokens) / self.rate
            if time.monotonic() + wait > deadline:
                raise DikshaError("rate_limited")
            time.sleep(wait)


class _TTLCache:
    def __init__(self, ttl: int, max_entries: int = 512):
        self.ttl = ttl
        self.max = max_entries
        self.data: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self.lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        with self.lock:
            hit = self.data.get(key)
            if not hit:
                return None
            if hit[0] < time.monotonic():
                self.data.pop(key, None)
                return None
            self.data.move_to_end(key)
            return hit[1]

    def set(self, key: str, value: Any) -> None:
        if self.ttl <= 0:
            return
        with self.lock:
            self.data[key] = (time.monotonic() + self.ttl, value)
            self.data.move_to_end(key)
            while len(self.data) > self.max:
                self.data.popitem(last=False)

    def clear(self) -> None:
        with self.lock:
            self.data.clear()


def validate_id(cid: str) -> str:
    if not isinstance(cid, str) or not ID_RE.match(cid):
        raise DikshaError("invalid_id")
    return cid


class DikshaClient:
    SEARCH_PATH = "/api/content/v1/search"

    def __init__(self, base_url: str, timeout: float, rate: float, ttl: int, transport: httpx.BaseTransport | None = None):
        self.base_url = base_url.rstrip("/")
        self._http = httpx.Client(base_url=self.base_url, timeout=timeout, transport=transport, follow_redirects=False,
                                  headers={"Accept": "application/json", "User-Agent": "EduAI-LMS-DigitalLibrary/1.0"})
        self._bucket = _TokenBucket(rate)
        self.cache = _TTLCache(ttl)

    # ---------------------------------------------------------------- transport
    def _request(self, method: str, path: str, *, json: dict | None = None, params: dict | None = None,
                 cache_key: str | None = None) -> dict:
        if cache_key and (hit := self.cache.get(cache_key)) is not None:
            return hit
        response = None
        for attempt in range(2):
            self._bucket.acquire()
            try:
                response = self._http.request(method, path, json=json, params=params)
            except httpx.TimeoutException:
                raise DikshaError("timeout")
            except httpx.HTTPError:
                raise DikshaError("unavailable")
            if response.status_code in (429, 503) and attempt == 0:
                try:
                    delay = min(float(response.headers.get("Retry-After", "1")), 3.0)
                except ValueError:
                    delay = 1.0
                time.sleep(max(delay, 0.2))
                continue
            break
        assert response is not None
        status = response.status_code
        if status == 429:
            raise DikshaError("rate_limited", status)
        if status == 404:
            raise DikshaError("not_found", status)
        if 400 <= status < 500:
            raise DikshaError("bad_request", status)
        if status >= 500:
            raise DikshaError("unavailable", status)
        try:
            body = response.json()
        except ValueError:
            raise DikshaError("invalid_response", status)
        if not isinstance(body, dict) or body.get("responseCode") != "OK" or not isinstance(body.get("result"), dict):
            raise DikshaError("invalid_response", status)
        result = body["result"]
        if cache_key:
            self.cache.set(cache_key, result)
        return result

    # ---------------------------------------------------------------- endpoints
    def search(self, request: dict) -> dict:
        """request = the Sunbird `request` object. Returns {count, content[], facets[]} (keys may be missing)."""
        limit = int(request.get("limit", 0) or 0)
        offset = int(request.get("offset", 0) or 0)
        if offset + limit > MAX_RESULT_WINDOW:
            # Past DIKSHA's search window: answer locally instead of triggering an upstream 500.
            return {"count": None, "content": [], "facets": [], "window_exceeded": True}
        key = "search:" + json.dumps(request, sort_keys=True)
        return self._request("POST", self.SEARCH_PATH, json={"request": request},
                             params={"orgdetails": "orgName", "licenseDetails": "name,url,description"}, cache_key=key)

    def read(self, cid: str) -> dict:
        validate_id(cid)
        result = self._request("GET", f"/api/content/v1/read/{cid}", params={"licenseDetails": "name,url,description"},
                               cache_key=f"read:{cid}")
        content = result.get("content")
        if not isinstance(content, dict) or not content.get("identifier"):
            raise DikshaError("invalid_response")
        return content

    def hierarchy(self, cid: str) -> dict:
        validate_id(cid)
        result = self._request("GET", f"/api/course/v1/hierarchy/{cid}", cache_key=f"hierarchy:{cid}")
        content = result.get("content")
        if not isinstance(content, dict) or not content.get("identifier"):
            raise DikshaError("invalid_response")
        return content


_client: DikshaClient | None = None
_client_lock = threading.Lock()


def get_client() -> DikshaClient:
    s = get_settings()
    if not s.diksha_enabled:
        raise DikshaError("disabled")
    global _client
    with _client_lock:
        if _client is None:
            _client = DikshaClient(s.diksha_api_base_url, s.diksha_api_timeout_seconds, s.diksha_request_rate_limit,
                                   s.library_cache_ttl_seconds)
        return _client


def set_client(client: DikshaClient | None) -> None:
    """Tests inject a client backed by httpx.MockTransport (no live DIKSHA calls)."""
    global _client
    with _client_lock:
        _client = client
