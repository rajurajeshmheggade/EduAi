"""Apply db/migrations/*.sql in order (idempotent). Equivalent to running each file in pgAdmin 4.

    python -m scripts.migrate
"""
from pathlib import Path

from app.db import close_pool, connection

MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"


def run() -> list[str]:
    applied: list[str] = []
    with connection() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS public.schema_migrations "
            "(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())"
        )
        done = {r["filename"] for r in conn.execute("SELECT filename FROM public.schema_migrations").fetchall()}
        for f in sorted(MIGRATIONS.glob("*.sql")):
            if f.name in done:
                continue
            conn.execute(f.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO public.schema_migrations(filename) VALUES (%s)", (f.name,))
            applied.append(f.name)
    return applied


if __name__ == "__main__":
    out = run()
    print("Applied:", out or "nothing (up to date)")
    close_pool()
