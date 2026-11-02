"""Retention purge (daily): finished student proctoring sessions older than their module's retention_days are deleted
with their flags and teacher actions. Open sessions are never touched. The append-only triggers allow these deletes
only inside this transaction (eduai.proctor_purge = on)."""
from __future__ import annotations

from ... import db
from . import config as cfg


def purge(days: int | None = None) -> dict:
    """`days` overrides every school's setting (e.g. for a one-off clean-up)."""
    deleted = 0
    with db.connection() as conn:
        with conn.transaction():
            conn.execute("SELECT set_config('eduai.proctor_purge', 'on', true)")
            orgs = [r["org_code"] for r in conn.execute("SELECT DISTINCT org_code FROM public.proctor_sessions").fetchall()]
            for org in orgs:
                saved = {r["module"]: r["settings"] for r in conn.execute(
                    "SELECT module, settings FROM public.proctor_settings WHERE org_code = %s", (org,)).fetchall()}
                for module in cfg.MODULES:
                    keep = days if days is not None else cfg.merge(module, saved.get(module))["retention_days"]
                    cur = conn.execute(
                        "DELETE FROM public.proctor_sessions WHERE org_code = %s AND module = %s AND status IN ('SUBMITTED', "
                        "'ENDED_BY_TEACHER', 'CLOSED') AND COALESCE(ended_at, updated_at) < NOW() - make_interval(days => %s)",
                        (org, module, int(keep)))
                    deleted += cur.rowcount
    return {"sessions_deleted": deleted}
