"""Unified student proctoring (Online Tests, Virtual Labs, AI Classroom): lifecycle, flags-only events, teacher actions,
RBAC, notifications, interruption sweep, settings, retention and the real-time hub / stream."""
import asyncio
import threading
import time
from datetime import datetime, timedelta, timezone

import pymupdf
import pytest
from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb

from app import db
from app.routers import proctoring as proctoring_router
from app.services import nlp_catalog
from app.services import notifications as notif
from app.services.proctoring import config as cfg
from app.services.proctoring import hub as hubmod
from app.services.proctoring import retention, sessions

P = "/ICMELive/api/v1/proctoring"
E = "/ICMELive/api/v1/evaluation"
S = "/ICMELive/api/v1/assessments"
ORG = "DEMO-SCHOOL"
ALL_CHECKS = {"camera": True, "face": True, "microphone": True, "fullscreen": True, "lighting": True}


def _login(client, ident):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def u(client):
    return {k: _login(client, e) for k, e in [("admin", "admin@demo.edu"), ("priya", "teacher@demo.edu"), ("kavya", "kavya@demo.edu"),
                                              ("rohan", "student@demo.edu"), ("meera", "meera@demo.edu"), ("ishaan", "ishaan@demo.edu"),
                                              ("kabir", "kabir@demo.edu")]}


@pytest.fixture(scope="module")
def online_test(client, u):
    body = {"class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "SUBJECT_LEVEL", "test_title": f"Proctored quiz {time.time_ns()}",
            "assessment_type": "ONLINE_TEST", "duration_minutes": 30, "due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
    r = client.post(f"{E}/tests", headers=u["priya"], json=body)
    assert r.status_code == 201, r.text
    tid = r.json()["eval_test_id"]
    items = [{"sl_no": "1", "question_type": "MCQ", "question_text": "SI unit of force?", "max_marks": 1,
              "mcq_options": ["Joule", "Newton"], "correct_option": "b", "model_answer_text": "(b) Newton"}]
    assert client.put(f"{E}/tests/{tid}/masters", headers=u["priya"], json={"items": items}).status_code == 200
    assert client.post(f"{E}/tests/{tid}/assign", headers=u["priya"], json={"assigned": True}).status_code == 200
    return tid


def _lab(title="Proctored lab"):
    ws = {"aim": "Observe", "materials": [], "steps": ["Do it"], "observation_columns": [], "observation_rows": 0,
          "questions": [{"id": "q1", "type": "mcq", "prompt": "Pick", "options": ["A", "B"], "answer": 1, "marks": 1}],
          "conclusion_prompt": "", "record_marks": 0}
    row = db.fetch_one(
        "INSERT INTO public.virtual_lab_assignments (org_code, class_code, subject_code, year_code, teacher_code, collection_id, lab_id, lab, "
        "title, worksheet, max_marks, min_minutes) SELECT %s, 'Grade-10-A', 'PHY101', c.year_code, 'EMP1001', 'do_coll', 'do_lab', %s, %s, %s, 1, 0 "
        "FROM public.classes c WHERE c.org_code = %s AND c.class_code = 'Grade-10-A' RETURNING assignment_id",
        (ORG, Jsonb({"name": title, "resources": []}), title, Jsonb(ws), ORG))
    return str(row["assignment_id"])


def _prepare(client, h, module, ref):
    r = client.post(f"{P}/student/sessions", headers=h, json={"module": module, "ref_id": ref})
    assert r.status_code == 200, r.text
    return r.json()


def _start(client, h, sid, checks=ALL_CHECKS):
    return client.post(f"{P}/student/sessions/{sid}/start", headers=h,
                       json={"acknowledged": True, "rules_version": cfg.RULES_VERSION, "checks": checks, "camera_label": "Integrated Camera",
                             "mic_label": "Built-in microphone"})


def _event(seq, code, **kw):
    return {"seq": seq, "code": code, "client_ts": datetime.now(timezone.utc).isoformat(), **kw}


def _notifications(user_code, ntype):
    return db.fetch_all("SELECT title, body, severity, payload, dedup_key FROM public.notifications WHERE org_code = %s AND user_code = %s "
                        "AND notif_type = %s ORDER BY created_at", (ORG, user_code, ntype))


# ---------------------------------------------------------------- rules + config
def test_rules_notice_and_role_checks(client, u):
    r = client.get(f"{P}/student/config", headers=u["rohan"], params={"module": "ONLINE_TEST"})
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["enabled"] and len(c["rules"]) == 9 and c["rules"][0] == "Keep your face visible throughout the examination."
    assert c["acknowledgement"] == "I have read and understood all examination rules and instructions."
    assert any("No video" in x for x in c["notice"]["not_captured"])
    assert c["client_rules"]["mic_required"] and c["client_rules"]["fullscreen_required"]
    assert client.get(f"{P}/student/config", headers=u["priya"], params={"module": "ONLINE_TEST"}).status_code == 403
    assert client.get(f"{P}/student/config", params={"module": "ONLINE_TEST"}).status_code == 401
    assert client.get(f"{P}/teacher/exams", headers=u["rohan"]).status_code == 403
    assert client.get(f"{P}/teacher/exams", headers=u["admin"]).status_code == 403


def test_severity_escalation_rules():
    st = cfg.defaults_for("ONLINE_TEST")
    assert cfg.severity_for("WINDOW_BLUR", 0, 0, st) == "Low"
    assert cfg.severity_for("TAB_HIDDEN", 5_000, 0, st) == "Medium"
    assert cfg.severity_for("TAB_HIDDEN", 45_000, 0, st) == "High"           # long episode
    assert cfg.severity_for("WINDOW_BLUR", 0, 2, st) == "Medium"             # third occurrence
    assert cfg.severity_for("TAB_HIDDEN", 45_000, 5, st) == "High"           # escalation alone never reaches Critical
    assert cfg.severity_for("MULTIPLE_FACES", 0, 5, st) == "Critical"        # a High flag, repeated
    assert cfg.severity_for("SESSION_RESUMED", 0, 9, st) == "Info"
    assert cfg.merge("ONLINE_TEST", {"no_face_seconds": 999, "enabled": "yes", "bogus": 1})["no_face_seconds"] == 120


# ---------------------------------------------------------------- online test: full lifecycle
def test_online_test_lifecycle(client, u, online_test):
    tid = online_test
    p = _prepare(client, u["rohan"], "ONLINE_TEST", tid)
    sid = p["session_id"]
    assert p["status"] == "PRECHECK" and p["last_seq"] == 0
    assert _prepare(client, u["rohan"], "ONLINE_TEST", tid)["session_id"] == sid         # reload resumes, never duplicates

    view = client.get(f"{P}/teacher/exam", headers=u["priya"], params={"module": "ONLINE_TEST", "ref_id": tid}).json()
    me = next(s for s in view["students"] if s["student_code"] == "REG2026001")
    assert me["state"] == "PRECHECK" and view["counts"]["prechecking"] == 1 and view["counts"]["enrolled"] >= 4

    # Mandatory gate: rules acknowledged and the required checks passed (mic + full screen are required for tests).
    bad = client.post(f"{P}/student/sessions/{sid}/start", headers=u["rohan"],
                      json={"acknowledged": False, "rules_version": cfg.RULES_VERSION, "checks": ALL_CHECKS})
    assert bad.status_code == 422
    r = _start(client, u["rohan"], sid, {**ALL_CHECKS, "microphone": False})
    assert r.status_code == 409 and "microphone" in r.json()["detail"]
    r = _start(client, u["rohan"], sid)
    assert r.status_code == 200 and r.json()["status"] == "ACTIVE"
    assert client.post(f"{S}/my/{tid}/start", headers=u["rohan"]).status_code == 200

    started = _notifications("EMP1001", "PROCTOR_STARTED")
    mine = [n for n in started if n["payload"] and n["payload"]["session_id"] == sid]
    assert len(mine) == 1 and mine[0]["severity"] == "Info"
    pl = mine[0]["payload"]
    assert pl["student_id"] == "REG2026001" and pl["student_name"] == "Rohan Student" and pl["section"] == "A"
    assert pl["exam_name"].startswith("Proctored quiz") and pl["exam_started_at"] and pl["session_status"] == "ACTIVE"

    batch = [_event(1, "MULTIPLE_FACES", duration_ms=3200, details={"faces": 2}), _event(2, "TAB_HIDDEN", duration_ms=40_000),
             _event(3, "WINDOW_BLUR", duration_ms=3000)]
    r = client.post(f"{P}/student/sessions/{sid}/events", headers=u["rohan"], json={"events": batch})
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == [1, 2, 3] and r.json()["status"] == "ACTIVE"
    assert client.post(f"{P}/student/sessions/{sid}/events", headers=u["rohan"], json={"events": batch}).status_code == 200  # retry
    stored = db.fetch_all("SELECT code, severity, category FROM public.proctor_events WHERE session_id = %s ORDER BY seq", (sid,))
    assert [(e["code"], e["severity"]) for e in stored] == [("MULTIPLE_FACES", "High"), ("TAB_HIDDEN", "High"), ("WINDOW_BLUR", "Low")]
    # backward compatible count on the attempt
    assert db.fetch_one("SELECT proctor_flag_count FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s AND student_user_code = %s",
                        (tid, "REG2026001"))["proctor_flag_count"] == 3

    # flags only: unknown codes, big / nested details and oversized batches are refused
    for e in ({"seq": 9, "code": "SCREENSHOT"}, _event(9, "NO_FACE", details={"image": "x" * 500}), _event(9, "NO_FACE", details={"a": {"b": 1}})):
        assert client.post(f"{P}/student/sessions/{sid}/events", headers=u["rohan"], json={"events": [e]}).status_code == 422
    assert client.post(f"{P}/student/sessions/{sid}/events", headers=u["rohan"],
                       json={"events": [_event(100 + i, "COPY_PASTE") for i in range(51)]}).status_code == 422

    alerts = [n for n in _notifications("EMP1001", "PROCTOR_ALERT") if n["payload"]["session_id"] == sid]
    assert {n["payload"]["alert_type"] for n in alerts} == {"MULTIPLE_FACES", "TAB_HIDDEN"}       # High only (WINDOW_BLUR is Low)
    a = next(n for n in alerts if n["payload"]["alert_type"] == "MULTIPLE_FACES")
    assert a["severity"] == "High" and a["payload"]["alert_at"] and a["payload"]["class_name"] and "not proof" in a["body"]
    # cooldown: the same alert again within notify_cooldown_seconds does not notify twice
    client.post(f"{P}/student/sessions/{sid}/events", headers=u["rohan"], json={"events": [_event(4, "MULTIPLE_FACES", duration_ms=3000)]})
    assert len([n for n in _notifications("EMP1001", "PROCTOR_ALERT")
                if n["payload"]["session_id"] == sid and n["payload"]["alert_type"] == "MULTIPLE_FACES"]) == 1

    view = client.get(f"{P}/teacher/exam", headers=u["priya"], params={"module": "ONLINE_TEST", "ref_id": tid}).json()
    me = next(s for s in view["students"] if s["student_code"] == "REG2026001")
    assert me["state"] == "ACTIVE" and me["suspicious"] and me["alerts"]["open"] == 3 and me["latest_alert"]["code"] == "MULTIPLE_FACES"
    c = view["counts"]
    assert c["writing"] == 1 and c["with_active_alerts"] == 1 and c["suspicious"] == 1 and c["yet_to_start"] == c["enrolled"] - 1
    assert view["alerts"][0]["student_name"] == "Rohan Student"
    listed = client.get(f"{P}/teacher/exams", headers=u["priya"]).json()["exams"]
    assert any(e["ref_id"] == tid and e["counts"]["writing"] == 1 for e in listed)

    # heartbeat: camera off -> camera issue on the dashboard
    hb = {"camera_live": False, "mic_live": True, "mic_permission": "granted", "fullscreen": True, "visible": True, "faces": 0, "online": True}
    r = client.post(f"{P}/student/sessions/{sid}/heartbeat", headers=u["rohan"], json=hb)
    assert r.status_code == 200 and r.json()["warnings"] == [] and not r.json()["ended"]
    view = client.get(f"{P}/teacher/exam", headers=u["priya"], params={"module": "ONLINE_TEST", "ref_id": tid}).json()
    assert view["counts"]["camera_issues"] == 1

    # warning -> student sees it on the next heartbeat until acknowledged
    w = client.post(f"{P}/teacher/sessions/{sid}/warnings", headers=u["priya"], json={"message": "Please keep your face in view."})
    assert w.status_code == 201, w.text
    got = client.post(f"{P}/student/sessions/{sid}/heartbeat", headers=u["rohan"], json={**hb, "camera_live": True}).json()["warnings"]
    assert [x["message"] for x in got] == ["Please keep your face in view."]
    assert client.post(f"{P}/student/sessions/{sid}/warnings/{got[0]['action_id']}/ack", headers=u["rohan"]).status_code == 200
    assert client.post(f"{P}/student/sessions/{sid}/heartbeat", headers=u["rohan"], json=hb).json()["warnings"] == []

    # remarks + review: a dismissed flag no longer counts as an active alert
    assert client.post(f"{P}/teacher/sessions/{sid}/remarks", headers=u["priya"], json={"message": "Sibling walked in, checked."}).status_code == 201
    ev = db.fetch_one("SELECT event_id FROM public.proctor_events WHERE session_id = %s AND seq = 1", (sid,))["event_id"]
    r = client.post(f"{P}/teacher/events/{ev}/review", headers=u["priya"], json={"outcome": "DISMISSED", "note": "Sibling, not a helper"})
    assert r.status_code == 200, r.text
    d = client.get(f"{P}/teacher/sessions/{sid}", headers=u["priya"]).json()
    assert d["student"]["section"] == "A" and d["session"]["camera_label"] == "Integrated Camera" and d["can_end"]
    assert next(e for e in d["events"] if e["seq"] == 1)["review"]["outcome"] == "DISMISSED"
    assert {a["action"] for a in d["actions"]} == {"WARNING", "REMARK", "REVIEW"} and d["views"] == 1
    assert next(a for a in d["actions"] if a["action"] == "WARNING")["acknowledged_at"]
    client.get(f"{P}/teacher/sessions/{sid}", headers=u["priya"])
    assert db.fetch_one("SELECT COUNT(*) AS n FROM public.proctor_actions WHERE session_id = %s AND action = 'VIEW'", (sid,))["n"] == 1

    # the student can see every flag stored about them
    mine = client.get(f"{P}/student/sessions/{sid}", headers=u["rohan"]).json()
    assert [f["code"] for f in mine["flags"]][:3] == ["MULTIPLE_FACES", "TAB_HIDDEN", "WINDOW_BLUR"]

    # append-only audit trail
    with pytest.raises(pg_errors.RaiseException):
        db.execute("UPDATE public.proctor_events SET severity = 'Low' WHERE session_id = %s", (sid,))
    with pytest.raises(pg_errors.RaiseException):
        db.execute("DELETE FROM public.proctor_actions WHERE session_id = %s", (sid,))

    # teacher ends the exam: saved answers are handed in, the student is told on the next heartbeat
    assert client.post(f"{P}/teacher/sessions/{sid}/end", headers=u["priya"], json={"reason": ""}).status_code == 422
    r = client.post(f"{P}/teacher/sessions/{sid}/end", headers=u["priya"], json={"reason": "Repeated phone use"})
    assert r.status_code == 200 and r.json() == {"status": "ENDED_BY_TEACHER", "attempt": "test_submitted"}
    hbr = client.post(f"{P}/student/sessions/{sid}/heartbeat", headers=u["rohan"], json=hb).json()
    assert hbr["ended"] and hbr["status"] == "ENDED_BY_TEACHER"
    assert client.post(f"{P}/student/sessions/{sid}/events", headers=u["rohan"], json={"events": [_event(50, "NO_FACE")]}).json()["accepted"] == []
    assert client.get(f"{S}/my/{tid}", headers=u["rohan"]).json()["my"]["status"] != "IN_PROGRESS"
    assert client.post(f"{P}/teacher/sessions/{sid}/end", headers=u["priya"], json={"reason": "again"}).status_code == 409
    view = client.get(f"{P}/teacher/exam", headers=u["priya"], params={"module": "ONLINE_TEST", "ref_id": tid}).json()
    assert next(s for s in view["students"] if s["student_code"] == "REG2026001")["state"] == "ENDED_BY_TEACHER"
    r = client.post(f"{P}/student/sessions", headers=u["rohan"], json={"module": "ONLINE_TEST", "ref_id": tid})
    assert r.status_code == 409   # the attempt is handed in: no new session


def test_other_teachers_and_students_cannot_see_or_act(client, u, online_test):
    sid = _prepare(client, u["meera"], "ONLINE_TEST", online_test)["session_id"]
    assert _start(client, u["meera"], sid).status_code == 200
    client.post(f"{P}/student/sessions/{sid}/events", headers=u["meera"], json={"events": [_event(1, "PHONE_DETECTED", confidence=0.8)]})
    ev = db.fetch_one("SELECT event_id FROM public.proctor_events WHERE session_id = %s", (sid,))["event_id"]

    # Kavya teaches Grade 9-B only: nothing of this exam exists for her
    k = u["kavya"]
    assert client.get(f"{P}/teacher/exam", headers=k, params={"module": "ONLINE_TEST", "ref_id": online_test}).status_code == 404
    assert not any(e["ref_id"] == online_test for e in client.get(f"{P}/teacher/exams", headers=k).json()["exams"])
    assert client.get(f"{P}/teacher/sessions/{sid}", headers=k).status_code == 404
    assert client.post(f"{P}/teacher/sessions/{sid}/warnings", headers=k, json={"message": "hello"}).status_code == 404
    assert client.post(f"{P}/teacher/sessions/{sid}/remarks", headers=k, json={"message": "hello"}).status_code == 404
    assert client.post(f"{P}/teacher/sessions/{sid}/end", headers=k, json={"reason": "no reason"}).status_code == 404
    assert client.post(f"{P}/teacher/events/{ev}/review", headers=k, json={"outcome": "CONCERN"}).status_code == 404
    assert not _notifications("EMP1002", "PROCTOR_ALERT")

    # another student cannot drive or read Meera's session; students never reach teacher routes
    r = u["rohan"]
    assert client.get(f"{P}/student/sessions/{sid}", headers=r).status_code == 404
    assert _start(client, r, sid).status_code == 404
    assert client.post(f"{P}/student/sessions/{sid}/events", headers=r, json={"events": [_event(2, "NO_FACE")]}).status_code == 404
    assert client.post(f"{P}/student/sessions/{sid}/heartbeat", headers=r, json={"camera_live": True}).status_code == 404
    assert client.post(f"{P}/student/sessions/{sid}/finish", headers=r, json={"reason": "left"}).status_code == 404
    assert client.get(f"{P}/teacher/sessions/{sid}", headers=r).status_code == 403
    assert client.post(f"{P}/student/sessions/{sid}/heartbeat", headers=u["priya"], json={"camera_live": True}).status_code == 403
    # a student of another class cannot open a session for this test
    assert client.post(f"{P}/student/sessions", headers=u["kabir"], json={"module": "ONLINE_TEST", "ref_id": online_test}).status_code == 404
    assert client.post(f"{P}/student/sessions", headers=u["rohan"], json={"module": "ONLINE_TEST", "ref_id": "not-a-uuid"}).status_code == 404
    assert client.post(f"{P}/student/sessions", headers=u["rohan"], json={"module": "ONLINE_TEST", "ref_id": "../x"}).status_code == 422


# ---------------------------------------------------------------- virtual lab: interruption, resume, sanctioned away, end
def test_virtual_lab_interruption_resume_and_teacher_end(client, u):
    aid = _lab()
    h = u["ishaan"]
    sid = _prepare(client, h, "VIRTUAL_LAB", aid)["session_id"]
    assert _start(client, h, sid, {"camera": True, "face": True}).status_code == 200      # labs: no mic / full screen needed
    assert client.post(f"/ICMELive/api/v1/virtual-labs/my/{aid}/start", headers=h).status_code == 200
    r = client.post(f"{P}/student/sessions/{sid}/events", headers=h,
                    json={"events": [_event(1, "SANCTIONED_AWAY", details={"reason": "simulation"}), _event(2, "NO_FACE", duration_ms=9000)]})
    assert r.json()["accepted"] == [1, 2]
    assert db.fetch_one("SELECT proctor_flag_count FROM public.virtual_lab_attempts WHERE assignment_id = %s AND student_code = %s",
                        (aid, "REG2026003"))["proctor_flag_count"] == 1                     # the Info event is not a flag

    # silent device -> the sweep raises HEARTBEAT_MISSING and marks the session interrupted
    db.execute("UPDATE public.proctor_sessions SET last_heartbeat_at = NOW() - INTERVAL '3 minutes' WHERE session_id = %s", (sid,))
    assert sessions.sweep(ORG, force=True) >= 1
    s = sessions.load(sid)
    assert s["status"] == "INTERRUPTED"
    assert db.fetch_one("SELECT severity FROM public.proctor_events WHERE session_id = %s AND code = 'HEARTBEAT_MISSING'", (sid,))["severity"] == "High"
    view = client.get(f"{P}/teacher/exam", headers=u["priya"], params={"module": "VIRTUAL_LAB", "ref_id": aid}).json()
    assert view["counts"]["interrupted"] == 1
    # the device comes back
    r = client.post(f"{P}/student/sessions/{sid}/heartbeat", headers=h, json={"camera_live": True, "online": True})
    assert r.json()["status"] == "ACTIVE"
    assert db.fetch_one("SELECT COUNT(*) AS n FROM public.proctor_events WHERE session_id = %s AND code = 'SESSION_RESUMED'", (sid,))["n"] == 1

    # leaving the page interrupts; coming back resumes the same session after a new acknowledgement (no 2nd start notice)
    assert client.post(f"{P}/student/sessions/{sid}/finish", headers=h, json={"reason": "left"}).json()["status"] == "INTERRUPTED"
    assert client.post(f"{P}/student/sessions/{sid}/finish", headers=h, json={"reason": "submitted"}).json()["status"] == "INTERRUPTED"
    p = _prepare(client, h, "VIRTUAL_LAB", aid)
    assert p["session_id"] == sid and p["resumed"] and p["last_seq"] == 2
    assert _start(client, h, sid, {"camera": True, "face": True}).json()["status"] == "ACTIVE"
    assert len([n for n in _notifications("EMP1001", "PROCTOR_STARTED") if n["payload"]["session_id"] == sid]) == 1
    codes = [e["code"] for e in db.fetch_all("SELECT code FROM public.proctor_events WHERE session_id = %s ORDER BY server_ts", (sid,))]
    assert "SESSION_LEFT" in codes and codes.count("SESSION_RESUMED") == 2

    r = client.post(f"{P}/teacher/sessions/{sid}/end", headers=u["priya"], json={"reason": "Talking to a friend"})
    assert r.json()["attempt"] == "lab_submitted"
    assert db.fetch_one("SELECT status FROM public.virtual_lab_attempts WHERE assignment_id = %s AND student_code = %s",
                        (aid, "REG2026003"))["status"] == "submitted"


def test_teacher_can_end_switch_and_disabled_module(client, u):
    aid = _lab("Switch test lab")
    try:
        r = client.put(f"{P}/settings/VIRTUAL_LAB", headers=u["admin"], json={"teacher_can_end": False})
        assert r.status_code == 200 and r.json()["effective"]["teacher_can_end"] is False
        sid = _prepare(client, _login(client, "ananya@demo.edu"), "VIRTUAL_LAB", aid)["session_id"]
        assert client.post(f"{P}/teacher/sessions/{sid}/end", headers=u["priya"], json={"reason": "not allowed"}).status_code == 403
        assert client.put(f"{P}/settings/VIRTUAL_LAB", headers=u["admin"], json={"enabled": False}).status_code == 200
        assert client.get(f"{P}/student/config", headers=u["rohan"], params={"module": "VIRTUAL_LAB"}).json()["enabled"] is False
        assert client.post(f"{P}/student/sessions", headers=u["rohan"], json={"module": "VIRTUAL_LAB", "ref_id": aid}).status_code == 409
    finally:
        db.execute("DELETE FROM public.proctor_settings WHERE org_code = %s AND module = 'VIRTUAL_LAB'", (ORG,))


# ---------------------------------------------------------------- AI Classroom
@pytest.fixture()
def nlp_root(tmp_path, monkeypatch):
    ch = tmp_path / "nlp" / "X" / "Physics" / "Motion"
    ch.mkdir(parents=True)
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Motion")
    doc.save(str(ch / "motion.pdf"))
    doc.close()
    monkeypatch.setattr(nlp_catalog, "ROOT", tmp_path / "nlp")
    nlp_catalog._classroom_tree.cache_clear()
    yield
    nlp_catalog._classroom_tree.cache_clear()


def test_ai_classroom_sessions(client, u, nlp_root):
    h = u["rohan"]
    p = _prepare(client, h, "AI_CLASSROOM", "nlp/X/Physics/Motion")
    assert p["title"] == "AI Classroom · Motion (Physics)" and not p["client_rules"]["mic_required"]
    sid = p["session_id"]
    assert _start(client, h, sid, {"camera": True, "face": True}).status_code == 200
    s = sessions.load(sid)
    assert s["teacher_codes"] == ["EMP1001"] and s["subject_code"] == "PHY101"   # the class's Physics teacher
    assert not [n for n in _notifications("EMP1001", "PROCTOR_STARTED") if n["payload"]["session_id"] == sid]   # dashboard only
    client.post(f"{P}/student/sessions/{sid}/heartbeat", headers=h, json={"camera_live": True, "mic_live": None, "fullscreen": False})
    view = client.get(f"{P}/teacher/exam", headers=u["priya"], params={"module": "AI_CLASSROOM", "ref_id": "nlp/X/Physics/Motion"}).json()
    assert view["counts"]["writing"] == 1 and view["counts"]["camera_issues"] == 0
    me = next(x for x in view["students"] if x["student_code"] == "REG2026001")
    assert me["fullscreen"] is None and me["mic"]["live"] is None              # not required here: not shown as a problem
    assert client.get(f"{P}/teacher/exam", headers=u["kavya"], params={"module": "AI_CLASSROOM", "ref_id": "nlp/X/Physics/Motion"}).status_code == 404
    assert client.post(f"{P}/student/sessions/{sid}/finish", headers=h, json={"reason": "closed"}).json()["status"] == "CLOSED"

    tb = _prepare(client, h, "AI_CLASSROOM", "textbook/PHY101")
    assert tb["title"] == "AI Classroom · Physics textbook"
    for bad in ("nlp/X/Physics/Nope", "textbook/ENG-9", "video/1", "nlp/X"):
        assert client.post(f"{P}/student/sessions", headers=h, json={"module": "AI_CLASSROOM", "ref_id": bad}).status_code == 404, bad


# ---------------------------------------------------------------- settings
def test_settings_are_admin_editable_and_validated(client, u):
    r = client.get(f"{P}/settings", headers=u["admin"])
    assert r.status_code == 200 and r.json()["editable"]
    assert r.json()["modules"]["ONLINE_TEST"]["effective"]["fullscreen_required"] is True
    assert client.get(f"{P}/settings", headers=u["priya"]).json()["editable"] is False
    assert client.get(f"{P}/settings", headers=u["rohan"]).status_code == 403
    assert client.put(f"{P}/settings/ONLINE_TEST", headers=u["priya"], json={"no_face_seconds": 10}).status_code == 403
    assert client.put(f"{P}/settings/ONLINE_TEST", headers=u["admin"], json={"no_face_seconds": 1}).status_code == 422
    assert client.put(f"{P}/settings/ONLINE_TEST", headers=u["admin"], json={}).status_code == 422
    try:
        r = client.put(f"{P}/settings/ONLINE_TEST", headers=u["admin"], json={"no_face_seconds": 12, "notify_min_severity": "Medium"})
        assert r.status_code == 200 and r.json()["effective"]["no_face_seconds"] == 12 and r.json()["overrides"] == {
            "no_face_seconds": 12, "notify_min_severity": "Medium"}
        rules = client.get(f"{P}/student/config", headers=u["rohan"], params={"module": "ONLINE_TEST"}).json()["client_rules"]
        assert rules["durations_ms"]["NO_FACE"] == 12_000
        r = client.put(f"{P}/settings/ONLINE_TEST", headers=u["admin"], json={"no_face_seconds": 8})       # back to the default
        assert r.json()["overrides"] == {"notify_min_severity": "Medium"}
        hist = r.json()["history"]
        assert [h["changes"] for h in hist] == [{"no_face_seconds": [8, 12], "notify_min_severity": ["High", "Medium"]}, {"no_face_seconds": [12, 8]}]
        assert hist[0]["by"] == "ADMIN001"
    finally:
        db.execute("DELETE FROM public.proctor_settings WHERE org_code = %s AND module = 'ONLINE_TEST'", (ORG,))


def test_existing_notify_callers_are_unchanged():
    nid = notif.notify(ORG, "EMP1002", "TEST", "Plain notification", None, None, f"plain-{time.time_ns()}")
    row = db.fetch_one("SELECT severity, payload FROM public.notifications WHERE notification_id = %s", (nid,))
    assert row == {"severity": None, "payload": None}


# ---------------------------------------------------------------- retention
def test_retention_purges_only_old_finished_sessions(client, u):
    aid = _lab("Retention lab")
    h = _login(client, "ananya@demo.edu")
    sid = _prepare(client, h, "VIRTUAL_LAB", aid)["session_id"]
    _start(client, h, sid, {"camera": True, "face": True})
    client.post(f"{P}/student/sessions/{sid}/events", headers=h, json={"events": [_event(1, "NO_FACE", duration_ms=9000)]})
    client.post(f"{P}/teacher/sessions/{sid}/remarks", headers=u["priya"], json={"message": "ok"})
    open_sid = _prepare(client, u["rohan"], "VIRTUAL_LAB", aid)["session_id"]
    db.execute("UPDATE public.proctor_sessions SET status = 'SUBMITTED', ended_at = NOW() - INTERVAL '400 days' WHERE session_id = %s", (sid,))
    db.execute("UPDATE public.proctor_sessions SET created_at = NOW() - INTERVAL '400 days' WHERE session_id = %s", (open_sid,))
    assert retention.purge()["sessions_deleted"] >= 1
    assert sessions.load(sid) is None and sessions.load(open_sid) is not None
    assert db.fetch_one("SELECT COUNT(*) AS n FROM public.proctor_events WHERE session_id = %s", (sid,))["n"] == 0
    with pytest.raises(pg_errors.RaiseException):   # outside the purge the log stays append-only
        db.execute("DELETE FROM public.proctor_events WHERE org_code = %s", (ORG,))


# ---------------------------------------------------------------- real time
def test_hub_publish_subscribe_and_overflow():
    h = hubmod.Hub()

    async def run():
        sub = h.subscribe("org:teacher:T1")
        other = h.subscribe("org:teacher:T2")
        t = threading.Thread(target=lambda: h.publish("org:teacher:T1", {"type": "event", "n": 1}))
        t.start()
        t.join()
        assert (await asyncio.wait_for(sub.get(), 1)) == {"type": "event", "n": 1}
        assert other.queue.empty()                                   # channels are per teacher
        small = hubmod.Subscriber("c", asyncio.get_running_loop(), maxsize=2)
        for i in range(3):
            small.offer({"n": i})
        assert small.dropped == 1 and [await small.get() for _ in range(2)] == [{"n": 1}, {"n": 2, "overflow": True}]
        h.unsubscribe(sub)
        assert h.subscribers("org:teacher:T1") == 0 and h.deliver("org:teacher:T1", {}) == 0

    asyncio.run(run())


def test_redis_bridge_round_trip_and_fallback():
    class FakeRedis:
        def __init__(self, fail=False):
            self.sent, self.fail = [], fail

        def publish(self, channel, data):
            if self.fail:
                raise ConnectionError("down")
            self.sent.append((channel, data))

    h = hubmod.Hub()
    delivered = []
    h.deliver = lambda ch, m: delivered.append((ch, m)) or 1
    h.bridge = hubmod.RedisBridge(h, FakeRedis())
    h.publish("org:teacher:T1", {"type": "event"})
    assert not delivered and h.bridge.client.sent[0][0] == hubmod.REDIS_CHANNEL
    h.bridge.handle(h.bridge.client.sent[0][1])                       # what every process's listener does
    assert delivered == [("org:teacher:T1", {"type": "event"})]
    h.bridge.handle(b"not json")                                      # ignored, no crash
    h.bridge = hubmod.RedisBridge(h, FakeRedis(fail=True))
    h.publish("org:teacher:T1", {"type": "x"})
    assert delivered[-1] == ("org:teacher:T1", {"type": "x"})        # Redis down: local delivery


def test_stream_pushes_live_events_to_the_assigned_teacher(client, u, monkeypatch):
    monkeypatch.setattr(proctoring_router, "STREAM_SECONDS", 1.5)
    assert client.get(f"{P}/teacher/stream", headers=u["rohan"]).status_code == 403

    def later():
        time.sleep(0.5)
        hubmod.hub.publish(hubmod.teacher_channel(ORG, "EMP1001"), {"type": "event", "module": "ONLINE_TEST", "ref_id": "r1", "n": 1})
        hubmod.hub.publish(hubmod.teacher_channel(ORG, "EMP1001"), {"type": "event", "module": "VIRTUAL_LAB", "ref_id": "r2", "n": 2})
        hubmod.hub.publish(hubmod.teacher_channel(ORG, "EMP1002"), {"type": "event", "module": "ONLINE_TEST", "ref_id": "r1", "n": 3})

    t = threading.Thread(target=later)
    t.start()
    r = client.get(f"{P}/teacher/stream", headers=u["priya"], params={"module": "ONLINE_TEST"})
    t.join()
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    body = r.text
    assert body.startswith("event: hello") and body.rstrip().endswith('data: {"reconnect": true}')
    assert '"n": 1' in body and '"n": 2' not in body and '"n": 3' not in body   # module filter + per-teacher channel
