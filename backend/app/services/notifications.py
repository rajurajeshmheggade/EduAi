"""Shared in-app notification inbox (Phase 3 cross-module requirement). Any feature that needs to tell a
user something happened calls `notify()` / `notify_many()`; the recipient reads it from GET /notifications
in `backend/app/routers/notifications.py`. `dedup_key` makes a notification idempotent per (org, recipient):
reprocessing the same event (e.g. a retried request) never creates a second copy.

Email delivery is intentionally out of scope for v1 — there is no SMTP/email-provider configuration in this
project yet. This module is the hook point: a future `notify_email()` alongside `notify()` can reuse the same
call sites once real credentials are available.
"""
from __future__ import annotations

from .. import db


def notify(org_code: str, user_code: str, notif_type: str, title: str, body: str | None = None,
          link: str | None = None, dedup_key: str | None = None) -> str | None:
    """Creates one notification for one recipient. Returns the new notification_id, or None if it was a
    no-op duplicate (same org/user/dedup_key already notified)."""
    return db.call_scalar("usp_notify", org_code, user_code, notif_type, title, body, link, dedup_key)


def notify_many(org_code: str, user_codes: list[str], notif_type: str, title: str, body: str | None = None,
                link: str | None = None, dedup_key: str | None = None) -> None:
    """Same notification fanned out to several recipients (e.g. every student in a class). Each recipient
    gets their own dedup_key suffix so one recipient's duplicate-guard doesn't swallow another's."""
    for code in dict.fromkeys(user_codes):  # de-dup the recipient list itself, preserve order
        notify(org_code, code, notif_type, title, body, link,
              f"{dedup_key}:{code}" if dedup_key else None)


def list_for(org_code: str, user_code: str, limit: int = 50) -> list[dict]:
    return db.call_rows("usp_list_notifications", org_code, user_code, limit)


def mark_read(org_code: str, user_code: str, notification_id: str) -> bool:
    row = db.fetch_one(
        "UPDATE public.notifications SET is_read = TRUE WHERE org_code = %s AND user_code = %s "
        "AND notification_id::text = %s RETURNING notification_id",
        (org_code, user_code, notification_id))
    return row is not None


def mark_all_read(org_code: str, user_code: str) -> int:
    with db.connection() as conn:
        cur = conn.execute(
            "UPDATE public.notifications SET is_read = TRUE WHERE org_code = %s AND user_code = %s AND NOT is_read",
            (org_code, user_code))
        return cur.rowcount
