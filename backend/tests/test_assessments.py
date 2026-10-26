"""Teacher-assigned Online Tests & Assignments (FRD v3.2) end-to-end in offline mock mode."""
import csv
import io
import time
from datetime import datetime, timedelta, timezone

import pymupdf
import pytest

E = "/ICMELive/api/v1/evaluation"
S = "/ICMELive/api/v1/assessments"
A = "/ICMELive/api/v1/admin"

ITEMS = [
    {"sl_no": "1", "question_type": "MCQ", "question_text": "What is the SI unit of force?", "max_marks": 1,
     "mcq_options": ["Joule", "Newton", "Watt", "Pascal"], "correct_option": "b",
     "model_answer_text": "(b) Newton — the force that gives 1 kg an acceleration of 1 m/s^2."},
    {"sl_no": "2", "question_type": "SHORT_ANSWER", "question_text": "Define power and give its SI unit.", "max_marks": 2,
     "model_answer_text": "Power is the rate of doing work (1M). SI unit watt (1M).", "key_rubric_points": []},
    {"sl_no": "3", "question_type": "DESCRIPTIVE", "question_text": "State Newton's third law with an example.", "max_marks": 4,
     "model_answer_text": "To every action there is an equal and opposite reaction (2M). Example: a rocket moves up as gases "
                          "are pushed down (2M).", "key_rubric_points": []},
]


def iso(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _create(client, teacher, kind, **extra):
    body = {"class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "SUBJECT_LEVEL",
            "test_title": f"{kind} {time.time_ns()}", "assessment_type": kind, "due_at": iso(timedelta(days=1)), **extra}
    r = client.post(f"{E}/tests", headers=teacher, json=body)
    assert r.status_code == 201, r.text
    return r.json()["eval_test_id"]


def _ready(client, teacher, test_id, items=ITEMS, assign=True):
    r = client.put(f"{E}/tests/{test_id}/masters", headers=teacher, json={"items": items})
    assert r.status_code == 200, r.text
    if assign:
        a = client.post(f"{E}/tests/{test_id}/assign", headers=teacher, json={"assigned": True})
        assert a.status_code == 200 and a.json()["is_assigned"], a.text
    return r.json()


def _wait_evaluated(client, h, test_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        d = client.get(f"{S}/my/{test_id}", headers=h).json()
        if d["my"]["status"] in ("EVALUATED", "FAILED"):
            return d
        time.sleep(0.3)
    raise AssertionError("evaluation timeout")


def _pdf(text: str) -> bytes:
    doc = pymupdf.open()
    doc.new_page().insert_textbox(pymupdf.Rect(50, 60, 545, 780), text, fontsize=12)
    return doc.tobytes()


@pytest.fixture(scope="module")
def online(client, teacher):
    tid = _create(client, teacher, "ONLINE_TEST", duration_minutes=30)
    return tid


# ---------------------------------------------------------------- setup rules (FR-TST-01, FR-ASG-01)
def test_create_rules(client, teacher):
    no_duration = {"class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "SUBJECT_LEVEL",
                   "test_title": "Bad", "assessment_type": "ONLINE_TEST"}
    assert client.post(f"{E}/tests", headers=teacher, json=no_duration).status_code == 422
    bad_window = {**no_duration, "duration_minutes": 10, "available_from": iso(timedelta(days=2)), "due_at": iso(timedelta(days=1))}
    assert client.post(f"{E}/tests", headers=teacher, json=bad_window).status_code == 422


def test_assign_needs_questions_and_mcq_validation(client, teacher, online):
    assert client.post(f"{E}/tests/{online}/assign", headers=teacher, json={"assigned": True}).status_code == 409
    bad = [{**ITEMS[0], "correct_option": "e"}]
    assert client.put(f"{E}/tests/{online}/masters", headers=teacher, json={"items": bad}).status_code == 422
    one_option = [{**ITEMS[0], "mcq_options": ["Newton"]}]
    assert client.put(f"{E}/tests/{online}/masters", headers=teacher, json={"items": one_option}).status_code == 422
    saved = _ready(client, teacher, online)
    mcq = next(m for m in saved["masters"] if m["sl_no"] == "1")
    assert mcq["question_type"] == "MCQ" and mcq["mcq_options"][1] == "(b) Newton" and mcq["correct_option"] == "b"
    assert float(saved["total_max_marks"]) == 7
    # online tests are not uploaded as folders
    up = client.post(f"{E}/tests/{online}/scripts", headers=teacher, files=[("files", ("Rohan_Student.pdf", _pdf("x"), "application/pdf"))])
    assert up.status_code == 409


def test_mcq_options_parsed_from_documents(client, teacher):
    tid = _create(client, teacher, "ONLINE_TEST", duration_minutes=10)
    r = client.post(f"{E}/tests/{tid}/masters/parse", headers=teacher, files={
        "question_paper": ("qp.md", b"Q1. SI unit of force? (1 mark)\n(a) Joule (b) Newton (c) Watt (d) Pascal\nQ2. Define power. (2 marks)", "text/markdown"),
        "model_answers": ("ans.md", b"Ans 1: (b)\nAns 2: Power is the rate of doing work (1M). SI unit watt (1M).", "text/markdown")})
    items = {i["sl_no"]: i for i in r.json()["items"]}
    assert items["1"]["question_type"] == "MCQ" and items["1"]["correct_option"] == "b" and len(items["1"]["mcq_options"]) == 4
    assert items["2"]["question_type"] == "DESCRIPTIVE" and r.json()["warnings"] == []
    client.delete(f"{E}/tests/{tid}", headers=teacher)


# ---------------------------------------------------------------- online test runner (FR-TST-03/04)
def test_student_takes_online_test(client, student, online):
    listing = client.get(f"{S}/my", headers=student, params={"assessment_type": "ONLINE_TEST"}).json()
    item = next(a for a in listing["assessments"] if a["eval_test_id"] == online)
    assert item["my"]["status"] == "NOT_STARTED" and item["window"]["open"] and listing["pending"] >= 1
    assert "questions" not in client.get(f"{S}/my/{online}", headers=student).json()  # hidden until started

    started = client.post(f"{S}/my/{online}/start", headers=student).json()
    assert started["my"]["status"] == "IN_PROGRESS" and 1790 <= started["my"]["seconds_left"] <= 1800
    qs = started["questions"]
    assert [q["sl_no"] for q in qs] == ["1", "2", "3"]
    assert all("model_answer_text" not in q and "correct_option" not in q for q in qs)  # no answer leaks

    assert client.put(f"{S}/my/{online}/answers", headers=student, json={"answers": {"1": "z"}}).status_code == 422
    assert client.put(f"{S}/my/{online}/answers", headers=student, json={"answers": {"9": "x"}}).status_code == 422
    saved = client.put(f"{S}/my/{online}/answers", headers=student, json={"answers": {"1": "Newton"}, "flagged": ["3"]})
    assert saved.status_code == 200 and saved.json()["saved"] == 1
    resumed = client.post(f"{S}/my/{online}/start", headers=student).json()  # re-opening resumes the attempt
    assert resumed["answers"] == {"1": "b"} and resumed["flagged"] == ["3"]

    r = client.post(f"{S}/my/{online}/submit", headers=student,
                    json={"answers": {"1": "b", "2": "Power is the rate of doing work. Its SI unit is the watt."}})
    assert r.status_code == 200 and r.json()["my"]["status"] in ("EVALUATING", "EVALUATED")
    done = _wait_evaluated(client, student, online)
    assert done["result_available"] and done["score"]["obtained"] is not None
    assert client.post(f"{S}/my/{online}/start", headers=student).status_code == 409  # one attempt only

    rep = client.get(f"{S}/my/{online}/report", headers=student).json()
    items = {i["sl_no"]: i for i in rep["slno_wise_report"]}
    assert float(items["1"]["awarded_marks"]) == 1 and "Correct option (b) Newton" in items["1"]["why_marks_given"]
    assert float(items["2"]["awarded_marks"]) == 2
    assert not items["3"]["is_attempted"] and items["3"]["missing_points"]
    assert rep["summary"]["submission_mode"] == "ONLINE_TEST_UI" and rep["summary"]["ocr_method"] == "typed"
    assert float(rep["summary"]["total_obtained_marks"]) == 3


def test_wrong_mcq_and_timer_auto_submit(client, teacher, student_phy_only, online):
    meera = student_phy_only
    client.post(f"{S}/my/{online}/start", headers=meera)
    client.put(f"{S}/my/{online}/answers", headers=meera, json={"answers": {"1": "a"}})
    from app import db  # simulate the 30 minutes running out with the browser closed
    db.execute("UPDATE public.evaluation_candidate_scripts SET started_at = NOW() - interval '2 hours' "
               "WHERE student_user_code = 'REG2026002' AND eval_test_id = %s", (online,))
    assert client.put(f"{S}/my/{online}/answers", headers=meera, json={"answers": {"1": "b"}}).status_code == 409
    d = client.get(f"{E}/tests/{online}/dashboard", headers=teacher).json()  # also finalises expired attempts
    assert d["submission"]["submitted"] == 2 and d["submission"]["not_submitted"] == 2
    assert {s["full_name"] for s in d["submission"]["not_submitted_students"]} == {"Ishaan Verma", "Ananya Iyer"}
    done = _wait_evaluated(client, meera, online)
    rep = client.get(f"{S}/my/{online}/report", headers=meera).json()
    q1 = next(i for i in rep["slno_wise_report"] if i["sl_no"] == "1")
    assert float(q1["awarded_marks"]) == 0 and "correct answer is (b) Newton" in q1["why_marks_given"]
    assert done["my"]["submitted_at"]


def test_teacher_dashboard_and_roster_register(client, teacher, admin, online):
    d = client.get(f"{E}/tests/{online}/dashboard", headers=teacher).json()
    assert d["overview"]["total_students_evaluated"] == 2 and d["top_scoring_students"][0]["student_user_code"] == "REG2026001"
    assert d["unanswered_by_all"] == ["3"]
    reg = client.get(f"{A}/assessment-scores", headers=admin, params={"eval_test_id": online}).json()
    statuses = {r["student_name"]: r["processing_status"] for r in reg["rows"]}
    assert statuses["Ishaan Verma"] == "NOT_SUBMITTED" and statuses["Rohan Student"] == "EVALUATED" and len(reg["rows"]) == 4
    assert reg["rows"][0]["rank_no"] == 1 and reg["rows"][-1]["rank_no"] is None
    typed = client.get(f"{A}/assessment-scores", headers=admin, params={"assessment_type": "ASSIGNMENT"}).json()["tests"]
    assert all(t["assessment_type"] == "ASSIGNMENT" for t in typed)
    csv_rows = list(csv.reader(io.StringIO(client.get(f"{E}/tests/{online}/register.csv", headers=teacher).text)))
    assert "Not submitted" in [row[12] for row in csv_rows[2:]]
    # withdrawing or deleting after students submitted is blocked
    assert client.post(f"{E}/tests/{online}/assign", headers=teacher, json={"assigned": False}).status_code == 409
    assert client.delete(f"{E}/tests/{online}", headers=teacher).status_code == 409


def test_not_open_yet_and_other_class(client, teacher, student):
    tid = _create(client, teacher, "ONLINE_TEST", duration_minutes=10, available_from=iso(timedelta(hours=2)),
                  due_at=iso(timedelta(days=1)))
    _ready(client, teacher, tid)
    r = client.post(f"{S}/my/{tid}/start", headers=student)
    assert r.status_code == 409 and r.json()["detail"] == "Not open yet"
    kabir = _login(client, "kabir@demo.edu")  # Grade-9-B
    assert client.get(f"{S}/my/{tid}", headers=kabir).status_code == 404


# ---------------------------------------------------------------- assignment (FR-ASG-02/03/04)
@pytest.fixture(scope="module")
def assignment(client, teacher):
    tid = _create(client, teacher, "ASSIGNMENT", results_release="ON_PUBLISH",
                  instructions="Answer all questions on paper and upload one PDF.")
    _ready(client, teacher, tid, items=ITEMS[1:])
    return tid


def test_student_uploads_assignment_and_waits_for_publish(client, teacher, student, assignment):
    d = client.get(f"{S}/my/{assignment}", headers=student).json()
    assert d["my"]["status"] == "NOT_STARTED" and [q["sl_no"] for q in d["questions"]] == ["2", "3"]
    assert client.post(f"{S}/my/{assignment}/start", headers=student).status_code == 409  # not an online test
    bad = client.post(f"{S}/my/{assignment}/upload", headers=student, files={"file": ("a.png", b"\x89PNG....", "image/png")})
    assert bad.status_code == 415
    text = ("SL.No 2. Power is the rate of doing work. SI unit is watt.\n\n"
            "SL.No 3. To every action there is an equal and opposite reaction. Example: a rocket moves up as gases are pushed down.")
    r = client.post(f"{S}/my/{assignment}/upload", headers=student, files={"file": ("my_answers.pdf", _pdf(text), "application/pdf")})
    assert r.status_code == 200, r.text
    done = _wait_evaluated(client, student, assignment)
    assert done["result_pending_publish"] and not done["result_available"] and done["score"] is None
    assert client.get(f"{S}/my/{assignment}/report", headers=student).status_code == 404

    assert client.post(f"{E}/tests/{assignment}/publish", headers=teacher, json={"published": True}).status_code == 200
    rep = client.get(f"{S}/my/{assignment}/report", headers=student).json()
    assert float(rep["summary"]["total_obtained_marks"]) == 6 and rep["summary"]["submission_mode"] == "STUDENT_PDF_UPLOAD"
    assert rep["summary"]["script_url"]
    again = client.post(f"{S}/my/{assignment}/upload", headers=student, files={"file": ("x.pdf", _pdf("SL.No 2. x"), "application/pdf")})
    assert again.status_code == 409
    client.post(f"{E}/tests/{assignment}/publish", headers=teacher, json={"published": False})


def test_teacher_folder_upload_into_assignment(client, teacher, assignment):
    up = client.post(f"{E}/tests/{assignment}/scripts", headers=teacher,
                     files=[("files", ("Meera_Student.pdf", _pdf("SL.No 2. Power is work done per second."), "application/pdf"))])
    assert up.status_code == 200 and up.json()["uploaded"][0]["student_user_code"] == "REG2026002"
    progress = client.get(f"{E}/tests/{assignment}/dashboard", headers=teacher).json()["submission"]
    assert progress["submitted"] == 2 and progress["not_submitted"] == 2


def test_late_rules(client, teacher, student):
    closed = _create(client, teacher, "ASSIGNMENT", due_at=iso(timedelta(minutes=-5)))
    _ready(client, teacher, closed, items=ITEMS[1:2])
    r = client.post(f"{S}/my/{closed}/upload", headers=student, files={"file": ("a.pdf", _pdf("SL.No 2. Power is the rate of doing work."), "application/pdf")})
    assert r.status_code == 409 and "Due date" in r.json()["detail"]

    late_ok = _create(client, teacher, "ASSIGNMENT", due_at=iso(timedelta(minutes=-5)), allow_late=True)
    _ready(client, teacher, late_ok, items=ITEMS[1:2])
    r = client.post(f"{S}/my/{late_ok}/upload", headers=student, files={"file": ("a.pdf", _pdf("SL.No 2. Power is the rate of doing work."), "application/pdf")})
    assert r.status_code == 200 and r.json()["my"]["is_late"] is True


def test_settings_update(client, teacher):
    tid = _create(client, teacher, "ONLINE_TEST", duration_minutes=15)
    r = client.patch(f"{E}/tests/{tid}", headers=teacher, json={"duration_minutes": 20, "test_title": "Renamed quiz",
                                                                 "results_release": "ON_PUBLISH"})
    assert r.status_code == 200 and r.json()["duration_minutes"] == 20 and r.json()["test_title"] == "Renamed quiz"
    assert r.json()["results_release"] == "ON_PUBLISH"
    client.delete(f"{E}/tests/{tid}", headers=teacher)


def test_teacher_edits_marks_after_publish_and_resets(client, teacher, student, online):
    assert client.post(f"{E}/tests/{online}/publish", headers=teacher, json={"published": True}).status_code == 200
    rows = client.get(f"{E}/tests/{online}/register", headers=teacher).json()["rows"]
    rohan = next(r for r in rows if r["student_user_code"] == "REG2026001")
    rep = client.get(f"{E}/tests/{online}/scripts/{rohan['script_id']}/report", headers=teacher).json()
    q3 = next(i for i in rep["slno_wise_report"] if i["sl_no"] == "3")
    before = float(rep["summary"]["total_obtained_marks"])
    r = client.patch(f"{E}/tests/{online}/results/{q3['slno_result_id']}", headers=teacher,
                     json={"awarded_marks": 1.5, "teacher_comment": "Answered orally in class"})
    assert r.status_code == 200 and float(r.json()["summary"]["total_obtained_marks"]) == before + 1.5
    mine = client.get(f"{S}/my/{online}/report", headers=student).json()  # published -> student sees the edit
    assert float(mine["summary"]["total_obtained_marks"]) == before + 1.5
    assert next(i for i in mine["slno_wise_report"] if i["sl_no"] == "3")["teacher_comment"] == "Answered orally in class"
    reset = client.patch(f"{E}/tests/{online}/results/{q3['slno_result_id']}", headers=teacher, json={"reset_to_ai": True})
    assert float(reset.json()["summary"]["total_obtained_marks"]) == before
    assert reset.json()["summary"]["processing_status"] == "EVALUATED"
    assert client.patch(f"{E}/tests/{online}/results/{q3['slno_result_id']}", headers=student, json={"awarded_marks": 4}).status_code == 403
