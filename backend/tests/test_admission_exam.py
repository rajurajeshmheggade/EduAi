"""Admission tests, phases 2-5: supervised launch, exam token, candidate flow, proctoring events, server-derived
warnings / auto-submit, the report pipeline (mock AI and fallback), results, evidence, retention and key leakage."""
import io
import json
import time
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

import pytest
from PIL import Image

from app import db
from app.services.admission_test import ai as adm_ai
from app.services.admission_test.guard import limiter
from app.services.admission_test.retention import purge

E = "/ICMELive/api/v1/evaluation"
AD = "/ICMELive/api/v1/admission"
LEAKS = ("answer_key", "rubric", "model_answer", "correct_option", "key_rubric_points", '"points"', "hq_dimension")

QUESTIONS = [
    {"sl_no": "1", "question_type": "MCQ", "question_text": "What is the SI unit of force?", "max_marks": 1,
     "mcq_options": ["(a) Joule", "(b) Newton", "(c) Watt", "(d) Pascal"], "correct_option": "b", "model_answer_text": "(b) Newton"},
    {"sl_no": "2", "question_type": "NUMERICAL", "question_text": "A 2 kg mass accelerates at 3 m/s^2. Find the force in newtons.",
     "max_marks": 2, "model_answer_text": "F = ma = 6 N", "key_rubric_points": ["Formula F = ma (1M)", "Answer 6 N (1M)"]},
    {"sl_no": "3", "question_type": "SHORT_ANSWER", "question_text": "Define power and give its SI unit.", "max_marks": 2,
     "model_answer_text": "Power is the rate of doing work. Its SI unit is the watt.",
     "key_rubric_points": ["Power is the rate of doing work (1M)", "SI unit watt (1M)"]},
]


def _login(client, ident, pw="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def jpeg(size=(320, 240), color=(120, 90, 60), quality=80) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", size, color).save(b, "JPEG", quality=quality)
    return b.getvalue()


@pytest.fixture(scope="module")
def users(client):
    return {k: _login(client, e) for k, e in [("priya", "teacher@demo.edu"), ("kavya", "kavya@demo.edu"), ("admin", "admin@demo.edu")]}


@pytest.fixture(scope="module")
def published(client, users):
    """A published test: 3 imported Physics questions (MCQ, NUMERICAL, SHORT without key) + the HQ standard set."""
    p = users["priya"]
    r = client.post(f"{E}/tests", headers=p, json={"class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "SUBJECT_LEVEL",
                                                    "test_title": f"Unit test {time.time_ns()}", "assessment_type": "ONLINE_TEST", "duration_minutes": 20})
    eid = r.json()["eval_test_id"]
    masters = client.put(f"{E}/tests/{eid}/masters", headers=p, json={"items": QUESTIONS}).json()["masters"]
    t = client.post(f"{AD}/tests", headers=p, json={"title": f"Admission {time.time_ns()}", "grade_applying": "Class 8", "duration_minutes": 30}).json()
    tid = t["test_id"]
    client.post(f"{AD}/tests/{tid}/questions/import", headers=p, json={"master_q_ids": [m["master_q_id"] for m in masters], "section": "academic"})
    client.post(f"{AD}/tests/{tid}/questions/from-hq-bank", headers=p, json={"age_band": "12-14"})
    r = client.post(f"{AD}/tests/{tid}/publish", headers=p)
    assert r.status_code == 200, r.text
    return tid


def candidate(client, h, name="Ananya Rao", years=13, **extra):
    dob = date.today().replace(year=date.today().year - years) - timedelta(days=40)
    r = client.post(f"{AD}/candidates", headers=h, json={"full_name": name, "dob": dob.isoformat(), "grade_applying": "Class 8", **extra})
    assert r.status_code == 201, r.text
    return r.json()["candidate_id"], dob


CONSENT = {"guardian_name": "R. Rao", "relationship": "Mother", "method": "in_person"}


class Exam:
    """The exam view's HTTP client: exam token + device id + page id headers, never a JWT."""

    def __init__(self, client, launch, device):
        self.c, self.sid = client, launch["session_id"]
        self.h = {"X-Exam-Token": launch["exam_token"], "X-Device-Id": device, "X-Page-Id": "page-aaaaaaaaaaaa"}
        self.bodies: list[str] = []

    def _keep(self, r):
        self.bodies.append(r.text)
        return r

    def get(self, path, **kw):
        return self._keep(self.c.get(f"{AD}/session{path}", headers={**self.h, **kw.pop("headers", {})}, **kw))

    def post(self, path, **kw):
        return self._keep(self.c.post(f"{AD}/session{path}", headers={**self.h, **kw.pop("headers", {})}, **kw))

    def put(self, path, **kw):
        return self._keep(self.c.put(f"{AD}/session{path}", headers={**self.h, **kw.pop("headers", {})}, **kw))


GOOD_CHECK = {"secure_context": True, "screens_extended": False, "camera": True, "camera_label": "Integrated Webcam", "microphone": True,
              "face_ok": True, "screen_surface": "monitor", "fullscreen": True, "network_ms": 40, "models_ready": True, "browser": "Chrome 140"}


def launch(client, h, tid, cid, consent=CONSENT, device="device-0123456789abcdef"):
    r = client.post(f"{AD}/launches", headers=h, json={"test_id": tid, "candidate_id": cid, "device_id": device, "guardian_consent": consent})
    assert r.status_code == 201, r.text
    return Exam(client, r.json(), device)


def to_start(ex: Exam, dob: date) -> dict:
    assert ex.post("/claim", json={"page_id": "page-aaaaaaaaaaaa"}).status_code == 200
    assert ex.post("/confirm", json={"dob": dob.isoformat()}).status_code == 200
    assert ex.post("/consent", json={"accepted": True, "notice_version": "2026-10"}).status_code == 200
    assert ex.post("/system-check", json=GOOD_CHECK).status_code == 200
    r = ex.post("/id-photo", files={"file": ("id.jpg", jpeg(), "image/jpeg")})
    assert r.status_code == 200 and r.json()["status"] == "CHECKED", r.text
    r = ex.post("/start")
    assert r.status_code == 200 and r.json()["status"] == "IN_PROGRESS", r.text
    return r.json()


def wait_report(client, h, sid, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        r = client.get(f"{AD}/reports/{sid}", headers=h)
        if r.status_code == 200 and r.json()["status"] in ("READY", "FAILED"):
            return r.json()
        time.sleep(0.3)
    raise AssertionError("report timeout")


def leave_calibration(sid):
    db.execute("UPDATE public.admission_sessions SET started_at = started_at - interval '2 minutes' WHERE session_id = %s", (UUID(sid),))


# ---------------------------------------------------------------- launch + token
def test_launch_rules_and_exam_token_scope(client, users, published):
    p, k = users["priya"], users["kavya"]
    limiter.reset()
    cid, dob = candidate(client, p)
    draft = client.post(f"{AD}/tests", headers=p, json={"title": "Draft only", "grade_applying": "8", "duration_minutes": 10}).json()
    body = {"test_id": published, "candidate_id": cid, "device_id": "device-0123456789abcdef"}
    assert client.post(f"{AD}/launches", headers=p, json={**body, "test_id": draft["test_id"]}).status_code == 409   # not published
    assert client.post(f"{AD}/launches", headers=k, json=body).status_code == 404                                    # not the owner
    r = client.post(f"{AD}/launches", headers=p, json=body)
    assert r.status_code == 422 and "guardian consent" in r.json()["detail"]                                           # minor
    assert client.post(f"{AD}/launches", headers=p, json={**body, "guardian_consent": {**CONSENT, "method": "otp"}}).status_code == 422
    ex = launch(client, p, published, cid)
    token = ex.h["X-Exam-Token"]
    assert len(token) >= 40
    row = db.fetch_one("SELECT exam_token_hash, guardian_consent FROM public.admission_sessions WHERE session_id = %s", (UUID(ex.sid),))
    assert row["exam_token_hash"] != token and len(row["exam_token_hash"]) == 64 and row["guardian_consent"]["confirmed_by"] == "EMP1001"

    # the exam token works only on /session/*, the teacher JWT never does
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.get(f"{AD}/tests", headers={"X-Exam-Token": token}).status_code == 401
    assert client.get(f"{AD}/session", headers=p).status_code == 401
    assert client.get(f"{AD}/session", headers={**p, "X-Exam-Token": p["Authorization"].split()[1], "X-Device-Id": ex.h["X-Device-Id"]}).status_code == 401
    assert client.get(f"{AD}/session", headers={**ex.h, "X-Device-Id": "another-device-0000000"}).status_code == 401
    v = ex.get("")
    assert v.status_code == 200 and v.json()["candidate"]["first_name"] == "Ananya" and "questions" not in v.json()
    assert v.headers["cache-control"] == "no-store" and v.headers["x-content-type-options"] == "nosniff"

    # one page at a time
    assert ex.post("/claim", json={"page_id": "page-aaaaaaaaaaaa"}).status_code == 200
    r = ex.post("/claim", json={"page_id": "page-bbbbbbbbbbbb"}, headers={"X-Page-Id": "page-bbbbbbbbbbbb"})
    assert r.status_code == 409
    assert db.fetch_one("SELECT 1 FROM public.admission_proctor_events WHERE session_id = %s AND code = 'SECOND_SESSION'", (UUID(ex.sid),))
    assert ex.get("", headers={"X-Page-Id": "page-bbbbbbbbbbbb"}).status_code == 409

    # DOB: wrong twice -> attempts left, third -> locked; a re-launch by the teacher unlocks
    wrong = {"dob": (dob - timedelta(days=1)).isoformat()}
    assert "2 attempts left" in ex.post("/confirm", json=wrong).json()["detail"]
    assert ex.post("/confirm", json=wrong).status_code == 422
    assert ex.post("/confirm", json=wrong).status_code == 423
    live = client.get(f"{AD}/live", headers=p, params={"test_id": published}).json()
    assert next(s for s in live["sessions"] if s["session_id"] == ex.sid)["dob_locked"] is True
    old = ex.h["X-Exam-Token"]
    ex2 = launch(client, p, published, cid)
    assert ex2.sid == ex.sid and client.get(f"{AD}/session", headers={**ex.h, "X-Exam-Token": old}).status_code == 401
    db.execute("UPDATE public.admission_sessions SET token_expires_at = NOW() - interval '1 minute' WHERE session_id = %s", (UUID(ex2.sid),))
    assert "expired" in ex2.get("").json()["detail"]


def test_candidate_flow_answers_deadline_and_no_key_leakage(client, users, published):
    p = users["priya"]
    limiter.reset()
    cid, dob = candidate(client, p, "Kabir Nair")
    ex = launch(client, p, published, cid)
    assert ex.post("/claim", json={"page_id": "page-aaaaaaaaaaaa"}).status_code == 200
    assert ex.post("/consent", json={"accepted": True, "notice_version": "2026-10"}).status_code == 409    # confirm first
    assert ex.post("/confirm", json={"dob": dob.isoformat()}).json()["status"] == "CONFIRMED"
    assert ex.post("/id-photo", files={"file": ("id.jpg", jpeg(), "image/jpeg")}).status_code == 409        # consent first
    assert ex.post("/consent", json={"accepted": False, "notice_version": "2026-10"}).status_code == 422
    assert ex.post("/consent", json={"accepted": True, "notice_version": "2026-10"}).status_code == 200
    r = ex.post("/system-check", json={**GOOD_CHECK, "screen_surface": "browser", "screens_extended": True})
    assert r.status_code == 422 and "entire-screen" in r.json()["detail"] and "single screen" in r.json()["detail"]
    assert ex.post("/system-check", json=GOOD_CHECK).status_code == 200
    assert ex.post("/id-photo", files={"file": ("id.png", b"\x89PNG....", "image/png")}).status_code == 415
    assert ex.post("/id-photo", files={"file": ("id.jpg", b"\xff\xd8\xff" + b"0" * 400_000, "image/jpeg")}).status_code == 413
    assert ex.post("/start").status_code == 409                                                             # not CHECKED yet
    exif = io.BytesIO()
    img = Image.new("RGB", (800, 600), (10, 20, 30))
    ex_data = img.getexif()
    ex_data[0x010F] = "SecretCam"
    img.save(exif, "JPEG", exif=ex_data)
    assert ex.post("/id-photo", files={"file": ("id.jpg", exif.getvalue(), "image/jpeg")}).json()["status"] == "CHECKED"
    stored = db.fetch_one("SELECT id_photo_key FROM public.admission_sessions WHERE session_id = %s", (UUID(ex.sid),))["id_photo_key"]
    from app.services.storage import get_storage
    assert b"SecretCam" not in get_storage().get(stored)                                                    # EXIF stripped

    v = ex.post("/start").json()
    qs = v["questions"]
    assert len(qs) == 3 + 13 and v["deadline_at"] and {q["qtype"] for q in qs} >= {"MCQ", "NUMERICAL", "SHORT", "SJT", "REFLECTIVE", "IDEAS"}
    mcq = next(q for q in qs if q["qtype"] == "MCQ")
    newton = next(o["id"] for o in mcq["options"] if o["text"] == "Newton")
    num = next(q for q in qs if q["qtype"] == "NUMERICAL")
    short = next(q for q in qs if q["qtype"] == "SHORT")
    assert ex.put(f"/answers/{mcq['question_id']}", json={"answer": {"option": 9}}).status_code == 422
    assert ex.put(f"/answers/{mcq['question_id']}", json={"answer": {"option": newton}, "time_spent_ms": 999_999}).json()["time_spent_ms"] < 999_999
    assert ex.put(f"/answers/{num['question_id']}", json={"answer": {"value": "6"}, "time_spent_ms": 9000}).status_code == 200
    assert ex.put(f"/answers/{short['question_id']}", json={"answer": {"text": "x" * 5001}}).status_code == 422
    ex.put(f"/answers/{short['question_id']}", json={"answer": {"text": "Power is the rate of doing work; unit watt"}, "time_spent_ms": 20000})
    for q in qs:
        if q["qtype"] == "SJT":
            ex.put(f"/answers/{q['question_id']}", json={"answer": {"option": q["options"][0]["id"]}, "time_spent_ms": 8000})
        if q["qtype"] in ("REFLECTIVE", "IDEAS"):
            ex.put(f"/answers/{q['question_id']}", json={"answer": {"text": "When our science model broke I felt upset, so I asked "
                                                                             "my friends to help, we fixed it together because teamwork works. "
                                                                             "Hat, bucket, plant pot, drum, pencil stand"}, "time_spent_ms": 60000})
    again = ex.get("").json()
    assert again["answers"][mcq["question_id"]] == {"option": newton}

    # deadline + grace passed -> answers refused and the session is auto-submitted TIME_UP
    db.execute("UPDATE public.admission_sessions SET deadline_at = NOW() - interval '31 seconds' WHERE session_id = %s", (UUID(ex.sid),))
    r = ex.put(f"/answers/{mcq['question_id']}", json={"answer": {"option": 0}})
    assert r.status_code == 409 and "Time is up" in r.json()["detail"]
    st = ex.get("/status").json()
    assert st["status"] == "SUBMITTED" and st["submit_reason"] == "TIME_UP" and st["ended"]

    # no exam-view response ever carried an answer key, rubric or model answer
    for body in ex.bodies:
        for word in LEAKS:
            assert word not in body, word

    rep = wait_report(client, p, ex.sid)
    assert rep["status"] == "READY", rep["error"]
    r = rep["report"]
    assert r["scores"]["academic_score"] >= 3 and r["scores"]["academic_max"] == 5                 # MCQ 1 + NUMERICAL 2 (+ AI short)
    short_row = next(q for q in r["questions"] if q["qtype"] == "SHORT")
    assert short_row["ai_source"] == "mock-llm" and short_row["rubric"][0]["criterion"] == "Power is the rate of doing work"
    assert r["hq"]["dimensions"]["EQ"]["keyed"] is not None and r["hq"]["composite"] is not None
    assert r["session"]["submit_reason"] == "TIME_UP" and r["candidate"]["has_photo"] and rep["photo_url"]
    assert r["ai_sources"]["report"] == "mock-llm" and "integrity = max(0" in r["methodology"]["integrity_formula"]
    w = r["scores"]["weights"]
    expected = round((r["scores"]["academic_pct"] * w["academic"] + r["scores"]["hq_composite"] * w["hq"]) / (w["academic"] + w["hq"]), 1)
    assert r["scores"]["composite"] == expected


def test_events_warnings_auto_submit_evidence_and_monitor(client, users, published):
    p = users["priya"]
    limiter.reset()
    cid, dob = candidate(client, p, "Sara Joseph")
    ex = launch(client, p, published, cid)
    to_start(ex, dob)
    since = datetime.now(timezone.utc).isoformat()
    # calibration window: recorded, never deducted
    r = ex.post("/events", json={"events": [{"seq": 1, "code": "MULTIPLE_FACES", "duration_ms": 3000, "confidence": 0.9}]}).json()
    assert r["warnings_count"] == 0
    leave_calibration(ex.sid)
    evs = [{"seq": 2, "code": "TAB_HIDDEN", "duration_ms": 25_000}, {"seq": 3, "code": "COPY_PASTE"}, {"seq": 4, "code": "NOT_A_FLAG"}]
    assert ex.post("/events", json={"events": evs}).status_code == 422                                     # unknown code
    r = ex.post("/events", json={"events": evs[:2]}).json()
    assert r["accepted"] == [2, 3] and r["warnings_count"] == 1
    r = ex.post("/events", json={"events": evs[:2]}).json()                                                  # retry: idempotent by seq
    assert r["warnings_count"] == 1
    rows = db.fetch_all("SELECT code, points, calibration FROM public.admission_proctor_events WHERE session_id = %s AND seq IS NOT NULL ORDER BY seq",
                        (UUID(ex.sid),))
    assert [(x["code"], float(x["points"]), x["calibration"]) for x in rows] == [("MULTIPLE_FACES", 0, True), ("TAB_HIDDEN", 12, False),
                                                                                ("COPY_PASTE", 4, False)]
    # evidence: JPEG only, ≤ 200 KB, linked to its event
    assert ex.post("/evidence", data={"kind": "webcam", "seq": "2"}, files={"file": ("e.png", b"\x89PNG", "image/png")}).status_code == 415
    assert ex.post("/evidence", data={"kind": "webcam", "seq": "2"}, files={"file": ("e.jpg", b"\xff\xd8\xff" + b"1" * 210_000, "image/jpeg")}).status_code == 413
    assert ex.post("/evidence", data={"kind": "webcam", "seq": "99"}, files={"file": ("e.jpg", jpeg(), "image/jpeg")}).status_code == 404
    assert ex.post("/evidence", data={"kind": "webcam", "seq": "2"}, files={"file": ("e.jpg", jpeg(), "image/jpeg")}).json()["stored"]
    assert ex.post("/evidence", data={"kind": "presence"}, files={"file": ("p.jpg", jpeg(), "image/jpeg")}).json()["stored"]

    # heartbeat gap > 30 s -> HEARTBEAT_MISSING raised by the server
    hb = {"fullscreen": True, "visible": True, "faces": 1, "camera_live": True, "screen_live": True, "online": True, "answered": 2}
    assert ex.post("/heartbeat", json=hb).json()["server_flags"] == []
    db.execute("UPDATE public.admission_sessions SET last_heartbeat_at = NOW() - interval '45 seconds' WHERE session_id = %s", (UUID(ex.sid),))
    r = ex.post("/heartbeat", json=hb).json()
    assert r["server_flags"][0]["code"] == "HEARTBEAT_MISSING" and r["warnings_count"] == 2

    # live monitor: progress, chips, latest flags, alerts since
    live = client.get(f"{AD}/live", headers=p, params={"test_id": published, "since": since}).json()
    row = next(s for s in live["sessions"] if s["session_id"] == ex.sid)
    assert row["chips"]["fullscreen"] is True and row["warnings"] == 2 and row["total"] == 16 and row["latest_flags"]
    assert {a["code"] for a in live["alerts"] if a["session_id"] == ex.sid} >= {"TAB_HIDDEN", "HEARTBEAT_MISSING"}
    assert client.get(f"{AD}/live", headers=users["kavya"]).json()["sessions"] == [] or all(
        s["session_id"] != ex.sid for s in client.get(f"{AD}/live", headers=users["kavya"]).json()["sessions"])

    # 5 warnings -> auto-submit AUTO_VIOLATION; answers kept
    r = ex.post("/events", json={"events": [{"seq": 10 + i, "code": "FULLSCREEN_EXIT"} for i in range(3)]}).json()
    assert r["status"] == "SUBMITTED" and r["submit_reason"] == "AUTO_VIOLATION" and r["ended"]
    assert ex.post("/events", json={"events": [{"seq": 20, "code": "TAB_HIDDEN"}]}).json()["accepted"] == []
    rep = wait_report(client, p, ex.sid)
    integ = rep["report"]["integrity"]
    assert rep["status"] == "READY" and integ["score"] < 100 and {f["code"] for f in integ["flags"]} >= {"TAB_HIDDEN", "FULLSCREEN_EXIT"}
    assert rep["report"]["session"]["submit_reason"] == "AUTO_VIOLATION"
    ev = next(e for e in integ["evidence"] if e["code"] == "TAB_HIDDEN")
    assert str(ev["event_id"]) in rep["evidence_urls"] and any(e["code"] == "TAB_HIDDEN" for e in rep["evidence"])
    r = client.get(f"{AD}/reports/{ex.sid}/evidence/{ev['event_id']}", headers=users["admin"], follow_redirects=False)
    assert r.status_code == 302 and "/files/" in r.headers["location"]
    assert client.get(f"{AD}/reports/{ex.sid}", headers=users["kavya"]).status_code == 404


def test_supervisor_end_teacher_end_and_results(client, users, published):
    p = users["priya"]
    limiter.reset()
    cid, dob = candidate(client, p, "=HYPERLINK(\"http://x\")", years=19)
    ex = launch(client, p, published, cid, consent=None)
    to_start(ex, dob)
    for _ in range(5):
        assert ex.post("/supervisor-end", json={"email": "teacher@demo.edu", "password": "wrong"}).status_code == 401
    assert ex.post("/supervisor-end", json={"email": "teacher@demo.edu", "password": "Passw0rd!"}).status_code == 429    # rate limited
    assert db.fetch_one("SELECT COUNT(*) AS n FROM public.admission_proctor_events WHERE session_id = %s AND code = 'SUPERVISOR_AUTH_FAILED'",
                        (UUID(ex.sid),))["n"] == 5
    limiter.reset()
    assert ex.post("/supervisor-end", json={"email": "kavya@demo.edu", "password": "Passw0rd!"}).status_code == 401  # not the launcher
    r = ex.post("/supervisor-end", json={"email": "teacher@demo.edu", "password": "Passw0rd!"}).json()
    assert r["status"] == "ENDED" and r["submit_reason"] == "ENDED_BY_TEACHER"

    cid2, dob2 = candidate(client, p, "Tenzin Dorji", years=20)
    ex2 = launch(client, p, published, cid2, consent=None)
    to_start(ex2, dob2)
    assert client.post(f"{AD}/sessions/{ex2.sid}/end", headers=users["kavya"]).status_code == 404    # not hers: not revealed
    assert client.post(f"{AD}/sessions/{ex2.sid}/end", headers=p).json()["submit_reason"] == "ENDED_BY_TEACHER"
    assert client.post(f"{AD}/sessions/{ex2.sid}/end", headers=p).status_code == 409
    assert client.post(f"{AD}/launches", headers=p, json={"test_id": published, "candidate_id": cid2,
                                                           "device_id": "device-0123456789abcdef"}).status_code == 409   # already completed
    wait_report(client, p, ex.sid)
    res = client.get(f"{AD}/results", headers=p, params={"test_id": published}).json()["results"]
    assert {ex.sid, ex2.sid} <= {r["session_id"] for r in res}
    assert any(r["session_id"] == ex.sid for r in client.get(f"{AD}/results", headers=users["admin"]).json()["results"])
    csv_text = client.get(f"{AD}/results.csv", headers=p, params={"test_id": published}).text
    assert "'=HYPERLINK" in csv_text and "\n=HYPERLINK" not in csv_text


def test_ai_failure_falls_back_and_regenerate(client, users, published, monkeypatch):
    p = users["priya"]
    limiter.reset()
    cid, dob = candidate(client, p, "Fatima Sheikh", years=19)
    ex = launch(client, p, published, cid, consent=None)
    v = to_start(ex, dob)
    short = next(q for q in v["questions"] if q["qtype"] == "SHORT")
    ex.put(f"/answers/{short['question_id']}", json={"answer": {"text": "Power is the rate of doing work, unit watt"}})

    class Broken:
        name = "broken"

        def chat(self, *a, **k):
            raise RuntimeError("provider down")

    monkeypatch.setattr(adm_ai, "get_admission_llm", lambda: Broken())
    assert ex.post("/submit").json()["submit_reason"] == "MANUAL"
    rep = wait_report(client, p, ex.sid)
    assert rep["status"] == "READY"
    src = rep["report"]["ai_sources"]
    assert src["grade"]["fallback"] == 1 and src["report"] == "fallback" and src["integrity"] == "fallback"
    row = next(q for q in rep["report"]["questions"] if q["qtype"] == "SHORT")
    assert row["ai_source"] == "fallback" and row["low_confidence"] is True
    monkeypatch.undo()
    assert client.post(f"{AD}/reports/{ex.sid}/regenerate", headers=p).json()["status"] == "PENDING"
    assert wait_report(client, p, ex.sid)["report"]["ai_sources"]["report"] == "mock-llm"
    assert client.post(f"{AD}/reports/{ex.sid}/regenerate", headers=users["admin"]).status_code == 403


def test_retention_purge_and_candidate_delete(client, users, published):
    p = users["priya"]
    limiter.reset()
    cid, dob = candidate(client, p, "Joseph Mathew", years=19)
    ex = launch(client, p, published, cid, consent=None)
    to_start(ex, dob)
    leave_calibration(ex.sid)
    ex.post("/events", json={"events": [{"seq": 1, "code": "PHONE_DETECTED", "confidence": 0.8, "details": {"box": [1, 2, 3, 4]}}]})
    ex.post("/evidence", data={"kind": "webcam", "seq": "1"}, files={"file": ("e.jpg", jpeg(), "image/jpeg")})
    ex.post("/submit")
    wait_report(client, p, ex.sid)
    from app.services.storage import get_storage
    key = db.fetch_one("SELECT evidence_key FROM public.admission_proctor_events WHERE session_id = %s AND seq = 1", (UUID(ex.sid),))["evidence_key"]
    assert get_storage().get(key)
    out = purge(days=0, at=datetime.now(timezone.utc) + timedelta(seconds=5))
    assert out["events"] >= 1 and out["files"] >= 2
    row = db.fetch_one("SELECT evidence_key, details, code FROM public.admission_proctor_events WHERE session_id = %s AND seq = 1", (UUID(ex.sid),))
    assert row["evidence_key"] is None and row["details"] is None and row["code"] == "PHONE_DETECTED"
    with pytest.raises(FileNotFoundError):
        get_storage().get(key)
    rep = client.get(f"{AD}/reports/{ex.sid}", headers=p).json()
    assert rep["report"]["integrity"]["flags"] and rep["evidence_urls"] == {} and rep["photo_url"] is None

    cid2, dob2 = candidate(client, p, "Lakshmi Pillai", years=19)
    ex2 = launch(client, p, published, cid2, consent=None)
    to_start(ex2, dob2)
    assert client.delete(f"{AD}/candidates/{cid2}", headers=p).status_code == 409                           # in progress
    ex2.post("/submit")
    r = client.delete(f"{AD}/candidates/{cid2}", headers=users["admin"]).json()
    assert r["deleted"] and r["files"] >= 1
    assert db.fetch_one("SELECT 1 FROM public.admission_sessions WHERE session_id = %s", (UUID(ex2.sid),)) is None
    assert json.dumps(r)
