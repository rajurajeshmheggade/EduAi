"""Exam session state shared by the launch / exam / monitor routers and the report job.

The server is the authority for the deadline, warnings, integrity and every way a session ends:
MANUAL (candidate submits) · TIME_UP (deadline + grace) · AUTO_VIOLATION (§6.3 rules) · ENDED_BY_TEACHER.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from psycopg.types.json import Jsonb

from ... import db
from . import config as cfg
from . import integrity
from .guard import audit

OPEN = ("LAUNCHED", "CONFIRMED", "CHECKED", "IN_PROGRESS", "LOCKED")
DONE = ("SUBMITTED", "ENDED")
CONSENT_VERSION = "2026-10"


def now() -> datetime:
    return datetime.now(timezone.utc)


SESSION_SQL = (
    "SELECT s.*, t.title AS test_title, t.grade_applying AS test_grade, t.instructions, t.duration_minutes, t.sections, t.shuffle, "
    "t.proctoring_config, t.scoring_config, t.created_by AS test_owner, t.status AS test_status, c.full_name, c.dob, c.grade_applying, "
    "c.accommodations, c.guardian_name FROM public.admission_sessions s "
    "JOIN public.admission_tests t ON t.test_id = s.test_id JOIN public.admission_candidates c ON c.candidate_id = s.candidate_id ")


def load(session_id) -> dict | None:
    return db.fetch_one(SESSION_SQL + "WHERE s.session_id = %s", (session_id,))


def eff(s: dict) -> dict:
    return cfg.effective(s["proctoring_config"])


def consent_notice() -> dict:
    days = cfg.TUNABLES["evidence_retention_days"]
    return {"version": CONSENT_VERSION, "captured": [
        "Camera snapshots when the system flags something, plus one presence snapshot about every minute",
        "Screen thumbnails when a flag needs them",
        "Microphone loudness only — sound is never recorded",
        "Browser events such as leaving full screen, switching tabs or copy-paste attempts",
        "One ID photo of your face at the start",
    ], "not_captured": [
        "No continuous video or audio recording",
        "No emotion or facial-expression analysis",
        "Your face template for live matching stays in this browser and is never stored",
    ], "who_sees": "The teacher who runs this test and your school's administrators.",
    "retention": f"Snapshots and detailed events are deleted after {days} days; the result report follows school policy.",
    "deletion": "Your parent or guardian can ask the school to delete your data at any time.",
    "alternative": "If you do not agree, tell your teacher: the school will arrange an alternative way to take the test."}


# ---------------------------------------------------------------- questions for the exam view
def build_order(s: dict, questions: list[dict], seed: int) -> list[dict]:
    """Section order as configured; within a section display order, shuffled with the session seed. Option order is
    shuffled per question; answers always use ORIGINAL option indices so keys never move."""
    rnd = random.Random(seed)
    order = []
    for sec in s["sections"]:
        items = [q for q in questions if q["section"] == sec["key"]]
        if (s["shuffle"] or {}).get("questions", True):
            rnd.shuffle(items)
        for q in items:
            idx = list(range(len(q["options"] or [])))
            if idx and (s["shuffle"] or {}).get("options", True):
                rnd.shuffle(idx)
            order.append({"question_id": str(q["question_id"]), "options": idx})
    return order


def candidate_questions(s: dict) -> list[dict]:
    """Questions as the candidate sees them: NO answer keys, rubrics, model answers or HQ dimensions."""
    rows = {str(q["question_id"]): q for q in db.fetch_all(
        "SELECT question_id, section, qtype, prompt, options, marks FROM public.admission_questions WHERE test_id = %s", (s["test_id"],))}
    sections = {x["key"]: x for x in s["sections"]}
    out = []
    for n, o in enumerate(s["question_order"] or [], 1):
        q = rows.get(o["question_id"])
        if not q:
            continue
        hq = sections.get(q["section"], {}).get("kind") == "HQ"
        out.append({"question_id": o["question_id"], "number": n, "section": q["section"], "qtype": q["qtype"], "prompt": q["prompt"],
                    "options": [{"id": i, "text": q["options"][i]} for i in o["options"]],
                    "marks": None if hq else float(q["marks"])})
    return out


# ---------------------------------------------------------------- events and integrity
def is_calibration(s: dict, at: datetime) -> bool:
    started = s.get("started_at")
    return started is None or at < started + timedelta(seconds=cfg.TUNABLES["calibration_seconds"])


def insert_event(conn, s: dict, code: str, *, seq: int | None = None, client_ts=None, duration_ms: int = 0, confidence=None,
                 details: dict | None = None, at: datetime | None = None) -> dict | None:
    """Append one event. Severity and points come from the catalogue (the client never decides them)."""
    f = cfg.FLAGS[code]
    at = at or now()
    e = eff(s)
    calibration = code not in cfg.NOT_FLAGS and is_calibration(s, at)
    points = 0 if calibration or not e["rules"].get(code, True) else integrity.event_points(code, duration_ms, e["points"])
    return conn.execute(
        "INSERT INTO public.admission_proctor_events (session_id, seq, code, severity, points, client_ts, server_ts, duration_ms, "
        "confidence, details, calibration) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (session_id, seq) DO NOTHING "
        "RETURNING event_id, seq, code, severity, calibration",
        (s["session_id"], seq, code, f.severity, points, client_ts, at, duration_ms, confidence, Jsonb(details) if details else None,
         calibration)).fetchone()


def events_of(session_id, conn=None) -> list[dict]:
    sql = ("SELECT event_id, seq, code, severity, points, client_ts, server_ts, duration_ms, confidence, details, evidence_key, calibration "
           "FROM public.admission_proctor_events WHERE session_id = %s ORDER BY server_ts, event_id")
    return list(conn.execute(sql, (session_id,)).fetchall()) if conn else db.fetch_all(sql, (session_id,))


def recompute(conn, s: dict) -> dict:
    r = integrity.evaluate(events_of(s["session_id"], conn), eff(s))
    conn.execute("UPDATE public.admission_sessions SET warnings_count = %s, critical_count = %s, integrity_score = %s, integrity_band = %s, "
                 "updated_at = NOW() WHERE session_id = %s", (r["warnings"], r["critical"], r["score"], r["band"], s["session_id"]))
    s.update(warnings_count=r["warnings"], critical_count=r["critical"], integrity_score=r["score"], integrity_band=r["band"])
    return r


def finish(s: dict, reason: str, *, actor: str | None = None, role: str | None = None, details: dict | None = None) -> bool:
    """End an open session once (idempotent). Answers saved so far are kept and scored."""
    status = "ENDED" if reason == "ENDED_BY_TEACHER" else "SUBMITTED"
    with db.connection() as conn:
        row = conn.execute(
            "UPDATE public.admission_sessions SET status = %s, submitted_at = NOW(), submit_reason = %s, active_page_id = NULL, "
            "updated_at = NOW() WHERE session_id = %s AND status IN ('LAUNCHED','CONFIRMED','CHECKED','IN_PROGRESS','LOCKED') RETURNING session_id",
            (status, reason, s["session_id"])).fetchone()
        if not row:
            return False
        recompute(conn, s)
        audit(s["org_code"], f"session_{reason.lower()}", actor=actor, role=role, test_id=s["test_id"], session_id=s["session_id"],
              details=details, conn=conn)
    s.update(status=status, submit_reason=reason)
    if s.get("started_at"):
        from .report import schedule

        schedule(s["session_id"])
    return True


def expire_if_due(s: dict) -> bool:
    """Deadline + grace passed while in progress -> auto-submit TIME_UP."""
    if s["status"] == "IN_PROGRESS" and s["deadline_at"] and now() > s["deadline_at"] + timedelta(seconds=cfg.TUNABLES["grace_seconds"]):
        return finish(s, "TIME_UP")
    return False


def heartbeat_gap(conn, s: dict, at: datetime) -> dict | None:
    """Raise HEARTBEAT_MISSING once per gap > 30 s while the session is in progress."""
    last = s.get("last_heartbeat_at") or s.get("started_at")
    if s["status"] != "IN_PROGRESS" or not last:
        return None
    gap = (at - last).total_seconds()
    if gap <= cfg.TUNABLES["heartbeat_missing_s"]:
        return None
    seen = conn.execute("SELECT 1 FROM public.admission_proctor_events WHERE session_id = %s AND code = 'HEARTBEAT_MISSING' AND server_ts >= %s",
                        (s["session_id"], last)).fetchone()
    if seen:
        return None
    return insert_event(conn, s, "HEARTBEAT_MISSING", duration_ms=int(gap * 1000), details={"gap_s": round(gap)}, at=at)


def sweep(org_code: str, test_ids: list | None = None) -> None:
    """Monitor polls run this: time-up auto-submits and HEARTBEAT_MISSING for clients that went silent."""
    rows = db.fetch_all(SESSION_SQL + "WHERE s.org_code = %s AND s.status = 'IN_PROGRESS' AND (%s::uuid[] IS NULL OR s.test_id = ANY(%s::uuid[]))",
                        (org_code, test_ids, test_ids))
    for s in rows:
        if expire_if_due(s):
            continue
        with db.connection() as conn:
            r = recompute(conn, s) if heartbeat_gap(conn, s, now()) else None
        if r and r["auto_submit"]:
            finish(s, "AUTO_VIOLATION", details={"rule": r["auto_submit"]})
