"""AI avatar tutor explains / reads the textbook aloud: page cleaning, AI lesson, pronunciation, teacher voice,
publish gating, audio cache."""
import json
import time

import pytest

from app import db
from app.providers.speech import SpeechUnavailable
from app.services import page_lesson, read_aloud
from scripts.sample_pdf import build_sample_textbook

BASE = "/ICMELive/api/v1"
RA = f"{BASE}/read-aloud/textbooks"


def _login(client, email):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _indexed(client, headers, job_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        job = client.get(f"{BASE}/curriculum/jobs/{job_id}", headers=headers).json()
        if job["status"] in ("completed", "failed"):
            return job["status"] == "completed"
        time.sleep(0.3)
    return False


# ---------------------------------------------------------------- page text -> listening segments (pure)
def _line(text, y, size=11.0, bold=False, x=60, rotated=False):
    return {"bbox": (x, y, x + 400, y + size), "dir": (0.0, -1.0) if rotated else (1.0, 0.0),
            "spans": [{"text": text, "size": size, "flags": 16 if bold else 0}]}


def test_page_cleaning_drops_headers_footers_and_keeps_headings():
    page = {"width": 576, "height": 800, "blocks": [
        {"type": 0, "lines": [_line("India and the Contemporary World", 300, size=10, x=8, rotated=True)]},  # side header
        {"type": 0, "lines": [_line("2.1 The Aristocracy and the New Middle Class", 80, size=13, bold=True)]},
        {"type": 0, "lines": [
            _line("Socially and politically, a landed aristocracy was the dominant class on the conti-", 110),
            _line("nent. Fig. 3 shows its estates, e.g. in Prussia. The majority were peasants.", 124),
        ]},
        {"type": 1, "bbox": (0, 0, 576, 800)},                                                   # image block
        {"type": 0, "lines": [_line("8", 760, size=8)]},                                          # page number
        {"type": 0, "lines": [_line("Reprint 2025-26", 770, size=8, x=260)]},                     # footer
    ]}
    paras = read_aloud.paragraphs(page)
    assert paras == [
        "2.1 The Aristocracy and the New Middle Class.",
        "Socially and politically, a landed aristocracy was the dominant class on the continent. "
        "Fig. 3 shows its estates, e.g. in Prussia. The majority were peasants.",
    ]
    assert read_aloud.sentences(paras) == [
        "2.1 The Aristocracy and the New Middle Class.",
        "Socially and politically, a landed aristocracy was the dominant class on the continent.",
        "Fig. 3 shows its estates, e.g. in Prussia.",          # abbreviations do not end a sentence
        "The majority were peasants.",
    ]


def test_segments_group_sentences_and_split_overlong_ones():
    sents = [f"Sentence number {i} is about forty characters." for i in range(10)]
    segs = read_aloud.segment(sents, limit=100)
    assert all(len(s) <= 100 for s in segs) and " ".join(segs) == " ".join(sents)
    long = "word, " * 200
    assert all(len(s) <= 200 for s in read_aloud.segment([long], limit=100))
    quick = read_aloud.segment(sents, limit=100, first=30)               # first part = one sentence: speech starts sooner
    assert quick[0] == sents[0] and " ".join(quick) == " ".join(sents)


def test_text_is_made_speakable():
    assert read_aloud.speakable("In 1789, Fig. 3 shows 20% of 1500 kg (e.g. in 1814-1815).") == (
        "In seventeen eighty-nine, Figure 3 shows 20 per cent of 1500 kilograms "
        "(for example in eighteen fourteen to eighteen fifteen).")
    assert [read_aloud.say_year(y) for y in (1800, 1905, 2008, 2024)] == [
        "eighteen hundred", "nineteen oh five", "two thousand and eight", "twenty twenty-four"]
    assert read_aloud.speakable("about 1,500 people") == "about 1,500 people"


def test_ai_lesson_is_cleaned_and_scripted_like_a_teacher():
    lesson = page_lesson.clean_lesson({
        "title": "Nationalism", "intro": "Today we see how nations formed.",
        "key_points": [{"heading": "No nation-states", "explanation": "Europe was split into kingdoms.", "quote": "there were no nation-states"},
                       {"heading": "", "explanation": ""},                                     # dropped: empty
                       {"heading": "Many languages", "explanation": "People spoke many languages.", "quote": "spoke different languages"}],
        "terms": [{"term": "Nation-state", "meaning": "A state where most people share an identity."}],
        "recap": "Europe was divided.", "question": "What is a nation-state?"})
    assert len(lesson["key_points"]) == 2
    parts = page_lesson.script(lesson)
    assert [p["text"].split(",")[0].split(".")[0] for p in parts] == [
        "Today we see how nations formed", "First", "Second", "Let us remember some important words", "To sum up",
        "Here is a question for you"]
    assert parts[1]["quote"] == "there were no nation-states" and parts[1]["point"] == 0


# ---------------------------------------------------------------- API
class FakeSpeech:
    label, engine = "fake-v1", "Fake voice"

    def __init__(self):
        self.calls = []

    def synthesize(self, text, voice):
        self.calls.append((text, voice))
        return b"ID3" + voice.encode() + text.encode()[:20], "audio/mpeg"


@pytest.fixture
def speech(monkeypatch):
    fake = FakeSpeech()
    monkeypatch.setattr("app.services.read_aloud.get_speech", lambda: fake)
    monkeypatch.setattr("app.routers.read_aloud.get_speech", lambda: fake)
    return fake


@pytest.fixture(scope="module")
def book(client, teacher):
    r = client.post(f"{BASE}/curriculum/upload-textbook", headers=teacher,
                    data={"title": "Read-aloud Physics", "subject_code": "PHY101", "class_code": "Grade-10-A"},
                    files={"file": ("book.pdf", build_sample_textbook("Read-aloud Physics"), "application/pdf")})
    assert r.status_code == 202, r.text
    assert _indexed(client, teacher, r.json()["job_id"])
    yield r.json()["textbook_id"]
    db.execute("UPDATE public.app_users SET gender = NULL WHERE org_code = 'DEMO-SCHOOL'")


def test_student_cannot_read_an_unpublished_book(client, teacher, student, book, speech):
    assert client.get(f"{RA}/{book}/pages/2", headers=student).status_code == 404
    assert client.get(f"{RA}/{book}/pages/2", headers=teacher).status_code == 200   # teacher preview
    assert client.post(f"{BASE}/curriculum/textbooks/{book}/publish", headers=teacher,
                       json={"published": True}).status_code == 200


def test_read_mode_reads_the_page_word_for_word(client, student, book, speech):
    r = client.get(f"{RA}/{book}/pages/2?mode=read", headers=student)
    assert r.status_code == 200, r.text
    body = r.json()
    texts = [s["text"] for s in body["segments"]]
    assert body["total_pages"] >= 4 and body["lesson"] is None and texts[0] == "Chapter 1: Motion."
    assert any("1.1 Speed and Velocity." in t for t in texts)
    assert client.get(f"{RA}/{book}/pages/999", headers=student).status_code == 404


def test_explain_mode_offline_lesson(client, student, book, speech):
    body = client.get(f"{RA}/{book}/pages/2", headers=student).json()       # explain is the default
    assert body["mode"] == "explain" and body["engine"] == "offline"
    assert body["segments"][0]["text"].startswith("Let us understand page 2")
    assert body["lesson"]["key_points"] and all(k["quote"] for k in body["lesson"]["key_points"])


class FakeTutor:
    name = "azure-gpt-4o"

    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def chat(self, system, messages, *, json_mode=False, temperature=0.2):
        self.calls.append((system, messages[-1]["content"], json_mode))
        return self.reply


def test_explain_mode_uses_the_ai_teacher_once_per_page(client, student, book, speech, monkeypatch):
    reply = json.dumps({"title": "Acceleration", "intro": "This page explains acceleration.",
                        "key_points": [{"heading": "Rate of change", "explanation": "Acceleration tells how fast velocity changes.",
                                        "quote": "Acceleration is the rate of change of velocity"}],
                        "terms": [], "recap": "Velocity can change.", "question": "What is retardation?"})
    tutor = FakeTutor(reply)
    monkeypatch.setattr(page_lesson, "get_tutor_llm", lambda: tutor)
    a = client.get(f"{RA}/{book}/pages/3", headers=student).json()
    b = client.get(f"{RA}/{book}/pages/3", headers=student).json()
    assert len(tutor.calls) == 1 and a == b                                   # cached: the AI is asked once per page
    system, user, json_mode = tutor.calls[0]
    assert json_mode and "Class 10" in system and "PAGE TEXT:" in user and "student" not in user.lower()
    assert a["engine"] == "azure-gpt-4o" and a["lesson"]["key_points"][0]["quote"].startswith("Acceleration is")
    assert [s["point"] for s in a["segments"]][:2] == [None, 0]


def test_explain_mode_falls_back_when_the_ai_fails(client, student, book, speech, monkeypatch):
    tutor = FakeTutor("not json")
    monkeypatch.setattr(page_lesson, "get_tutor_llm", lambda: tutor)
    body = client.get(f"{RA}/{book}/pages/4", headers=student).json()
    assert body["engine"] == "offline-fallback" and body["fallback"] and body["segments"]
    assert client.get(f"{RA}/{book}/pages/4", headers=student).json()["version"] == body["version"]
    assert len(tutor.calls) == 2              # one retry, then the fallback is cached (stable parts; AI asked again later)


def test_voice_follows_the_subject_teacher(client, admin, student, book, speech):
    v = client.get(f"{RA}/{book}/voice", headers=student).json()
    assert v == {"teacher": {"name": "Priya Teacher", "gender": None}, "voice": "female", "engine": "Fake voice"}

    r = client.patch(f"{BASE}/admin/teachers/EMP1001", headers=admin, json={"gender": "male"})
    assert r.status_code == 200 and r.json()["gender"] == "male"
    assert client.get(f"{RA}/{book}/voice", headers=student).json()["voice"] == "male"

    client.patch(f"{BASE}/admin/teachers/EMP1001", headers=admin, json={"gender": "undisclosed"})
    assert client.get(f"{RA}/{book}/voice", headers=student).json()["voice"] == "female"   # not male -> female
    assert client.patch(f"{BASE}/admin/teachers/EMP1001", headers=admin, json={"gender": "robot"}).status_code == 422


def test_voice_falls_back_to_the_class_teacher(client, admin, book, speech):
    kabir = _login(client, "kabir@demo.edu")                    # Grade-9-B: Physics by EMP1001, class teacher EMP1002
    db.execute("UPDATE public.class_subjects SET teacher_code = NULL WHERE class_code = 'Grade-9-B' AND subject_code = 'PHY101'")
    try:
        client.patch(f"{BASE}/admin/teachers/EMP1002", headers=admin, json={"gender": "male"})
        assert client.get(f"{RA}/{book}/voice", headers=kabir).json()["teacher"] == {"name": "Kavya Teacher", "gender": "male"}
    finally:
        db.execute("UPDATE public.class_subjects SET teacher_code = 'EMP1001' WHERE class_code = 'Grade-9-B' AND subject_code = 'PHY101'")


def test_audio_is_voiced_once_and_cached(client, admin, student, book, speech):
    client.patch(f"{BASE}/admin/teachers/EMP1001", headers=admin, json={"gender": "male"})
    url = f"{RA}/{book}/pages/2/segments/0/audio?mode=read"
    a = client.get(url, headers=student)
    b = client.get(url, headers=student)
    assert a.status_code == b.status_code == 200
    assert a.headers["content-type"] == "audio/mpeg" and a.headers["x-voice"] == "male" and a.content == b.content
    assert len(speech.calls) == 1 and speech.calls[0] == ("Chapter 1: Motion.", "male")
    assert client.get(f"{RA}/{book}/pages/2/segments/39/audio", headers=student).status_code == 404


def test_audio_reports_a_missing_voice_clearly(client, student, book, speech, monkeypatch):
    def broken(text, voice):
        raise SpeechUnavailable("This page is not in English.")
    monkeypatch.setattr(speech, "synthesize", broken)
    r = client.get(f"{RA}/{book}/pages/5/segments/0/audio?mode=read", headers=student)
    assert r.status_code == 503 and "not in English" in r.json()["detail"]


def test_read_aloud_needs_the_avatar_module_and_the_subject(client, student, student_phy_only, admin, book, speech):
    db.execute("UPDATE public.organizations SET ai_modules = ARRAY['rag_chatbot'] WHERE org_code = 'DEMO-SCHOOL'")
    try:
        assert client.get(f"{RA}/{book}/voice", headers=student).status_code == 403
    finally:
        db.execute("UPDATE public.organizations SET ai_modules = ARRAY['rag_chatbot','ai_avatar_tutor','ocr_evaluation',"
                   "'capability_analysis','question_generator'] WHERE org_code = 'DEMO-SCHOOL'")
    assert client.get(f"{RA}/{book}/voice", headers=admin).status_code == 403          # classroom roles only


def test_admin_sets_gender_when_creating_a_teacher(client, admin):
    r = client.post(f"{BASE}/admin/teachers", headers=admin, json={
        "user_code": "EMP-RA1", "full_name": "Arjun Rao", "email": "arjun.ra@demo.edu", "gender": "male",
        "phone": "+91 9800000001", "password": "Str0ngPass1"})
    assert r.status_code == 201, r.text
    rows = client.get(f"{BASE}/admin/teachers", headers=admin).json()["teachers"]
    assert next(t for t in rows if t["user_code"] == "EMP-RA1")["gender"] == "male"
