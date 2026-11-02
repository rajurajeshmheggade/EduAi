"""Virtual Labs: DIKSHA virtual-lab catalogue, experiment extraction, licence-aware simulation embedding and the
teacher-assigns / student-performs / teacher-reviews workflow.

DIKSHA is served by httpx.MockTransport from tests/fixtures/diksha/hierarchy_virtual_lab.json, a trimmed copy of the
real Class 10 Science Lab Manual (do_3135614393797099521445) listed on https://diksha.gov.in/virtuallabs.html.
"""
import json
from pathlib import Path

import httpx
import pytest

from app import db
from app.config import get_settings
from app.services.diksha import access as acc
from app.services.diksha import normalize as nz
from app.services.diksha.client import DikshaClient, set_client
from app.services.virtual_labs import catalog, labs
from app.services.virtual_labs import worksheet as wsx

FIX = Path(__file__).parent / "fixtures" / "diksha"
A = "/ICMELive/api/v1/admin"
V = "/ICMELive/api/v1/virtual-labs"

SCI10 = "do_3135614393797099521445"              # Class 10 Science Lab Manual (English)
REACTIONS = "do_31356577898319052813162"         # experiment with two simulations
EXO = "do_31356577898317414413160"               # one simulation + lab manual
METALS = "do_31356577898336256013178"            # lab-manual PDF only
SIM_EXO = "https://obj.diksha.gov.in/ntp-content-production/content/html/"


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


class FakeDiksha:
    def __init__(self):
        self.body = load("hierarchy_virtual_lab.json")
        self.requests = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests += 1
        if request.url.path == f"/api/course/v1/hierarchy/{SCI10}":
            return httpx.Response(200, json=self.body)
        return httpx.Response(404, json=load("hierarchy_not_found.json"))


@pytest.fixture()
def fake():
    f = FakeDiksha()
    set_client(DikshaClient("https://diksha.gov.in", 5, 1000, 0, transport=httpx.MockTransport(f)))
    yield f
    set_client(None)


def _login(client, ident):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def users(client):
    u = {k: _login(client, e) for k, e in [("admin", "admin@demo.edu"), ("priya", "teacher@demo.edu"), ("kavya", "kavya@demo.edu"),
                                           ("rohan", "student@demo.edu"), ("ishaan", "ishaan@demo.edu"), ("ananya", "ananya@demo.edu"),
                                           ("meera", "meera@demo.edu"), ("kabir", "kabir@demo.edu")]}
    r = client.put(f"{A}/classes/Grade-10-A", headers=u["admin"],
                   json={"class_name": "Grade 10 — Section A", "class_teacher_code": "EMP1001", "is_active": True, "grade_number": 10})
    assert r.status_code == 200, r.text
    return u


class FakeTutor:
    name = "fake-tutor"

    def __init__(self, reply):
        self.reply = reply
        self.calls = []

    def chat(self, system, messages, *, json_mode=False, temperature=0.2):
        self.calls.append({"system": system, "messages": messages, "json_mode": json_mode})
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply if isinstance(self.reply, str) else json.dumps(self.reply)


def _worksheet(**over):
    ws = {"aim": "To study exothermic and endothermic reactions.", "materials": ["Beakers", "Thermometer"],
          "steps": ["Note the initial temperature", "Add the reactant", "Note the final temperature"],
          "observation_columns": ["Reaction", "Initial temp (°C)", "Final temp (°C)"], "observation_rows": 2,
          "questions": [
              {"type": "mcq", "prompt": "Dissolving NaOH in water is", "options": ["Exothermic", "Endothermic"], "answer": 0, "marks": 1},
              {"type": "mcq", "prompt": "Temperature falls in an", "options": ["Exothermic reaction", "Endothermic reaction"], "answer": 1, "marks": 1},
              {"type": "short", "prompt": "Why does the temperature rise?", "model_answer": "Heat is released.", "marks": 2}],
          "conclusion_prompt": "What do you conclude?", "record_marks": 4}
    ws.update(over)
    return ws


def _assign(client, users, **over):
    body = {"collection_id": SCI10, "lab_id": EXO, "class_code": "Grade-10-A", "subject_code": "PHY101", "worksheet": _worksheet(),
            "min_minutes": 1, "instructions": "Do the simulation, then fill the table."}
    body.update(over)
    return client.post(f"{V}/assignments", headers=users["priya"], json=body)


# ---------------------------------------------------------------- catalogue + extraction
def test_catalogue_covers_classes_6_to_12_from_the_diksha_page():
    assert len(catalog.COLLECTIONS) == 58 and catalog.CLASSES == [6, 7, 8, 9, 10, 11, 12]
    for c in catalog.CLASSES:
        rows = [r for r in catalog.COLLECTIONS if r["class_number"] == c]
        assert {r["medium"] for r in rows} == {"English", "Hindi"}, c
    assert all(r["collection_id"].startswith("do_") for r in catalog.COLLECTIONS)
    assert catalog.classes_of(SCI10) == {10}
    # a Hindi collection listed under both mediums on the source page
    assert {r["medium"] for r in catalog.entries("do_3145014393420021761252")} == {"English", "Hindi"}


def test_experiments_follow_diksha_units_with_resource_roles():
    tree = nz.normalize_tree(load("hierarchy_virtual_lab.json")["result"]["content"])
    exps = labs.experiments(tree)
    assert [e["lab_id"] for e in exps] == [REACTIONS, EXO, "do_31356577898272358413116", METALS]
    first = exps[0]
    assert first["name"].endswith("Decomposition of NH4Cl")                      # trailing space from DIKSHA trimmed
    assert first["roles"] == {"simulation": 2, "manual": 1, "theory": 2, "procedure": 2, "video": 3, "self_check": 2}
    assert [r["role"] for r in first["resources"]][:3] == ["simulation", "simulation", "manual"]   # simulation first
    roles = {r["name"].strip(): r["role"] for r in first["resources"]}
    assert roles["Theory- Different types of Chemical Reactions"] == "theory"   # a video named Theory
    assert roles["Assessment- Different types of Chemical Reactions"] == "self_check"   # HTML self-check
    assert "Amrita Vishwa Vidyapeetham" in first["authors"] and first["keywords"]
    assert exps[3]["has_simulation"] is False and exps[3]["roles"] == {"manual": 1}
    assert "resources" not in labs.summary(first)


def test_simulation_embeds_only_from_diksha_host_and_when_licence_allows(monkeypatch):
    tree = nz.normalize_tree(load("hierarchy_virtual_lab.json")["result"]["content"])
    sim = next(r for r in labs.find(tree, EXO)["resources"] if r["role"] == "simulation")
    assert sim["license"]["name"] == "CC BY-NC-SA 4.0"
    assert acc.viewer(sim)["viewer"] == "official"                                  # NonCommercial, not approved
    monkeypatch.setattr(get_settings(), "diksha_embed_noncommercial", True)
    v = acc.viewer(sim)
    assert v["viewer"] == "html" and v["src"].startswith(SIM_EXO) and v["src"].endswith("-latest/index.html")
    assert acc.viewer({**sim, "streaming_url": "https://evil.example.com/content/html/x", "preview_url": None})["viewer"] == "official"
    h5p = next(r for r in labs.find(tree, REACTIONS)["resources"] if r["mime_type"].endswith("h5p-archive"))
    assert acc.viewer(h5p)["viewer"] == "official"                                  # H5P needs DIKSHA's player
    shown = labs.present(labs.find(tree, EXO))
    assert all("streaming_url" not in r and "artifact_url" not in r for r in shown["resources"])
    assert shown["resources"][0]["role_label"] == "Simulation"


def test_worksheet_rules():
    with pytest.raises(ValueError):
        wsx.Worksheet(**_worksheet(questions=[{"type": "mcq", "prompt": "Pick one", "options": ["A", "B"], "marks": 1}]))  # no answer
    with pytest.raises(ValueError):
        wsx.Worksheet(**_worksheet(questions=[], record_marks=0))
    ws = wsx.Worksheet(**_worksheet()).model_dump()
    assert [q["id"] for q in ws["questions"]] == ["q1", "q2", "q3"] and wsx.max_marks(ws) == 8
    hidden = wsx.for_student(ws, reveal=False)
    assert all("answer" not in q and "model_answer" not in q for q in hidden["questions"])
    assert wsx.auto_mark(ws, {"q1": 0, "q2": 0})[:2] == (1.0, 2.0)


# ---------------------------------------------------------------- teacher
def test_teacher_explores_catalogue_collection_and_lab(client, users, fake):
    cat = client.get(f"{V}/catalog", headers=users["priya"]).json()
    assert len(cat["collections"]) == 58 and cat["source"]["url"] == catalog.SOURCE_PAGE
    assert {"Grade-10-A"} <= {t["class_code"] for t in cat["targets"]}
    col = client.get(f"{V}/collections/{SCI10}", headers=users["priya"]).json()
    assert col["collection"]["class_number"] == 10 and col["collection"]["name"] == "Science Lab Manual"
    assert len(col["labs"]) == 4 and col["labs"][0]["roles"]["simulation"] == 2 and "resources" not in col["labs"][0]
    lab = client.get(f"{V}/collections/{SCI10}/labs/{EXO}", headers=users["priya"]).json()
    assert lab["lab"]["resources"][0]["access"]["viewer"] in ("official", "html") and lab["assigned"] == []
    assert client.get(f"{V}/collections/do_31310347535505817611436", headers=users["priya"]).status_code == 404   # not a lab collection
    assert client.get(f"{V}/collections/{SCI10}/labs/do_1234567890", headers=users["priya"]).status_code == 404
    assert client.get(f"{V}/collections/not-an-id", headers=users["priya"]).status_code == 422
    assert client.get(f"{V}/catalog", headers=users["rohan"]).status_code == 403


def test_worksheet_draft_offline_and_with_ai(client, users, fake, monkeypatch):
    r = client.post(f"{V}/collections/{SCI10}/labs/{EXO}/worksheet", headers=users["priya"])
    assert r.status_code == 200 and r.json()["engine"] == "offline"
    ws = r.json()["worksheet"]
    assert ws["aim"].startswith("To ") and any("simulation" in s.lower() for s in ws["steps"]) and ws["questions"]
    tutor = FakeTutor({"aim": "To study the change in temperature in exothermic and endothermic reactions.",
                       "materials": ["NaOH", "Thermometer"], "steps": ["Pour water", "Add NaOH", "Read thermometer"],
                       "observation_columns": ["Substance", "Initial temp (°C)", "Final temp (°C)"], "observation_rows": 4,
                       "questions": [{"type": "mcq", "prompt": "Dissolving NaOH is", "options": ["Exothermic", "Endothermic", "Neither", "Both"],
                                      "answer": 0, "explanation": "Heat is released."},
                                     {"type": "mcq", "prompt": "Broken question", "options": ["Only one"], "answer": 0},
                                     {"type": "short", "prompt": "Why does the beaker feel warm?", "model_answer": "Heat is given out."}],
                       "conclusion_prompt": "Which reactions released heat?"})
    monkeypatch.setattr(wsx, "get_tutor_llm", lambda: tutor)
    r = client.post(f"{V}/collections/{SCI10}/labs/{EXO}/worksheet", headers=users["priya"])
    d = r.json()
    assert d["engine"] == "fake-tutor" and len(d["worksheet"]["questions"]) == 2          # malformed MCQ dropped
    assert d["worksheet"]["observation_rows"] == 4 and d["max_marks"] == 1 + 2 + 4
    assert "Class 10" in tutor.calls[0]["system"] and "Change in temp" in tutor.calls[0]["messages"][0]["content"]
    monkeypatch.setattr(wsx, "get_tutor_llm", lambda: FakeTutor("not json"))
    assert client.post(f"{V}/collections/{SCI10}/labs/{EXO}/worksheet", headers=users["priya"]).json()["engine"] == "offline-fallback"
    assert client.post(f"{V}/collections/{SCI10}/labs/{EXO}/worksheet", headers=users["admin"]).status_code == 403


def test_assignment_validation(client, users, fake):
    db.execute("UPDATE public.classes SET grade_number = 9 WHERE class_code = 'Grade-9-B'")
    try:
        r = _assign(client, users, class_code="Grade-9-B")        # Priya teaches PHY101 there, but it is Class 9
        assert r.status_code == 422 and "Class 10" in r.json()["detail"] and "Class 9" in r.json()["detail"]
    finally:
        db.execute("UPDATE public.classes SET grade_number = NULL WHERE class_code = 'Grade-9-B'")
    assert client.post(f"{V}/assignments", headers=users["kavya"], json={
        "collection_id": SCI10, "lab_id": EXO, "class_code": "Grade-10-A", "subject_code": "PHY101", "worksheet": _worksheet()}).status_code == 403
    assert _assign(client, users, collection_id="do_31310347535505817611436").status_code == 404
    assert _assign(client, users, due_at="2020-01-01T00:00:00Z").status_code == 422
    bad = _worksheet(questions=[{"type": "mcq", "prompt": "Pick", "options": ["A", "A"], "answer": 0}])
    assert _assign(client, users, worksheet=bad).status_code == 422


# ---------------------------------------------------------------- end-to-end
def test_student_performs_lab_and_teacher_reviews(client, users, fake, monkeypatch):
    r = _assign(client, users, title="Exothermic or endothermic?", due_at="2099-01-01T10:00:00Z")
    assert r.status_code == 201, r.text
    aid = r.json()["assignment_id"]
    assert r.json()["max_marks"] == 8 and r.json()["student_count"] >= 4

    # the lab is in the student's list; other classes cannot see it
    mine = client.get(f"{V}/my", headers=users["rohan"]).json()
    item = next(x for x in mine["labs"] if x["assignment_id"] == aid)
    assert item["my"]["status"] == "not_started" and item["window"]["can_work"] and item["has_simulation"]
    assert mine["counts"]["to_do"] >= 1
    assert client.get(f"{V}/my/{aid}", headers=users["kabir"]).status_code == 404
    view = client.get(f"{V}/my/{aid}", headers=users["rohan"]).json()
    assert view["attempt"] is None and all("answer" not in q for q in view["worksheet"]["questions"])
    assert view["lab"]["resources"][0]["role"] == "simulation" and view["lab"]["collection"]["class_number"] == 10
    assert client.post(f"{V}/my/{aid}/ask", headers=users["rohan"], json={"question": "What is exothermic?"}).status_code == 409

    # start + time in the lab (capped by the server clock)
    started = client.post(f"{V}/my/{aid}/start", headers=users["rohan"]).json()
    assert started["attempt"]["status"] == "in_progress" and started["attempt"]["active_seconds"] == 0
    beat = client.post(f"{V}/my/{aid}/activity", headers=users["rohan"], json={"seconds": 120, "launched": True}).json()
    assert beat["active_seconds"] <= 4 and beat["launches"] == 1 and beat["min_seconds"] == 60
    r = client.post(f"{V}/my/{aid}/submit", headers=users["rohan"], json={})
    assert r.status_code == 409 and "1 minutes" not in r.json()["detail"] and "minute" in r.json()["detail"]
    db.execute("UPDATE public.virtual_lab_attempts SET last_active_at = NOW() - interval '45 seconds' "
               "WHERE assignment_id = %s AND student_code = 'REG2026001'", (aid,))
    beat = client.post(f"{V}/my/{aid}/activity", headers=users["rohan"], json={"seconds": 45}).json()
    assert 45 <= beat["active_seconds"] <= 49
    db.execute("UPDATE public.virtual_lab_attempts SET last_active_at = NOW() - interval '1 hour' "
               "WHERE assignment_id = %s AND student_code = 'REG2026001'", (aid,))
    beat = client.post(f"{V}/my/{aid}/activity", headers=users["rohan"], json={"seconds": 100}).json()
    assert beat["active_seconds"] <= 49 + 60                                       # one report adds at most a minute

    # autosave of the lab record
    work = {"steps_done": [0, 1, 7], "observations": [["NaOH in water", "25", "31"], ["NH4Cl in water", "25", "21"]],
            "answers": {"q1": 0, "q2": 0, "q3": "Because heat is released when NaOH dissolves."}, "conclusion": "Dissolving NaOH is exothermic."}
    assert client.put(f"{V}/my/{aid}/work", headers=users["rohan"], json={**work, "answers": {"q9": 1}}).status_code == 422
    assert client.put(f"{V}/my/{aid}/work", headers=users["rohan"], json={**work, "answers": {"q1": 5}}).status_code == 422
    assert client.put(f"{V}/my/{aid}/work", headers=users["rohan"], json=work).status_code == 200
    saved = client.get(f"{V}/my/{aid}", headers=users["rohan"]).json()["attempt"]
    assert saved["steps_done"] == [0, 1] and saved["observations"][1] == ["NH4Cl in water", "25", "21"]

    # lab assistant (no AI provider in tests -> guidance message)
    a = client.post(f"{V}/my/{aid}/ask", headers=users["rohan"], json={"question": "Why does the temperature rise?"}).json()
    assert a["engine"] == "offline" and "procedure" in a["answer"].lower()

    # submit: MCQs marked exactly; without AI the short answer + record wait for the teacher
    done = client.post(f"{V}/my/{aid}/submit", headers=users["rohan"], json=work).json()
    att = done["attempt"]
    assert att["status"] == "submitted" and att["is_late"] is False
    assert att["result"]["auto_score"] == 1 and att["result"]["auto_max"] == 2 and att["result"]["suggested_marks"] is None
    assert att["result"]["feedback"]["checks"] == {"rows_filled": 2, "rows_expected": 2, "steps_done": 2, "steps_total": 3,
                                                   "answered": 3, "questions": 3, "conclusion_words": 4}
    assert done["worksheet"]["questions"][1]["answer"] == 1                       # revealed after submitting
    assert client.put(f"{V}/my/{aid}/work", headers=users["rohan"], json=work).status_code == 409
    assert client.post(f"{V}/my/{aid}/start", headers=users["rohan"]).json()["attempt"]["status"] == "submitted"

    # a second student with the AI marking short answers and the record
    tutor = FakeTutor({"questions": [{"id": "q3", "marks": 5, "feedback": "Good — you linked heat to dissolving."}],
                       "record": {"marks": 3.4, "feedback": "Readings are sensible."}, "overall": "Well done. Add units next time."})
    monkeypatch.setattr(wsx, "get_tutor_llm", lambda: tutor)
    client.post(f"{V}/my/{aid}/start", headers=users["ishaan"])
    db.execute("UPDATE public.virtual_lab_attempts SET active_seconds = 90 WHERE assignment_id = %s AND student_code = 'REG2026003'", (aid,))
    d = client.post(f"{V}/my/{aid}/submit", headers=users["ishaan"], json={**work, "answers": {"q1": 0, "q2": 1, "q3": "Heat is released."}}).json()
    res = d["attempt"]["result"]
    assert res["auto_score"] == 2 and res["feedback"]["engine"] == "fake-tutor"
    assert res["feedback"]["questions"] == [{"id": "q3", "marks": 2.0, "max": 2.0, "feedback": "Good — you linked heat to dissolving."}]  # clamped
    assert res["feedback"]["record"]["marks"] == 3.5 and res["suggested_marks"] == 2 + 2 + 3.5
    assert "Never invent readings" in tutor.calls[0]["system"] and "NH4Cl in water | 25 | 21" in tutor.calls[0]["messages"][0]["content"]

    # teacher: roster, attempt detail, review / return for redo
    t = client.get(f"{V}/assignments/{aid}", headers=users["priya"]).json()
    rows = {r["student_code"]: r for r in t["roster"]}
    assert rows["REG2026001"]["status"] == "submitted" and rows["REG2026003"]["suggested_marks"] == 7.5
    assert rows["REG2026004"]["status"] == "not_started" and t["stats"]["submitted"] == 2 and t["stats"]["students"] >= 4
    assert t["worksheet"]["questions"][0]["answer"] == 0                          # teacher sees answers
    listed = next(x for x in client.get(f"{V}/assignments", headers=users["priya"]).json()["assignments"] if x["assignment_id"] == aid)
    assert listed["submitted"] == 2 and listed["reviewed"] == 0 and listed["lab_name"].startswith("Change in temp")
    detail = client.get(f"{V}/assignments/{aid}/attempts/REG2026001", headers=users["priya"]).json()
    assert detail["attempt"]["answers"]["q3"].startswith("Because") and detail["max_marks"] == 8
    assert client.get(f"{V}/assignments/{aid}/attempts/REG2026004", headers=users["priya"]).status_code == 404
    rv = f"{V}/assignments/{aid}/attempts/REG2026001/review"
    assert client.post(rv, headers=users["priya"], json={"marks": 9}).status_code == 422
    assert client.post(rv, headers=users["priya"], json={"return_for_redo": True}).status_code == 422
    assert client.post(rv, headers=users["priya"], json={"return_for_redo": True, "feedback": "Add a third reading."}).status_code == 200
    back = client.get(f"{V}/my/{aid}", headers=users["rohan"]).json()["attempt"]
    assert back["status"] == "in_progress" and back["teacher_feedback"] == "Add a third reading." and back["returned_count"] == 1
    assert next(x for x in client.get(f"{V}/my", headers=users["rohan"]).json()["labs"] if x["assignment_id"] == aid)["my"]["returned"]
    monkeypatch.setattr(wsx, "get_tutor_llm", lambda: FakeTutor(RuntimeError("AI down")))
    again = client.post(f"{V}/my/{aid}/submit", headers=users["rohan"], json=work).json()["attempt"]
    assert again["status"] == "submitted" and again["result"]["feedback"]["engine"] == "offline-fallback"
    assert client.post(rv, headers=users["priya"], json={"marks": 6.5, "feedback": "Good work."}).json() == {"status": "reviewed", "marks": 6.5}
    final = client.get(f"{V}/my/{aid}", headers=users["rohan"]).json()["attempt"]
    assert final["status"] == "reviewed" and final["result"]["marks"] == 6.5 and final["teacher_feedback"] == "Good work."
    assert client.get(f"{V}/assignments/{aid}", headers=users["priya"]).json()["stats"]["average_pct"] == round(6.5 * 100 / 8, 1)

    # other teachers cannot see it; the lab detail shows where it is assigned
    assert client.get(f"{V}/assignments/{aid}", headers=users["kavya"]).status_code == 404
    lab = client.get(f"{V}/collections/{SCI10}/labs/{EXO}", headers=users["priya"]).json()
    assert any(x["assignment_id"] == aid for x in lab["assigned"])


def test_proctor_flag_count_is_visible_to_the_student_and_the_teacher(client, users, fake):
    aid = _assign(client, users, min_minutes=0).json()["assignment_id"]
    client.post(f"{V}/my/{aid}/start", headers=users["rohan"])

    assert client.post(f"{V}/my/{aid}/proctor-flag", headers=users["rohan"]).json() == {"flag_count": 1}
    assert client.post(f"{V}/my/{aid}/proctor-flag", headers=users["rohan"]).json() == {"flag_count": 2}
    assert client.get(f"{V}/my/{aid}", headers=users["rohan"]).json()["attempt"]["proctor_flag_count"] == 2

    # not started yet (Grade-10-A, but no attempt) -> 409; wrong class entirely -> 404
    assert client.post(f"{V}/my/{aid}/proctor-flag", headers=users["meera"]).status_code == 409
    assert client.post(f"{V}/my/{aid}/proctor-flag", headers=users["kabir"]).status_code == 404

    listed = next(x for x in client.get(f"{V}/assignments", headers=users["priya"]).json()["assignments"] if x["assignment_id"] == aid)
    assert listed["proctor_flags"] == 2
    roster = {r["student_code"]: r for r in client.get(f"{V}/assignments/{aid}", headers=users["priya"]).json()["roster"]}
    assert roster["REG2026001"]["proctor_flag_count"] == 2

    done = client.post(f"{V}/my/{aid}/submit", headers=users["rohan"], json={}).json()
    assert done["attempt"]["proctor_flag_count"] == 2
    assert client.post(f"{V}/my/{aid}/proctor-flag", headers=users["rohan"]).status_code == 409  # already submitted


def test_lab_windows_closing_and_deleting(client, users, fake):
    aid = _assign(client, users, lab_id=REACTIONS, available_from="2099-01-01T00:00:00Z").json()["assignment_id"]
    item = next(x for x in client.get(f"{V}/my", headers=users["meera"]).json()["labs"] if x["assignment_id"] == aid)
    assert item["window"]["state"] == "scheduled"
    assert client.post(f"{V}/my/{aid}/start", headers=users["meera"]).json()["detail"] == "This lab has not opened yet"
    client.patch(f"{V}/assignments/{aid}", headers=users["priya"], json={"status": "closed"})
    r = client.post(f"{V}/my/{aid}/start", headers=users["meera"])
    assert r.status_code == 409 and r.json()["detail"] == "Your teacher has closed this lab"

    aid2 = _assign(client, users, lab_id=METALS, allow_late=False, due_at="2099-01-01T00:00:00Z").json()["assignment_id"]
    assert client.post(f"{V}/my/{aid2}/start", headers=users["meera"]).status_code == 200
    db.execute("UPDATE public.virtual_lab_assignments SET due_at = NOW() - interval '1 day' WHERE assignment_id = %s", (aid2,))
    r = client.put(f"{V}/my/{aid2}/work", headers=users["meera"], json={})
    assert r.status_code == 409 and "late work is not accepted" in r.json()["detail"]
    client.patch(f"{V}/assignments/{aid2}", headers=users["priya"], json={"allow_late": True, "min_minutes": 0})
    done = client.post(f"{V}/my/{aid2}/submit", headers=users["meera"], json={}).json()["attempt"]
    assert done["status"] == "submitted" and done["is_late"] is True

    assert client.delete(f"{V}/assignments/{aid2}", headers=users["kavya"]).status_code == 404
    assert client.delete(f"{V}/assignments/{aid2}", headers=users["priya"]).status_code == 204
    assert client.get(f"{V}/my/{aid2}", headers=users["meera"]).status_code == 404


def test_lab_assistant_guards_worksheet_answers(client, users, fake, monkeypatch):
    aid = _assign(client, users).json()["assignment_id"]
    client.post(f"{V}/my/{aid}/start", headers=users["ananya"])
    tutor = FakeTutor("Think about whether the beaker feels warm or cold.")
    monkeypatch.setattr(wsx, "get_tutor_llm", lambda: tutor)
    r = client.post(f"{V}/my/{aid}/ask", headers=users["ananya"], json={
        "question": "Is dissolving NaOH exothermic?", "history": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "Hello!"}]})
    assert r.json() == {"answer": "Think about whether the beaker feels warm or cold.", "engine": "fake-tutor"}
    sent = tutor.calls[0]
    assert "do NOT answer them directly" in sent["system"] and "Why does the temperature rise?" in sent["system"]
    assert [m["role"] for m in sent["messages"]] == ["user", "assistant", "user"]
