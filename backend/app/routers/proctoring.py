"""Unified AI proctoring for students (Online Tests, Virtual Labs, AI Classroom) — FLAGS ONLY.

Student (own JWT)                                   Teacher (assigned teachers only)
GET  /student/config?module=                        GET  /teacher/exams                      ongoing exams + totals
POST /student/sessions            prepare           GET  /teacher/exam?module=&ref_id=       roster, totals, alert feed
GET  /student/sessions/{id}       own flags         GET  /teacher/sessions/{id}              timeline + actions (audited)
POST /student/sessions/{id}/start ack + checks      POST /teacher/sessions/{id}/remarks|warnings|end
POST /student/sessions/{id}/events                  POST /teacher/events/{id}/review
POST /student/sessions/{id}/heartbeat               GET  /teacher/stream                     Server-Sent Events
POST /student/sessions/{id}/warnings/{a}/ack
POST /student/sessions/{id}/finish                  Admin: GET /settings · PUT /settings/{module}

Detection runs on the student's device; only flags (code, timing, a few small scalar details) reach the server.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..security import CurrentUser, require_role
from ..services.admission_test.guard import RateLimiter
from ..services.proctoring import config as cfg
from ..services.proctoring import exams, sessions
from ..services.proctoring.hub import ensure_bridge, hub, teacher_channel

router = APIRouter(prefix="/ICMELive/api/v1/proctoring", tags=["proctoring"])
students = require_role("student")
teachers = require_role("teacher")
admins = require_role("orgadmin", "superadmin")
readers = require_role("teacher", "orgadmin", "superadmin")

ModuleName = Literal["ONLINE_TEST", "VIRTUAL_LAB", "AI_CLASSROOM"]
MAX_EVENTS_PER_MINUTE = 240
MAX_HEARTBEATS_PER_MINUTE = 40
STREAM_SECONDS = 300          # a stream lives at most this long (the client reconnects with a fresh token)
KEEPALIVE_SECONDS = 15
limiter = RateLimiter()


# ---------------------------------------------------------------- student
@router.get("/student/config")
def student_config(module: ModuleName, user: CurrentUser = Depends(students)):
    return sessions.config_view(user.org_code, module)


class PrepareIn(BaseModel):
    module: ModuleName
    ref_id: str = Field(min_length=1, max_length=400)

    @field_validator("ref_id")
    @classmethod
    def _ref(cls, v: str) -> str:
        v = v.strip()
        if any(ord(ch) < 32 for ch in v) or ".." in v:
            raise ValueError("invalid reference")
        return v


@router.post("/student/sessions")
def prepare(body: PrepareIn, user: CurrentUser = Depends(students)):
    """Open (or resume) the student's session for this exam in the PRECHECK state: the preparation window is showing."""
    return sessions.prepare(user, body.module, body.ref_id)


@router.get("/student/sessions/{session_id}")
def my_session(session_id: UUID, user: CurrentUser = Depends(students)):
    """The student's own record: status and every flag stored about them (transparency)."""
    s = sessions.own(user, session_id)
    events = db.fetch_all("SELECT code, severity, server_ts, duration_ms FROM public.proctor_events WHERE session_id = %s "
                                   "ORDER BY server_ts", (s["session_id"],))
    return {**sessions.student_view(s), "flags": [{**e, "label": cfg.FLAGS[e["code"]].label} for e in events]}


class ChecksIn(BaseModel):
    camera: bool = False
    face: bool = False
    microphone: bool = False
    fullscreen: bool = False
    lighting: bool | None = None


class StartIn(BaseModel):
    acknowledged: bool
    rules_version: str = Field(max_length=32)
    checks: ChecksIn
    camera_label: str | None = Field(default=None, max_length=200)
    mic_label: str | None = Field(default=None, max_length=200)


@router.post("/student/sessions/{session_id}/start")
def start(session_id: UUID, body: StartIn, user: CurrentUser = Depends(students)):
    s = sessions.own(user, session_id)
    return sessions.start(s, acknowledged=body.acknowledged, rules_version=body.rules_version, checks=body.checks.model_dump(),
                          camera_label=body.camera_label, mic_label=body.mic_label)


Scalar = int | float | bool | str | None


class EventIn(BaseModel):
    seq: int = Field(ge=1, le=10_000_000)
    code: str = Field(max_length=32)
    client_ts: datetime | None = None
    duration_ms: int = Field(default=0, ge=0, le=86_400_000)
    confidence: float | None = Field(default=None, ge=0, le=1)
    details: dict[str, Scalar] = Field(default_factory=dict)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        if v not in cfg.CLIENT_CODES:
            raise ValueError("unknown event code")
        return v

    @field_validator("details")
    @classmethod
    def _details(cls, v: dict) -> dict:
        # Small scalars only: nothing that could carry an image, a recording or free text of any length.
        if len(v) > 8 or any(len(k) > 32 or (isinstance(x, str) and len(x) > 80) for k, x in v.items()):
            raise ValueError("event details must be at most 8 short values")
        return v


class EventsIn(BaseModel):
    events: list[EventIn] = Field(min_length=1, max_length=50)


@router.post("/student/sessions/{session_id}/events")
def events(session_id: UUID, body: EventsIn, user: CurrentUser = Depends(students)):
    s = sessions.own(user, session_id)
    for _ in body.events:
        limiter.hit(f"proctor-ev:{s['session_id']}", MAX_EVENTS_PER_MINUTE, 60, message="Too many proctoring events")
    return sessions.ingest(s, [e.model_dump() for e in body.events])


class HeartbeatIn(BaseModel):
    camera_live: bool
    mic_live: bool | None = None
    camera_permission: Literal["granted", "denied", "prompt"] | None = None
    mic_permission: Literal["granted", "denied", "prompt"] | None = None
    fullscreen: bool | None = None
    visible: bool = True
    faces: int | None = Field(default=None, ge=0, le=10)
    online: bool = True
    fps: float | None = Field(default=None, ge=0, le=120)


@router.post("/student/sessions/{session_id}/heartbeat")
def heartbeat(session_id: UUID, body: HeartbeatIn, user: CurrentUser = Depends(students)):
    """Every ~10 s while the exam is open. Returns teacher warnings not yet acknowledged and whether a teacher ended it."""
    s = sessions.own(user, session_id)
    limiter.hit(f"proctor-hb:{s['session_id']}", MAX_HEARTBEATS_PER_MINUTE, 60, message="Too many heartbeats")
    return sessions.heartbeat(s, body.model_dump())


@router.post("/student/sessions/{session_id}/warnings/{action_id}/ack")
def acknowledge(session_id: UUID, action_id: UUID, user: CurrentUser = Depends(students)):
    if not sessions.acknowledge_warning(sessions.own(user, session_id), action_id):
        raise HTTPException(404, "Warning not found")
    return {"ok": True}


class FinishIn(BaseModel):
    reason: Literal["submitted", "left", "closed"]


@router.post("/student/sessions/{session_id}/finish")
def finish(session_id: UUID, body: FinishIn, user: CurrentUser = Depends(students)):
    return sessions.finish(sessions.own(user, session_id), body.reason)


# ---------------------------------------------------------------- teacher
@router.get("/teacher/exams")
def teacher_exams(user: CurrentUser = Depends(teachers)):
    sessions.sweep(user.org_code)
    out = []
    for e in exams.teacher_exams(user):
        view = sessions.exam_view(user, e["module"], e["ref_id"])
        out.append({**view["exam"], "counts": view["counts"], "latest_alert": view["alerts"][0] if view["alerts"] else None})
    return {"exams": out, "severities": cfg.SEVERITIES}


@router.get("/teacher/exam")
def teacher_exam(module: ModuleName, ref_id: str = Query(min_length=1, max_length=400), user: CurrentUser = Depends(teachers)):
    return sessions.exam_view(user, module, ref_id)


@router.get("/teacher/sessions/{session_id}")
def teacher_session(session_id: UUID, user: CurrentUser = Depends(teachers)):
    s = sessions.monitored(user, session_id)
    sessions.audit_view(s, user)
    return sessions.session_detail(user, s)


class MessageIn(BaseModel):
    message: str = Field(min_length=2, max_length=1000)

    @field_validator("message")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("write a message")
        return v


@router.post("/teacher/sessions/{session_id}/remarks", status_code=201)
def remark(session_id: UUID, body: MessageIn, user: CurrentUser = Depends(teachers)):
    """A private note on the student's record (never shown to the student)."""
    s = sessions.monitored(user, session_id)
    row = sessions.add_action(s, user, "REMARK", message=body.message)
    return {"action_id": row["action_id"], "created_at": row["created_at"]}


@router.post("/teacher/sessions/{session_id}/warnings", status_code=201)
def warn(session_id: UUID, body: MessageIn, user: CurrentUser = Depends(teachers)):
    """A warning the student sees on screen within ~10 s and must acknowledge."""
    s = sessions.monitored(user, session_id)
    if s["status"] not in ("ACTIVE", "INTERRUPTED", "PRECHECK"):
        raise HTTPException(409, "This session has finished")
    row = sessions.add_action(s, user, "WARNING", message=body.message)
    return {"action_id": row["action_id"], "created_at": row["created_at"]}


class EndIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/teacher/sessions/{session_id}/end")
def end(session_id: UUID, body: EndIn, user: CurrentUser = Depends(teachers)):
    """End the student's exam now: what they saved so far is handed in (online test / lab) and the session closes."""
    return sessions.end_by_teacher(sessions.monitored(user, session_id), user, body.reason.strip())


class ReviewIn(BaseModel):
    outcome: Literal["DISMISSED", "NOTED", "CONCERN"]
    note: str | None = Field(default=None, max_length=1000)


@router.post("/teacher/events/{event_id}/review")
def review(event_id: UUID, body: ReviewIn, user: CurrentUser = Depends(teachers)):
    """DISMISSED: a false positive · NOTED: seen, no action · CONCERN: follow up with the student."""
    return sessions.review_event(user, event_id, body.outcome, (body.note or "").strip() or None)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


async def _stream(request: Request, user: CurrentUser, module: str | None, ref_id: str | None, lifetime: float):
    ensure_bridge()
    sub = hub.subscribe(teacher_channel(user.org_code, user.user_code))
    deadline = time.monotonic() + lifetime
    try:
        yield _sse("hello", {"lifetime_s": int(lifetime), "keepalive_s": KEEPALIVE_SECONDS})
        while True:
            left = deadline - time.monotonic()
            if left <= 0 or await request.is_disconnected():
                break
            try:
                msg = await asyncio.wait_for(sub.get(), timeout=min(KEEPALIVE_SECONDS, left))
            except asyncio.TimeoutError:
                await run_in_threadpool(sessions.sweep, user.org_code)   # surfaces devices that went silent
                yield ": keep-alive\n\n"
                continue
            if module and (msg.get("module") != module or (ref_id and msg.get("ref_id") != ref_id)) and not msg.get("overflow"):
                continue
            yield _sse(msg.get("type", "message"), msg)
        yield _sse("bye", {"reconnect": True})
    finally:
        hub.unsubscribe(sub)


@router.get("/teacher/stream")
async def stream(request: Request, module: ModuleName | None = None, ref_id: str | None = Query(default=None, max_length=400),
                 user: CurrentUser = Depends(teachers)):
    """Live updates for this teacher's sessions. Uses the Authorization header (fetch-based reader on the client); the
    stream closes before the access token expires and the client reconnects with a fresh one."""
    exp = user.get("exp")
    lifetime = STREAM_SECONDS if not exp else max(1.0, min(STREAM_SECONDS, float(exp) - time.time() - 5))
    return StreamingResponse(_stream(request, user, module, ref_id, lifetime), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- settings (org admins edit; teachers read)
def _org(user: CurrentUser, org_code: str | None) -> str:
    if user.role == "superadmin" and org_code:
        return org_code
    if not user.org_code:
        raise HTTPException(422, "Choose an institution")
    return user.org_code


@router.get("/settings")
def get_settings(org_code: str | None = Query(default=None, max_length=64), user: CurrentUser = Depends(readers)):
    return {"modules": sessions.all_settings(_org(user, org_code)), "flags": {c: {"label": f.label, "severity": f.severity,
            "category": f.category} for c, f in cfg.FLAGS.items()}, "limits": cfg.NUMERIC_LIMITS, "severities": cfg.SEVERITIES,
            "editable": user.role in ("orgadmin", "superadmin")}


class SettingsIn(BaseModel):
    enabled: bool | None = None
    camera_required: bool | None = None
    mic_required: bool | None = None
    fullscreen_required: bool | None = None
    detect_multiple_faces: bool | None = None
    detect_looking_away: bool | None = None
    detect_objects: bool | None = None
    detect_voice: bool | None = None
    no_face_seconds: int | None = Field(default=None, ge=2, le=120)
    multiple_faces_seconds: int | None = Field(default=None, ge=1, le=60)
    looking_away_seconds: int | None = Field(default=None, ge=2, le=120)
    camera_blocked_seconds: int | None = Field(default=None, ge=1, le=60)
    window_blur_seconds: int | None = Field(default=None, ge=1, le=60)
    voice_seconds: int | None = Field(default=None, ge=1, le=60)
    voice_db: int | None = Field(default=None, ge=6, le=40)
    object_min_confidence: float | None = Field(default=None, ge=0.3, le=0.95)
    escalate_after_seconds: int | None = Field(default=None, ge=5, le=600)
    repeat_escalation_count: int | None = Field(default=None, ge=2, le=20)
    heartbeat_missing_seconds: int | None = Field(default=None, ge=20, le=600)
    notify_min_severity: Literal["Low", "Medium", "High", "Critical"] | None = None
    notify_cooldown_seconds: int | None = Field(default=None, ge=0, le=3600)
    teacher_can_end: bool | None = None
    notify_on_start: bool | None = None
    retention_days: int | None = Field(default=None, ge=7, le=730)


@router.put("/settings/{module}")
def put_settings(module: ModuleName, body: SettingsIn, org_code: str | None = Query(default=None, max_length=64),
                 user: CurrentUser = Depends(admins)):
    values = body.model_dump(exclude_none=True)
    if not values:
        raise HTTPException(422, "Nothing to change")
    return sessions.save_settings(_org(user, org_code), module, values, user.user_code)
