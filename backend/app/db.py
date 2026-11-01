"""PostgreSQL access layer. All data access goes through public.usp_* functions (the ICME
repository pattern shared with the .NET 8 API)."""
from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Sequence
from urllib.parse import urlsplit, urlunsplit

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_settings

log = logging.getLogger("eduai.db")
_pool: ConnectionPool | None = None
_tenant_pool: ConnectionPool | None = None


def _resolve_dsn() -> str:
    s = get_settings()
    if s.database_url:
        return s.database_url
    from . import devdb  # local-dev PostgreSQL 16 + pgvector (no Docker)

    dsn = devdb.start()
    log.info("Local dev PostgreSQL ready: %s", dsn)
    return dsn


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(_resolve_dsn(), min_size=1, max_size=10, kwargs={"row_factory": dict_row}, open=True)
    return _pool


def _tenant_dsn() -> str:
    s = get_settings()
    if s.admission_database_url:
        return s.admission_database_url
    # Local dev / tests: same server and database, connecting as admission_login (trust authentication).
    u = urlsplit(_resolve_dsn())
    host = u.hostname or "127.0.0.1"
    netloc = f"admission_login@{host}" + (f":{u.port}" if u.port else "")
    return urlunsplit((u.scheme, netloc, u.path, u.query, u.fragment))


def get_tenant_pool() -> ConnectionPool:
    global _tenant_pool
    if _tenant_pool is None:
        _tenant_pool = ConnectionPool(_tenant_dsn(), min_size=1, max_size=10, kwargs={"row_factory": dict_row}, open=True)
    return _tenant_pool


def close_pool() -> None:
    global _pool, _tenant_pool
    for p in (_pool, _tenant_pool):
        if p is not None:
            p.close()
    _pool = _tenant_pool = None


@contextmanager
def connection() -> Iterator[Any]:
    with get_pool().connection() as conn:
        yield conn


TENANT_ROLE = "admission_app"


@contextmanager
def tenant(org_code: str, user_code: str, user_role: str) -> Iterator[Any]:
    """Transaction for tenant-isolated (row-level security) tables, e.g. the `admission` schema.

    Uses its own pool that logs in as `admission_login` (not a superuser; may only become `admission_app`), drops to
    `admission_app` and sets the session context the RLS policies read. SET LOCAL / set_config(..., true) last only for
    this transaction, so a pooled connection never keeps another request's school.
    """
    if not org_code:
        raise ValueError("A school (org_code) is required for tenant-scoped queries")
    with get_tenant_pool().connection() as conn:
        with conn.transaction():
            conn.execute(f"SET LOCAL ROLE {TENANT_ROLE}")
            conn.execute("SELECT set_config('app.org_code', %s, true), set_config('app.user_code', %s, true), "
                         "set_config('app.user_role', %s, true)", (org_code, user_code, user_role))
            yield conn


def fetch_all(sql: str, params: Sequence[Any] | None = None) -> list[dict]:
    with connection() as conn:
        return list(conn.execute(sql, params).fetchall())


def fetch_one(sql: str, params: Sequence[Any] | None = None) -> dict | None:
    with connection() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params: Sequence[Any] | None = None) -> None:
    with connection() as conn:
        conn.execute(sql, params)


def _placeholders(args: Sequence[Any], casts: Sequence[str | None] | None) -> str:
    casts = casts or [None] * len(args)
    return ", ".join("%s" + (f"::{c}" if c else "") for c in casts)


def call_rows(fn: str, *args: Any, casts: Sequence[str | None] | None = None) -> list[dict]:
    """SELECT * FROM public.<fn>(...) — for table-returning usp_* functions."""
    return fetch_all(f"SELECT * FROM public.{fn}({_placeholders(args, casts)})", args)


def call_row(fn: str, *args: Any, casts: Sequence[str | None] | None = None) -> dict | None:
    rows = call_rows(fn, *args, casts=casts)
    return rows[0] if rows else None


def call_scalar(fn: str, *args: Any, casts: Sequence[str | None] | None = None) -> Any:
    row = fetch_one(f"SELECT public.{fn}({_placeholders(args, casts)}) AS v", args)
    return row["v"] if row else None


def vec_literal(values: Sequence[float]) -> str:
    """pgvector text literal, e.g. '[0.1,0.2,...]' (cast with ::vector)."""
    return "[" + ",".join(f"{v:.7f}" for v in values) + "]"
