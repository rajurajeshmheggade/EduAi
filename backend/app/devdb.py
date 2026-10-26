"""Local-dev PostgreSQL 16 + pgvector (no Docker needed), using the binaries bundled in `pgserver`.

    python -m app.devdb start|stop|status

Runs on 127.0.0.1:5433 with trust auth (development only). Data: <repo>/.data/pg16.
In production set DATABASE_URL to Azure Database for PostgreSQL instead.
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

from .config import ROOT

PORT = 5433
DB_NAME = "eduai"
DATA = ROOT / ".data" / "pg16"
LOG = ROOT / ".data" / "pg16.log"
DSN = f"postgresql://postgres@127.0.0.1:{PORT}/{DB_NAME}"


def _bin() -> Path:
    import pgserver

    return Path(pgserver.__file__).parent / "pginstall" / "bin"


def _run(exe: str, *args: str, timeout: int = 90) -> subprocess.CompletedProcess:
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    return subprocess.run(
        [str(_bin() / exe), *args], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=timeout, creationflags=flags,
    )


def is_running() -> bool:
    return DATA.exists() and _run("pg_ctl", "-D", str(DATA), "status", timeout=20).returncode == 0


def start() -> str:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    if not (DATA / "PG_VERSION").exists():
        r = _run("initdb", "-D", str(DATA), "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C")
        if r.returncode != 0:
            raise RuntimeError("initdb failed")
    if not is_running():
        r = _run("pg_ctl", "-D", str(DATA), "-o", f"-p {PORT} -h 127.0.0.1", "-l", str(LOG), "-w", "-t", "60", "start")
        if r.returncode != 0:
            raise RuntimeError(f"pg_ctl start failed; see {LOG}")
    import psycopg

    for _ in range(20):
        try:
            with psycopg.connect(f"postgresql://postgres@127.0.0.1:{PORT}/postgres", autocommit=True) as c:
                if not c.execute("SELECT 1 FROM pg_database WHERE datname=%s", (DB_NAME,)).fetchone():
                    c.execute(f'CREATE DATABASE "{DB_NAME}"')
            break
        except psycopg.OperationalError:
            time.sleep(0.5)
    return DSN


def stop() -> None:
    if DATA.exists():
        _run("pg_ctl", "-D", str(DATA), "-m", "fast", "-w", "stop")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "start":
        print("started:", start())
    elif cmd == "stop":
        stop()
        print("stopped")
    else:
        print("running" if is_running() else "stopped")
