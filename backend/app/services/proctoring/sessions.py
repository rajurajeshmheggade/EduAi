"""Student proctoring sessions: lifecycle, the flag log, teacher actions, notifications and the real-time feed.

Lifecycle   PRECHECK (preparation window) -> ACTIVE (rules acknowledged, device checks passed) <-> INTERRUPTED (left the
            page / stopped reporting) -> SUBMITTED | ENDED_BY_TEACHER | CLOSED (AI Classroom closed, or the preparation
            window was closed before starting).
Events      append-only, idempotent by (session, seq); severity from config.severity_for, never from the device.
Real time   every change is published to the assigned teachers' hub channels; "student started" and alerts at or above
            the module's notify_min_severity also land in their notification inbox (with a per-code cooldown).
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from ... import db
from ...security import CurrentUser
from .. import notifications as notif
from . import config as cfg
from . import exams
from .hub import ensure_bridge, hub, teacher_channel

SESSION_SQL = (
    "SELECT s.*, u.full_name AS student_name, u.roll_number, c.class_name FROM public.proctor_sessions s "
    "LEFT JOIN public.app_users u ON u.org_code = s.org_code AND u.user_code = s.student_code "
    "LEFT JOIN public.classes c ON c.org_code = s.org_code AND c.class_code = s.class_code ")
PRECHECK_STALE_MINUTES = 30
SETTINGS_HISTORY = 50          # settings changes kept in proctor_settings.history
SWEEP_EVERY_S = 10
_sweeps: dict[str, float] = {}
_sweep_lock = threading.Lock()


def now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- settings
def settings_for(org: str, module: str) -> dict:
    row = db.fetch_one("SELECT settings FROM public.proctor_settings WHERE org_code = %s AND module = %s", (org, module))
    return cfg.merge(module, row["settings"] if row else None)


def all_settings(org: str) -> dict:
    rows = {r["module"]: r for r in db.fetch_all(
        "SELECT module, settings, history, updated_by, updated_at FROM public.proctor_settings WHERE org_code = %s", (org,))}
    return {m: {"effective": cfg.merge(m, rows[m]["settings"] if m in rows else None), "defaults": cfg.defaults_for(m),
                "overrides": rows[m]["settings"] if m in rows else {}, "updated_by": rows.get(m, {}).get("updated_by"),
                "updated_at": rows.get(m, {}).get("updated_at"), "history": (rows.get(m, {}).get("history") or [])[-10:]}
            for m in cfg.MODULES}


def save_settings(org: str, module: str, values: dict, actor: str) -> dict:
    """Store only real overrides of the defaults, and append what changed to the settings' audit history."""
    current = db.fetch_one("SELECT settings FROM public.proctor_settings WHERE org_code = %s AND module = %s", (org, module))
    before = cfg.merge(module, current["settings"] if current else None)
    after = cfg.merge(module, {**(current["settings"] if current else {}), **values})
    defaults = cfg.defaults_for(module)
    overrides = {k: v for k, v in after.items() if v != defaults[k]}
    changes = {k: [before[k], after[k]] for k in after if before[k] != after[k]}
    entry = Jsonb([{"at": now().isoformat(), "by": actor, "changes": changes}])
    db.execute("INSERT INTO public.proctor_settings (org_code, module, settings, history, updated_by) VALUES (%s,%s,%s,%s,%s) "
               "ON CONFLICT (org_code, module) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = NOW(), "
               "history = (SELECT COALESCE(jsonb_agg(v ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(public.proctor_settings.history "
               "|| EXCLUDED.history) WITH ORDINALITY AS h(v, n) WHERE n > jsonb_array_length(public.proctor_settings.history) + 1 - %s)",
               (org, module, Jsonb(overrides), entry, actor, SETTINGS_HISTORY))
    return all_settings(org)[module]


# ---------------------------------------------------------------- loading
def load(session_id) -> dict | None:
    return db.fetch_one(SESSION_SQL + "WHERE s.session_id = %s", (session_id,))


def own(user: CurrentUser, session_id) -> dict:
    s = load(session_id)
    if not s or s["org_code"] != user.org_code or s["student_code"] != user.user_code:
        raise HTTPException(404, "Proctoring session not found")
    return s


def monitored(user: CurrentUser, session_id) -> dict:
    s = load(session_id)
    if not s or s["org_code"] != user.org_code or not exams.can_monitor(user, s):
        raise HTTPException(404, "Proctoring session not found")
    return s


def student_view(s: dict) -> dict:
    st = s["settings"] or {}
    return {"session_id": s["session_id"], "module": s["module"], "ref_id": s["ref_id"], "title": s["ref_title"], "status": s["status"],
            "started_at": s["started_at"], "resumed": bool(s["started_at"]), "rules_version": cfg.RULES_VERSION,
            "client_rules": cfg.client_rules({**cfg.defaults_for(s["module"]), **st}),
            "last_seq": (db.fetch_one("SELECT COALESCE(MAX(seq), 0) AS n FROM public.proctor_events WHERE session_id = %s",
                                      (s["session_id"],)) or {"n": 0})["n"],
            "end_reason": s["end_reason"]}


def config_view(org: str, module: str) -> dict:
    """What the preparation window shows before any session exists: whether proctoring is on, the rules and notice."""
    st = settings_for(org, module)
    return {"module": module, "enabled": st["enabled"], "rules": cfg.RULES, "rules_version": cfg.RULES_VERSION,
            "acknowledgement": cfg.ACKNOWLEDGEMENT, "notice": cfg.notice(st["retention_days"]), "client_rules": cfg.client_rules(st)}


# ---------------------------------------------------------------- student lifecycle
def prepare(user: CurrentUser, module: str, ref_id: str) -> dict:
    exam = exams.resolve_for_student(user, module, ref_id)
    st = settings_for(user.org_code, module)
    if not st["enabled"]:
        raise HTTPException(409, "Proctoring is switched off for this module")
    find = ("SELECT session_id FROM public.proctor_sessions WHERE org_code = %s AND module = %s AND ref_id = %s AND student_code = %s "
            "AND status IN ('PRECHECK', 'ACTIVE', 'INTERRUPTED')")
    args = (user.org_code, module, exam["ref_id"], user.user_code)
    row = db.fetch_one(find, args)
    if not row:
        row = db.fetch_one(
            "INSERT INTO public.proctor_sessions (org_code, module, ref_id, ref_title, student_code, class_code, subject_code, teacher_codes, "
            "settings) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING session_id",
            (user.org_code, module, exam["ref_id"], exam["title"], user.user_code, exam["class_code"], exam["subject_code"],
             exam["teacher_codes"], Jsonb(st))) or db.fetch_one(find, args)   # a parallel tab may have created it
    else:   # refresh the assigned teachers and thresholds of a session that has not finished yet
        db.execute("UPDATE public.proctor_sessions SET teacher_codes = %s, settings = %s, ref_title = %s, updated_at = NOW() "
                   "WHERE session_id = %s", (exam["teacher_codes"], Jsonb(st), exam["title"], row["session_id"]))
    s = load(row["session_id"])
    _publish(s, "session")
    return student_view(s)


def start(s: dict, *, acknowledged: bool, rules_version: str, checks: dict, camera_label: str | None, mic_label: str | None) -> dict:
    if s["status"] in cfg.DONE:
        raise HTTPException(409, "This proctoring session has ended")
    if not acknowledged or rules_version != cfg.RULES_VERSION:
        raise HTTPException(422, "Read and acknowledge the examination rules first")
    st = s["settings"]
    missing = [name for name, needed in (("camera", st.get("camera_required")), ("face", st.get("camera_required")),
                                         ("microphone", st.get("mic_required")), ("fullscreen", st.get("fullscreen_required")))
               if needed and not checks.get(name)]
    if missing:
        raise HTTPException(409, f"Mandatory checks have not passed: {', '.join(missing)}")
    resumed = s["started_at"] is not None
    at = now()
    db.execute(
        "UPDATE public.proctor_sessions SET status = 'ACTIVE', started_at = COALESCE(started_at, %s), rules_acknowledged_at = %s, "
        "rules_version = %s, checks = %s, camera_label = %s, mic_label = %s, last_heartbeat_at = %s, "
        "resumed_count = resumed_count + %s, updated_at = NOW() WHERE session_id = %s",
        (at, at, rules_version, Jsonb(checks), (camera_label or "")[:200] or None, (mic_label or "")[:200] or None, at,
         1 if resumed else 0, s["session_id"]))
    s = load(s["session_id"])
    if resumed:
        _insert(s, "SESSION_RESUMED", source="server", details={"resume": s["resumed_count"]})
    else:
        _notify_started(s)
    _publish(s, "session")
    return student_view(s)


def finish(s: dict, reason: str) -> dict:
    """reason: submitted (exam handed in) | left (page closed / navigated away) | closed (AI Classroom closed)."""
    if s["status"] in cfg.DONE:
        return student_view(s)
    if s["status"] == "PRECHECK":
        status, event = "CLOSED", None                     # preparation window closed before starting
    elif s["module"] == "AI_CLASSROOM":
        status, event = "CLOSED", None
    elif reason == "submitted" and exams.attempt_states(s["module"], s["ref_id"]).get(s["student_code"]) == "SUBMITTED":
        status, event = "SUBMITTED", None
    else:                                                  # left mid-exam (or "submitted" while the attempt is still open)
        status, event = "INTERRUPTED", "SESSION_LEFT"
    db.execute("UPDATE public.proctor_sessions SET status = %s, ended_at = CASE WHEN %s IN ('SUBMITTED', 'CLOSED') THEN NOW() END, "
               "end_reason = CASE WHEN %s IN ('SUBMITTED', 'CLOSED') THEN %s END, updated_at = NOW() WHERE session_id = %s "
               "AND status IN ('PRECHECK', 'ACTIVE', 'INTERRUPTED')", (status, status, status, reason.upper(), s["session_id"]))
    s = load(s["session_id"])
    if event and s["status"] == "INTERRUPTED":
        _insert(s, event, source="server")
    _publish(s, "session")
    return student_view(s)


def heartbeat(s: dict, status: dict) -> dict:
    if s["status"] not in ("ACTIVE", "INTERRUPTED"):
        return {**_student_status(s), "warnings": []}
    at = now()
    last = s["last_heartbeat_at"] or s["started_at"] or at
    gap = (at - last).total_seconds()
    limit = s["settings"].get("heartbeat_missing_seconds", cfg.DEFAULTS["heartbeat_missing_seconds"])
    changed = (s["last_status"] or {}) != status
    db.execute("UPDATE public.proctor_sessions SET status = 'ACTIVE', last_heartbeat_at = %s, last_status = %s, updated_at = NOW() "
               "WHERE session_id = %s AND status IN ('ACTIVE', 'INTERRUPTED')", (at, Jsonb(status), s["session_id"]))
    was = s["status"]
    s = load(s["session_id"])
    if was == "INTERRUPTED":
        _insert(s, "SESSION_RESUMED", source="server", details={"gap_s": round(gap)})
    elif gap > limit:   # nobody swept while it was silent: record the gap now
        _insert(s, "HEARTBEAT_MISSING", source="server", duration_ms=int(gap * 1000), details={"gap_s": round(gap)})
    if changed or was == "INTERRUPTED":
        _publish(s, "session")
    return {**_student_status(s), "warnings": pending_warnings(s)}


def ingest(s: dict, events: list[dict]) -> dict:
    """Append client events (idempotent by seq). Returns the accepted seqs and anything the student must see now."""
    if s["status"] not in ("ACTIVE", "INTERRUPTED"):
        return {**_student_status(s), "accepted": [], "warnings": []}
    accepted, flags = [], 0
    for e in sorted(events, key=lambda x: x["seq"]):
        row = _insert(s, e["code"], seq=e["seq"], client_ts=e.get("client_ts"), duration_ms=e.get("duration_ms") or 0,
                      confidence=e.get("confidence"), details=e.get("details") or None)
        accepted.append(e["seq"])
        if row and row["severity"] != "Info":
            flags += 1
    exams.bump_flag_counter(s, flags)
    return {**_student_status(s), "accepted": accepted, "warnings": pending_warnings(s)}


def _student_status(s: dict) -> dict:
    return {"status": s["status"], "ended": s["status"] == "ENDED_BY_TEACHER", "end_reason": s["end_reason"], "server_time": now()}


def _insert(s: dict, code: str, *, seq: int | None = None, client_ts=None, duration_ms: int = 0, confidence=None,
            details: dict | None = None, source: str = "client") -> dict | None:
    f = cfg.FLAGS[code]
    settings = {**cfg.defaults_for(s["module"]), **(s["settings"] or {})}
    with db.connection() as conn:
        previous = conn.execute("SELECT COUNT(*) AS n FROM public.proctor_events WHERE session_id = %s AND code = %s",
                                (s["session_id"], code)).fetchone()["n"]
        row = conn.execute(
            "INSERT INTO public.proctor_events (session_id, org_code, seq, code, severity, category, client_ts, duration_ms, confidence, "
            "details, source) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (session_id, seq) WHERE seq IS NOT NULL DO NOTHING "
            "RETURNING event_id, seq, code, severity, category, client_ts, server_ts, duration_ms, details",
            (s["session_id"], s["org_code"], seq, code, cfg.severity_for(code, duration_ms, previous, settings), f.category, client_ts,
             duration_ms, confidence, Jsonb(details) if details else None, source)).fetchone()
    if not row:
        return None   # a retried batch: already stored
    ev = _event_view(row)
    _publish(s, "event", event=ev)
    if cfg.level(row["severity"]) >= cfg.level(settings["notify_min_severity"]) and row["severity"] != "Info":
        _notify_alert(s, ev, settings)
    return row


def _event_view(e: dict) -> dict:
    return {"event_id": e["event_id"], "seq": e.get("seq"), "code": e["code"], "label": cfg.FLAGS[e["code"]].label,
            "severity": e["severity"], "category": e["category"], "client_ts": e.get("client_ts"), "server_ts": e["server_ts"],
            "duration_ms": e["duration_ms"], "details": e.get("details")}


# ---------------------------------------------------------------- interruption sweep
def sweep(org: str, *, force: bool = False) -> int:
    """Raise HEARTBEAT_MISSING and mark the session INTERRUPTED when a device stops reporting. Run (throttled) by the
    teacher's dashboard requests and the live stream, so silent devices surface without a background scheduler."""
    t = time.monotonic()
    with _sweep_lock:
        if not force and t - _sweeps.get(org, 0) < SWEEP_EVERY_S:
            return 0
        _sweeps[org] = t
    rows = db.fetch_all(SESSION_SQL + "WHERE s.org_code = %s AND s.status = 'ACTIVE' AND COALESCE(s.last_heartbeat_at, s.started_at) "
                        "< NOW() - INTERVAL '20 seconds'", (org,))
    n = 0
    for s in rows:
        limit = (s["settings"] or {}).get("heartbeat_missing_seconds", cfg.DEFAULTS["heartbeat_missing_seconds"])
        gap = (now() - (s["last_heartbeat_at"] or s["started_at"])).total_seconds()
        if gap <= limit:
            continue
        row = db.fetch_one("UPDATE public.proctor_sessions SET status = 'INTERRUPTED', updated_at = NOW() WHERE session_id = %s "
                           "AND status = 'ACTIVE' RETURNING session_id", (s["session_id"],))
        if row:
            s = load(s["session_id"])
            _insert(s, "HEARTBEAT_MISSING", source="server", duration_ms=int(gap * 1000), details={"gap_s": round(gap)})
            _publish(s, "session")
            n += 1
    return n


# ---------------------------------------------------------------- teacher actions
def add_action(s: dict, user: CurrentUser, action: str, *, message: str | None = None, event_id=None, outcome: str | None = None) -> dict:
    row = db.fetch_one(
        "INSERT INTO public.proctor_actions (session_id, org_code, actor_code, actor_role, action, event_id, outcome, message) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (s["session_id"], s["org_code"], user.user_code, user.role, action, event_id, outcome, message))
    if action != "VIEW":
        _publish(s, "action", action={"action_id": row["action_id"], "action": action, "event_id": event_id, "outcome": outcome,
                                      "created_at": row["created_at"]})
    return row


def audit_view(s: dict, user: CurrentUser) -> None:
    """Opening a student's proctoring record is logged (at most once per teacher per session per 10 minutes)."""
    seen = db.fetch_one("SELECT 1 FROM public.proctor_actions WHERE session_id = %s AND actor_code = %s AND action = 'VIEW' "
                        "AND created_at > NOW() - INTERVAL '10 minutes'", (s["session_id"], user.user_code))
    if not seen:
        add_action(s, user, "VIEW")


def review_event(user: CurrentUser, event_id, outcome: str, note: str | None) -> dict:
    e = db.fetch_one("SELECT session_id FROM public.proctor_events WHERE event_id = %s AND org_code = %s", (event_id, user.org_code))
    if not e:
        raise HTTPException(404, "Event not found")
    s = monitored(user, e["session_id"])
    add_action(s, user, "REVIEW", message=note, event_id=event_id, outcome=outcome)
    return {"event_id": event_id, "outcome": outcome}


def end_by_teacher(s: dict, user: CurrentUser, reason: str) -> dict:
    if not s["settings"].get("teacher_can_end", True):
        raise HTTPException(403, "Ending sessions is switched off for this module")
    if s["status"] not in ("PRECHECK", "ACTIVE", "INTERRUPTED"):
        raise HTTPException(409, "This session has already finished")
    row = db.fetch_one("UPDATE public.proctor_sessions SET status = 'ENDED_BY_TEACHER', ended_at = NOW(), end_reason = 'ENDED_BY_TEACHER', "
                       "ended_by = %s, updated_at = NOW() WHERE session_id = %s AND status IN ('PRECHECK', 'ACTIVE', 'INTERRUPTED') "
                       "RETURNING session_id", (user.user_code, s["session_id"]))
    if not row:
        raise HTTPException(409, "This session has already finished")
    outcome = exams.end_attempt(s)
    add_action(load(s["session_id"]), user, "END_SESSION", message=f"{reason}" + (f" [{outcome}]" if outcome else ""))
    s = load(s["session_id"])
    _publish(s, "session")
    return {"status": s["status"], "attempt": outcome}


def pending_warnings(s: dict) -> list[dict]:
    """Teacher warnings the student has not acknowledged yet (marked delivered the first time they are sent)."""
    rows = db.fetch_all("SELECT action_id, message, created_at, delivered_at FROM public.proctor_actions WHERE session_id = %s "
                        "AND action = 'WARNING' AND acknowledged_at IS NULL ORDER BY created_at", (s["session_id"],))
    fresh = [r["action_id"] for r in rows if r["delivered_at"] is None]
    if fresh:
        db.execute("UPDATE public.proctor_actions SET delivered_at = NOW() WHERE action_id = ANY(%s) AND delivered_at IS NULL", (fresh,))
    return [{"action_id": r["action_id"], "message": r["message"], "created_at": r["created_at"]} for r in rows]


def acknowledge_warning(s: dict, action_id) -> bool:
    row = db.fetch_one("UPDATE public.proctor_actions SET acknowledged_at = NOW(), delivered_at = COALESCE(delivered_at, NOW()) "
                       "WHERE action_id = %s AND session_id = %s AND action = 'WARNING' AND acknowledged_at IS NULL RETURNING action_id",
                       (action_id, s["session_id"]))
    if row:
        _publish(s, "action", action={"action_id": action_id, "action": "WARNING_ACKNOWLEDGED"})
    return row is not None


# ---------------------------------------------------------------- teacher views
OPEN_REVIEW = ("LEFT JOIN LATERAL (SELECT a.outcome, a.message AS review_note, a.actor_code AS reviewed_by, a.created_at AS reviewed_at "
               "FROM public.proctor_actions a WHERE a.event_id = e.event_id AND a.action = 'REVIEW' ORDER BY a.created_at DESC LIMIT 1) r ON TRUE ")


def exam_view(user: CurrentUser, module: str, ref_id: str) -> dict:
    exam = exams.exam_for_teacher(user, module, ref_id)
    sweep(user.org_code)
    if module == "AI_CLASSROOM":
        class_codes = exam["class_codes"]
    else:
        class_codes = [exam["class_code"]]
    students = exams.roster(user.org_code, class_codes)
    attempts = exams.attempt_states(module, ref_id)
    sessions = {r["student_code"]: r for r in db.fetch_all(
        "SELECT DISTINCT ON (student_code) * FROM public.proctor_sessions WHERE org_code = %s AND module = %s AND ref_id = %s "
        "ORDER BY student_code, (status IN ('PRECHECK', 'ACTIVE', 'INTERRUPTED')) DESC, created_at DESC", (user.org_code, module, ref_id))}
    stats = {r["student_code"]: r for r in db.fetch_all(
        "SELECT s.student_code, COUNT(*) FILTER (WHERE e.severity <> 'Info') AS total, "
        "COUNT(*) FILTER (WHERE e.severity IN ('Medium', 'High', 'Critical') AND r.outcome IS NULL) AS open, "
        "COUNT(*) FILTER (WHERE e.severity IN ('High', 'Critical')) AS high, "
        "COALESCE(BOOL_OR(e.category = 'suspicious' AND e.severity <> 'Info' AND r.outcome IS NULL), FALSE) AS suspicious, "
        "COALESCE(BOOL_OR(e.category = 'camera' AND r.outcome IS NULL AND e.server_ts > NOW() - INTERVAL '5 minutes'), FALSE) AS camera_recent "
        "FROM public.proctor_events e JOIN public.proctor_sessions s ON s.session_id = e.session_id " + OPEN_REVIEW +
        "WHERE s.org_code = %s AND s.module = %s AND s.ref_id = %s GROUP BY s.student_code", (user.org_code, module, ref_id))}
    latest = {r["student_code"]: r for r in db.fetch_all(
        "SELECT DISTINCT ON (s.student_code) s.student_code, e.code, e.severity, e.server_ts FROM public.proctor_events e "
        "JOIN public.proctor_sessions s ON s.session_id = e.session_id WHERE s.org_code = %s AND s.module = %s AND s.ref_id = %s "
        "AND e.severity <> 'Info' ORDER BY s.student_code, e.server_ts DESC", (user.org_code, module, ref_id))}
    warned = {r["student_code"]: r["n"] for r in db.fetch_all(
        "SELECT s.student_code, COUNT(*) AS n FROM public.proctor_actions a JOIN public.proctor_sessions s ON s.session_id = a.session_id "
        "WHERE s.org_code = %s AND s.module = %s AND s.ref_id = %s AND a.action = 'WARNING' GROUP BY s.student_code",
        (user.org_code, module, ref_id))}
    rows = []
    for r in students:
        code = r["student_code"]
        s = sessions.get(code)
        st = stats.get(code) or {}
        state = _state(module, s, attempts.get(code))
        last = (s or {}).get("last_status") or {}
        need = (s or {}).get("settings") or {}
        open_session = state in ("ACTIVE", "INTERRUPTED")
        camera_issue = open_session and ((need.get("camera_required") and last.get("camera_live") is False)
                                         or (need.get("mic_required") and last.get("mic_live") is False)
                                         or bool(st.get("camera_recent")))
        lt = latest.get(code)
        rows.append({
            **r, "section": exams.section_of(r["class_code"], r["class_name"]), "state": state,
            "session_id": s["session_id"] if s else None, "started_at": s["started_at"] if s else None,
            "last_heartbeat_at": s["last_heartbeat_at"] if s else None,
            "camera": {"live": last.get("camera_live"), "label": s["camera_label"] if s else None},
            "mic": {"live": last.get("mic_live"), "permission": last.get("mic_permission"), "label": s["mic_label"] if s else None},
            "fullscreen": last.get("fullscreen") if need.get("fullscreen_required") else None,
            "online": last.get("online"), "faces": last.get("faces"),
            "alerts": {"open": st.get("open", 0), "total": st.get("total", 0), "high": st.get("high", 0)},
            "suspicious": bool(st.get("suspicious")), "camera_issue": bool(camera_issue), "warnings": warned.get(code, 0),
            "latest_alert": {"code": lt["code"], "label": cfg.FLAGS[lt["code"]].label, "severity": lt["severity"], "at": lt["server_ts"]}
            if lt else None,
        })
    counts = {
        "enrolled": len(rows),
        "writing": sum(1 for x in rows if x["state"] == "ACTIVE"),
        "prechecking": sum(1 for x in rows if x["state"] == "PRECHECK"),
        "yet_to_start": sum(1 for x in rows if x["state"] in ("NOT_STARTED", "PRECHECK")),
        "interrupted": sum(1 for x in rows if x["state"] == "INTERRUPTED"),
        "submitted": sum(1 for x in rows if x["state"] in ("SUBMITTED", "ENDED_BY_TEACHER", "CLOSED")),
        "with_active_alerts": sum(1 for x in rows if x["alerts"]["open"] > 0),
        "camera_issues": sum(1 for x in rows if x["camera_issue"]),
        "suspicious": sum(1 for x in rows if x["suspicious"]),
    }
    return {"exam": exam, "counts": counts, "students": rows, "alerts": alerts(user, module, ref_id)}


def _state(module: str, s: dict | None, attempt: str | None) -> str:
    if s and s["status"] == "ENDED_BY_TEACHER":
        return "ENDED_BY_TEACHER"
    if attempt == "SUBMITTED":
        return "SUBMITTED"
    if s and s["status"] in ("ACTIVE", "INTERRUPTED"):
        return s["status"]
    if attempt == "IN_PROGRESS":
        return "INTERRUPTED"      # mid-exam without a running proctoring session
    if s and s["status"] == "PRECHECK" and s["updated_at"] > now() - timedelta(minutes=PRECHECK_STALE_MINUTES):
        return "PRECHECK"
    if s and s["status"] in ("SUBMITTED", "CLOSED") and module == "AI_CLASSROOM":
        return "CLOSED"
    return "NOT_STARTED"


def alerts(user: CurrentUser, module: str, ref_id: str, limit: int = 60) -> list[dict]:
    rows = db.fetch_all(
        "SELECT e.event_id, e.seq, e.code, e.severity, e.category, e.client_ts, e.server_ts, e.duration_ms, e.details, s.session_id, "
        "s.student_code, u.full_name AS student_name, r.outcome, r.review_note, r.reviewed_by, r.reviewed_at "
        "FROM public.proctor_events e JOIN public.proctor_sessions s ON s.session_id = e.session_id "
        "LEFT JOIN public.app_users u ON u.org_code = s.org_code AND u.user_code = s.student_code " + OPEN_REVIEW +
        "WHERE s.org_code = %s AND s.module = %s AND s.ref_id = %s AND e.severity <> 'Info' ORDER BY e.server_ts DESC LIMIT %s",
        (user.org_code, module, ref_id, limit))
    return [{**_event_view(r), "session_id": r["session_id"], "student_code": r["student_code"], "student_name": r["student_name"],
             "review": _review(r)} for r in rows]


def _review(r: dict) -> dict | None:
    return {"outcome": r["outcome"], "note": r["review_note"], "by": r["reviewed_by"], "at": r["reviewed_at"]} if r.get("outcome") else None


def session_detail(user: CurrentUser, s: dict) -> dict:
    events = db.fetch_all(
        "SELECT e.*, r.outcome, r.review_note, r.reviewed_by, r.reviewed_at FROM public.proctor_events e " + OPEN_REVIEW +
        "WHERE e.session_id = %s ORDER BY e.server_ts, e.seq NULLS LAST", (s["session_id"],))
    actions = db.fetch_all(
        "SELECT a.action_id, a.action, a.event_id, a.outcome, a.message, a.created_at, a.delivered_at, a.acknowledged_at, "
        "a.actor_code, a.actor_role, u.full_name AS actor_name FROM public.proctor_actions a "
        "LEFT JOIN public.app_users u ON u.org_code = a.org_code AND u.user_code = a.actor_code "
        "WHERE a.session_id = %s ORDER BY a.created_at", (s["session_id"],))
    other = db.fetch_all("SELECT session_id, status, started_at, ended_at, created_at FROM public.proctor_sessions WHERE org_code = %s "
                         "AND module = %s AND ref_id = %s AND student_code = %s ORDER BY created_at DESC LIMIT 20",
                         (s["org_code"], s["module"], s["ref_id"], s["student_code"]))
    st = s["settings"] or {}
    return {
        "session": {k: s[k] for k in ("session_id", "module", "ref_id", "ref_title", "status", "started_at", "ended_at", "end_reason",
                                      "rules_version", "rules_acknowledged_at", "checks", "camera_label", "mic_label", "resumed_count",
                                      "last_heartbeat_at", "last_status", "created_at")},
        "student": {"student_code": s["student_code"], "full_name": s["student_name"], "roll_number": s["roll_number"],
                    "class_code": s["class_code"], "class_name": s["class_name"], "section": exams.section_of(s["class_code"], s["class_name"])},
        "can_end": bool(st.get("teacher_can_end", True)) and s["status"] in cfg.OPEN,
        "requires": {"camera": bool(st.get("camera_required")), "microphone": bool(st.get("mic_required")),
                     "fullscreen": bool(st.get("fullscreen_required"))},
        "events": [{**_event_view(e), "confidence": e["confidence"], "source": e["source"], "review": _review(e)} for e in events],
        "actions": [a for a in actions if a["action"] != "VIEW"],
        "views": sum(1 for a in actions if a["action"] == "VIEW"),
        "sessions": other,
    }


# ---------------------------------------------------------------- notifications + real-time
def _student_fields(s: dict) -> dict:
    return {"student_name": s.get("student_name"), "student_id": s["student_code"], "roll_number": s.get("roll_number"),
            "class_name": s.get("class_name"), "section": exams.section_of(s.get("class_code"), s.get("class_name")),
            "exam_name": s["ref_title"], "module": s["module"], "exam_started_at": s["started_at"], "session_status": s["status"]}


def _link(s: dict) -> str:
    from urllib.parse import urlencode

    return "/teacher/proctoring/exam?" + urlencode({"module": s["module"], "ref": s["ref_id"], "session": str(s["session_id"])})


def _fmt(ts) -> str:
    return ts.astimezone(timezone.utc).strftime("%H:%M:%S UTC") if ts else "—"


def _class_label(f: dict) -> str:
    return f"{f['class_name'] or ''}" + (f" (Section {f['section']})" if f["section"] and "section" not in (f["class_name"] or "").lower() else "")


def _notify_started(s: dict) -> None:
    if not (s["settings"] or {}).get("notify_on_start", True):
        return   # e.g. AI Classroom: the start is on the live dashboard, without a bell notification
    f = _student_fields(s)
    body = (f"{f['student_name']} (ID {f['student_id']}) · {_class_label(f)} · {cfg.MODULE_LABEL[s['module']]} started at "
            f"{_fmt(s['started_at'])} · session {s['status'].lower()}")
    payload = {**f, "alert_type": "SESSION_STARTED", "alert_label": "Proctored session started", "alert_at": s["started_at"],
               "severity": "Info", "session_id": s["session_id"]}
    notif.notify_with_payload(s["org_code"], s["teacher_codes"], "PROCTOR_STARTED", f"Started: {f['student_name']} — {s['ref_title']}"[:300],
                              body, _link(s), f"proctor-start:{s['session_id']}", "Info", _json(payload))


def _notify_alert(s: dict, ev: dict, settings: dict) -> None:
    s = load(s["session_id"])
    f = _student_fields(s)
    prefix = f"proctor-alert:{s['session_id']}:{ev['code']}:"
    cooldown = int(settings.get("notify_cooldown_seconds") or 0)
    if cooldown and s["teacher_codes"] and db.fetch_one(
            "SELECT 1 FROM public.notifications WHERE org_code = %s AND user_code = %s AND notif_type = 'PROCTOR_ALERT' "
            "AND dedup_key LIKE %s AND created_at > NOW() - make_interval(secs => %s) LIMIT 1",
            (s["org_code"], s["teacher_codes"][0], prefix + "%", cooldown)):
        return   # the same alert for this student was notified moments ago (it is still on the live dashboard)
    body = (f"{ev['label']} at {_fmt(ev['server_ts'])} · {f['student_name']} (ID {f['student_id']}) · {_class_label(f)} · "
            f"started {_fmt(s['started_at'])} · session {s['status'].lower()}. A signal to review, not proof of misconduct.")
    payload = {**f, "alert_type": ev["code"], "alert_label": ev["label"], "alert_at": ev["server_ts"], "severity": ev["severity"],
               "session_id": s["session_id"], "event_id": ev["event_id"]}
    notif.notify_with_payload(s["org_code"], s["teacher_codes"], "PROCTOR_ALERT",
                              f"{ev['severity']} alert: {f['student_name']} — {s['ref_title']}"[:300], body, _link(s),
                              f"{prefix}{ev['event_id']}", ev["severity"], _json(payload))


def _json(d: dict) -> dict:
    return {k: (v.isoformat() if isinstance(v, datetime) else str(v) if k.endswith("_id") and v is not None else v) for k, v in d.items()}


def _publish(s: dict, kind: str, **extra) -> None:
    ensure_bridge()
    msg = {"type": kind, "module": s["module"], "ref_id": s["ref_id"], "session_id": str(s["session_id"]),
           "student_code": s["student_code"], "student_name": s.get("student_name"), "status": s["status"], "at": now().isoformat()}
    for k, v in extra.items():
        msg[k] = _json(v) if isinstance(v, dict) else v
    for code in s["teacher_codes"] or []:
        hub.publish(teacher_channel(s["org_code"], code), msg)
