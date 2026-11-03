"""AI avatar tutor's page pipeline: single-flight, per-reader lookahead windows (priority order, prerequisites),
cancellation / replacement when a reader jumps, retries with backoff — and the read-aloud cache on top of it: cached
fallback lessons the AI later replaces, content-version invalidation, continuity between pages, readiness status,
the cached avatar-teacher lookup. Fakes only: no real LLM or voice."""
import json
import re
import threading
import time

import pytest

from app import db
from app.config import get_settings
from app.services import page_lesson, read_aloud
from app.services.page_pipeline import Pipeline, SingleFlight, Step
from scripts.sample_pdf import build_sample_textbook

BASE = "/ICMELive/api/v1"
RA = f"{BASE}/read-aloud/textbooks"


def _until(cond, timeout=5.0):
    end = time.monotonic() + timeout
    while not cond():
        assert time.monotonic() < end, "timed out"
        time.sleep(0.005)


@pytest.fixture
def pipe():
    p = Pipeline(workers=1, retries=0, backoff=0.01)
    yield p
    p.shutdown()


# ---------------------------------------------------------------- pipeline (pure)
def test_single_flight_runs_identical_work_once_and_unrelated_work_in_parallel():
    sf = SingleFlight()
    calls, out = [], []
    release = threading.Event()

    def slow():
        calls.append(1)
        release.wait(5)
        return "lesson"

    threads = [threading.Thread(target=lambda: out.append(sf.do("page-5", slow))) for _ in range(5)]
    for t in threads:
        t.start()
    _until(lambda: sf.busy("page-5"))
    assert sf.do("page-9", lambda: "other page") == "other page"     # not blocked by page 5 (no striped locks)
    time.sleep(0.05)
    release.set()
    for t in threads:
        t.join(5)
    assert calls == [1] and out == ["lesson"] * 5 and not sf.busy("page-5")

    def boom():
        raise ValueError("AI down")
    with pytest.raises(ValueError):
        sf.do("page-6", boom)
    assert not sf.busy("page-6")


def test_windows_run_in_priority_order_and_wait_for_their_prerequisites(pipe):
    gate, order = threading.Event(), []

    def step(key, needs=None):
        return Step(key, lambda _c: order.append(key), needs)

    pipe.submit(Step("busy", lambda _c: gate.wait(5)), rank=0)          # holds the only worker while windows queue up
    _until(lambda: pipe.state("busy") == "preparing")
    pipe.follow("ravi", [step("script-5"), step("audio-5", "script-5"), step("script-6", "script-5"),
                         step("audio-6", "script-6"), step("rest-5", "script-5")])
    pipe.follow("asha", [step("script-9"), step("audio-9", "script-9")])
    assert pipe.state("script-6") == "queued"
    gate.set()
    assert pipe.wait_idle(5)
    # Everybody's most urgent step first (FIFO within a rank); nothing starts before its prerequisite is done.
    assert order == ["script-5", "script-9", "audio-5", "audio-9", "script-6", "audio-6", "rest-5"]


def test_lookahead_prepares_the_next_page_before_the_rest_of_this_one(monkeypatch, pipe):
    monkeypatch.setattr(get_settings(), "read_aloud_lookahead_pages", 2)
    tb = {"textbook_id": "tb-lookahead", "org_code": "DEMO-SCHOOL", "blob_pdf_url": "books/x.pdf", "total_pages": 10}
    steps = read_aloud.lookahead(tb, 4, "explain", "female")

    def label(key):
        m = re.search(r'-p(\d+)\.json', key)
        return f"{key.split('|')[0]}-{m.group(1)}"
    assert [label(s.key) for s in steps] == ["script-4", "audio-4", "script-5", "audio-5", "rest-4", "script-6", "audio-6"]
    needs = {label(s.key): s.needs and label(s.needs) for s in steps}
    assert needs["script-5"] == "script-4" and needs["script-6"] == "script-5"   # continuity: lessons in page order
    assert needs["audio-5"] == "script-5" and needs["rest-4"] == "script-4"
    assert [label(s.key) for s in read_aloud.lookahead(tb, 10, "read", "female")] == ["script-10", "audio-10", "rest-10"]

    done = []
    monkeypatch.setattr(read_aloud, "page_script", lambda tb, p, mode: done.append(f"script-{p}") or {
        "segments": [{"text": f"p{p} part {i}"} for i in range(3)]})
    monkeypatch.setattr(read_aloud, "segment_audio", lambda text, voice: done.append(text))
    pipe.follow("ravi", steps)
    assert pipe.wait_idle(5)
    voiced = [d for d in done if not d.startswith("script")]
    assert voiced == ["p4 part 0", "p5 part 0", "p4 part 1", "p4 part 2", "p6 part 0"]


def test_jumping_elsewhere_cancels_queued_work_and_stops_running_work_between_parts(pipe):
    gate, order, parts = threading.Event(), [], []

    def rest_of_page(cancelled):
        for i in range(10):
            if cancelled():
                return
            parts.append(i)
            if i == 1:
                gate.wait(5)                                   # a long part is being voiced when the reader jumps

    pipe.follow("ravi", [Step("rest-5", rest_of_page), Step("script-6", lambda _c: order.append("script-6")),
                         Step("shared", lambda _c: order.append("shared"))])
    pipe.follow("asha", [Step("shared", lambda _c: order.append("shared"))])
    _until(lambda: parts == [0, 1])
    pipe.follow("ravi", [Step("script-20", lambda _c: order.append("script-20"))])    # Ravi jumps to page 20
    assert pipe.state("script-6") is None                      # queued for Ravi only: dropped before it started
    assert pipe.state("shared") == "queued"                    # Asha still needs it
    gate.set()
    assert pipe.wait_idle(5)
    assert parts == [0, 1] and order == ["shared", "script-20"]

    pipe.follow("asha", [Step("later", lambda _c: gate.wait(5))])
    pipe.forget("asha")
    assert pipe.wait_idle(5)


def test_failed_steps_are_retried_with_backoff_then_reported_failed():
    pipe = Pipeline(workers=1, retries=2, backoff=0.02, failed_ttl=60)
    try:
        tries = []

        def flaky(_c):
            tries.append(time.monotonic())
            if len(tries) < 3:
                raise OSError("storage hiccup")
        pipe.submit(Step("flaky", flaky))
        assert pipe.wait_idle(5) and len(tries) == 3
        assert tries[1] - tries[0] >= 0.02 and tries[2] - tries[1] >= 0.04          # exponential backoff
        assert pipe.state("flaky") is None

        broken = []
        pipe.submit(Step("broken", lambda _c: broken.append(1) or (_ for _ in ()).throw(OSError("down"))))
        assert pipe.wait_idle(5) and len(broken) == 3 and pipe.state("broken") == "failed"
        pipe.follow("ravi", [Step("broken", lambda _c: broken.append(1))])        # failed recently: not hammered
        assert pipe.wait_idle(5) and len(broken) == 3 and pipe.state("broken") == "failed"

        missing = []
        pipe.submit(Step("missing", lambda _c: missing.append(1) or (_ for _ in ()).throw(LookupError(999))))
        assert pipe.wait_idle(5) and missing == [1] and pipe.state("missing") == "failed"   # no such page: no retry
    finally:
        pipe.shutdown()


# ---------------------------------------------------------------- read-aloud cache on top of it (API)
class FakeSpeech:
    label, engine = "fake-pipeline-v1", "Fake voice"

    def __init__(self, gate=None):
        self.calls, self.gate = [], gate

    def synthesize(self, text, voice):
        if self.gate is not None:
            self.gate.wait(5)
        self.calls.append((text, voice))
        return b"ID3" + text.encode()[:20], "audio/mpeg"


@pytest.fixture
def speech(monkeypatch):
    fake = FakeSpeech()
    monkeypatch.setattr("app.services.read_aloud.get_speech", lambda: fake)
    monkeypatch.setattr("app.routers.read_aloud.get_speech", lambda: fake)
    return fake


class FakeTutor:
    name = "azure-gpt-4o"

    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def chat(self, system, messages, *, json_mode=False, temperature=0.2):
        self.calls.append(messages[-1]["content"])
        return self.reply


GOOD = json.dumps({"title": "Acceleration", "intro": "Today we see how velocity changes.",
                   "key_points": [{"heading": "Rate of change", "explanation": "Acceleration tells how fast velocity changes.",
                                   "quote": "Acceleration is the rate of change of velocity"}],
                   "terms": [], "recap": "Velocity can change.", "question": "What is retardation?"})


@pytest.fixture(scope="module")
def book(client, teacher):
    r = client.post(f"{BASE}/curriculum/upload-textbook", headers=teacher,
                    data={"title": "Pipeline Physics", "subject_code": "PHY101", "class_code": "Grade-10-A"},
                    files={"file": ("book.pdf", build_sample_textbook("Pipeline Physics"), "application/pdf")})
    assert r.status_code == 202, r.text
    end = time.time() + 60
    while client.get(f"{BASE}/curriculum/jobs/{r.json()['job_id']}", headers=teacher).json()["status"] not in ("completed", "failed"):
        assert time.time() < end
        time.sleep(0.3)
    tb = r.json()["textbook_id"]
    assert client.post(f"{BASE}/curriculum/textbooks/{tb}/publish", headers=teacher, json={"published": True}).status_code == 200
    return tb


@pytest.fixture
def fast_retries(monkeypatch):
    monkeypatch.setattr(get_settings(), "read_aloud_retry_backoff", 0)


def test_a_failed_ai_lesson_is_cached_as_a_fallback_until_the_ai_replaces_it(client, student, book, speech, fast_retries,
                                                                           monkeypatch):
    tutor = FakeTutor("not json")
    monkeypatch.setattr(page_lesson, "get_tutor_llm", lambda: tutor)
    a = client.get(f"{RA}/{book}/pages/2", headers=student).json()
    assert a["engine"] == "offline-fallback" and a["fallback"] and len(tutor.calls) == 2      # one try + one retry
    b = client.get(f"{RA}/{book}/pages/2", headers=student).json()
    assert b["version"] == a["version"] and len(tutor.calls) == 2      # cached: same parts, no AI call per request

    tutor.reply = GOOD                                                 # the AI is back; the retry interval passes
    monkeypatch.setattr(get_settings(), "read_aloud_fallback_retry_seconds", 0)
    c = client.get(f"{RA}/{book}/pages/2", headers=student).json()
    assert c["engine"] == "azure-gpt-4o" and not c["fallback"] and c["version"] != a["version"]
    assert client.get(f"{RA}/{book}/pages/2", headers=student).json()["version"] == c["version"]
    assert len(tutor.calls) == 3

    # A reader part-way through the old (fallback) explanation keeps hearing it, part by part, in order.
    r = client.get(f"{RA}/{book}/pages/2/segments/1/audio?v={a['version']}", headers=student)
    assert r.status_code == 200 and speech.calls[-1][0] == read_aloud.speakable(a["segments"][1]["text"])
    r = client.get(f"{RA}/{book}/pages/2/segments/0/audio?v={c['version']}", headers=student)
    assert r.status_code == 200 and speech.calls[-1][0] == read_aloud.speakable(c["segments"][0]["text"])
    assert client.get(f"{RA}/{book}/pages/2/segments/0/audio?v=0123456789ab", headers=student).status_code == 409


def test_changed_textbook_content_or_prompt_is_explained_afresh(client, student, book, speech, monkeypatch):
    tutor = FakeTutor(GOOD)
    monkeypatch.setattr(page_lesson, "get_tutor_llm", lambda: tutor)
    row = db.fetch_one("SELECT content_sha256 FROM public.subject_textbooks WHERE textbook_id = %s", (book,))
    assert row["content_sha256"] and len(row["content_sha256"].strip()) == 64       # set when the book was indexed
    client.get(f"{RA}/{book}/pages/3", headers=student)
    client.get(f"{RA}/{book}/pages/3", headers=student)
    assert len(tutor.calls) == 1
    try:
        db.execute("UPDATE public.subject_textbooks SET content_sha256 = %s WHERE textbook_id = %s", ("f" * 64, book))
        client.get(f"{RA}/{book}/pages/3", headers=student)
        assert len(tutor.calls) == 2                                   # new content -> new key -> explained again
        monkeypatch.setattr(page_lesson, "PROMPT_VERSION", "lesson-test")
        client.get(f"{RA}/{book}/pages/3", headers=student)
        assert len(tutor.calls) == 3                                   # new prompt -> explained again
    finally:
        db.execute("UPDATE public.subject_textbooks SET content_sha256 = %s WHERE textbook_id = %s", (row["content_sha256"], book))


def test_the_next_page_carries_on_from_the_previous_one(client, student, book, speech, monkeypatch):
    tutor = FakeTutor(GOOD)
    monkeypatch.setattr(page_lesson, "get_tutor_llm", lambda: tutor)
    client.get(f"{RA}/{book}/pages/4", headers=student)
    client.get(f"{RA}/{book}/pages/5", headers=student)
    assert "The previous page (page 4) was about: Acceleration. Velocity can change." in tutor.calls[-1]
    client.get(f"{RA}/{book}/pages/2?mode=read", headers=student)
    assert len(tutor.calls) == 2                                        # word for word: no AI, no hand-off


def test_prepare_aims_the_readers_pipeline_and_status_reports_readiness(client, student, book, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "read_aloud_prewarm", True)
    monkeypatch.setattr(s, "read_aloud_lookahead_pages", 1)
    gate = threading.Event()
    speech = FakeSpeech(gate)
    monkeypatch.setattr("app.services.read_aloud.get_speech", lambda: speech)
    pipe = Pipeline(workers=1, retries=0)
    monkeypatch.setattr(read_aloud, "_pipe", pipe)
    tb = db.call_row("usp_get_textbook", book)
    try:
        r = client.post(f"{RA}/{book}/pages/2/prepare?mode=read", headers=student)
        assert r.status_code == 200 and [p["page"] for p in r.json()["pages"]] == [2, 3]
        _until(lambda: pipe.state(f"audio|{read_aloud.script_key(tb, 2, 'read')}|0|female") == "preparing")
        st = {p["page"]: p for p in client.get(f"{RA}/{book}/pages/2/status?mode=read", headers=student).json()["pages"]}
        assert (st[2]["script"], st[2]["audio"], st[2]["status"]) == ("ready", "preparing", "preparing")
        assert st[3]["status"] == "queued"

        # The reader jumps to page 4: page 3 (queued for them only) is dropped, page 4 and 5 are queued instead.
        client.post(f"{RA}/{book}/pages/4/prepare?mode=read", headers=student)
        assert pipe.state(f"script|{read_aloud.script_key(tb, 3, 'read')}") is None
        assert pipe.state(f"script|{read_aloud.script_key(tb, 4, 'read')}") == "queued"
        gate.set()
        assert pipe.wait_idle(10)
        st = client.get(f"{RA}/{book}/pages/4/status?mode=read", headers=student).json()["pages"]
        assert [p["status"] for p in st] == ["ready", "ready"]
        p4 = client.get(f"{RA}/{book}/pages/4?mode=read&prefetch=true", headers=student).json()
        p5 = client.get(f"{RA}/{book}/pages/5?mode=read&prefetch=true", headers=student).json()
        voiced = [t for t, _ in speech.calls]
        # page 4's first part, then page 5's first part, then the rest of page 4
        assert voiced[1:3] == [read_aloud.speakable(p4["segments"][0]["text"]), read_aloud.speakable(p5["segments"][0]["text"])]
        assert set(voiced[3:]) == {read_aloud.speakable(x["text"]) for x in p4["segments"][1:]}
        assert client.get(f"{RA}/{book}/pages/999/status", headers=student).status_code == 404
    finally:
        gate.set()
        pipe.shutdown()


def test_the_avatar_teacher_lookup_is_cached_and_cleared_by_admin_edits(client, admin, student, book, speech, monkeypatch):
    read_aloud.forget_avatar_teachers()
    queries = []
    real = db.fetch_one
    monkeypatch.setattr(db, "fetch_one", lambda sql, params=None: queries.append(sql) or real(sql, params))
    try:
        assert client.get(f"{RA}/{book}/voice", headers=student).json()["voice"] == "female"
        client.get(f"{RA}/{book}/voice", headers=student)
        client.get(f"{RA}/{book}/pages/2/segments/0/audio?mode=read", headers=student)
        assert sum("class_subjects" in q for q in queries) == 1     # one query for the lookup, then cached
        assert client.patch(f"{BASE}/admin/teachers/EMP1001", headers=admin, json={"gender": "male"}).status_code == 200
        assert client.get(f"{RA}/{book}/voice", headers=student).json()["voice"] == "male"    # admin edit clears it
    finally:
        db.execute("UPDATE public.app_users SET gender = NULL WHERE org_code = 'DEMO-SCHOOL' AND user_code = 'EMP1001'")
        read_aloud.forget_avatar_teachers()
