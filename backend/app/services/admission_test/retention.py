"""Retention purge (daily): evidence files, ID photos and raw event details older than EVIDENCE_RETENTION_DAYS are
deleted. Event rows (code, time, duration, points) and the report's aggregate numbers stay."""
from __future__ import annotations

from datetime import datetime, timedelta

from ... import db
from ..storage import get_storage
from . import config as cfg
from .sessions import now


def purge(days: int | None = None, *, at: datetime | None = None) -> dict:
    cutoff = (at or now()) - timedelta(days=days if days is not None else cfg.TUNABLES["evidence_retention_days"])
    storage = get_storage()
    files = 0

    def drop(key: str | None) -> None:
        nonlocal files
        if not key:
            return
        try:
            storage.delete(key)
            files += 1
        except Exception:  # noqa: BLE001 — already gone
            pass

    events = db.fetch_all("SELECT event_id, evidence_key FROM public.admission_proctor_events WHERE server_ts < %s "
                          "AND (evidence_key IS NOT NULL OR details IS NOT NULL)", (cutoff,))
    for e in events:
        drop(e["evidence_key"])
    if events:
        db.execute("UPDATE public.admission_proctor_events SET evidence_key = NULL, details = NULL WHERE event_id = ANY(%s)",
                   ([e["event_id"] for e in events],))
    photos = db.fetch_all("SELECT session_id, id_photo_key FROM public.admission_sessions WHERE id_photo_key IS NOT NULL "
                          "AND COALESCE(submitted_at, launched_at) < %s", (cutoff,))
    for p in photos:
        drop(p["id_photo_key"])
    if photos:
        db.execute("UPDATE public.admission_sessions SET id_photo_key = NULL WHERE session_id = ANY(%s)", ([p["session_id"] for p in photos],))
    return {"cutoff": cutoff.isoformat(), "events": len(events), "photos": len(photos), "files": files}
