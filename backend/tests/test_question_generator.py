"""AI Question Generator: content repository (topics / learning content, JEE), class → subject mapping, generation of
every question type (mock mode), grounding, de-duplication, marks, papers (CRUD, reorder, duplicate, publish
immutability, versions), question bank, PDF exports, online-test conversion and RBAC."""
import io
import re

import pymupdf as fitz
import pytest
from PIL import Image

from app import db
from app.routers import question_generator as qg_router
from app.services import nlp_catalog
from app.services.qgen import content, generator, mapping, richtext, schema
from app.services.qgen.text import content_words, stem

Q = "/ICMELive/api/v1/qgen"
QA = "/ICMELive/api/v1/qgen/admin"
N = "/ICMELive/api/v1/nlp"
E = "/ICMELive/api/v1/evaluation"
ALL_TYPES = [t["code"] for t in schema.TYPE_CATALOGUE]


def _login(client, email, pw="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module", autouse=True)
def _module_on():
    db.execute("UPDATE public.organizations SET ai_modules = array_append(ai_modules, 'question_generator') "
               "WHERE org_code = 'DEMO-SCHOOL' AND NOT ('question_generator' = ANY(ai_modules))")
    qg_router.limiter.reset()
    yield
    qg_router.limiter.reset()


@pytest.fixture(scope="module")
def kavya(client):
    return _login(client, "kavya@demo.edu")


def _electricity_topic(client, teacher, title_part="Factors"):
    r = client.get(f"{Q}/catalog/topics", headers=teacher,
                   params={"class_code": "Grade-10-A", "subject_code": "PHY101", "chapter": "electricity"})
    assert r.status_code == 200, r.text
    body = r.json()
    return body, next(t for t in body["topics"] if title_part in t["title"])


# ════════════════════════════════════════════════════════════ content repository
def test_cleaning_removes_pdf_layer_duplicates():
    st = content.chapter_structure("X", "General Science", "electricity")
    assert st["clean_chars"] < st["raw_chars"] * 0.5
    text = " ".join(s["text"] for s in st["segments"].values())
    assert "Reprint 2025-26" not in text
    assert "11.1 ELECTRIC CURRENT CIRCUIT 11.1 ELECTRIC CURRENT CIRCUIT" not in text
    assert content.clean_text("Let us read Let us read Madhu loved food.") == "Let us read Madhu loved food."


def test_topics_from_numbered_headings_and_segments():
    st = content.chapter_structure("X", "General Science", "electricity")
    assert st["topic_source"] == "headings"
    titles = [t["title"] for t in st["topics"]]
    assert "Electric Current Circuit" in titles and "Electric Power" in titles and "Ohm’s Law" in titles
    for t in st["topics"]:
        assert t["id"].startswith("t-") and t["segment_ids"]
    for s in st["segments"].values():
        assert s["id"].startswith("s-") and 0 < s["word_count"] <= 700 and s["title"].startswith("Part ")
    # stable ids: the same file gives the same structure
    content._structure.cache_clear()
    again = content.chapter_structure("X", "General Science", "electricity")
    assert [t["id"] for t in again["topics"]] == [t["id"] for t in st["topics"]]


def test_chapters_without_headings_get_labelled_sections():
    st = content.chapter_structure("III", "English", "madhus wish")
    assert st["topic_source"] == "segments"
    assert all(t["title"].startswith("Section ") for t in st["topics"])


def test_jee_chapters_are_visible(client, teacher):
    assert "JEE" in [c["class_label"] for c in client.get(f"{N}/classes", headers=teacher).json()["classes"]]
    chapters = client.get(f"{N}/chapters", headers=teacher, params={"class_label": "JEE", "subject": "Physics"}).json()["chapters"]
    assert "Kinematics" in chapters and "Work Energy and Power" in chapters
    text = client.get(f"{N}/chapter-text", headers=teacher,
                      params={"class_label": "JEE", "subject": "Physics", "chapter": "Kinematics"}).json()["text"]
    assert "velocity" in text.lower()
    st = content.chapter_structure("JEE", "Physics", "Kinematics")
    assert st["topics"] and st["segments"]


def test_duplicate_chapter_file_is_picked_deterministically():
    path = nlp_catalog.chapter_path("III", "English", "madhus wish")
    assert path.name == "madhus wish.txt"


def test_syllabus_topics_are_used_when_the_text_has_no_headings(client, teacher):
    st = content.chapter_structure("X", "Mathematics", "probability")
    assert st["topic_source"] == "segments"
    ch = db.fetch_one("INSERT INTO public.syllabus_chapters(org_code, class_code, subject_code, position, title) "
                      "VALUES ('DEMO-SCHOOL','Grade-10-A','MATH-12',1,'Chapter 14: Probability') RETURNING chapter_id")
    for i, t in enumerate(["Theoretical probability of an event", "Complementary events and sure events"]):
        db.execute("INSERT INTO public.syllabus_topics(chapter_id, position, title) VALUES (%s,%s,%s)", (ch["chapter_id"], i, t))
    try:
        r = client.get(f"{Q}/catalog/topics", headers=teacher,
                       params={"class_code": "Grade-10-A", "subject_code": "MATH-12", "chapter": "probability"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["topic_source"] == "syllabus"
        assert [t["title"] for t in body["topics"]] == ["Theoretical probability of an event",
                                                       "Complementary events and sure events"]
        assert all(t["segment_count"] >= 1 for t in body["topics"])
    finally:
        db.execute("DELETE FROM public.syllabus_chapters WHERE chapter_id = %s", (ch["chapter_id"],))


def test_learning_content_and_preview(client, teacher):
    _, topic = _electricity_topic(client, teacher)
    params = {"class_code": "Grade-10-A", "subject_code": "PHY101", "chapter": "electricity", "topic_id": topic["id"]}
    segs = client.get(f"{Q}/catalog/content", headers=teacher, params=params).json()["segments"]
    assert len(segs) == topic["segment_count"] and segs[0]["preview"]
    prev = client.get(f"{Q}/catalog/preview", headers=teacher, params={**params, "segment_ids": [segs[0]["id"]]}).json()
    assert len(prev["segments"]) == 1 and len(prev["segments"][0]["text"]) > 100
    assert prev["source"] == {"class": "X", "subject": "General Science", "chapter": "electricity",
                              "file": "X/General Science/electricity/electricity.txt"}
    other = client.get(f"{Q}/catalog/topics", headers=teacher, params={k: params[k] for k in ("class_code", "subject_code", "chapter")}).json()
    foreign = next(t for t in other["topics"] if t["id"] != topic["id"])
    foreign_seg = client.get(f"{Q}/catalog/content", headers=teacher, params={**params, "topic_id": foreign["id"]}).json()["segments"][0]
    assert client.get(f"{Q}/catalog/preview", headers=teacher,
                      params={**params, "segment_ids": [foreign_seg["id"]]}).status_code == 404
    assert client.get(f"{Q}/catalog/topics", headers=teacher,
                      params={"class_code": "Grade-10-A", "subject_code": "PHY101", "chapter": "../../etc"}).status_code == 404


# ════════════════════════════════════════════════════════════ class → subject mapping
def test_demo_teacher_classes_map_to_repository_folders(client, teacher):
    classes = client.get(f"{Q}/catalog/classes", headers=teacher).json()["classes"]
    by = {(c["class_code"], s["subject_code"]): s for c in classes for s in c["subjects"]}
    assert by[("Grade-10-A", "PHY101")]["nlp_class"] == "X"
    assert by[("Grade-10-A", "PHY101")]["nlp_subject"] == "General Science"
    assert by[("Grade-10-A", "MATH-12")]["nlp_subject"] == "Mathematics"
    assert by[("Grade-9-B", "PHY101")]["nlp_class"] == "IX" and by[("Grade-9-B", "PHY101")]["nlp_subject"] == "Science"
    assert all(s["mapping"] == "auto" for s in by.values())
    chapters = client.get(f"{Q}/catalog/chapters", headers=teacher,
                          params={"class_code": "Grade-10-A", "subject_code": "MATH-12"}).json()["chapters"]
    assert "polynomials" in chapters


def test_mapping_rules():
    assert mapping.grade_of({"class_name": "Grade 10 — Section A"}) == 10
    assert mapping.grade_of({"class_code": "7-B", "class_name": "Seven B"}) == 7
    assert mapping.grade_of({"class_name": "Class XI Science"}) == 11
    assert mapping.grade_of({"grade_number": 4, "class_name": "Sunflower"}) == 4
    assert mapping.grade_of({"class_name": "Sunflower"}) is None
    assert mapping.auto_subject("XII", "Physics", "PHY") == "Physics"
    assert mapping.auto_subject("X", "Social Studies", "SST") == "Social Science"
    assert mapping.auto_subject("V", "EVS", None) == "Environmental Science"
    assert mapping.auto_subject("X", "Maths", None) == "Mathematics"
    assert mapping.auto_subject("X", "Sanskrit", "SKT") is None


def test_admin_can_correct_a_mapping(client, teacher, admin):
    r = client.get(f"{QA}/mappings", headers=admin)
    assert r.status_code == 200
    assert any(m["class_code"] == "Grade-10-A" and m["subject_code"] == "PHY101" for m in r.json()["mappings"])
    assert client.put(f"{QA}/mappings/Grade-10-A/PHY101", headers=admin,
                      json={"nlp_class": "X", "nlp_subject": "Nope"}).status_code == 422
    assert client.put(f"{QA}/mappings/Grade-10-A/PHY101", headers=teacher,
                      json={"nlp_class": "XII", "nlp_subject": "Physics"}).status_code == 403
    assert client.put(f"{QA}/mappings/Grade-10-A/PHY101", headers=admin,
                      json={"nlp_class": "XII", "nlp_subject": "Physics"}).status_code == 200
    try:
        classes = client.get(f"{Q}/catalog/classes", headers=teacher).json()["classes"]
        s = next(s for c in classes if c["class_code"] == "Grade-10-A" for s in c["subjects"] if s["subject_code"] == "PHY101")
        assert (s["nlp_class"], s["nlp_subject"], s["mapping"]) == ("XII", "Physics", "override")
    finally:
        assert client.delete(f"{QA}/mappings/Grade-10-A/PHY101", headers=admin).status_code == 200
    classes = client.get(f"{Q}/catalog/classes", headers=teacher).json()["classes"]
    s = next(s for c in classes if c["class_code"] == "Grade-10-A" for s in c["subjects"] if s["subject_code"] == "PHY101")
    assert s["mapping"] == "auto" and s["nlp_subject"] == "General Science"


def test_admin_assertion_reason_codes(client, teacher, admin):
    codes = ["Code one text", "Code two text", "Code three text", "Code four text"]
    assert client.put(f"{QA}/settings", headers=admin, json={"ar_instruction": "Pick a code.", "ar_codes": codes[:3]}).status_code == 422
    r = client.put(f"{QA}/settings", headers=admin, json={"ar_instruction": "Pick the right code below.", "ar_codes": codes})
    assert r.status_code == 200 and r.json()["ar_codes"] == codes
    try:
        assert client.get(f"{Q}/meta", headers=teacher).json()["settings"]["ar_codes"] == codes
    finally:
        client.delete(f"{QA}/settings", headers=admin)
    assert client.get(f"{Q}/meta", headers=teacher).json()["settings"]["ar_codes"] == schema.AR_CODES_DEFAULT


# ════════════════════════════════════════════════════════════ schemas
def test_meta_lists_every_type_and_option(client, teacher):
    m = client.get(f"{Q}/meta", headers=teacher).json()
    assert [t["code"] for t in m["types"]] == ALL_TYPES and len(ALL_TYPES) == 17
    assert [d["code"] for d in m["difficulties"]] == ["EASY", "MEDIUM", "HARD"]
    assert len(m["blooms"]) == 6 and {lang["code"] for lang in m["languages"]} == {"en", "hi", "kn", "ta"}


def _opt(i, t, **kw):
    return {"id": f"o{i}", "text": t, **kw}


def test_schema_rejects_invalid_questions():
    bad = [
        {"type": "MCQ", "text": "Q", "marks": 1, "data": {"options": [_opt(1, "a")], "correct": "o1"}},
        {"type": "MCQ", "text": "Q", "marks": 1, "data": {"options": [_opt(1, "a"), _opt(2, "b")], "correct": "o9"}},
        {"type": "MRQ", "text": "Q", "marks": 2, "data": {"options": [_opt(i, f"x{i}", correct=i == 1) for i in range(1, 5)]}},
        {"type": "FILL_BLANK", "text": "No blanks here", "marks": 1, "data": {}},
        {"type": "MATCH", "text": "", "marks": 1, "data": {"pairs": [{"id": "p1", "left": "a", "right": "b"}]}},
        {"type": "HOTS", "text": "Why?", "marks": 4, "bloom": "Remember", "data": {"model_answer": "x"}},
        {"type": "DIAGRAM", "text": "Draw", "marks": 3, "data": {"model_answer": "x"}},
        {"type": "ORDERING", "text": "", "marks": 2, "data": {"items": [{"id": "i1", "text": "a"}, {"id": "i2", "text": "b"}]}},
        {"type": "ASSERTION_REASON", "text": "", "marks": 1, "data": {"assertion": "A", "reason": "R", "answer": "E"}},
        {"type": "SHORT_ANSWER", "text": "x" * 3001, "marks": 2, "data": {"model_answer": "y"}},
        {"type": "MCQ", "text": "Q", "marks": 0, "data": {"options": [_opt(1, "a"), _opt(2, "b")], "correct": "o1"}},
    ]
    for q in bad:
        with pytest.raises(Exception):
            schema.validate_question(q)


def test_schema_normalises_and_sanitises():
    q = schema.validate_question({
        "type": "MCQ", "text": '<p onclick="x()">What is H<sub>2</sub>O?<script>alert(1)</script></p>', "marks": "1",
        "difficulty": "difficult", "bloom": "Knowledge",
        "data": {"options": [_opt(1, "Water"), _opt(2, "<img src=x onerror=alert(1)>Salt")], "correct": "o1"}})
    assert q["text"] == "<p>What is H<sub>2</sub>O?</p>" and q["data"]["options"][1]["text"] == "Salt"
    assert q["difficulty"] == "HARD" and q["bloom"] == "REMEMBER" and q["marks"] == 1.0
    case = schema.validate_question({"type": "CASE_BASED", "text": "Read", "marks": 99, "data": {
        "passage": "A case.", "sub_questions": [
            {"type": "ONE_WORD", "text": "Q1", "marks": 1, "data": {"answer": "x"}},
            {"type": "SHORT_ANSWER", "text": "Q2", "marks": 2.5, "data": {"model_answer": "y"}}]}})
    assert case["marks"] == 3.5
    match = schema.validate_question({"type": "MATCH", "text": "", "marks": 3, "data": {"pairs": [
        {"id": f"p{i}", "left": f"L{i}", "right": f"R{i}"} for i in range(1, 5)]}})
    order = match["data"]["right_order"]
    assert sorted(order) == ["p1", "p2", "p3", "p4"] and all(a != b for a, b in zip(order, ["p1", "p2", "p3", "p4"]))
    assert schema.mrq_score(4, right=2, wrong=1, total_correct=2) == 2.0
    assert schema.mrq_score(4, right=1, wrong=2, total_correct=2) == 0.0
    assert richtext.latex_to_text("x^2 + \\frac{1}{2}") == "x² + 1/2"


# ════════════════════════════════════════════════════════════ generation
def _generate(client, teacher, topic_id, blueprint, **extra):
    r = client.post(f"{Q}/generate", headers=teacher, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "chapter": "electricity", "topic_id": topic_id,
        "language": "en", "blueprint": blueprint, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_generates_every_question_type_offline(client, teacher):
    _, topic = _electricity_topic(client, teacher)
    out = _generate(client, teacher, topic["id"], [{"type": t, "count": 1} for t in ALL_TYPES],
                    instructions="Focus on resistivity.")
    assert out["engine"] == "offline"
    got = {q["type"] for q in out["items"]}
    assert got == set(ALL_TYPES), set(ALL_TYPES) - got
    selected = set(out["source"]["segment_ids"])
    for q in out["items"]:
        assert schema.validate_question(q) == q
        assert q["origin"] == "AI" and set(q["source_refs"]) <= selected and q["source_refs"]
        assert q["difficulty"] == "MEDIUM"


def test_generation_is_grounded_in_the_selected_content_only(client, teacher):
    _, topic = _electricity_topic(client, teacher, "Electric Power")
    segs = client.get(f"{Q}/catalog/content", headers=teacher, params={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "chapter": "electricity", "topic_id": topic["id"]}).json()["segments"]
    chosen = segs[0]["id"]
    st = content.chapter_structure("X", "General Science", "electricity")
    seg_text = st["segments"][chosen]["text"]
    vocab = {stem(w) for w in content_words(seg_text, 3)}
    out = _generate(client, teacher, topic["id"], [{"type": t, "count": 1} for t in
                                                    ("MCQ", "TRUE_FALSE", "FILL_BLANK", "ONE_WORD", "SHORT_ANSWER")],
                    segment_ids=[chosen])
    assert out["items"]
    for q in out["items"]:
        assert q["source_refs"] == [chosen]
        assert generator.grounding_score(q, vocab) >= 0.9, (q["type"], schema.question_plain(q))
        if q["type"] == "MCQ":
            ans = richtext.plain(next(o["text"] for o in q["data"]["options"] if o["id"] == q["data"]["correct"]))
            assert re.search(re.escape(ans), seg_text, re.I)
        if q["type"] == "ONE_WORD":
            assert q["data"]["answer"].lower() in seg_text.lower()


def test_marks_assignment_difficulty_and_bloom(client, teacher):
    _, topic = _electricity_topic(client, teacher)
    out = _generate(client, teacher, topic["id"], [
        {"type": "MCQ", "count": 2, "difficulty": "EASY", "bloom": "REMEMBER"},
        {"type": "TRUE_FALSE", "count": 1, "difficulty": "HARD", "options": {"statements": 3}},
        {"type": "MATCH", "count": 1, "options": {"pairs": 4}},
        {"type": "SHORT_ANSWER", "count": 1, "marks": 3, "bloom": "APPLY"},
        {"type": "HOTS", "count": 1, "bloom": "REMEMBER"},
        {"type": "CASE_BASED", "count": 1, "marks": 6, "options": {"sub_questions": 3}},
    ])
    by = {}
    for q in out["items"]:
        by.setdefault(q["type"], []).append(q)
    assert all(q["marks"] == 1 and q["difficulty"] == "EASY" and q["bloom"] == "REMEMBER" for q in by["MCQ"])
    tf = by["TRUE_FALSE"][0]
    assert len(tf["data"]["statements"]) == 3 and tf["marks"] == 3 and tf["difficulty"] == "HARD"
    assert by["MATCH"][0]["marks"] == len(by["MATCH"][0]["data"]["pairs"])
    assert by["SHORT_ANSWER"][0]["marks"] == 3 and by["SHORT_ANSWER"][0]["bloom"] == "APPLY"
    assert by["HOTS"][0]["bloom"] in ("ANALYZE", "EVALUATE", "CREATE")
    case = by["CASE_BASED"][0]
    assert case["marks"] == 6 and sum(s["marks"] for s in case["data"]["sub_questions"]) == 6
    assert len(case["data"]["sub_questions"]) == 3


def test_blueprint_validation(client, teacher):
    _, topic = _electricity_topic(client, teacher)
    base = {"class_code": "Grade-10-A", "subject_code": "PHY101", "chapter": "electricity", "topic_id": topic["id"]}
    assert client.post(f"{Q}/generate", headers=teacher, json={**base, "blueprint": [
        {"type": "MCQ", "count": 2, "options": {"option_count": 9}}]}).status_code == 422
    assert client.post(f"{Q}/generate", headers=teacher, json={**base, "blueprint": [
        {"type": "NOPE", "count": 2}]}).status_code == 422
    assert client.post(f"{Q}/generate", headers=teacher, json={**base, "blueprint": [
        {"type": "MCQ", "count": 20}, {"type": "ONE_WORD", "count": 20}, {"type": "SHORT_ANSWER", "count": 20}]}).status_code == 422
    assert client.post(f"{Q}/generate", headers=teacher, json={**base, "topic_id": "t-nope", "blueprint": [
        {"type": "MCQ", "count": 1}]}).status_code == 404


def test_ai_path_validates_retries_rejects_ungrounded_and_falls_back(monkeypatch):
    """Simulated provider: first reply invalid JSON (retried), second has one good, one ungrounded, one invalid MCQ."""
    st = content.chapter_structure("X", "General Science", "electricity")
    topic = next(t for t in st["topics"] if "Factors" in t["title"])
    segs = content.selected_segments(st, topic, None)
    good_term = next(w for w in content_words(segs[0]["text"], 5) if w.isalpha())
    calls = []

    class FakeLLM:
        name = "fake-llm"

        def chat(self, system, messages, json_mode=False, temperature=0.2):
            calls.append(system)
            assert "LEARNING CONTENT" in system and "[S1]" in system
            if len(calls) == 1:
                return "not json"
            return '{"questions": [' \
                   f'{{"text": "Which term is about {good_term}?", "options": ["{good_term}", "copper", "nichrome", "resistance"], "correct_index": 0, "explanation": "From the content.", "sources": ["S1"]}},' \
                   '{"text": "Who won the 1998 football world cup in Paris?", "options": ["France", "Brazil", "Italy", "Spain"], "correct_index": 0, "sources": ["S1"]},' \
                   '{"text": "Broken", "options": ["only one"], "correct_index": 3}]}'

    from app.services.qgen import generator as gen

    monkeypatch.setattr(gen, "get_llm", lambda: FakeLLM())
    monkeypatch.setattr(gen, "get_settings", lambda: type("S", (), {"provider_mode": "azure"})())
    res = gen.generate(segs, [gen.Row("MCQ", 3, "MEDIUM", "UNDERSTAND")], existing=[], seed="t",
                       meta={"klass": "Class X", "subject": "Science", "chapter": "electricity", "topic": topic["title"],
                             "language": "en", "instructions": ""})
    assert len(calls) == 2                       # one retry after invalid JSON
    assert res.engine == "fake-llm" and len(res.items) == 3
    assert res.rows[0]["from_ai"] == 1           # the football question is not grounded; the broken one is invalid
    assert any("rejected" in w for w in res.warnings) and any("offline" in w for w in res.warnings)
    assert not any("football" in schema.question_plain(q) for q in res.items)


def test_generation_dedupes_against_the_paper(client, teacher):
    _, topic = _electricity_topic(client, teacher)
    p = client.post(f"{Q}/papers", headers=teacher, json={"class_code": "Grade-10-A", "subject_code": "PHY101",
                                                           "chapter": "electricity", "title": "Dedupe paper"}).json()
    first = _generate(client, teacher, topic["id"], [{"type": "ONE_WORD", "count": 3}], paper_id=p["paper_id"])
    r = client.post(f"{Q}/papers/{p['paper_id']}/items", headers=teacher, json={"items": [{"question": q} for q in first["items"]]})
    assert r.status_code == 200 and r.json()["added"] == 3
    second = _generate(client, teacher, topic["id"], [{"type": "ONE_WORD", "count": 3}], paper_id=p["paper_id"])
    old = {schema.stem_plain(q) for q in first["items"]}
    assert not old & {schema.stem_plain(q) for q in second["items"]}
    again = client.post(f"{Q}/papers/{p['paper_id']}/items", headers=teacher, json={"items": [{"question": q} for q in first["items"]]})
    assert again.json()["added"] == 0 and again.json()["skipped_duplicates"] == 3
    client.delete(f"{Q}/papers/{p['paper_id']}", headers=teacher)


def test_generation_rate_limit(client, teacher):
    _, topic = _electricity_topic(client, teacher)
    qg_router.limiter.reset()
    try:
        for _ in range(qg_router.GENERATE_LIMIT):
            assert client.post(f"{Q}/generate", headers=teacher, json={
                "class_code": "Grade-10-A", "subject_code": "PHY101", "chapter": "electricity", "topic_id": topic["id"],
                "blueprint": [{"type": "MCQ", "count": 1}]}).status_code == 200
        r = client.post(f"{Q}/generate", headers=teacher, json={
            "class_code": "Grade-10-A", "subject_code": "PHY101", "chapter": "electricity", "topic_id": topic["id"],
            "blueprint": [{"type": "MCQ", "count": 1}]})
        assert r.status_code == 429
    finally:
        qg_router.limiter.reset()


# ════════════════════════════════════════════════════════════ papers
@pytest.fixture(scope="module")
def mixed_paper(client, teacher):
    _, topic = _electricity_topic(client, teacher)
    gen = _generate(client, teacher, topic["id"], [
        {"type": "MCQ", "count": 2}, {"type": "ASSERTION_REASON", "count": 2}, {"type": "TRUE_FALSE", "count": 1},
        {"type": "NUMERICAL", "count": 1}, {"type": "MATCH", "count": 1}, {"type": "LONG_ANSWER", "count": 1},
        {"type": "PASSAGE", "count": 1}, {"type": "ORDERING", "count": 1}, {"type": "DIAGRAM", "count": 1}])
    p = client.post(f"{Q}/papers", headers=teacher, json={"class_code": "Grade-10-A", "subject_code": "PHY101",
                                                           "chapter": "electricity", "title": "Unit Test — Electricity"})
    assert p.status_code == 201, p.text
    paper = p.json()
    assert paper["status"] == "DRAFT" and paper["version"] == 1 and paper["header"]["exam_title"] == "Unit Test — Electricity"
    sections = [{"id": "A", "title": "Section A — Objective", "instructions": "1 mark each."},
                {"id": "B", "title": "Section B — Subjective", "instructions": ""}]
    objective = ("MCQ", "ASSERTION_REASON", "TRUE_FALSE", "NUMERICAL", "MATCH", "ORDERING")
    items = [{"section_id": "A" if q["type"] in objective else "B", "question": q} for q in gen["items"]]
    manual = {"type": "SHORT_ANSWER", "text": "State Ohm’s law. Write it as <span class=\"math\" data-latex=\"V = IR\">V = IR</span>.",
              "marks": 2, "difficulty": "EASY", "bloom": "REMEMBER", "data": {"model_answer": "Current is proportional to potential difference.",
                                                                              "key_points": ["V ∝ I", "R constant"]}}
    items.append({"section_id": "B", "question": manual})
    header = {**paper["header"], "institution_name": "Demo International School", "duration_minutes": 90,
              "general_instructions": ["All questions are compulsory.", "Use of calculators is not allowed."]}
    r = client.put(f"{Q}/papers/{paper['paper_id']}", headers=teacher, json={
        "revision": paper["revision"], "title": paper["title"], "language": "en", "chapter": "electricity",
        "header": header, "sections": sections, "items": items})
    assert r.status_code == 200, r.text
    return r.json()


def test_mixed_type_paper_saves_with_totals(mixed_paper):
    types = {i["question"]["type"] for i in mixed_paper["items"]}
    assert {"MCQ", "ASSERTION_REASON", "PASSAGE", "SHORT_ANSWER", "LONG_ANSWER"} <= types
    assert mixed_paper["total_marks"] == round(sum(i["question"]["marks"] for i in mixed_paper["items"]), 2)
    assert mixed_paper["question_count"] == len(mixed_paper["items"])
    assert {i["section_id"] for i in mixed_paper["items"]} == {"A", "B"}


def test_stale_revision_conflict(client, teacher, mixed_paper):
    p = client.get(f"{Q}/papers/{mixed_paper['paper_id']}", headers=teacher).json()
    body = {"revision": p["revision"] - 1, "title": p["title"], "language": "en", "chapter": "electricity",
            "header": p["header"], "sections": p["sections"], "items": [{"item_id": i["item_id"], "section_id": i["section_id"],
                                                                        "question": i["question"]} for i in p["items"]]}
    assert client.put(f"{Q}/papers/{p['paper_id']}", headers=teacher, json=body).status_code == 409


def test_edit_duplicate_reorder_delete(client, teacher, mixed_paper):
    pid = mixed_paper["paper_id"]
    p = client.get(f"{Q}/papers/{pid}", headers=teacher).json()
    first = p["items"][0]
    edited = {**first["question"], "text": "Edited question text?", "marks": 2}
    r = client.put(f"{Q}/papers/{pid}/items/{first['item_id']}", headers=teacher, json={"question": edited})
    assert r.status_code == 200 and r.json()["items"][0]["question"]["text"] == "Edited question text?"
    bad = {**first["question"], "marks": -1}
    assert client.put(f"{Q}/papers/{pid}/items/{first['item_id']}", headers=teacher, json={"question": bad}).status_code == 422

    r = client.post(f"{Q}/papers/{pid}/items/{first['item_id']}/duplicate", headers=teacher)
    items = r.json()["items"]
    assert len(items) == len(p["items"]) + 1
    assert items[1]["question"]["text"] == "Edited question text?" and items[1]["question"]["id"] != items[0]["question"]["id"]
    assert items[1]["question"]["origin"] == "MANUAL"

    order = [i["item_id"] for i in items][::-1]
    r = client.post(f"{Q}/papers/{pid}/reorder", headers=teacher, json={"order": order, "sections": {order[0]: "A"}})
    assert r.status_code == 200 and [i["item_id"] for i in r.json()["items"]] == order
    assert r.json()["items"][0]["section_id"] == "A"
    assert client.post(f"{Q}/papers/{pid}/reorder", headers=teacher, json={"order": order[:-1]}).status_code == 422

    r = client.delete(f"{Q}/papers/{pid}/items/{items[1]['item_id']}", headers=teacher)
    assert r.status_code == 200 and len(r.json()["items"]) == len(p["items"])
    assert client.delete(f"{Q}/papers/{pid}/items/{items[1]['item_id']}", headers=teacher).status_code == 404


def test_media_upload_and_diagram_question(client, teacher, mixed_paper):
    buf = io.BytesIO()
    Image.new("RGB", (160, 90), (30, 90, 200)).save(buf, "PNG")
    r = client.post(f"{Q}/media", headers=teacher, files={"file": ("circuit.png", buf.getvalue(), "image/png")})
    assert r.status_code == 201, r.text
    media = r.json()
    assert media["width"] == 160 and media["url"]
    assert client.post(f"{Q}/media", headers=teacher, files={"file": ("x.png", b"<svg onload=alert(1)>", "image/png")}).status_code == 415
    q = {"type": "DIAGRAM", "text": "Identify the component marked X in the circuit.", "marks": 2,
         "media": [{"media_id": media["media_id"], "caption": "Figure 1"}],
         "data": {"model_answer": "A resistor.", "key_points": ["resistor"]}}
    r = client.post(f"{Q}/papers/{mixed_paper['paper_id']}/items", headers=teacher, json={"items": [{"section_id": "B", "question": q}]})
    assert r.status_code == 200 and r.json()["added"] == 1
    assert media["media_id"] in r.json()["media"]
    foreign = {**q, "media": [{"media_id": "00000000-0000-0000-0000-000000000001", "caption": ""}], "text": "Other?"}
    assert client.post(f"{Q}/papers/{mixed_paper['paper_id']}/items", headers=teacher,
                       json={"items": [{"question": foreign}]}).status_code == 422
    header = {**r.json()["header"], "logo_media_id": media["media_id"]}
    p = r.json()
    r = client.put(f"{Q}/papers/{p['paper_id']}", headers=teacher, json={
        "revision": p["revision"], "title": p["title"], "language": "en", "chapter": "electricity", "header": header,
        "sections": p["sections"], "items": [{"item_id": i["item_id"], "section_id": i["section_id"], "question": i["question"]} for i in p["items"]]})
    assert r.status_code == 200, r.text


def _pdf(client, teacher, pid, **params):
    r = client.get(f"{Q}/papers/{pid}/export.pdf", headers=teacher, params=params)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    return fitz.open(stream=r.content, filetype="pdf"), r


def test_pdf_exports_paper_and_answer_key(client, teacher, mixed_paper):
    pid = mixed_paper["paper_id"]
    doc, r = _pdf(client, teacher, pid)
    assert "attachment" in r.headers["content-disposition"]
    text = "".join(page.get_text() for page in doc)
    assert "Demo International School" in text and "Unit Test" in text and "Maximum Marks" in text
    assert f"Page 1 of {doc.page_count}" in text and "Section A" in text and "General Instructions" in text
    assert "Assertion (A)" in text and "1 hour 30 minutes" in text
    assert any(page.get_images() for page in doc)          # the diagram and the logo are embedded
    assert doc[0].rect.width == pytest.approx(595, abs=1)  # A4
    key, r = _pdf(client, teacher, pid, answer_key="true")
    ktext = "".join(page.get_text() for page in key)
    assert "ANSWER KEY" in ktext and "Answer" in ktext and "Answer Key" in r.headers["content-disposition"]


def test_pdf_in_indic_languages(client, teacher):
    p = client.post(f"{Q}/papers", headers=teacher, json={"class_code": "Grade-10-A", "subject_code": "PHY101",
                                                           "title": "Hindi paper", "language": "hi"}).json()
    q = {"type": "SHORT_ANSWER", "text": "विद्युत धारा की परिभाषा लिखिए।", "marks": 2,
         "data": {"model_answer": "आवेश के प्रवाह की दर को विद्युत धारा कहते हैं।"}}
    q2 = {"type": "ONE_WORD", "text": "ವಿದ್ಯುತ್ ಪ್ರವಾಹದ ಘಟಕ ಯಾವುದು?", "marks": 1, "data": {"answer": "ಆಂಪಿಯರ್"}}
    q3 = {"type": "ONE_WORD", "text": "மின்னோட்டத்தின் அலகு என்ன?", "marks": 1, "data": {"answer": "ஆம்பியர்"}}
    r = client.post(f"{Q}/papers/{p['paper_id']}/items", headers=teacher, json={"items": [{"question": x} for x in (q, q2, q3)]})
    assert r.status_code == 200
    for key in ("false", "true"):
        doc, _ = _pdf(client, teacher, p["paper_id"], answer_key=key)
        fonts = {f[3] for page in doc for f in page.get_fonts()}
        assert any("Devanagari" in f for f in fonts) and any("Kannada" in f for f in fonts) and any("Tamil" in f for f in fonts)
    client.delete(f"{Q}/papers/{p['paper_id']}", headers=teacher)


def test_publish_makes_the_paper_immutable_and_versions(client, teacher, mixed_paper):
    pid = mixed_paper["paper_id"]
    r = client.post(f"{Q}/papers/{pid}/publish", headers=teacher)
    assert r.status_code == 200, r.text
    pub = r.json()
    assert pub["status"] == "PUBLISHED" and pub["published_at"]
    assert client.post(f"{Q}/papers/{pid}/publish", headers=teacher).status_code == 409
    body = {"revision": pub["revision"], "title": "Changed", "language": "en", "chapter": "electricity",
            "header": pub["header"], "sections": pub["sections"],
            "items": [{"item_id": i["item_id"], "section_id": i["section_id"], "question": i["question"]} for i in pub["items"]]}
    assert client.put(f"{Q}/papers/{pid}", headers=teacher, json=body).status_code == 409
    first = pub["items"][0]
    assert client.post(f"{Q}/papers/{pid}/items/{first['item_id']}/duplicate", headers=teacher).status_code == 409
    assert client.delete(f"{Q}/papers/{pid}/items/{first['item_id']}", headers=teacher).status_code == 409
    assert client.post(f"{Q}/papers/{pid}/reorder", headers=teacher,
                       json={"order": [i["item_id"] for i in pub["items"]][::-1]}).status_code == 409
    with pytest.raises(Exception, match="QGEN_PUBLISHED"):   # the database refuses too
        db.execute("DELETE FROM public.qgen_paper_items WHERE paper_id = %s", (pid,))
    doc, _ = _pdf(client, teacher, pid)
    assert "DRAFT" not in "".join(p.get_text() for p in doc)

    r = client.post(f"{Q}/papers/{pid}/new-version", headers=teacher)
    assert r.status_code == 201
    v2 = r.json()
    assert v2["version"] == 2 and v2["status"] == "DRAFT" and v2["family_id"] == pub["family_id"]
    assert len(v2["items"]) == len(pub["items"]) and v2["parent_paper_id"] == pid
    assert client.get(f"{Q}/papers/{pid}", headers=teacher).json()["status"] == "PUBLISHED"
    assert client.post(f"{Q}/papers/{v2['paper_id']}/new-version", headers=teacher).status_code == 409


def test_published_paper_becomes_an_online_test(client, teacher, mixed_paper):
    pid = mixed_paper["paper_id"]
    r = client.post(f"{Q}/papers/{pid}/assessment", headers=teacher, json={"assessment_type": "ONLINE_TEST"})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["auto_graded_exactly"] >= 4        # 2 MCQ + 2 assertion–reason (+ one-statement true/false)
    t = client.get(f"{E}/tests/{out['eval_test_id']}", headers=teacher).json()
    assert t["assessment_type"] == "ONLINE_TEST" and t["status"] == "READY" and t["duration_minutes"] == 90
    masters = t["masters"]
    assert len(masters) == out["items"] and float(t["total_max_marks"]) == out["total_marks"]
    mcq = [m for m in masters if m["question_type"] == "MCQ"]
    assert all(m["correct_option"] in "abcd" and len(m["mcq_options"]) >= 2 for m in mcq)
    assert any(re.fullmatch(r"\d+[a-z]", m["sl_no"]) for m in masters)   # passage sub-questions 7a, 7b …
    assert client.get(f"{Q}/papers/{pid}", headers=teacher).json()["eval_test_id"] == out["eval_test_id"]
    draft = client.post(f"{Q}/papers", headers=teacher, json={"class_code": "Grade-10-A", "subject_code": "PHY101", "title": "Draft only"}).json()
    assert client.post(f"{Q}/papers/{draft['paper_id']}/assessment", headers=teacher,
                       json={"assessment_type": "ASSIGNMENT"}).status_code == 409
    client.delete(f"{Q}/papers/{draft['paper_id']}", headers=teacher)


# ════════════════════════════════════════════════════════════ question bank
def test_question_bank_save_dedupe_search_and_reuse(client, teacher, kavya, mixed_paper):
    pid = mixed_paper["paper_id"]
    r = client.post(f"{Q}/papers/{pid}/bank", headers=teacher, json={"visibility": "PRIVATE"})
    assert r.status_code == 200, r.text
    saved = r.json()
    assert len(saved["saved"]) >= 5 and not saved["duplicates"]
    again = client.post(f"{Q}/papers/{pid}/bank", headers=teacher, json={}).json()
    assert not again["saved"] and len(again["duplicates"]) == len(saved["saved"])
    # a near-identical rewording is caught by the embedding check
    q = {"type": "SHORT_ANSWER", "text": "State Ohm’s law. Write it as V = IR!", "marks": 2,
         "data": {"model_answer": "Current is proportional to potential difference."}}
    near = client.post(f"{Q}/bank", headers=teacher, json={"class_code": "Grade-10-A", "subject_code": "PHY101", "questions": [q]}).json()
    assert near["duplicates"] and not near["saved"]

    found = client.get(f"{Q}/bank", headers=teacher, params={"q": "Ohm", "scope": "mine"}).json()
    assert found["total"] >= 1 and all(i["mine"] for i in found["items"])
    mcqs = client.get(f"{Q}/bank", headers=teacher, params={"qtype": "MCQ", "nlp_subject": "General Science"}).json()
    assert mcqs["items"] and all(i["qtype"] == "MCQ" for i in mcqs["items"])
    # private questions are invisible to another teacher; ORG-shared ones are visible
    assert client.get(f"{Q}/bank", headers=kavya, params={"q": "Ohm"}).json()["total"] == 0
    shared = {"type": "ONE_WORD", "text": "Name the SI unit of electric charge.", "marks": 1, "data": {"answer": "coulomb"}}
    r = client.post(f"{Q}/bank", headers=teacher, json={"class_code": "Grade-10-A", "subject_code": "PHY101",
                                                         "visibility": "ORG", "questions": [shared]})
    bank_id = r.json()["saved"][0]
    seen = client.get(f"{Q}/bank", headers=kavya, params={"q": "coulomb"}).json()
    assert seen["total"] == 1 and not seen["items"][0]["mine"]
    assert client.delete(f"{Q}/bank/{bank_id}", headers=kavya).status_code == 403

    new = client.post(f"{Q}/papers", headers=teacher, json={"class_code": "Grade-10-A", "subject_code": "PHY101", "title": "From bank"}).json()
    r = client.post(f"{Q}/papers/{new['paper_id']}/items/from-bank", headers=teacher, json={"bank_ids": [bank_id, saved["saved"][0]]})
    assert r.status_code == 200 and r.json()["added"] == 2
    assert all(i["question"]["origin"] == "BANK" and i["question"]["bank_id"] for i in r.json()["items"])
    used = client.get(f"{Q}/bank", headers=teacher, params={"q": "coulomb"}).json()["items"][0]
    assert used["usage_count"] == 1
    assert client.delete(f"{Q}/bank/{bank_id}", headers=teacher).status_code == 200
    client.delete(f"{Q}/papers/{new['paper_id']}", headers=teacher)


# ════════════════════════════════════════════════════════════ RBAC
def test_rbac(client, teacher, student, admin, kavya, mixed_paper):
    pid = mixed_paper["paper_id"]
    for url in (f"{Q}/meta", f"{Q}/papers", f"{Q}/catalog/classes", f"{Q}/bank", f"{Q}/papers/{pid}"):
        assert client.get(url, headers=student).status_code == 403
        assert client.get(url, headers=admin).status_code == 403          # the generator is a teacher tool
    assert client.get(f"{QA}/mappings", headers=student).status_code == 403
    # another teacher can neither see nor change Priya's paper
    assert client.get(f"{Q}/papers/{pid}", headers=kavya).status_code == 404
    assert client.get(f"{Q}/papers/{pid}/export.pdf", headers=kavya).status_code == 404
    assert client.post(f"{Q}/papers/{pid}/publish", headers=kavya).status_code == 404
    assert pid not in [p["paper_id"] for p in client.get(f"{Q}/papers", headers=kavya).json()["papers"]]
    # … nor generate / create papers for a class subject she does not teach
    _, topic = _electricity_topic(client, teacher)
    assert client.post(f"{Q}/generate", headers=kavya, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "chapter": "electricity", "topic_id": topic["id"],
        "blueprint": [{"type": "MCQ", "count": 1}]}).status_code == 403
    assert client.post(f"{Q}/papers", headers=kavya, json={"class_code": "Grade-10-A", "subject_code": "PHY101",
                                                           "title": "Not mine"}).status_code == 403
    assert client.get(f"{Q}/catalog/chapters", headers=kavya, params={"class_code": "Grade-10-A", "subject_code": "MATH-12"}).status_code == 403
    # Kavya's own English class maps to IX/English
    k = client.get(f"{Q}/catalog/classes", headers=kavya).json()["classes"]
    eng = next(s for c in k for s in c["subjects"] if s["subject_code"] == "ENG-9")
    assert (eng["nlp_class"], eng["nlp_subject"]) == ("IX", "English")


def test_module_switch(client, teacher):
    sa = _login(client, "superadmin", "superadmin")
    org = db.fetch_one("SELECT ai_modules FROM public.organizations WHERE org_code = 'DEMO-SCHOOL'")["ai_modules"]
    db.execute("UPDATE public.organizations SET ai_modules = %s WHERE org_code = 'DEMO-SCHOOL'",
               ([m for m in org if m != "question_generator"],))
    try:
        assert client.get(f"{Q}/meta", headers=teacher).status_code == 403
        assert client.get(f"{Q}/papers", headers=teacher).status_code == 403
    finally:
        db.execute("UPDATE public.organizations SET ai_modules = %s WHERE org_code = 'DEMO-SCHOOL'", (org,))
    assert client.get(f"{Q}/meta", headers=teacher).status_code == 200
    me = client.get("/api/v1/auth/me", headers=teacher).json()
    assert "question_generator" in me["ai_modules"]
    assert sa


def test_evaluation_generate_ai_is_gated_by_its_module(client, teacher):
    t = client.post(f"{E}/tests", headers=teacher, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "CHAPTER_LEVEL",
        "test_title": "Gate check", "exam_date": "2026-01-12", "chapter_title": "polynomials"}).json()
    org = db.fetch_one("SELECT ai_modules FROM public.organizations WHERE org_code = 'DEMO-SCHOOL'")["ai_modules"]
    db.execute("UPDATE public.organizations SET ai_modules = %s WHERE org_code = 'DEMO-SCHOOL'",
               ([m for m in org if m != "ocr_evaluation"],))
    try:
        r = client.post(f"{E}/tests/{t['eval_test_id']}/masters/generate-ai", headers=teacher, json={
            "class_label": "X", "subject": "Mathematics", "chapter": "polynomials", "count": 2})
        assert r.status_code == 403
    finally:
        db.execute("UPDATE public.organizations SET ai_modules = %s WHERE org_code = 'DEMO-SCHOOL'", (org,))


def test_delete_paper(client, teacher, kavya):
    p = client.post(f"{Q}/papers", headers=teacher, json={"class_code": "Grade-10-A", "subject_code": "PHY101", "title": "Temp"}).json()
    assert client.delete(f"{Q}/papers/{p['paper_id']}", headers=kavya).status_code == 404
    assert client.delete(f"{Q}/papers/{p['paper_id']}", headers=teacher).status_code == 200
    assert client.get(f"{Q}/papers/{p['paper_id']}", headers=teacher).status_code == 404
