"""Public (unauthenticated) endpoints for the marketing site: demo requests, plus the super-admin lead inbox."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from .. import db
from ..security import CurrentUser, require_role
from ..services.members import Email, Name, Phone

router = APIRouter(prefix="/api/v1/public", tags=["public"])
admin_router = APIRouter(prefix="/ICMELive/api/v1/admin", tags=["public"])

INTERESTS = Literal["attendance", "timetable", "homework", "online_tests", "assignments", "ai_evaluation",
                    "ai_tutor", "lesson_planner", "admin_console"]
LeadStatus = Literal["NEW", "CONTACTED", "DEMO_DONE", "WON", "LOST"]

# Light abuse protection for an open form: per-IP sliding window (process-local; put a WAF in front in production).
_WINDOW_S, _MAX_PER_WINDOW = 3600, 5
_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def _throttle(ip: str) -> None:
    now = time.monotonic()
    with _lock:
        q = _hits[ip]
        while q and now - q[0] > _WINDOW_S:
            q.popleft()
        if len(q) >= _MAX_PER_WINDOW:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests — please try again later")
        q.append(now)


class DemoRequest(BaseModel):
    full_name: Name
    email: Email
    phone: Phone | None = None
    institution_name: str = Field(min_length=2, max_length=250)
    institution_type: Literal["school", "college", "coaching"]
    role: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=100)
    student_count: Literal["<300", "300-1000", "1000-3000", "3000+"] | None = None
    interests: list[INTERESTS] = Field(default_factory=list, max_length=12)
    message: str | None = Field(default=None, max_length=2000)
    consent: bool
    website: str | None = Field(default=None, max_length=200)  # honeypot: real people leave it empty


@router.post("/demo-requests", status_code=status.HTTP_201_CREATED)
def create_demo_request(body: DemoRequest, request: Request):
    if not body.consent:
        raise HTTPException(422, "Please agree to be contacted about your demo")
    if body.website:  # bot filled the hidden field — accept silently, store nothing
        return {"ok": True}
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else ""))[:64]
    _throttle(ip or "unknown")
    db.execute(
        "INSERT INTO public.demo_requests(full_name, email, phone, institution_name, institution_type, role, city, "
        "student_count, interests, message, source_ip) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (body.full_name, body.email, body.phone or None, body.institution_name.strip(), body.institution_type,
         (body.role or "").strip() or None, (body.city or "").strip() or None, body.student_count,
         sorted(set(body.interests)), (body.message or "").strip() or None, ip or None))
    return {"ok": True}


# ---------------------------------------------------------------- super-admin lead inbox
superadmin_only = require_role("superadmin")


@admin_router.get("/demo-requests")
def list_demo_requests(status_filter: LeadStatus | None = None, user: CurrentUser = Depends(superadmin_only)):
    rows = db.fetch_all(
        "SELECT request_id, full_name, email, phone, institution_name, institution_type, role, city, student_count, "
        "interests, message, status, notes, created_at, updated_at FROM public.demo_requests "
        "WHERE (%s::text IS NULL OR status = %s::text) ORDER BY created_at DESC LIMIT 500", (status_filter, status_filter))
    counts = {r["status"]: r["n"] for r in db.fetch_all(
        "SELECT status, COUNT(*) AS n FROM public.demo_requests GROUP BY status")}
    return {"requests": rows, "counts": counts}


class LeadUpdate(BaseModel):
    status: LeadStatus | None = None
    notes: str | None = Field(default=None, max_length=4000)


@admin_router.patch("/demo-requests/{request_id}")
def update_demo_request(request_id: UUID, body: LeadUpdate, user: CurrentUser = Depends(superadmin_only)):
    row = db.fetch_one(
        "UPDATE public.demo_requests SET status = COALESCE(%s, status), notes = COALESCE(%s, notes), updated_at = NOW() "
        "WHERE request_id = %s RETURNING request_id, status, notes", (body.status, body.notes, request_id))
    if not row:
        raise HTTPException(404, "Request not found")
    return row
