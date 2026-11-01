"""NLP chapter library (Class III-XII + JEE -> Subject -> Chapter) and AI-generated test questions from it."""
N = "/ICMELive/api/v1/nlp"
A = "/ICMELive/api/v1/admin"
C = "/ICMELive/api/v1/classroom"
E = "/ICMELive/api/v1/evaluation"


def test_classes_subjects_chapters_are_real_folders(client, teacher):
    classes = client.get(f"{N}/classes", headers=teacher).json()["classes"]
    labels = {c["class_label"] for c in classes}
    assert "X" in labels and "III" in labels
    assert next(c["grade"] for c in classes if c["class_label"] == "X") == 10

    subjects = client.get(f"{N}/subjects", headers=teacher, params={"class_label": "X"}).json()["subjects"]
    assert "Mathematics" in subjects

    chapters = client.get(f"{N}/chapters", headers=teacher, params={"class_label": "X", "subject": "Mathematics"}).json()["chapters"]
    assert "polynomials" in chapters

    text = client.get(f"{N}/chapter-text", headers=teacher,
                      params={"class_label": "X", "subject": "Mathematics", "chapter": "polynomials"}).json()["text"]
    assert "polynomial" in text.lower() and len(text) > 500


def test_chapter_text_rejects_unknown_triples(client, teacher):
    assert client.get(f"{N}/chapter-text", headers=teacher,
                      params={"class_label": "X", "subject": "Mathematics", "chapter": "../../etc"}).status_code == 404
    assert client.get(f"{N}/chapter-text", headers=teacher,
                      params={"class_label": "ZZ", "subject": "Nope", "chapter": "nope"}).status_code == 404


def test_student_cannot_browse_the_catalogue(client, student):
    assert client.get(f"{N}/classes", headers=student).status_code == 403


def test_ai_generated_questions_from_a_chapter(client, teacher):
    new_test = client.post(f"{E}/tests", headers=teacher, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "CHAPTER_LEVEL",
        "test_title": "Polynomials quiz", "exam_date": "2026-01-10", "chapter_title": "polynomials"})
    assert new_test.status_code == 201, new_test.text
    test_id = new_test.json()["eval_test_id"]

    r = client.post(f"{E}/tests/{test_id}/masters/generate-ai", headers=teacher, json={
        "class_label": "X", "subject": "Mathematics", "chapter": "polynomials", "count": 5,
        "types": ["MCQ", "SHORT_ANSWER"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["items"]) == 5
    assert {i["question_type"] for i in body["items"]} <= {"MCQ", "SHORT_ANSWER"}
    for i in body["items"]:
        assert i["question_text"].strip()
        if i["question_type"] == "MCQ":
            assert len(i["mcq_options"]) == 4 and i["correct_option"]
        else:
            assert "______" in i["question_text"] and i["model_answer_text"].strip()


def test_generate_ai_rejects_unknown_chapter(client, teacher):
    new_test = client.post(f"{E}/tests", headers=teacher, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "CHAPTER_LEVEL",
        "test_title": "Bad chapter test", "exam_date": "2026-01-11", "chapter_title": "nope"})
    test_id = new_test.json()["eval_test_id"]
    r = client.post(f"{E}/tests/{test_id}/masters/generate-ai", headers=teacher, json={
        "class_label": "X", "subject": "Mathematics", "chapter": "does-not-exist", "count": 3})
    assert r.status_code == 404
