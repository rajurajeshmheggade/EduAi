"""AI Classroom's chapter-library PDF reader for students: Class -> Subject -> Chapter PDFs dropped into
backend/nlp/, served to students, with an AI assistant grounded in the page currently open."""
import pymupdf as fitz
import pytest

from app.services import ai_classroom as ai_classroom_svc
from app.services import nlp_catalog

AI = "/ICMELive/api/v1/ai-classroom/nlp"


class FakeTutor:
    name = "fake-tutor"

    def __init__(self, reply):
        self.reply = reply
        self.calls = []

    def chat(self, system, messages, *, json_mode=False, temperature=0.2):
        self.calls.append({"system": system, "messages": messages})
        return self.reply


@pytest.fixture()
def nlp_root(tmp_path, monkeypatch):
    root = tmp_path / "nlp"

    # Class X / Science / photosynthesis -> both a .txt and a .pdf
    ch1 = root / "X" / "Science" / "photosynthesis"
    ch1.mkdir(parents=True)
    (ch1 / "photosynthesis.txt").write_text("Photosynthesis text chapter.", encoding="utf-8")
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Page one: leaves use sunlight.")
    doc.new_page().insert_text((72, 72), "Page two: chlorophyll absorbs light.")
    doc.save(str(ch1 / "photosynthesis.pdf"))
    doc.close()

    # Class X / Science / respiration -> a .pdf only, no .txt
    ch2 = root / "X" / "Science" / "respiration"
    ch2.mkdir(parents=True)
    doc2 = fitz.open()
    doc2.new_page().insert_text((72, 72), "Respiration releases energy.")
    doc2.save(str(ch2 / "respiration.pdf"))
    doc2.close()

    # Class X / Science / genetics -> a .txt only, no .pdf
    ch3 = root / "X" / "Science" / "genetics"
    ch3.mkdir(parents=True)
    (ch3 / "genetics.txt").write_text("Genetics text only.", encoding="utf-8")

    monkeypatch.setattr(nlp_catalog, "ROOT", root)
    nlp_catalog._classroom_tree.cache_clear()
    nlp_catalog._pdf_page_texts.cache_clear()
    yield root
    nlp_catalog._classroom_tree.cache_clear()
    nlp_catalog._pdf_page_texts.cache_clear()


def test_classroom_catalogue_lists_pdf_and_text_chapters(client, student, nlp_root):
    classes = client.get(f"{AI}/classes", headers=student).json()["classes"]
    assert any(c["class_label"] == "X" and c["grade"] == 10 for c in classes)

    subjects = client.get(f"{AI}/subjects", headers=student, params={"class_label": "X"}).json()["subjects"]
    assert subjects == ["Science"]

    chapters = {c["chapter"]: c for c in client.get(f"{AI}/chapters", headers=student,
                params={"class_label": "X", "subject": "Science"}).json()["chapters"]}
    assert chapters["photosynthesis"] == {"chapter": "photosynthesis", "has_text": True, "has_pdf": True}
    assert chapters["respiration"] == {"chapter": "respiration", "has_text": False, "has_pdf": True}
    assert chapters["genetics"] == {"chapter": "genetics", "has_text": True, "has_pdf": False}


def test_chapter_pdf_streams_the_file_only_when_one_exists(client, student, nlp_root):
    r = client.get(f"{AI}/chapter-pdf", headers=student, params={"class_label": "X", "subject": "Science", "chapter": "photosynthesis"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    assert client.get(f"{AI}/chapter-pdf", headers=student,
                      params={"class_label": "X", "subject": "Science", "chapter": "genetics"}).status_code == 404
    assert client.get(f"{AI}/chapter-pdf", headers=student,
                      params={"class_label": "X", "subject": "Science", "chapter": "does-not-exist"}).status_code == 404


def test_ask_and_explain_are_grounded_in_the_current_page(client, student, nlp_root, monkeypatch):
    tutor = FakeTutor("Leaves capture sunlight to make food.")
    monkeypatch.setattr(ai_classroom_svc, "get_tutor_llm", lambda: tutor)

    r = client.post(f"{AI}/ask", headers=student, json={
        "class_label": "X", "subject": "Science", "chapter": "photosynthesis", "page": 1, "question": "What happens on this page?"})
    assert r.status_code == 200 and r.json() == {"answer": "Leaves capture sunlight to make food.", "engine": "fake-tutor"}
    assert "leaves use sunlight" in tutor.calls[0]["system"].lower()

    r2 = client.post(f"{AI}/explain", headers=student, json={
        "class_label": "X", "subject": "Science", "chapter": "photosynthesis", "page": 2})
    assert r2.status_code == 200 and r2.json()["engine"] == "fake-tutor"
    assert "chlorophyll absorbs light" in tutor.calls[1]["system"].lower()

    assert client.post(f"{AI}/ask", headers=student, json={
        "class_label": "X", "subject": "Science", "chapter": "photosynthesis", "page": 99, "question": "x?"}).status_code == 404
    assert client.post(f"{AI}/ask", headers=student, json={
        "class_label": "X", "subject": "Science", "chapter": "genetics", "page": 1, "question": "x?"}).status_code == 404  # no pdf


def test_offline_mode_gives_a_safe_fallback_answer(client, student, nlp_root):
    r = client.post(f"{AI}/ask", headers=student, json={
        "class_label": "X", "subject": "Science", "chapter": "photosynthesis", "page": 1, "question": "What happens on this page?"})
    assert r.status_code == 200 and r.json()["engine"] == "offline"


def test_teacher_cannot_use_the_student_ai_classroom(client, teacher, nlp_root):
    assert client.get(f"{AI}/classes", headers=teacher).status_code == 403
