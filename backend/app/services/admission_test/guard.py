"""Security helpers for admission tests: exam tokens, rate limits, response headers and the audit log."""
from __future__ import annotations

import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Response
from psycopg.types.json import Jsonb

from ... import db


# ---------------------------------------------------------------- exam token
def new_exam_token() -> tuple[str, str]:
    """(token shown once, SHA-256 stored). 32 random bytes, URL-safe."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- rate limits (per API process)
class RateLimiter:
    """Sliding-window counter per key. In-process: with several API workers each enforces its own window."""

    def __init__(self) -> None:
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_s: float, *, message: str = "Too many requests. Please slow down.") -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_s:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(429, message)
            q.append(now)

    def count(self, key: str, window_s: float) -> int:
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key) or deque()
            return sum(1 for t in q if t > now - window_s)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def no_store(response: Response) -> None:
    """Router dependency: admission responses are never cached and never sniffed."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"


def headers(resp: Response) -> Response:
    no_store(resp)
    return resp


# ---------------------------------------------------------------- audit
def audit(org: str, action: str, *, actor: str | None = None, role: str | None = None, test_id=None, session_id=None,
          details: dict | None = None, conn=None) -> None:
    sql = ("INSERT INTO public.admission_test_audit (org_code, actor_code, actor_role, action, test_id, session_id, details) "
           "VALUES (%s,%s,%s,%s,%s,%s,%s)")
    args = (org, actor, role, action, test_id, session_id, Jsonb(details) if details else None)
    if conn is not None:
        conn.execute(sql, args)
    else:
        db.execute(sql, args)
