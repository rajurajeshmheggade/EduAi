"""Admission tests, phase 1: authoring from the teacher's own Assignments / Online tests, the HQ bank, AI drafts,
candidates; plus the pure scoring / integrity rules."""
import io
import time
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

import pytest

from app import db
from app.services.admission_test import config as cfg
from app.services.admission_test import integrity, scoring
from app.services.admission_test import questions as qs
from app.services.admission_test.guard import limiter

E = "/ICMELive/api/v1/evaluation"
AD = "/ICMELive/api/v1/admission"

PHYSICS = [
    {"sl_no": "1", "question_type": "MCQ", "question_text": "What is the SI unit of force?", "max_marks": 1,
     "mcq_options": ["(a) Joule", "(b) Newton", "(c) Watt", "(d) Pascal"], "correct_option": "b",
     "model_answer_text": "(b) Newton"},
    {"sl_no": "2", "question_type": "SHORT_ANSWER", "question_text": "Define power and give its SI unit.", "max_marks": 2,
     "model_answer_text": "Power is the rate of doing work. SI unit watt.", "key_rubric_points": ["Rate of doing work (1M)", "SI unit watt (1M)"]},
    {"sl_no": "3", "question_type": "NUMERICAL", "question_text": "A 2 kg mass accelerates at 3 m/s^2. Find the force in newtons.",
     "max_marks": 2, "model_answer_text": "F = ma = 6 N", "key_rubric_points": ["Formula F = ma (1M)", "Answer 6 N"]},
    {"sl_no": "4", "question_type": "DESCRIPTIVE", "question_text": "State Newton's third law with an example.", "max_marks": 4,
     "model_answer_text": "Every action has an equal and opposite reaction. A rocket moves up as gases go down.", "key_rubric_points": []},
]


def _login(client, ident):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _eval_test(client, h, kind, items, class_code="Grade-10-A", subject="PHY101", title=None):
    body = {"class_code": class_code, "subject_code": subject, "evaluation_scope": "SUBJECT_LEVEL",
            "test_title": title or f"{kind} {time.time_ns()}", "assessment_type": kind,
            "due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
    if kind == "ONLINE_TEST":
        body["duration_minutes"] = 30
    r = client.post(f"{E}/tests", headers=h, json=body)
    assert r.status_code == 201, r.text
    tid = r.json()["eval_test_id"]
    r = client.put(f"{E}/tests/{tid}/masters", headers=h, json={"items": items})
    assert r.status_code == 200, r.text
    return tid, {m["sl_no"]: m["master_q_id"] for m in r.json()["masters"]}


@pytest.fixture(scope="module")
def users(client):
    return {k: _login(client, e) for k, e in [("priya", "teacher@demo.edu"), ("kavya", "kavya@demo.edu"), ("admin", "admin@demo.edu"),
                                             ("rohan", "student@demo.edu")]}


@pytest.fixture(scope="module")
def sources(client, users):
    """Priya: an Online test + an Assignment in Physics; Kavya: an English assignment Priya does not teach."""
    online, online_q = _eval_test(client, users["priya"], "ONLINE_TEST", PHYSICS, title="Force and Laws – Unit Test 2")
    assign, assign_q = _eval_test(client, users["priya"], "ASSIGNMENT", PHYSICS[:2], title="Work and Power – Homework")
    english, english_q = _eval_test(client, users["kavya"], "ASSIGNMENT", [
        {"sl_no": "1", "question_type": "SHORT_ANSWER", "question_text": "Write the plural of 'child'.", "max_marks": 1,
         "model_answer_text": "children"}], class_code="Grade-9-B", subject="ENG-9")
    return {"online": online, "online_q": online_q, "assign": assign, "assign_q": assign_q, "english": english, "english_q": english_q}


def _new_test(client, h, **over):
    body = {"title": f"Class 6 admission {time.time_ns()}", "grade_applying": "Class 6", "duration_minutes": 45, **over}
    r = client.post(f"{AD}/tests", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------- pure rules
def test_rubric_parsing_and_snapshot():
    assert scoring.parse_rubric(["Formula 1/v + 1/u = 1/f (1M)", "Sign convention [2 marks]", "Final answer"], 4) == [
        {"criterion": "Formula 1/v + 1/u = 1/f", "marks": 1.0}, {"criterion": "Sign convention", "marks": 2.0},
        {"criterion": "Final answer", "marks": 1.0}]
    assert scoring.parse_rubric([], 3) == [{"criterion": "Matches the model answer", "marks": 3.0}]
    assert scoring.option_index("b", ["(a) Joule", "(b) Newton"]) == 1 and scoring.option_index("(c)", ["x", "y", "z"]) == 2
    assert scoring.clean_option("(b) -15 cm") == "-15 cm"
    assert scoring.numeric_key("v = −30 cm") == {"value": -30.0, "tolerance": 0.3}
    snap = scoring.snapshot({**PHYSICS[0], "max_marks": 1, "eval_test_id": "e", "master_q_id": "m"}, "academic", "src", 3)
    assert snap["options"] == ["Joule", "Newton", "Watt", "Pascal"] and snap["answer_key"] == {"option": 1}
    assert snap["qtype"] == "MCQ" and snap["origin"] == "IMPORTED" and snap["status"] == "APPROVED"


def test_objective_scoring_every_type():
    mcq = {"qtype": "MCQ", "marks": 1, "answer_key": {"option": 2}}
    assert scoring.objective_score(mcq, {"option": 2}) == 1 and scoring.objective_score(mcq, {"option": 0}) == 0
    assert scoring.objective_score(mcq, None) == 0
    multi = {"qtype": "MULTI", "marks": 2, "answer_key": {"options": [0, 3]}}
    assert scoring.objective_score(multi, {"options": [3, 0]}) == 2 and scoring.objective_score(multi, {"options": [0]}) == 0
    num = {"qtype": "NUMERICAL", "marks": 2, "answer_key": {"value": 6, "tolerance": 0.06}}
    assert scoring.objective_score(num, {"value": "6.05"}) == 2 and scoring.objective_score(num, {"value": "6.2"}) == 0
    assert scoring.objective_score(num, {"value": "six"}) == 0
    short = {"qtype": "SHORT", "marks": 1, "answer_key": {"accept": ["Children"], "regex": r"child(ren)?s?"}}
    assert scoring.objective_score(short, {"text": " children. "}) == 1 and scoring.objective_score(short, {"text": "childs"}) == 1
    assert scoring.objective_score({"qtype": "SHORT", "marks": 2, "answer_key": None}, {"text": "x"}) is None   # AI grades
    assert scoring.objective_score({"qtype": "DESCRIPTIVE", "marks": 4}, {"text": "x"}) is None
    sjt = {"qtype": "SJT", "answer_key": {"points": [0, 2, 1, 0]}}
    assert scoring.sjt_points(sjt, {"option": 1}) == 2 and scoring.sjt_points(sjt, None) is None
    with pytest.raises(ValueError):
        scoring.normalise_answer({"qtype": "MCQ", "options": ["a", "b"]}, {"option": 5}, 100)
    with pytest.raises(ValueError):
        scoring.normalise_answer({"qtype": "DESCRIPTIVE"}, {"text": "x" * 101}, 100)


def test_question_validation():
    with pytest.raises(ValueError):
        qs.QuestionIn(section="a", qtype="MCQ", prompt="Pick one", options=["x", "y"])                       # no key
    with pytest.raises(ValueError):
        qs.QuestionIn(section="a", qtype="SJT", prompt="What would you do?", options=list("abcd"),
                      answer_key={"points": [2, 2, 0, 0]}, hq_dimension="EQ")                                  # two Best
    with pytest.raises(ValueError):
        qs.QuestionIn(section="h", qtype="REFLECTIVE", prompt="Tell us about a time…")                         # no dimension
    sjt = qs.QuestionIn(section="h", qtype="SJT", prompt="What would you do?", options=list("abcd"),
                        answer_key={"points": [0, 1, 2, 0]}, hq_dimension="SQ", marks=9)
    assert sjt.marks == 2 and sjt.answer_key == {"points": [0, 1, 2, 0]}
    assert qs.age_band_for_grade("Class 6") == "9-11" and qs.age_band_for_grade("Grade 11") == "15-17"


def _ev(code, ms=0, cal=False):
    return {"code": code, "duration_ms": ms, "calibration": cal}


def test_integrity_formula_caps_and_auto_submit():
    eff = cfg.effective({})
    assert integrity.evaluate([], eff)["score"] == 100
    r = integrity.evaluate([_ev("TAB_HIDDEN", 25_000)], eff)            # 10 + 2 (25 s hidden -> +1 per 10 s)
    assert r["score"] == 88 and r["band"] == "High" and r["warnings"] == 1
    r = integrity.evaluate([_ev("PHONE_DETECTED")] * 3, eff)             # 60 points, capped at 40
    assert r["score"] == 60 and r["critical"] == 3 and r["auto_submit"].startswith("3 critical")
    r = integrity.evaluate([_ev("COPY_PASTE")] * 3, eff)                 # Medium warns from the 3rd
    assert r["warnings"] == 1 and r["score"] == 88
    assert integrity.evaluate([_ev("MULTIPLE_FACES", cal=True)], eff)["score"] == 100      # calibration: nudge only
    off = cfg.effective({"rules": {"VOICE_DETECTED": False}})
    assert integrity.evaluate([_ev("VOICE_DETECTED", 9000)], off)["score"] == 100         # rule switched off
    r = integrity.evaluate([_ev("FACE_MISMATCH"), _ev("FACE_MISMATCH")], eff)
    assert r["score"] == 50 and r["auto_submit"] == "face did not match the ID photo twice"
    r = integrity.evaluate([_ev("FULLSCREEN_EXIT")] * 5, eff)
    assert r["warnings"] == 5 and r["auto_submit"].startswith("5 warnings") and r["deducted"]["FULLSCREEN_EXIT"] == 24
    strict = cfg.effective({"preset": "strict"})
    assert integrity.evaluate([_ev("FULLSCREEN_EXIT")] * 3, strict)["auto_submit"].startswith("3 warnings")
    assert integrity.band(84) == "Moderate" and integrity.band(59) == "Low"
    assert integrity.evaluate([_ev("NETWORK_OFFLINE")] * 6, eff)["warnings"] == 0


# ---------------------------------------------------------------- authoring
def test_question_bank_is_scoped_and_import_snapshots(client, users, sources):
    p, k = users["priya"], users["kavya"]
    bank = client.get(f"{AD}/question-bank", headers=p).json()
    srcs = {s["eval_test_id"] for s in bank["sources"]}
    assert sources["online"] in srcs and sources["assign"] in srcs and sources["english"] not in srcs
    online_only = client.get(f"{AD}/question-bank", headers=p, params={"assessment_type": "ONLINE_TEST", "qtype": "MCQ"}).json()
    assert all(q["assessment_type"] == "ONLINE_TEST" and q["question_type"] == "MCQ" for q in online_only["questions"])
    mcq = next(q for q in bank["questions"] if q["master_q_id"] == sources["online_q"]["1"])
    assert mcq["correct_option"] == "b" and "Force and Laws" in mcq["source_label"]               # keys shown to the teacher

    t = _new_test(client, p)
    assert [s["kind"] for s in t["sections"]] == ["ACADEMIC", "HQ"] and t["status"] == "DRAFT" and t["age_band"] == "9-11"
    ids = [sources["online_q"][n] for n in ("1", "2", "3", "4")]
    r = client.post(f"{AD}/tests/{t['test_id']}/questions/import", headers=p, json={"master_q_ids": ids, "section": "academic"})
    assert r.status_code == 200, r.text
    imp = {q["source_master_q_id"]: q for q in r.json()["imported"]}
    q1, q2, q3 = imp[ids[0]], imp[ids[1]], imp[ids[2]]
    assert q1["options"] == ["Joule", "Newton", "Watt", "Pascal"] and q1["answer_key"] == {"option": 1} and q1["origin"] == "IMPORTED"
    assert q2["qtype"] == "SHORT" and q2["rubric"] == [{"criterion": "Rate of doing work", "marks": 1.0}, {"criterion": "SI unit watt", "marks": 1.0}]
    assert q3["qtype"] == "NUMERICAL" and q3["answer_key"]["value"] == 6.0 and q3["source_label"].startswith("Physics")
    again = client.post(f"{AD}/tests/{t['test_id']}/questions/import", headers=p, json={"master_q_ids": ids[:1], "section": "academic"})
    assert again.json()["skipped"] == 1
    assert client.post(f"{AD}/tests/{t['test_id']}/questions/import", headers=p,
                       json={"master_q_ids": [sources["english_q"]["1"]], "section": "academic"}).status_code == 403
    assert client.post(f"{AD}/tests/{t['test_id']}/questions/import", headers=p, json={"master_q_ids": ids[:1], "section": "hq"}).status_code == 422

    # later edits of the assignment never change the snapshot
    db.execute("UPDATE public.evaluation_master_questions SET question_text = 'CHANGED' WHERE master_q_id = %s", (ids[0],))
    qs_now = client.get(f"{AD}/tests/{t['test_id']}/questions", headers=p).json()["questions"]
    assert next(q for q in qs_now if q["source_master_q_id"] == ids[0])["prompt"] == "What is the SI unit of force?"


def test_hq_bank_drafts_and_publish(client, users, sources):
    p = users["priya"]
    limiter.reset()
    t = _new_test(client, p, grade_applying="Class 7")
    tid = t["test_id"]
    bank = client.get(f"{AD}/hq-bank", headers=p, params={"age_band": "12-14"}).json()
    assert len(bank["items"]) == 17 and {i["qtype"] for i in bank["items"]} == {"SJT", "REFLECTIVE", "IDEAS"}
    r = client.post(f"{AD}/tests/{tid}/questions/from-hq-bank", headers=p, json={"age_band": "12-14"}).json()
    kinds = [q["qtype"] for q in r["added"]]
    assert kinds.count("SJT") == 10 and kinds.count("REFLECTIVE") == 2 and kinds.count("IDEAS") == 1
    dims = [q["hq_dimension"] for q in r["added"] if q["qtype"] == "SJT"]
    assert set(dims) == {"EQ", "SQ", "AQ"} and all(q["section"] == "hq" for q in r["added"])
    assert client.post(f"{AD}/tests/{tid}/questions/from-hq-bank", headers=p, json={"age_band": "12-14"}).json()["skipped"] == 13

    # nothing academic yet -> cannot publish
    assert client.post(f"{AD}/tests/{tid}/publish", headers=p).status_code == 409
    d = client.post(f"{AD}/tests/{tid}/questions/draft", headers=p, json={"kind": "ACADEMIC", "section": "academic", "topic": "Fractions", "count": 2})
    assert d.status_code == 200, d.text
    drafted = d.json()["drafted"]
    assert len(drafted) == 2 and all(q["status"] == "DRAFT" and q["origin"] == "AI_DRAFT" for q in drafted)
    assert client.post(f"{AD}/tests/{tid}/questions/draft", headers=p, json={"kind": "ACADEMIC", "section": "academic"}).status_code == 422
    r = client.post(f"{AD}/tests/{tid}/publish", headers=p)
    assert r.status_code == 409 and "2 drafted" in r.json()["detail"]
    mcq = next(q for q in drafted if q["qtype"] == "MCQ")
    body = {k: mcq[k] for k in ("section", "qtype", "prompt", "options", "answer_key", "rubric", "model_answer", "marks", "topic", "difficulty")}
    assert client.put(f"{AD}/questions/{mcq['question_id']}", headers=p, json={**body, "status": "APPROVED"}).status_code == 200
    assert client.put(f"{AD}/questions/{mcq['question_id']}", headers=p, json={**body, "answer_key": {}}).status_code == 422
    short = next(q for q in drafted if q["qtype"] == "SHORT")
    assert client.delete(f"{AD}/questions/{short['question_id']}", headers=p).status_code == 204
    r = client.post(f"{AD}/tests/{tid}/publish", headers=p)
    assert r.status_code == 200 and r.json()["status"] == "PUBLISHED"
    assert client.put(f"{AD}/questions/{mcq['question_id']}", headers=p, json=body).status_code == 409    # frozen once published
    assert client.post(f"{AD}/tests/{tid}/unpublish", headers=p).json()["status"] == "DRAFT"
    assert client.post(f"{AD}/tests/{tid}/publish", headers=p).status_code == 200

    # admins read, others' teachers do not
    assert any(x["test_id"] == tid for x in client.get(f"{AD}/tests", headers=users["admin"]).json()["tests"])
    assert client.get(f"{AD}/tests/{tid}", headers=users["kavya"]).status_code == 404
    assert client.put(f"{AD}/tests/{tid}", headers=users["admin"], json={"title": "x" * 3, "grade_applying": "6"}).status_code == 403
    assert client.get(f"{AD}/tests", headers=users["rohan"]).status_code == 403


def test_test_settings_validation(client, users):
    p = users["priya"]
    t = _new_test(client, p)
    base = {"title": t["title"], "grade_applying": "Class 6", "duration_minutes": 45}
    bad_rule = {**base, "proctoring_config": {"preset": "strict", "rules": {"NOT_A_RULE": False}}}
    assert client.put(f"{AD}/tests/{t['test_id']}", headers=p, json=bad_rule).status_code == 422
    bad_bands = {**base, "scoring_config": {"w_academic": 0.6, "w_hq": 0.4, "bands": {"strong": 50, "recommended": 60}}}
    assert client.put(f"{AD}/tests/{t['test_id']}", headers=p, json=bad_bands).status_code == 422
    ok = {**base, "proctoring_config": {"preset": "lenient", "rules": {"VOICE_DETECTED": False}},
          "scoring_config": {"w_academic": 0.6, "w_hq": 0.4}, "sections": [{"key": "academic", "title": "Maths", "kind": "ACADEMIC"},
                                                                           {"key": "apt", "title": "Aptitude", "kind": "APTITUDE"}]}
    r = client.put(f"{AD}/tests/{t['test_id']}", headers=p, json=ok).json()
    assert r["proctoring_config"]["preset"] == "lenient" and r["proctoring_config"]["rules"]["VOICE_DETECTED"] is False
    assert r["scoring_config"]["w_hq"] == 0.4 and [s["key"] for s in r["sections"]] == ["academic", "apt"]


def test_candidates_and_csv_import(client, users):
    p, k = users["priya"], users["kavya"]
    dob = date.today().replace(year=date.today().year - 11)
    r = client.post(f"{AD}/candidates", headers=p, json={"full_name": "Aarav Menon", "dob": dob.isoformat(), "grade_applying": "Class 6",
                                                         "guardian_name": "Lakshmi Menon", "accommodations": {"extra_time_minutes": 10}})
    assert r.status_code == 201 and r.json()["minor"] is True and r.json()["age"] == 11
    cid = r.json()["candidate_id"]
    assert client.post(f"{AD}/candidates", headers=p, json={"full_name": "X Y", "dob": "2024-01-01", "grade_applying": "1"}).status_code == 422
    assert client.post(f"{AD}/candidates", headers=p, json={"full_name": "X Y", "dob": dob.isoformat(), "grade_applying": "1",
                                                            "email": "not-an-email"}).status_code == 422
    assert any(c["candidate_id"] == cid for c in client.get(f"{AD}/candidates", headers=p).json()["candidates"])
    assert not any(c["candidate_id"] == cid for c in client.get(f"{AD}/candidates", headers=k).json()["candidates"])
    assert any(c["candidate_id"] == cid for c in client.get(f"{AD}/candidates", headers=users["admin"]).json()["candidates"])

    csv_text = ("name,email,phone,dob,grade_applying,guardian_name,guardian_email,guardian_phone\n"
                "Meera Iyer,meera@example.com,,21/05/2015,Class 6,R Iyer,,\n"
                "No Date,,,,Class 6,,,\n"
                "Kabir Shah,bad-email,,2014-01-02,Class 7,,,\n"
                "Sara Khan,,,2008-03-04,Class 12,,,\n")
    files = {"file": ("candidates.csv", io.BytesIO(csv_text.encode()), "text/csv")}
    prev = client.post(f"{AD}/candidates/import", headers=p, files=files).json()
    assert prev["valid"] == 2 and prev["invalid"] == 2 and prev["created"] == 0
    assert [r["error"] is None for r in prev["rows"]] == [True, False, False, True] and prev["rows"][3]["minor"] is False
    files = {"file": ("candidates.csv", io.BytesIO(csv_text.encode()), "text/csv")}
    assert client.post(f"{AD}/candidates/import?commit=true", headers=p, files=files).json()["created"] == 2
    big = {"file": ("big.csv", io.BytesIO(b"name,dob,grade_applying\n" + b"x" * (1024 * 1024)), "text/csv")}
    assert client.post(f"{AD}/candidates/import", headers=p, files=big).status_code == 413
    assert client.delete(f"{AD}/candidates/{cid}", headers=k).status_code == 404
    assert client.delete(f"{AD}/candidates/{cid}", headers=p).json()["deleted"] is True
    assert db.fetch_one("SELECT 1 FROM public.admission_candidates WHERE candidate_id = %s", (UUID(cid),)) is None
