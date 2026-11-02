"""Admission tests — supervised launch, the exam view (exam token only) and the live monitor.

Teacher JWT:   POST /launches · POST /sessions/{id}/end · GET /live
Exam token:    GET /session · POST /session/{claim, release, confirm, consent, system-check, id-photo, start, events,
               heartbeat, evidence, submit, supervisor-end} · PUT /session/answers/{question_id} · GET /session/{status, ping}

The exam token is 32 random bytes shown once; only its SHA-256 is stored. It is bound to the session, the launching
teacher and the device id generated at launch, and is accepted only here (it is not a JWT, so every other route
refuses it). Teacher JWTs are not accepted on /session/*.
"""
from __future__ import annotations

import io
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..security import CurrentUser, authenticate, require_role
from ..services.admission_test import config as cfg
from ..services.admission_test import guard, sessions
from ..services.admission_test.scoring import normalise_answer
from ..services.admission_test.sessions import now
from ..services.storage import get_storage
from .admission_tests import age_on, candidate_for, org_of, test_for

router = APIRouter(prefix="/ICMELive/api/v1/admission", tags=["admission-exam"], dependencies=[Depends(guard.no_store)])
teachers = require_role("teacher")
monitors = require_role("teacher", "orgadmin", "superadmin")

T = cfg.TUNABLES
ID_PHOTO_MAX = 300 * 1024
EVIDENCE_MAX = 200 * 1024


# ---------------------------------------------------------------- media
def clean_jpeg(data: bytes, max_bytes: int, max_side: int = 1280) -> bytes:
    """JPEG only (magic bytes), size-checked, re-encoded so EXIF and any trailing payload are dropped."""
    if len(data) > max_bytes:
        raise HTTPException(413, f"Image larger than {max_bytes // 1024} KB")
    if not data.startswith(b"\xff\xd8\xff"):
        raise HTTPException(415, "Only JPEG images are accepted")
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:  # noqa: BLE001
        raise HTTPException(415, "The image could not be read") from None
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=80, optimize=True)
    return out.getvalue()


def _store_image(s: dict, name: str, data: bytes) -> str:
    key = f"admission-tests/{s['org_code']}/{s['session_id']}/{name}.jpg"
    get_storage().put(key, data, "image/jpeg")
    return key


# ---------------------------------------------------------------- teacher: launch / end
class GuardianConsent(BaseModel):
    guardian_name: str = Field(min_length=2, max_length=200)
    relationship: str = Field(min_length=2, max_length=60)
    method: Literal["in_person", "signed_form", "otp"]


class LaunchIn(BaseModel):
    test_id: UUID
    candidate_id: UUID
    device_id: str = Field(pattern=r"^[A-Za-z0-9_-]{16,64}$")
    guardian_consent: GuardianConsent | None = None


@router.post("/launches", status_code=201)
def launch(body: LaunchIn, user: CurrentUser = Depends(teachers)):
    """Create (or re-launch) the candidate's session on this device and return the exam token ONCE."""
    t = test_for(user, body.test_id, write=True)
    if t["status"] != "PUBLISHED":
        raise HTTPException(409, "Publish the test before launching it")
    c = candidate_for(user, body.candidate_id, own=False)
    minor = age_on(c["dob"]) < 18
    consent = None
    if minor:
        if not body.guardian_consent:
            raise HTTPException(422, "The candidate is under 18: confirm guardian consent before launching")
        if body.guardian_consent.method == "otp":
            raise HTTPException(422, "OTP consent needs an SMS / email sender, which is not configured. Use in-person or a signed form.")
        consent = {**body.guardian_consent.model_dump(), "confirmed_by": user.user_code, "confirmed_at": now().isoformat()}
    if db.fetch_one("SELECT 1 FROM public.admission_sessions WHERE test_id = %s AND candidate_id = %s AND status IN ('SUBMITTED','ENDED')",
                    (body.test_id, body.candidate_id)):
        raise HTTPException(409, "This candidate has already completed this test")
    token, token_hash = guard.new_exam_token()
    expires = now() + timedelta(minutes=T["exam_token_ttl_minutes"])
    with db.connection() as conn:
        open_s = conn.execute("SELECT session_id, status FROM public.admission_sessions WHERE test_id = %s AND candidate_id = %s "
                              "AND status IN ('LAUNCHED','CONFIRMED','CHECKED','IN_PROGRESS','LOCKED') FOR UPDATE",
                              (body.test_id, body.candidate_id)).fetchone()
        if open_s:
            # Re-launch on this device (browser closed, DOB lock cleared by the teacher): the old token stops working.
            row = conn.execute(
                "UPDATE public.admission_sessions SET exam_token_hash = %s, token_expires_at = %s, device_id = %s, launched_by = %s, "
                "active_page_id = NULL, dob_attempts = 0, status = CASE WHEN status = 'LOCKED' THEN 'LAUNCHED' ELSE status END, "
                "guardian_consent = COALESCE(%s, guardian_consent), updated_at = NOW() WHERE session_id = %s RETURNING session_id, status",
                (token_hash, expires, body.device_id, user.user_code, Jsonb(consent) if consent else None, open_s["session_id"])).fetchone()
            action = "session_relaunched"
        else:
            row = conn.execute(
                "INSERT INTO public.admission_sessions (test_id, candidate_id, org_code, launched_by, exam_token_hash, token_expires_at, "
                "device_id, guardian_consent) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING session_id, status",
                (body.test_id, body.candidate_id, user.org_code, user.user_code, token_hash, expires, body.device_id,
                 Jsonb(consent) if consent else None)).fetchone()
            action = "session_launched"
        guard.audit(user.org_code, action, actor=user.user_code, role=user.role, test_id=body.test_id, session_id=row["session_id"],
                    details={"candidate_id": str(body.candidate_id), "minor": minor, "guardian_consent": bool(consent)}, conn=conn)
    return {"session_id": row["session_id"], "exam_token": token, "expires_at": expires, "candidate_name": c["full_name"],
            "status": row["status"]}


def _monitored(user: CurrentUser, session_id: UUID) -> dict:
    s = sessions.load(session_id)
    if not s or s["org_code"] != org_of(user) or (user.role == "teacher" and user.user_code not in (s["launched_by"], s["test_owner"])):
        raise HTTPException(404, "Session not found")
    return s


@router.post("/sessions/{session_id}/end")
def end_session(session_id: UUID, user: CurrentUser = Depends(teachers)):
    """The teacher ends a session from the live monitor (any device)."""
    s = _monitored(user, session_id)
    if s["status"] not in sessions.OPEN:
        raise HTTPException(409, "This session has already ended")
    sessions.finish(s, "ENDED_BY_TEACHER", actor=user.user_code, role=user.role, details={"via": "monitor"})
    return {"status": "ENDED", "submit_reason": "ENDED_BY_TEACHER"}


@router.get("/live")
def live(test_id: UUID | None = None, since: datetime | None = None, user: CurrentUser = Depends(monitors)):
    """Open sessions with progress, time left, status chips, integrity and the latest flags; new High / Critical flags
    since `since` for alerts. Also sweeps time-ups and silent clients."""
    org = org_of(user)
    if test_id:
        test_for(user, test_id)
    sessions.sweep(org, [test_id] if test_id else None)
    rows = db.fetch_all(
        sessions.SESSION_SQL + "WHERE s.org_code = %s AND (s.status IN ('LAUNCHED','CONFIRMED','CHECKED','IN_PROGRESS','LOCKED') "
        "OR s.submitted_at > NOW() - interval '30 minutes') AND (%s::uuid IS NULL OR s.test_id = %s::uuid) "
        "AND (%s::text IS NULL OR s.launched_by = %s::text OR t.created_by = %s::text) ORDER BY s.launched_at DESC",
        (org, test_id, test_id, *([user.user_code] * 3 if user.role == "teacher" else [None] * 3)))
    ids = [r["session_id"] for r in rows]
    counts = {r["session_id"]: r for r in db.fetch_all(
        "SELECT s.session_id, (SELECT COUNT(*) FROM jsonb_array_elements(s.question_order)) AS total, "
        "(SELECT COUNT(*) FROM public.admission_answers a WHERE a.session_id = s.session_id AND a.answer IS NOT NULL) AS answered "
        "FROM public.admission_sessions s WHERE s.session_id = ANY(%s)", (ids,))} if ids else {}
    flags = db.fetch_all(
        "SELECT session_id, event_id, code, severity, server_ts, duration_ms, calibration FROM public.admission_proctor_events "
        "WHERE session_id = ANY(%s) AND severity IN ('Med','High','Crit') ORDER BY server_ts DESC", (ids,)) if ids else []
    out, alerts = [], []
    t_now = now()
    for r in rows:
        mine = [f for f in flags if f["session_id"] == r["session_id"]]
        c = counts.get(r["session_id"], {})
        out.append({
            "session_id": r["session_id"], "test_id": r["test_id"], "test_title": r["test_title"], "candidate_name": r["full_name"],
            "status": r["status"], "submit_reason": r["submit_reason"], "answered": c.get("answered", 0), "total": c.get("total", 0),
            "seconds_left": max(0, int((r["deadline_at"] - t_now).total_seconds())) if r["deadline_at"] and r["status"] == "IN_PROGRESS" else None,
            "chips": r["last_status"] or {}, "last_heartbeat_at": r["last_heartbeat_at"],
            "heartbeat_stale": bool(r["status"] == "IN_PROGRESS" and r["last_heartbeat_at"] and (t_now - r["last_heartbeat_at"]).total_seconds() > 30),
            "integrity_score": r["integrity_score"], "integrity_band": r["integrity_band"], "warnings": r["warnings_count"],
            "max_warnings": cfg.effective(r["proctoring_config"])["max_warnings"], "dob_locked": r["status"] == "LOCKED",
            "latest_flags": [{"code": f["code"], "label": cfg.FLAGS[f["code"]].label, "severity": f["severity"], "at": f["server_ts"]}
                             for f in mine[:3]]})
        if since:
            alerts += [{"session_id": r["session_id"], "candidate_name": r["full_name"], "code": f["code"], "label": cfg.FLAGS[f["code"]].label,
                        "severity": f["severity"], "at": f["server_ts"]}
                       for f in mine if f["server_ts"] > since and f["severity"] in ("High", "Crit") and not f["calibration"]]
    return {"sessions": out, "alerts": alerts, "server_time": t_now}


# ---------------------------------------------------------------- exam token
def exam_session(request: Request, x_exam_token: str | None = Header(default=None), x_device_id: str | None = Header(default=None),
                 x_page_id: str | None = Header(default=None)) -> dict:
    if not x_exam_token or len(x_exam_token) > 100:
        raise HTTPException(401, "Exam token required")
    s = db.fetch_one(sessions.SESSION_SQL + "WHERE s.exam_token_hash = %s", (guard.hash_token(x_exam_token),))
    if not s:
        raise HTTPException(401, "This exam token is not valid")
    if s["token_expires_at"] and s["token_expires_at"] < now():
        raise HTTPException(401, "This exam launch has expired. Ask your teacher to launch it again.")
    if not x_device_id or x_device_id != s["device_id"]:
        raise HTTPException(401, "This exam was launched on another device")
    guard.limiter.hit(f"adm-req:{s['session_id']}", 900, 60)
    path = request.url.path
    claiming = path.endswith("/session/claim") or path.endswith("/session/release")
    if not claiming and s["active_page_id"]:
        if x_page_id != s["active_page_id"]:
            raise HTTPException(409, "This exam is open in another tab or window")
        db.execute("UPDATE public.admission_sessions SET page_seen_at = NOW() WHERE session_id = %s", (s["session_id"],))
    s["page_id"] = x_page_id
    return s


def _status(s: dict) -> dict:
    e = sessions.eff(s)
    return {"status": s["status"], "submit_reason": s["submit_reason"], "warnings_count": s["warnings_count"],
            "max_warnings": e["max_warnings"], "deadline_at": s["deadline_at"], "server_time": now(),
            "ended": s["status"] in sessions.DONE, "locked": s["status"] == "LOCKED"}


def _view(s: dict) -> dict:
    acc = s["accommodations"] or {}
    counts = {}
    for q in db.fetch_all("SELECT section, COUNT(*) AS n FROM public.admission_questions WHERE test_id = %s GROUP BY section", (s["test_id"],)):
        counts[q["section"]] = q["n"]
    info = s["client_info"] or {}
    out = {
        "session_id": s["session_id"], **_status(s),
        "candidate": {"full_name": s["full_name"], "first_name": s["full_name"].split()[0]},
        "test": {"title": s["test_title"], "grade_applying": s["test_grade"], "instructions": s["instructions"],
                 "duration_minutes": s["duration_minutes"], "extra_time_minutes": acc.get("extra_time_minutes", 0),
                 "sections": [{**x, "count": counts.get(x["key"], 0)} for x in s["sections"]]},
        "rules": cfg.client_rules(s["proctoring_config"], disable_voice=bool(acc.get("disable_voice_flag"))),
        "consent_notice": sessions.consent_notice(),
        "steps": {"confirmed": s["status"] not in ("LAUNCHED", "LOCKED"), "consent": bool(s["consent_at"]),
                  "system_check": bool(info.get("system_check_ok")), "id_photo": bool(s["id_photo_key"]),
                  "started": s["started_at"] is not None},
        "started_at": s["started_at"],
    }
    if s["status"] == "IN_PROGRESS":
        out["questions"] = sessions.candidate_questions(s)
        out["answers"] = {str(a["question_id"]): a["answer"] for a in db.fetch_all(
            "SELECT question_id, answer FROM public.admission_answers WHERE session_id = %s", (s["session_id"],))}
    return out


@router.get("/session")
def session_view(s: dict = Depends(exam_session)):
    sessions.expire_if_due(s)
    return _view(sessions.load(s["session_id"]))


class PageIn(BaseModel):
    page_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")


@router.post("/session/claim")
def claim(body: PageIn, s: dict = Depends(exam_session)):
    """One page at a time. A reload releases the old page first (keepalive request on pagehide); a second live tab or
    device is refused with 409 and SECOND_SESSION. A page silent for 20 s is treated as closed and taken over."""
    if s["status"] in sessions.DONE:
        return _status(s)
    stale = not s["page_seen_at"] or (now() - s["page_seen_at"]).total_seconds() > 20
    if s["active_page_id"] and s["active_page_id"] != body.page_id and not stale:
        with db.connection() as conn:
            sessions.insert_event(conn, s, "SECOND_SESSION", details={"refused_page": body.page_id[:16]})
            r = sessions.recompute(conn, s)
        if r["auto_submit"]:
            sessions.finish(s, "AUTO_VIOLATION", details={"rule": r["auto_submit"]})
        raise HTTPException(409, "This exam is already open in another tab or window")
    with db.connection() as conn:
        conn.execute("UPDATE public.admission_sessions SET active_page_id = %s, page_seen_at = NOW(), page_claims = page_claims + 1 "
                     "WHERE session_id = %s", (body.page_id, s["session_id"]))
        if s["page_claims"] >= 1 and s["status"] == "IN_PROGRESS":
            sessions.insert_event(conn, s, "PAGE_RELOAD", details={"claims": s["page_claims"] + 1})
            sessions.recompute(conn, s)
    return _status(s)


@router.post("/session/release")
def release(body: PageIn, s: dict = Depends(exam_session)):
    db.execute("UPDATE public.admission_sessions SET active_page_id = NULL WHERE session_id = %s AND active_page_id = %s",
               (s["session_id"], body.page_id))
    return {"released": True}


class ConfirmIn(BaseModel):
    dob: date


@router.post("/session/confirm")
def confirm(body: ConfirmIn, s: dict = Depends(exam_session)):
    if s["status"] == "LOCKED":
        raise HTTPException(423, "Too many attempts. Please ask your teacher.")
    if s["status"] != "LAUNCHED":
        return _view(s)
    if body.dob == s["dob"]:
        db.execute("UPDATE public.admission_sessions SET status = 'CONFIRMED', updated_at = NOW() WHERE session_id = %s AND status = 'LAUNCHED'",
                   (s["session_id"],))
        return _view(sessions.load(s["session_id"]))
    attempts = s["dob_attempts"] + 1
    locked = attempts >= T["dob_attempts"]
    with db.connection() as conn:
        conn.execute("UPDATE public.admission_sessions SET dob_attempts = %s, status = CASE WHEN %s THEN 'LOCKED' ELSE status END, "
                     "updated_at = NOW() WHERE session_id = %s", (attempts, locked, s["session_id"]))
        if locked:
            guard.audit(s["org_code"], "session_locked_dob", test_id=s["test_id"], session_id=s["session_id"], conn=conn)
    if locked:
        raise HTTPException(423, "Too many attempts. Please ask your teacher.")
    left = T["dob_attempts"] - attempts
    raise HTTPException(422, f"That date of birth does not match. {left} attempt{'s' if left != 1 else ''} left.")


def _need(s: dict, *statuses: str) -> None:
    if s["status"] not in statuses:
        raise HTTPException(409, "This step is not available now")


def _maybe_checked(session_id) -> dict:
    s = sessions.load(session_id)
    if s["status"] == "CONFIRMED" and s["consent_at"] and s["id_photo_key"] and (s["client_info"] or {}).get("system_check_ok"):
        db.execute("UPDATE public.admission_sessions SET status = 'CHECKED' WHERE session_id = %s AND status = 'CONFIRMED'", (session_id,))
        s = sessions.load(session_id)
    return s


class ConsentIn(BaseModel):
    accepted: bool
    notice_version: str = Field(max_length=16)


@router.post("/session/consent")
def consent(body: ConsentIn, s: dict = Depends(exam_session)):
    _need(s, "CONFIRMED", "CHECKED")
    if not body.accepted:
        raise HTTPException(422, "Consent is needed to take the proctored test. Ask your teacher about an alternative arrangement.")
    if body.notice_version != sessions.CONSENT_VERSION:
        raise HTTPException(409, "The notice has changed. Please read it again.")
    db.execute("UPDATE public.admission_sessions SET consent_at = NOW(), consent_version = %s WHERE session_id = %s",
               (body.notice_version, s["session_id"]))
    return _view(_maybe_checked(s["session_id"]))


class SystemCheckIn(BaseModel):
    secure_context: bool
    screens_extended: bool | None = None
    camera: bool
    camera_label: str | None = Field(default=None, max_length=200)
    virtual_camera_suspected: bool = False
    microphone: bool
    face_ok: bool
    screen_surface: str | None = Field(default=None, max_length=20)
    fullscreen: bool
    network_ms: float | None = Field(default=None, ge=0, le=60000)
    models_ready: bool
    browser: str | None = Field(default=None, max_length=200)
    screen: str | None = Field(default=None, max_length=40)


@router.post("/session/system-check")
def system_check(body: SystemCheckIn, s: dict = Depends(exam_session)):
    """Stores the environment for the report and enforces the required checks server-side too."""
    _need(s, "CONFIRMED", "CHECKED")
    e = sessions.eff(s)
    failed = []
    if not body.secure_context:
        failed.append("secure connection")
    if body.screens_extended:
        failed.append("single screen")
    if e["require_camera"] and not (body.camera and body.face_ok):
        failed.append("camera and face")
    if e["require_screen_share"] and body.screen_surface != "monitor":
        failed.append("entire-screen sharing")
    if not body.fullscreen:
        failed.append("full screen")
    if not body.models_ready:
        failed.append("proctoring models")
    info = {**(s["client_info"] or {}), **body.model_dump(), "system_check_ok": not failed, "checked_at": now().isoformat()}
    db.execute("UPDATE public.admission_sessions SET client_info = %s WHERE session_id = %s", (Jsonb(info), s["session_id"]))
    if failed:
        raise HTTPException(422, "Fix these checks first: " + ", ".join(failed))
    return _view(_maybe_checked(s["session_id"]))


@router.post("/session/id-photo")
def id_photo(file: UploadFile = File(...), s: dict = Depends(exam_session)):
    _need(s, "CONFIRMED", "CHECKED")
    if not s["consent_at"]:
        raise HTTPException(409, "Consent comes before the ID photo")
    data = clean_jpeg(file.file.read(ID_PHOTO_MAX + 1), ID_PHOTO_MAX, 640)
    key = _store_image(s, "id-photo", data)
    db.execute("UPDATE public.admission_sessions SET id_photo_key = %s WHERE session_id = %s", (key, s["session_id"]))
    return _view(_maybe_checked(s["session_id"]))


@router.post("/session/start")
def start(s: dict = Depends(exam_session)):
    """The server sets the deadline; questions are released (shuffled, without any keys) only now."""
    if s["status"] == "IN_PROGRESS":
        return _view(s)
    _need(s, "CHECKED")
    questions = db.fetch_all("SELECT question_id, section, options FROM public.admission_questions WHERE test_id = %s AND status = 'APPROVED' "
                             "ORDER BY display_order, created_at", (s["test_id"],))
    seed = int.from_bytes(uuid4().bytes[:6], "big")
    order = sessions.build_order(s, questions, seed)
    minutes = s["duration_minutes"] + int((s["accommodations"] or {}).get("extra_time_minutes", 0) or 0)
    with db.connection() as conn:
        row = conn.execute(
            "UPDATE public.admission_sessions SET status = 'IN_PROGRESS', started_at = NOW(), deadline_at = NOW() + make_interval(mins => %s), "
            "seed = %s, question_order = %s, last_heartbeat_at = NOW(), updated_at = NOW() WHERE session_id = %s AND status = 'CHECKED' "
            "RETURNING session_id", (minutes, seed, Jsonb(order), s["session_id"])).fetchone()
        if row:
            guard.audit(s["org_code"], "session_started", test_id=s["test_id"], session_id=s["session_id"], conn=conn)
    return _view(sessions.load(s["session_id"]))


class AnswerIn(BaseModel):
    answer: dict | None = None
    time_spent_ms: int = Field(default=0, ge=0, le=3_600_000)


def _in_progress(s: dict) -> dict:
    if sessions.expire_if_due(s):
        raise HTTPException(409, "Time is up. Your answers have been submitted.")
    if s["status"] != "IN_PROGRESS":
        raise HTTPException(409, "The test is not in progress")
    return s


@router.put("/session/answers/{question_id}")
def save_answer(question_id: UUID, body: AnswerIn, s: dict = Depends(exam_session)):
    _in_progress(s)
    if str(question_id) not in {o["question_id"] for o in s["question_order"] or []}:
        raise HTTPException(404, "Question not found")
    q = db.fetch_one("SELECT qtype, options FROM public.admission_questions WHERE question_id = %s", (question_id,))
    try:
        answer = normalise_answer(q, body.answer, T["max_answer_chars"])
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    elapsed_ms = int((now() - s["started_at"]).total_seconds() * 1000)
    row = db.fetch_one(
        "INSERT INTO public.admission_answers (session_id, question_id, answer, saved_at, time_spent_ms) VALUES (%s,%s,%s,NOW(),LEAST(%s,%s)) "
        "ON CONFLICT (session_id, question_id) DO UPDATE SET answer = EXCLUDED.answer, saved_at = NOW(), "
        "time_spent_ms = LEAST(public.admission_answers.time_spent_ms + %s, %s) RETURNING saved_at, time_spent_ms",
        (s["session_id"], question_id, Jsonb(answer) if answer is not None else None, body.time_spent_ms, elapsed_ms,
         body.time_spent_ms, elapsed_ms))
    return {"saved_at": row["saved_at"], "time_spent_ms": row["time_spent_ms"]}


class EventIn(BaseModel):
    seq: int = Field(ge=1, le=10_000_000)
    code: str = Field(max_length=32)
    client_ts: datetime | None = None
    duration_ms: int = Field(default=0, ge=0, le=86_400_000)
    confidence: float | None = Field(default=None, ge=0, le=1)
    details: dict = Field(default_factory=dict)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        if v not in cfg.CLIENT_CODES:
            raise ValueError("unknown event code")
        return v

    @field_validator("details")
    @classmethod
    def _details(cls, v: dict) -> dict:
        if len(str(v)) > 2000:
            raise ValueError("event details too large")
        return v


class EventsIn(BaseModel):
    events: list[EventIn] = Field(min_length=1, max_length=50)


@router.post("/session/events")
def events(body: EventsIn, s: dict = Depends(exam_session)):
    """Append-only, idempotent by seq. Severity / points / warnings / integrity / auto-submit are decided here."""
    if s["status"] != "IN_PROGRESS":
        return {**_status(s), "accepted": []}
    for _ in body.events:
        guard.limiter.hit(f"adm-ev:{s['session_id']}", T["max_events_per_minute"], 60, message="Too many proctoring events")
    accepted = []
    with db.connection() as conn:
        for e in body.events:
            row = sessions.insert_event(conn, s, e.code, seq=e.seq, client_ts=e.client_ts, duration_ms=e.duration_ms,
                                        confidence=e.confidence, details=e.details)
            accepted.append(e.seq)
            if row is None:
                continue  # duplicate seq (retry) — already stored
        r = sessions.recompute(conn, s)
    if r["auto_submit"]:
        sessions.finish(s, "AUTO_VIOLATION", details={"rule": r["auto_submit"]})
    return {**_status(s), "accepted": accepted}


class HeartbeatIn(BaseModel):
    fullscreen: bool
    visible: bool
    faces: int | None = Field(default=None, ge=0, le=10)
    camera_live: bool
    screen_live: bool
    mic_live: bool = True
    online: bool = True
    answered: int = Field(default=0, ge=0, le=1000)
    fps: float | None = Field(default=None, ge=0, le=120)


@router.post("/session/heartbeat")
def heartbeat(body: HeartbeatIn, s: dict = Depends(exam_session)):
    if sessions.expire_if_due(s) or s["status"] != "IN_PROGRESS":
        return {**_status(sessions.load(s["session_id"])), "server_flags": []}
    at = now()
    with db.connection() as conn:
        raised = sessions.heartbeat_gap(conn, s, at)
        conn.execute("UPDATE public.admission_sessions SET last_heartbeat_at = %s, last_status = %s WHERE session_id = %s",
                     (at, Jsonb(body.model_dump()), s["session_id"]))
        r = sessions.recompute(conn, s) if raised else None
    if r and r["auto_submit"]:
        sessions.finish(s, "AUTO_VIOLATION", details={"rule": r["auto_submit"]})
    return {**_status(s), "server_flags": [{"code": raised["code"], "label": cfg.FLAGS[raised["code"]].label,
                                            "calibration": raised["calibration"]}] if raised else []}


@router.post("/session/evidence")
def evidence(file: UploadFile = File(...), kind: Literal["webcam", "screen", "presence"] = Form(...), seq: int | None = Form(default=None),
             s: dict = Depends(exam_session)):
    """One JPEG per flagged event (or a sparse presence snapshot). ≤ 200 KB, re-encoded, linked by seq.
    Evidence for an already-stored event is still accepted for 2 minutes after the session ends (the event that
    triggered an auto-submit usually has its snapshot in flight)."""
    late_ok = (s["status"] in sessions.DONE and seq is not None and kind != "presence" and s["submitted_at"]
               and (now() - s["submitted_at"]).total_seconds() < 120)
    if s["status"] != "IN_PROGRESS" and not late_ok:
        raise HTTPException(409, "The test is not in progress")
    used = db.fetch_one("SELECT COUNT(*) AS n FROM public.admission_proctor_events WHERE session_id = %s AND evidence_key IS NOT NULL",
                        (s["session_id"],))["n"]
    if used >= T["max_evidence_per_session"]:
        raise HTTPException(429, "Evidence limit reached for this session")
    data = clean_jpeg(file.file.read(EVIDENCE_MAX + 1), EVIDENCE_MAX, 640)
    if kind == "presence":
        key = _store_image(s, f"presence-{uuid4().hex[:12]}", data)
        with db.connection() as conn:
            row = sessions.insert_event(conn, s, "PRESENCE_SNAPSHOT", details={"kind": "webcam"})
            conn.execute("UPDATE public.admission_proctor_events SET evidence_key = %s WHERE event_id = %s", (key, row["event_id"]))
        return {"stored": True, "event_id": row["event_id"]}
    if seq is None:
        raise HTTPException(422, "seq is required for flag evidence")
    ev = db.fetch_one("SELECT event_id, evidence_key FROM public.admission_proctor_events WHERE session_id = %s AND seq = %s",
                      (s["session_id"], seq))
    if not ev:
        raise HTTPException(404, "Send the event before its evidence")
    if ev["evidence_key"]:
        return {"stored": False, "event_id": ev["event_id"]}
    key = _store_image(s, f"{kind}-{seq}-{uuid4().hex[:8]}", data)
    db.execute("UPDATE public.admission_proctor_events SET evidence_key = %s, details = COALESCE(details, '{}'::jsonb) || %s "
               "WHERE event_id = %s", (key, Jsonb({"evidence": kind}), ev["event_id"]))
    return {"stored": True, "event_id": ev["event_id"]}


@router.post("/session/submit")
def submit(s: dict = Depends(exam_session)):
    if s["status"] in sessions.DONE:
        return _status(s)
    _in_progress(s)
    sessions.finish(s, "MANUAL")
    return _status(sessions.load(s["session_id"]))


class SupervisorIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


@router.post("/session/supervisor-end")
def supervisor_end(body: SupervisorIn, s: dict = Depends(exam_session)):
    """The launching teacher (or an org admin) ends the session at the exam device with their password."""
    if s["status"] in sessions.DONE:
        return _status(s)
    key = f"adm-sup:{s['session_id']}"
    if guard.limiter.count(key, 600) >= T["supervisor_auth_attempts"]:
        raise HTTPException(429, "Too many attempts. Try again in 10 minutes or end the session from the live monitor.")
    u = authenticate(body.email.strip(), body.password, s["org_code"])
    if not u or not u.get("is_active", True) or not (u["user_code"] == s["launched_by"] or u["user_role"] == "orgadmin"):
        guard.limiter.hit(key, T["supervisor_auth_attempts"], 600)
        with db.connection() as conn:
            if s["status"] == "IN_PROGRESS":
                sessions.insert_event(conn, s, "SUPERVISOR_AUTH_FAILED")
                sessions.recompute(conn, s)
            guard.audit(s["org_code"], "supervisor_auth_failed", test_id=s["test_id"], session_id=s["session_id"],
                        details={"email": body.email.strip()[:254]}, conn=conn)
        raise HTTPException(401, "Those details are not the launching teacher's (or an admin's)")
    sessions.finish(s, "ENDED_BY_TEACHER", actor=u["user_code"], role=u["user_role"], details={"via": "supervisor"})
    return _status(sessions.load(s["session_id"]))


@router.get("/session/status")
def status(s: dict = Depends(exam_session)):
    sessions.expire_if_due(s)
    return _status(sessions.load(s["session_id"]))


@router.get("/session/ping")
def ping(s: dict = Depends(exam_session)):
    return {"server_time": now()}
