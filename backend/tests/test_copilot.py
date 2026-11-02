"""Admin Copilot (#13): aggregated, anonymised institution Q&A for staff. Answers must be grounded in the
real, freshly-computed snapshot (services/copilot.py), never a canned string, even in PROVIDER_MODE=mock."""
BASE = "/ICMELive/api/v1/copilot"


def test_copilot_rbac(client, admin, teacher, student):
    q = {"query": "How many students do we have?", "stream": False}
    assert client.post(f"{BASE}/query", headers=admin, json=q).status_code == 200
    assert client.post(f"{BASE}/query", headers=teacher, json=q).status_code == 200
    assert client.post(f"{BASE}/query", headers=student, json=q).status_code == 200  # students get their OWN snapshot


def test_copilot_student_gets_only_their_own_data(client, student):
    r = client.post(f"{BASE}/query", headers=student, json={"query": "How's my attendance?", "stream": False})
    assert r.status_code == 200, r.text
    assert "attendance" in r.json()["answer"].lower()

    r2 = client.post(f"{BASE}/query", headers=student, json={"query": "What homework do I have pending?", "stream": False})
    assert r2.status_code == 200, r2.text
    assert "homework" in r2.json()["answer"].lower()


def test_copilot_student_cannot_get_institution_wide_staff_data(client, student):
    # A student asking a staff-scoped question never gets staff/institution-wide numbers back — Copilot has
    # no such data in the student's snapshot (build_student_snapshot) to answer from in the first place.
    r = client.post(f"{BASE}/query", headers=student, json={"query": "How many teachers do we have?", "stream": False})
    assert r.status_code == 200, r.text
    assert "teacher" not in r.json()["answer"].lower()


def test_copilot_answers_from_real_aggregated_snapshot(client, admin):
    r = client.post(f"{BASE}/query", headers=admin, json={"query": "How many teachers do we have?", "stream": False})
    assert r.status_code == 200, r.text
    answer = r.json()["answer"]
    assert answer and "teacher" in answer.lower()


def test_copilot_admissions_question(client, admin):
    r = client.post(f"{BASE}/query", headers=admin,
                    json={"query": "How many families have given consent?", "stream": False})
    assert r.status_code == 200, r.text
    assert "consent" in r.json()["answer"].lower()


def test_copilot_streams_sse(client, admin):
    with client.stream("POST", f"{BASE}/query", headers=admin, json={"query": "How is attendance today?"}) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        raw = "".join(r.iter_text())
    assert "event: token" in raw and "event: done" in raw


def test_copilot_query_validation(client, admin):
    assert client.post(f"{BASE}/query", headers=admin, json={"query": "x"}).status_code == 422


# ──────────────────────────────────────────────────────────── follow-up suggestions, advice, status, voice
import json  # noqa: E402

import pytest  # noqa: E402


def _events(client, headers, query):
    with client.stream("POST", f"{BASE}/query", headers=headers, json={"query": query}) as r:
        assert r.status_code == 200, r.read()
        raw = "".join(r.iter_text())
    out = []
    for block in raw.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def _other_student_names(exclude_email):
    from app import db

    rows = db.fetch_all("SELECT full_name FROM public.app_users WHERE user_role = 'student' AND email <> %s", (exclude_email,))
    return [r["full_name"] for r in rows if r["full_name"]]


@pytest.mark.parametrize("who", ["student", "admin", "teacher"])
def test_copilot_stream_ends_with_suggestions(client, request, who):
    events = _events(client, request.getfixturevalue(who), "How is my attendance?" if who == "student" else "How many teachers do we have?")
    names = [e for e, _ in events]
    assert names[0] == "token" and names[-2:] == ["done", "suggestions"], names
    items = events[-1][1]["items"]
    assert 2 <= len(items) <= 4
    assert all(isinstance(s, str) and 0 < len(s) <= 100 for s in items)
    assert len({s.lower() for s in items}) == len(items)


def test_copilot_non_stream_includes_suggestions(client, admin):
    r = client.post(f"{BASE}/query", headers=admin, json={"query": "How many teachers do we have?", "stream": False})
    assert r.status_code == 200, r.text
    sugg = r.json()["suggestions"]
    assert 2 <= len(sugg) <= 4
    assert "How many teachers do we have?" not in sugg  # never repeats the question just asked


def test_copilot_student_suggestions_stay_on_their_own_data(client, student):
    others = _other_student_names("student@demo.edu")
    assert others, "seed should have other students to check against"
    for q in ("How is my attendance?", "What homework do I have pending?", "Suggest how I can improve this week"):
        events = _events(client, student, q)
        answer = "".join(d["text"] for e, d in events if e == "token")
        items = events[-1][1]["items"]
        text = " ".join(items) + " " + answer
        for name in others:
            assert name not in text
            assert name.split()[0] not in " ".join(items)
        for word in ("classmate", "class average", "rank", "other student"):
            assert word not in " ".join(items).lower()
        assert all("teacher" not in s.lower() for s in items)  # no staff-scoped follow-ups for a student


def test_copilot_student_advice_is_concrete(client, student):
    r = client.post(f"{BASE}/query", headers=student, json={"query": "Suggest how I can improve this week", "stream": False})
    assert r.status_code == 200, r.text
    answer = r.json()["answer"]
    assert "suggest" in answer.lower() and "\n- " in answer  # a bulleted list of actions
    assert "teachers do we have" not in answer.lower()


def test_copilot_staff_advice_is_aggregated(client, admin):
    r = client.post(f"{BASE}/query", headers=admin, json={"query": "What should we focus on this week?", "stream": False})
    assert r.status_code == 200, r.text
    answer = r.json()["answer"]
    assert "\n- " in answer
    for name in _other_student_names(""):
        assert name not in answer
    assert "What should we focus on this week?" not in r.json()["suggestions"]


def test_advice_intent_detection():
    from app.services import copilot as svc

    for q in ("Suggest a study plan", "How can I improve my attendance?", "What should we focus on?", "any tips for exams",
              "Recommend next steps", "how do we raise attendance"):
        assert svc.wants_advice(q), q
    for q in ("How many teachers do we have?", "What homework do I have pending?", "How can I see my timetable?"):
        assert not svc.wants_advice(q), q


def test_clean_suggestions_enforces_privacy_and_limits():
    from app.services import copilot as svc

    student = svc.clean_suggestions(
        ["1. How is my attendance?", "How do I compare with my classmates?", "What is the class average?",
         "Who is the class topper?", "What homework is due next?", "What homework is due next?", "ok",
         "x" * 150, 42, "Plan my revision for this week", "Show my last result", "One more?"],
        "student", "How is my attendance")
    assert student == ["What homework is due next?", "Plan my revision for this week", "Show my last result", "One more?"]
    staff = svc.clean_suggestions(["Which students were absent today?", "What are the names of absent kids?",
                                   "Who is the weakest student?", "How is attendance trending this month?"], "orgadmin", "q")
    assert staff == ["How is attendance trending this month?"]
    assert svc.clean_suggestions("not a list", "student", "q") == []


class _FakeLLM:
    name = "fake"

    def __init__(self, reply=None, fail=False):
        self.reply, self.fail, self.calls = reply, fail, []

    def chat(self, system, messages, *, json_mode=False, temperature=0.2):
        self.calls.append((system, messages, json_mode))
        if self.fail:
            raise RuntimeError("provider down")
        return self.reply

    def chat_stream(self, system, messages, *, temperature=0.2):
        yield "Answer from the fake model."

    def transcribe(self, audio, filename):
        self.calls.append(("transcribe", len(audio), filename))
        return "  how is my   attendance  "


def test_llm_suggestions_are_validated_and_padded(client, student, monkeypatch):
    from app.services import copilot as svc

    fake = _FakeLLM(json.dumps({"suggestions": ["Compare me with my classmates", "What homework is due next?"]}))
    monkeypatch.setattr(svc, "ai_ready", lambda: True)
    monkeypatch.setattr(svc, "get_copilot_llm", lambda: fake)
    events = _events(client, student, "How is my attendance?")
    items = events[-1][1]["items"]
    assert items[0] == "What homework is due next?"  # the LLM's valid one first…
    assert not any("classmate" in s.lower() for s in items)  # …its privacy-violating one dropped…
    assert 2 <= len(items) <= 4  # …and padded from the deterministic fallback
    system, _, json_mode = fake.calls[-1]
    assert "[TASK:COPILOT_SUGGEST]" in system and json_mode
    assert "classmates" in system  # the student privacy rule is in the prompt


@pytest.mark.parametrize("fake", [_FakeLLM(fail=True), _FakeLLM("not json at all")])
def test_llm_suggestion_failures_fall_back(client, admin, monkeypatch, fake):
    from app.services import copilot as svc

    monkeypatch.setattr(svc, "ai_ready", lambda: True)
    monkeypatch.setattr(svc, "get_copilot_llm", lambda: fake)
    r = client.post(f"{BASE}/query", headers=admin, json={"query": "How many teachers do we have?", "stream": False})
    assert r.status_code == 200, r.text
    assert r.json()["answer"] == "Answer from the fake model."
    assert 2 <= len(r.json()["suggestions"]) <= 4


def test_copilot_status_reports_offline_mode_without_key_material(client, admin, student):
    for h in (admin, student):
        r = client.get(f"{BASE}/status", headers=h)
        assert r.status_code == 200, r.text
        assert r.json() == {"mode": "mock", "ai_ready": False, "voice_transcription": False}
    assert client.get(f"{BASE}/status").status_code in (401, 403)


# ── voice messages
AUDIO = {"Content-Type": "audio/webm;codecs=opus"}


@pytest.fixture
def voice(monkeypatch):
    from app.routers import copilot as router

    router.voice_limiter.reset()
    yield router
    router.voice_limiter.reset()


def test_transcribe_requires_auth_and_audio(client, student, voice):
    assert client.post(f"{BASE}/transcribe", content=b"abc", headers=AUDIO).status_code in (401, 403)
    assert client.post(f"{BASE}/transcribe", content=b"abc", headers={**student, "Content-Type": "text/plain"}).status_code == 415
    assert client.post(f"{BASE}/transcribe", content=b"", headers={**student, **AUDIO}).status_code == 400


def test_transcribe_rejects_oversized_audio(client, student, voice, monkeypatch):
    monkeypatch.setattr(voice, "MAX_AUDIO_BYTES", 1000)
    r = client.post(f"{BASE}/transcribe", content=b"x" * 1001, headers={**student, **AUDIO})
    assert r.status_code == 413


def test_transcribe_in_mock_mode_is_a_friendly_501(client, teacher, voice):
    r = client.post(f"{BASE}/transcribe", content=b"fake-webm", headers={**teacher, **AUDIO})
    assert r.status_code == 501
    assert "AI key" in r.json()["detail"]


def test_transcribe_is_rate_limited(client, admin, voice, monkeypatch):
    monkeypatch.setattr(voice, "VOICE_LIMIT", (2, 600))
    codes = [client.post(f"{BASE}/transcribe", content=b"fake-webm", headers={**admin, **AUDIO}).status_code for _ in range(3)]
    assert codes == [501, 501, 429]


def test_transcribe_with_a_provider(client, student, voice, monkeypatch):
    from app.services import copilot as svc

    fake = _FakeLLM()
    monkeypatch.setattr(svc, "ai_ready", lambda: True)
    monkeypatch.setattr(voice, "get_copilot_llm", lambda: fake)
    r = client.post(f"{BASE}/transcribe", content=b"fake-webm", headers={**student, **AUDIO})
    assert r.status_code == 200, r.text
    assert r.json() == {"text": "how is my attendance"}
    assert fake.calls[-1] == ("transcribe", 9, "voice.webm")
