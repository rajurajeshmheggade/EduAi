"""In-app notification inbox — every signed-in role (student, teacher, admin, ...) reads their own."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..security import CurrentUser, require_role
from ..services import notifications as notif

router = APIRouter(prefix="/ICMELive/api/v1/notifications", tags=["notifications"])

any_role = require_role("superadmin", "orgadmin", "teacher", "student", "counsellor", "reviewer", "parent")


@router.get("")
def list_notifications(user: CurrentUser = Depends(any_role)):
    rows = notif.list_for(user.org_code, user.user_code)
    return {"notifications": rows, "unread": sum(1 for r in rows if not r["is_read"])}


@router.patch("/{notification_id}/read")
def mark_read(notification_id: str, user: CurrentUser = Depends(any_role)):
    if not notif.mark_read(user.org_code, user.user_code, notification_id):
        raise HTTPException(404, "Notification not found")
    return {"ok": True}


@router.patch("/read-all")
def mark_all_read(user: CurrentUser = Depends(any_role)):
    return {"marked": notif.mark_all_read(user.org_code, user.user_code)}
