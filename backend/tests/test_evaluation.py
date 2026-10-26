"""AI Evaluation Engine (FR-EV-01..13) end-to-end in offline mock mode: typed scripts use the PDF text layer and
the deterministic rubric grader; a scanned script must fail cleanly without AI keys."""
import csv
import io
import time

import pymupdf
import pytest

from app.services.evaluation import matching

E = "/ICMELive/api/v1/evaluation"
A = "/ICMELive/api/v1/admin"

QUESTION_PAPER = b"""# Physics - Chapter 1 Unit Test
SL.No 1. State the two laws of reflection of light and draw a labeled ray diagram. (5 marks)
SL.No 2. An object is placed 20 cm in front of a concave mirror of focal length 15 cm. Find the image distance and nature. (5 marks)
SL.No 3. Derive the relation between critical angle and refractive index for total internal reflection. (5 marks)
"""
MODEL_ANSWERS = b"""Ans 1: 1. Angle of incidence (i) equals angle of reflection (r) (2M). 2. The incident ray, the normal and the reflected ray lie in the same plane (2M). 3. Labeled ray diagram with arrows (1M).
Ans 2: Mirror formula 1/v + 1/u = 1/f (1M). Sign convention u = -20 cm, f = -15 cm (1M). Calculation gives v = -60 cm (2M). Nature of image: real, inverted, magnified (1M).
Ans 3: Snell law at the critical angle n1 sin c = n2 sin 90 (2M). Relation n = 1/sin c (2M). Conditions for total internal reflection: denser to rarer medium and angle greater than critical angle (1M).
"""

SCRIPTS = {
    "Rohan_Student.pdf": [
        "SL.No 1. Angle of incidence (i) equals angle of reflection (r). The incident ray, the normal and the reflected "
        "ray lie in the same plane. Labeled ray diagram with arrows drawn.",
        "SL.No 2. Mirror formula 1/v + 1/u = 1/f. Sign convention u = -20 cm, f = -15 cm. Calculation gives v = -60 cm. "
        "Nature of image: real, inverted, magnified.",
    ],
    "meera student.pdf": [
        "SL.No 1. Angle of incidence equals angle of reflection.",
        "SL.No 2. Mirror formula 1/v + 1/u = 1/f with u = -20 and f = +15.",
    ],
    "10A03_REG2026003.pdf": ["SL.No 1. Light bounces back from a shiny mirror surface."],
    "Ananya Iyar.pdf": [
        "SL.No 1. Angle of incidence (i) equals angle of reflection (r). The incident ray, the normal and the reflected "
        "ray lie in the same plane.",
        "SL.No 2. Mirror formula 1/v + 1/u = 1/f, sign convention u = -20 cm, f = -15 cm, v = -60 cm.",
    ],
    "Unknown_Kid.pdf": ["SL.No 1. Something."],
}


def _pdf(paragraphs: list[str]) -> bytes:
    doc = pymupdf.open()
    for para in paragraphs:  # one answer per page, like a real script
        page = doc.new_page()
        page.insert_textbox(pymupdf.Rect(50, 60, 545, 780), "Student answer script\n\n" + para, fontsize=12)
    return doc.tobytes()


def _scanned_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.draw_rect(pymupdf.Rect(80, 80, 400, 300), color=(0, 0, 0), fill=(0.8, 0.8, 0.8))  # no text layer
    return doc.tobytes()


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _wait(client, h, job_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        job = client.get(f"{E}/jobs/{job_id}", headers=h).json()
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(0.3)
    raise AssertionError("evaluation job timeout")


@pytest.fixture(scope="module")
def test_id(client, teacher):
    r = client.post(f"{E}/tests", headers=teacher, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "CHAPTER_LEVEL",
        "chapter_title": "Light - Reflection and Refraction", "test_title": "Chapter 1 Unit Test",
        "exam_date": "2026-10-20", "pass_percentage": 40})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "DRAFT" and r.json()["evaluation_scope"] == "CHAPTER_LEVEL"
    return r.json()["eval_test_id"]


# ---------------------------------------------------------------- unit: filename matching (FR-EV-06)
ROSTER = [{"user_code": "S1", "full_name": "Aarav Sharma", "roll_number": "1"},
          {"user_code": "S2", "full_name": "Priya Patel", "roll_number": "2"},
          {"user_code": "S3", "full_name": "Priya Pathak", "roll_number": "3"}]


@pytest.mark.parametrize("name,expected,method", [
    ("Aarav_Sharma.pdf", "S1", "name"), ("aarav sharma.PDF", "S1", "name"), ("10A01_Aarav_Sharma.pdf", "S1", "name"),
    ("Sharma Aarav.pdf", "S1", "name"), ("S2.pdf", "S2", "code"), ("Arav_Sharma.pdf", "S1", "fuzzy"),
    ("Priya_Pat.pdf", None, None), ("3.pdf", "S3", "roll"), ("random.pdf", None, None),
])
def test_filename_matching(name, expected, method):
    code, how, _ = matching.match_student(name, ROSTER)
    assert (code, how) == (expected, method)


def test_matching_skips_students_already_taken():
    assert matching.match_student("Aarav_Sharma.pdf", ROSTER, taken={"S1"})[0] is None


# ---------------------------------------------------------------- setup & masters (FR-EV-01..04)
def test_rbac_and_module_gate(client, student, admin):
    body = {"class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "SUBJECT_LEVEL", "test_title": "Unit test"}
    assert client.post(f"{E}/tests", headers=student, json=body).status_code == 403
    assert client.post(f"{E}/tests", headers=admin, json=body).status_code == 403
    kavya = _login(client, "kavya@demo.edu")  # teaches ENG-9 only
    assert client.post(f"{E}/tests", headers=kavya, json=body).status_code == 403
    no_chapter = {**body, "evaluation_scope": "CHAPTER_LEVEL"}
    teacher = _login(client, "teacher@demo.edu")
    assert client.post(f"{E}/tests", headers=teacher, json=no_chapter).status_code == 422

    sa = _login(client, "superadmin", "superadmin")
    client.put(f"{A}/settings", headers=sa, params={"org_code": "DEMO-SCHOOL"}, json={"ai_modules": ["rag_chatbot"]})
    try:
        assert client.post(f"{E}/tests", headers=teacher, json=body).status_code == 403
    finally:
        client.put(f"{A}/settings", headers=sa, params={"org_code": "DEMO-SCHOOL"},
                   json={"ai_modules": ["rag_chatbot", "ai_avatar_tutor", "ocr_evaluation", "capability_analysis"]})


def test_parse_masters_preview(client, teacher, test_id):
    r = client.post(f"{E}/tests/{test_id}/masters/parse", headers=teacher, files={
        "question_paper": ("question_paper.md", QUESTION_PAPER, "text/markdown"),
        "model_answers": ("model_answers.md", MODEL_ANSWERS, "text/markdown")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["warnings"] == [] and body["parser"] == "rules"
    items = {i["sl_no"]: i for i in body["items"]}
    assert list(items) == ["1", "2", "3"] and all(i["max_marks"] == 5 for i in items.values())
    assert items["1"]["key_rubric_points"][0].startswith("Angle of incidence (i) equals angle of reflection (r)")
    assert len(items["2"]["key_rubric_points"]) == 4
    # nothing saved yet: scripts can't be uploaded while the test is a draft
    up = client.post(f"{E}/tests/{test_id}/scripts", headers=teacher, files=[("files", ("a.pdf", _pdf(["x"]), "application/pdf"))])
    assert up.status_code == 409


def test_parse_warns_about_missing_marks(client, teacher, test_id):
    r = client.post(f"{E}/tests/{test_id}/masters/parse", headers=teacher, files={
        "question_paper": ("qp.txt", b"Q1. Define force.\nQ2. Define work.", "text/plain"),
        "model_answers": ("ans.txt", b"Ans 1: Force is a push or pull.", "text/plain")})
    warnings = r.json()["warnings"]
    assert any("SL.No 1: maximum marks" in w for w in warnings) and any("SL.No 2: no model answer" in w for w in warnings)
    bad = client.post(f"{E}/tests/{test_id}/masters/parse", headers=teacher, files={
        "question_paper": ("qp.exe", b"MZ", "application/octet-stream"),
        "model_answers": ("ans.txt", b"x", "text/plain")})
    assert bad.status_code == 415


def test_save_masters(client, teacher, test_id):
    parsed = client.post(f"{E}/tests/{test_id}/masters/parse", headers=teacher, files={
        "question_paper": ("question_paper.md", QUESTION_PAPER, "text/markdown"),
        "model_answers": ("model_answers.md", MODEL_ANSWERS, "text/markdown")}).json()
    dup = {"items": [parsed["items"][0], {**parsed["items"][1], "sl_no": "1"}]}
    assert client.put(f"{E}/tests/{test_id}/masters", headers=teacher, json=dup).status_code == 422
    r = client.put(f"{E}/tests/{test_id}/masters", headers=teacher, json={"items": parsed["items"]})
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["status"] == "READY" and float(t["total_max_marks"]) == 15 and t["total_questions"] == 3
    assert all(m["has_embedding"] for m in t["masters"])
    assert t["question_paper_url"] and t["model_answer_name"] == "model_answers.md"


# ---------------------------------------------------------------- folder upload & matching (FR-EV-05..07)
def test_folder_upload_matches_roster(client, teacher, test_id):
    files = [("files", (n, _pdf(p), "application/pdf")) for n, p in SCRIPTS.items()]
    files.append(("files", ("Thumbs.db", b"junk", "application/octet-stream")))  # ignored like a real folder
    r = client.post(f"{E}/tests/{test_id}/scripts", headers=teacher, files=files)
    assert r.status_code == 200, r.text
    got = {u["file"]: (u["student_user_code"], u["match_method"]) for u in r.json()["uploaded"]}
    assert got == {
        "Rohan_Student.pdf": ("REG2026001", "name"), "meera student.pdf": ("REG2026002", "name"),
        "10A03_REG2026003.pdf": ("REG2026003", "code"), "Ananya Iyar.pdf": ("REG2026004", "fuzzy"),
        "Unknown_Kid.pdf": (None, None)}
    view = r.json()
    assert view["students_without_script"] == [] and len(view["roster"]) >= 4


def test_manual_reassignment(client, teacher, test_id):
    scripts = client.get(f"{E}/tests/{test_id}/scripts", headers=teacher).json()["scripts"]
    unknown = next(s for s in scripts if s["uploaded_pdf_filename"] == "Unknown_Kid.pdf")
    taken = client.patch(f"{E}/tests/{test_id}/scripts/{unknown['script_id']}", headers=teacher,
                         json={"student_user_code": "REG2026001"})
    assert taken.status_code == 409
    other_class = client.patch(f"{E}/tests/{test_id}/scripts/{unknown['script_id']}", headers=teacher,
                               json={"student_user_code": "REG2026101"})
    assert other_class.status_code == 422
    assert client.delete(f"{E}/tests/{test_id}/scripts/{unknown['script_id']}", headers=teacher).status_code == 200


def test_zip_upload_replaces_existing_script(client, teacher, test_id):
    buf = io.BytesIO()
    import zipfile
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("scripts/Ananya_Iyer.pdf", _pdf(SCRIPTS["Ananya Iyar.pdf"]))
        z.writestr("__MACOSX/._Ananya_Iyer.pdf", b"junk")
    r = client.post(f"{E}/tests/{test_id}/scripts", headers=teacher, files=[("files", ("batch.zip", buf.getvalue(), "application/zip"))])
    assert r.status_code == 200, r.text
    up = r.json()["uploaded"]
    assert len(up) == 1 and up[0]["student_user_code"] == "REG2026004" and up[0]["replaced"] is True
    assert sum(1 for s in r.json()["scripts"] if s["student_user_code"] == "REG2026004") == 1


# ---------------------------------------------------------------- AI queue + analytics (FR-EV-09..12)
@pytest.fixture(scope="module")
def evaluated(client, teacher, test_id):
    r = client.post(f"{E}/tests/{test_id}/evaluate", headers=teacher, json={})
    assert r.status_code == 202, r.text
    assert r.json()["scripts"] == 4
    job = _wait(client, teacher, r.json()["job_id"])
    assert job["status"] == "completed" and job["detail"]["done"] == 4 and job["detail"]["failed"] == 0, job
    return client.get(f"{E}/tests/{test_id}/dashboard", headers=teacher).json()


def test_dashboard_top_low_and_unanswered(evaluated):
    d = evaluated
    assert d["overview"]["total_students_evaluated"] == 4 and d["test"]["status"] == "EVALUATED"
    top = [s["student_user_code"] for s in d["top_scoring_students"]]
    assert top[0] == "REG2026001" and top[-1] == "REG2026003"
    assert float(d["top_scoring_students"][0]["total_obtained_marks"]) == 10  # full marks on SL.No 1 and 2
    assert "REG2026003" in [s["student_user_code"] for s in d["low_scoring_students"]]
    assert d["unanswered_by_all"] == ["3"]  # nobody answered SL.No 3
    q = {x["sl_no"]: x for x in d["question_analytics"]}
    assert q["3"]["attempt_rate"] == 0 and q["1"]["attempt_rate"] == 100 and q["2"]["unanswered_count"] == 1
    assert q["1"]["full_marks_count"] >= 1 and q["1"]["common_missing_points"]
    assert d["most_skipped"][0]["sl_no"] == "3"
    assert sum(b["students"] for b in d["score_distribution"]) == 4


def test_script_report_why_missing_feedback(client, teacher, test_id, evaluated):
    rows = client.get(f"{E}/tests/{test_id}/register", headers=teacher).json()["rows"]
    rohan = next(r for r in rows if r["student_user_code"] == "REG2026001")
    assert rohan["rank_no"] == 1 and rohan["grade"] in ("B", "C") and rohan["result"] == "Pass"
    rep = client.get(f"{E}/tests/{test_id}/scripts/{rohan['script_id']}/report", headers=teacher).json()
    s, items = rep["summary"], {i["sl_no"]: i for i in rep["slno_wise_report"]}
    assert s["ocr_method"] == "text_layer" and s["rank"] == 1 and s["percentile"] == 100.0 and s["script_url"]
    assert items["1"]["is_attempted"] and float(items["1"]["awarded_marks"]) == 5 and "Awarded" in items["1"]["why_marks_given"]
    assert items["1"]["student_ocr_text"].startswith("Angle of incidence")
    assert "answer script" not in items["1"]["student_ocr_text"].lower()  # page header of page 2 stripped
    assert not items["3"]["is_attempted"] and float(items["3"]["awarded_marks"]) == 0
    assert len(items["3"]["missing_points"]) == 3 and "not attempted" in items["3"]["why_marks_given"]
    assert 0 < float(items["1"]["semantic_similarity"]) <= 1
    meera = next(r for r in rows if r["student_user_code"] == "REG2026002")
    mrep = client.get(f"{E}/tests/{test_id}/scripts/{meera['script_id']}/report", headers=teacher).json()
    m2 = next(i for i in mrep["slno_wise_report"] if i["sl_no"] == "2")
    assert 0 < float(m2["awarded_marks"]) < 5 and m2["missing_points"]


def test_teacher_override_recomputes_totals(client, teacher, test_id, evaluated):
    rows = client.get(f"{E}/tests/{test_id}/register", headers=teacher).json()["rows"]
    meera = next(r for r in rows if r["student_user_code"] == "REG2026002")
    rep = client.get(f"{E}/tests/{test_id}/scripts/{meera['script_id']}/report", headers=teacher).json()
    item = next(i for i in rep["slno_wise_report"] if i["sl_no"] == "2")
    before = float(rep["summary"]["total_obtained_marks"])
    assert client.patch(f"{E}/tests/{test_id}/results/{item['slno_result_id']}", headers=teacher,
                        json={"awarded_marks": 9}).status_code == 422
    r = client.patch(f"{E}/tests/{test_id}/results/{item['slno_result_id']}", headers=teacher,
                     json={"awarded_marks": 4, "teacher_comment": "Sign convention slip only"})
    assert r.status_code == 200, r.text
    after = r.json()
    new_item = next(i for i in after["slno_wise_report"] if i["sl_no"] == "2")
    assert new_item["teacher_override"] and float(new_item["awarded_marks"]) == 4
    assert float(new_item["ai_awarded_marks"]) == float(item["ai_awarded_marks"])
    assert float(after["summary"]["total_obtained_marks"]) == before - float(item["awarded_marks"]) + 4
    assert after["summary"]["processing_status"] == "REVIEWED"


def test_scanned_script_fails_cleanly_without_keys(client, teacher, test_id, evaluated):
    up = client.post(f"{E}/tests/{test_id}/scripts", headers=teacher,
                     files=[("files", ("Ishaan_Verma.pdf", _scanned_pdf(), "application/pdf"))])
    assert up.json()["uploaded"][0]["replaced"] is True
    job = _wait(client, teacher, client.post(f"{E}/tests/{test_id}/evaluate", headers=teacher, json={}).json()["job_id"])
    assert job["detail"]["failed"] == 1 and "scanned" in job["detail"]["errors"][0]["error"].lower()
    ishaan = next(s for s in client.get(f"{E}/tests/{test_id}/scripts", headers=teacher).json()["scripts"]
                  if s["student_user_code"] == "REG2026003")
    assert ishaan["processing_status"] == "FAILED" and "PROVIDER_MODE" in ishaan["error"]
    # put the typed script back so later tests see four evaluated students
    client.post(f"{E}/tests/{test_id}/scripts", headers=teacher,
                files=[("files", ("REG2026003.pdf", _pdf(SCRIPTS["10A03_REG2026003.pdf"]), "application/pdf"))])
    assert _wait(client, teacher, client.post(f"{E}/tests/{test_id}/evaluate", headers=teacher, json={}).json()["job_id"])["status"] == "completed"


def test_editing_masters_after_grading_needs_confirmation(client, teacher, test_id, evaluated):
    masters = client.get(f"{E}/tests/{test_id}", headers=teacher).json()["masters"]
    items = [{k: m[k] for k in ("sl_no", "question_text", "model_answer_text", "key_rubric_points")} | {"max_marks": float(m["max_marks"])}
             for m in masters]
    assert client.put(f"{E}/tests/{test_id}/masters", headers=teacher, json={"items": items}).status_code == 409


# ---------------------------------------------------------------- publish, student view, admin register (FR-EV-11, 13)
def test_student_sees_report_only_after_publish(client, teacher, student, test_id, evaluated):
    assert client.get(f"{E}/my-tests", headers=student).json()["tests"] == []
    assert client.get(f"{E}/my-tests/{test_id}", headers=student).status_code == 404
    r = client.post(f"{E}/tests/{test_id}/publish", headers=teacher, json={"published": True})
    assert r.status_code == 200 and r.json()["status"] == "PUBLISHED"
    mine = client.get(f"{E}/my-tests", headers=student).json()["tests"]
    assert [t["eval_test_id"] for t in mine] == [test_id] and mine[0]["grade"]
    rep = client.get(f"{E}/my-tests/{test_id}", headers=student).json()
    assert rep["summary"]["student_user_code"] == "REG2026001" and len(rep["slno_wise_report"]) == 3
    # published results are locked
    assert client.post(f"{E}/tests/{test_id}/evaluate", headers=teacher, json={"re_evaluate": True}).status_code == 409
    # teachers' endpoints stay closed to students
    assert client.get(f"{E}/tests/{test_id}/dashboard", headers=student).status_code == 403


def test_admin_score_register_and_csv(client, admin, teacher, test_id, evaluated):
    listing = client.get(f"{A}/evaluation-scores", headers=admin, params={"class_code": "Grade-10-A", "subject_code": "PHY101"}).json()
    assert any(t["eval_test_id"] == test_id for t in listing["tests"])
    reg = client.get(f"{A}/evaluation-scores", headers=admin, params={"eval_test_id": test_id}).json()
    assert len(reg["rows"]) == 4 and reg["rows"][0]["rank_no"] == 1 and reg["rows"][0]["student_name"] == "Rohan Student"
    csv_r = client.get(f"{A}/evaluation-scores.csv", headers=admin, params={"eval_test_id": test_id})
    assert csv_r.status_code == 200 and csv_r.headers["content-type"].startswith("text/csv")
    lines = list(csv.reader(io.StringIO(csv_r.text)))
    assert lines[1][:4] == ["Rank", "Roll", "Admission No", "Student"] and len(lines) == 6
    assert client.get(f"{A}/evaluation-scores", headers=teacher).status_code == 403
    assert client.post(f"{E}/tests/{test_id}/publish", headers=admin, json={"published": False}).status_code == 403
