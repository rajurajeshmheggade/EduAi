"""Lesson Plan (7-step creator, repository, AI Bot assistant) + Session Plan (sessions, agents, resource library)."""
import httpx
import pytest

LP = "/ICMELive/api/v1/lessonplan"
SP = "/ICMELive/api/v1/lessonplan/sessions"
CTX = {"board": "CBSE", "grade": "Grade 10 — Section A", "subject": "Physics", "chapter": "Light — Reflection",
       "class_code": "Grade-10-A", "subject_code": "PHY101"}


@pytest.fixture(scope="module")
def built_plan(client, teacher):
    """Walk the creator exactly as the UI does and save a completed plan."""
    cos = client.post(f"{LP}/course-outcomes", json={**CTX, "co_count": 3}, headers=teacher)
    assert cos.status_code == 200, cos.text
    course_outcomes = cos.json()["course_outcomes"]
    assert len(course_outcomes) == 3 and course_outcomes[0]["co_id"] == "CO1"

    sk = client.post(f"{LP}/skills-per-co", json={**CTX, "total_outcomes": 3, "course_outcomes": course_outcomes},
                     headers=teacher).json()
    assert all(len(c["skills"]) == 2 for c in sk["course_outcomes"])
    cp = client.post(f"{LP}/competencies-per-co", json={**CTX, "course_outcomes": sk["course_outcomes"]},
                     headers=teacher).json()
    assert all(len(c["competencies"]) == 2 for c in cp["course_outcomes"])

    elos = client.post(f"{LP}/elos", json={**CTX, "course_outcomes": cp["course_outcomes"],
                                           "blooms_elo_counts": {"Apply": 2, "Analyse": 1},
                                           "skills": ["Observation"], "competencies": ["Critical Thinking"],
                                           "attitudes": ["Respect"]}, headers=teacher)
    assert elos.status_code == 200, elos.text
    flat = [e for co in elos.json() for e in co["elos"]]
    assert len(flat) == 3 and {e["Elo_id"] for e in flat} == {"Elo-1", "Elo-2", "Elo-3"}

    items = client.post(f"{LP}/assessment-items", json={**CTX, "topic": CTX["chapter"], "elo": flat[0]["elo"],
                                                        "assessment_details": [{"itemType": "MCQ", "noOfItems": 2,
                                                                                "bloomsLevel": "Apply"}]},
                        headers=teacher).json()
    assert len(items["0"]["assessment"]) == 2

    block = client.post(f"{LP}/five-e-resource", json={**CTX, "elo": flat[0]["elo"], "phase": "Explore",
                                                       "resource": "Experiments", "est_time": "10"}, headers=teacher).json()
    assert block["block"]["title"] and block["block"]["body"]

    plan = {"grade": CTX["grade"], "subject": "Physics", "topic": CTX["chapter"], "duration": "90",
            "coreObjectives": [{"text": c["co_description"], "factor": c["factor"]} for c in course_outcomes],
            "elos": [{"id": e["Elo_id"], "text": e["elo"]} for e in flat],
            "assessment": [{"id": e["Elo_id"], "name": f"ELO {i + 1}", "fullText": e["elo"], "bloomLevel": e["bloom_level"],
                            "items": items["0"]["assessment"] if i == 0 else []} for i, e in enumerate(flat)],
            "fiveEDesign": {"eloSteps": [], "generatedContentData": {}}}
    saved = client.post(f"{LP}/save-unit-plan", json={"classCode": "Grade-10-A", "className": "Grade 10 — Section A",
                                                      "subjectCode": "PHY101", "subjectName": "Physics",
                                                      "chapterName": CTX["chapter"], "unitPlanTitle": CTX["chapter"],
                                                      "board": "CBSE", "durationMins": 90, "plan": plan,
                                                      "isCompleted": True, "source": "manual"}, headers=teacher)
    assert saved.status_code == 200, saved.text
    return {"id": saved.json()["id"], "elos": flat}


def test_scope_lists_only_own_classes(client, teacher):
    r = client.get(f"{LP}/scope", headers=teacher).json()
    codes = {c["class_code"]: [s["subject_code"] for s in c["subjects"]] for c in r["classes"]}
    assert set(codes["Grade-10-A"]) == {"PHY101", "MATH-12"}     # class teacher → every subject
    assert codes["Grade-9-B"] == ["PHY101"]                       # subject teacher → only Physics
    assert "CBSE" in r["boards"]


def test_generation_is_scope_guarded(client, teacher):
    r = client.post(f"{LP}/course-outcomes", json={**CTX, "class_code": "Grade-9-B", "subject_code": "ENG-9"},
                    headers=teacher)
    assert r.status_code == 403
    by_name = client.post(f"{LP}/course-outcomes", json={"grade": "Grade 9 — Section B", "subject": "English",
                                                         "chapter": "Poem"}, headers=teacher)
    assert by_name.status_code == 403


def test_regenerate_and_pedagogy(client, teacher):
    co = client.post(f"{LP}/regenerate-course-outcome", json={**CTX, "course_outcome": "Students will x",
                                                              "co_title": "T", "factor": "Problem Solving",
                                                              "additional_instructions": "simpler"}, headers=teacher)
    assert co.json()["course_outcome"]["co_description"].startswith("Students will")
    elo = client.post(f"{LP}/regenerate-elo", json={**CTX, "elo": "Students will a", "bloom_level": "Apply"},
                      headers=teacher)
    assert elo.json()["elo"].startswith("Students will")
    ped = client.post(f"{LP}/pedagogical-approaches", json={**CTX, "elos": ["e1", "e2"]}, headers=teacher).json()
    assert len(ped["approaches"]) == 4
    asg = client.post(f"{LP}/assignments", json={**CTX, "elos": ["e1"]}, headers=teacher).json()
    assert len(asg["assignments"]) == 3


def test_repository_crud_and_ownership(client, teacher, built_plan):
    plans = client.get(f"{LP}/plans", headers=teacher).json()["plans"]
    row = next(p for p in plans if p["id"] == built_plan["id"])
    assert row["isCompleted"] and row["sessionCount"] == 0 and row["plan"]["topic"] == CTX["chapter"]
    # Another teacher cannot see or delete it.
    other = client.post("/api/v1/auth/login", json={"email": "kavya@demo.edu", "password": "Passw0rd!"}).json()
    oh = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get(f"{LP}/plans/{built_plan['id']}", headers=oh).status_code == 404
    assert client.delete(f"{LP}/plans/{built_plan['id']}", headers=oh).status_code == 404
    # Draft save + update in place.
    d = client.post(f"{LP}/save-unit-plan", json={"classCode": "Grade-10-A", "subjectCode": "MATH-12",
                                                  "className": "Grade 10 — Section A", "subjectName": "Mathematics",
                                                  "chapterName": "Quadratics", "unitPlanTitle": "Quadratics",
                                                  "plan": {"__creatorState": {"current": 2}}, "isCompleted": False},
                    headers=teacher).json()
    u = client.post(f"{LP}/save-unit-plan", json={"id": d["id"], "classCode": "Grade-10-A", "subjectCode": "MATH-12",
                                                  "unitPlanTitle": "Quadratic Equations", "plan": {}, "isCompleted": False},
                    headers=teacher)
    assert u.status_code == 200 and u.json()["id"] == d["id"]
    got = client.get(f"{LP}/plans/{d['id']}", headers=teacher).json()["plan"]
    assert got["title"] == "Quadratic Equations" and got["isCompleted"] is False
    assert client.delete(f"{LP}/plans/{d['id']}", headers=teacher).status_code == 200
    assert client.get(f"{LP}/plans/{d['id']}", headers=teacher).status_code == 404
    # Saving into a class/subject the teacher is not assigned to is refused.
    assert client.post(f"{LP}/save-unit-plan", json={"classCode": "Grade-9-B", "subjectCode": "ENG-9", "plan": {}},
                       headers=teacher).status_code == 403


def test_sessions_full_cycle(client, teacher, built_plan):
    pid = built_plan["id"]
    elos = client.post(f"{SP}/elos", json={"lessonPlanId": pid}, headers=teacher).json()
    assert elos["count"] == 3 and elos["status"] == "S001" and elos["elos"][0]["bloomLevel"]
    assert client.post(f"{SP}/list", json={"lessonPlanId": pid}, headers=teacher).json()["total"] == 0

    stages = [{"stage": "Opening", "sortOrder": 0, "classSetting": "Whole Class", "durationMins": 10,
               "description": "<p>Hook</p>",
               "resources": [{"resourceId": "", "sourceKind": "resource", "title": "Mirror demo video",
                              "resourceType": "Video", "url": "https://example.org/v"}]},
              {"stage": "Wrap Up", "sortOrder": 4, "classSetting": "Pair", "durationMins": 5, "description": "",
               "resources": []}]
    gen = client.post(f"{SP}/generate", json={"lessonPlanId": pid, "title": "Intro to reflection", "durationMins": 40,
                                              "instructions": "Use the mirror", "elos": [elos["elos"][0]["elo"], "smuggled"],
                                              "stages": stages, "includeAgents": False, "save": True}, headers=teacher)
    assert gen.status_code == 200, gen.text
    g = gen.json()
    assert g["id"] and g["content"]["stages"][0]["resources"][0]["title"] == "Mirror demo video"
    assert [e["elo"] for e in g["content"]["learningOutcomes"]] == [elos["elos"][0]["elo"]]   # intersected

    one = client.post(f"{SP}/get", json={"id": g["id"]}, headers=teacher).json()["session"]
    assert one["sessionNo"] == 1 and one["status"] == "completed" and one["resourceCount"] == 1
    assert [s["stage"] for s in one["stages"]] == ["Opening", "Wrap Up"]
    assert client.get(f"{LP}/plans/{pid}", headers=teacher).json()["plan"]["sessionCount"] == 1

    # Duplicate session number → 409; stale rowVersion → 409; fresh update ok.
    dup = client.post(f"{SP}/save", json={"lessonPlanId": pid, "title": "Other", "sessionNo": 1, "stages": []},
                      headers=teacher)
    assert dup.status_code == 409
    upd = client.post(f"{SP}/save", json={"lessonPlanId": pid, "id": g["id"], "rowVersion": one["rowVersion"],
                                          "title": "Intro to reflection (edited)", "status": "completed",
                                          "stages": stages}, headers=teacher)
    assert upd.status_code == 200 and upd.json()["rowVersion"] == one["rowVersion"] + 1
    stale = client.post(f"{SP}/save", json={"lessonPlanId": pid, "id": g["id"], "rowVersion": one["rowVersion"],
                                            "title": "x", "stages": []}, headers=teacher)
    assert stale.status_code == 409

    listed = client.post(f"{SP}/list", json={"lessonPlanId": pid, "search": "edited"}, headers=teacher).json()
    assert listed["total"] == 1 and listed["sessions"][0]["stages"][0]["resources"]
    assert client.post(f"{SP}/delete", json={"id": g["id"]}, headers=teacher).status_code == 200
    assert client.post(f"{SP}/get", json={"id": g["id"]}, headers=teacher).status_code == 404
    # A soft delete frees the number again.
    again = client.post(f"{SP}/save", json={"lessonPlanId": pid, "title": "Again", "stages": []}, headers=teacher).json()
    assert again["sessionNo"] == 1


def test_generate_splices_agent_blocks(client, teacher, built_plan, monkeypatch):
    from app.services.lesson_plan import agents

    def fake_run_all(grade, subject, topic):
        assert topic == CTX["chapter"]
        return ({"images": [{"title": "Plane mirror", "url": "https://x/y.png"}], "currentAffairs": [],
                 "educationalVideos": [], "educationalDocuments": []},
                {"images": {"status": "ok", "provider": "serpapi", "count": 1, "message": None},
                 "currentAffairs": {"status": "empty", "provider": "serpapi", "count": 0, "message": None}})

    monkeypatch.setattr(agents, "run_all", fake_run_all)
    r = client.post(f"{SP}/generate", json={"lessonPlanId": built_plan["id"], "title": "Agents", "durationMins": 30,
                                            "stages": [], "save": False}, headers=teacher).json()
    assert r["content"]["additionalSections"]["images"][0]["title"] == "Plane mirror"
    assert r["agents"]["images"]["provider"] == "serpapi" and r["id"] is None


def test_resource_library(client, teacher):
    from app import db

    org = db.fetch_one("SELECT org_code FROM public.app_users WHERE email = 'teacher@demo.edu'")["org_code"]
    db.execute("INSERT INTO public.homeworks(org_code, class_code, subject_code, title, instructions, due_date, assigned_by) "
               "VALUES (%s,'Grade-10-A','PHY101','Mirror hunt','Find 3 mirrors at home', CURRENT_DATE + 3, 'EMP1001')", (org,))
    lib = client.get(f"{SP}/resource-library", params={"classCode": "Grade-10-A", "subjectCode": "PHY101",
                                                       "assetType": "Activities"}, headers=teacher).json()
    hw = [x for g in lib["groups"] for x in g["items"] if x["sourceKind"] == "activity"]
    assert hw, "seeded homework shows under Activities"
    content = client.get(f"{SP}/resource-content", params={"sourceKind": "activity", "resourceId": hw[0]["resourceId"]},
                         headers=teacher).json()
    assert content["mode"] == "activity" and content["title"] == hw[0]["title"]

    add = client.post(f"{SP}/resources", data={"classCode": "Grade-10-A", "subjectCode": "PHY101", "title": "Ray diagram",
                                               "resourceType": "Video", "url": "https://example.org/rays"},
                      headers=teacher)
    assert add.status_code == 201, add.text
    vids = client.get(f"{SP}/resource-library", params={"classCode": "Grade-10-A", "subjectCode": "PHY101",
                                                        "assetType": "Video Catalogue"}, headers=teacher).json()
    assert vids["counts"]["Video Catalogue"] >= 1 and any(x["title"] == "Ray diagram" for g in vids["groups"] for x in g["items"])
    up = client.post(f"{SP}/resources", data={"classCode": "Grade-10-A", "subjectCode": "PHY101", "title": "Worksheet",
                                              "resourceType": "Document"},
                     files={"file": ("ws.txt", b"Q1 ...", "text/plain")}, headers=teacher)
    assert up.status_code == 201
    assert client.delete(f"{SP}/resources/{add.json()['resourceId']}", headers=teacher).status_code == 200
    # Not assigned → 403
    assert client.get(f"{SP}/resource-library", params={"classCode": "Grade-9-B", "subjectCode": "ENG-9"},
                      headers=teacher).status_code == 403
    assert client.get(f"{SP}/resource-content", params={"sourceKind": "test", "resourceId": "nope"},
                      headers=teacher).json()["mode"] == "error"


def test_extract_text_and_student_forbidden(client, teacher, student):
    r = client.post(f"{LP}/extract-text", files={"file": ("notes.txt", b"Refraction bends light.", "text/plain")},
                    headers=teacher)
    assert r.status_code == 200 and "Refraction" in r.json()["text"]
    assert client.get(f"{LP}/plans", headers=student).status_code == 403
    assert client.post(f"{SP}/list", json={"lessonPlanId": "x"}, headers=student).status_code == 403


def test_assistant_collects_inputs_then_starts_pipeline(client, teacher):
    msgs = [{"role": "assistant", "content": "Which class?"}, {"role": "user", "content": "Grade 10 — Section A"},
            {"role": "user", "content": "Physics"}]
    r = client.post(f"{LP}/assistant/chat", json={"messages": msgs}, headers=teacher).json()["response"]
    assert r.startswith("[LIST_CHAPTERS]")
    ctx = {"chaptersLoaded": True, "label": "Grade 10 · Physics", "chapters": ["Light — Reflection"]}
    for answer in ["Light — Reflection", "3", "1 hour 30 minutes", "Apply: 2, Analyse: 1"]:
        msgs.append({"role": "user", "content": answer})
    summary = client.post(f"{LP}/assistant/chat", json={"messages": msgs, "context": ctx}, headers=teacher).json()["response"]
    assert "Shall I go ahead" in summary
    msgs += [{"role": "assistant", "content": summary}, {"role": "user", "content": "Yes"}]
    start = client.post(f"{LP}/assistant/chat", json={"messages": msgs, "context": ctx}, headers=teacher).json()["response"]
    assert start.startswith("[START_LESSON_PIPELINE]") and '"Apply": 2' in start
    mix = client.post(f"{LP}/assistant/assessment-mix", json={"text": "5 mcq and 3 short answer"}, headers=teacher).json()
    assert mix["assessment_requirements"]["mcq"] == 5 and mix["assessment_requirements"]["short_answer"] == 3


# ─────────────────────────────────────────────────────────────── content agents (HTTP stubbed)
def _resp(url: str, payload: dict, code: int = 200) -> httpx.Response:
    return httpx.Response(code, json=payload, request=httpx.Request("GET", url))


def test_agents_chain_serpapi_youtube_and_fallbacks(monkeypatch):
    from app.config import get_settings
    from app.services.lesson_plan import agents

    s = get_settings()
    monkeypatch.setattr(s, "serpapi_api_key", "test-serp")
    monkeypatch.setattr(s, "youtube_api_key", "test-yt")
    monkeypatch.setattr(s, "session_agents_cache_minutes", 0)
    calls: list[str] = []

    def fake_get(self, url, deadline, ua=agents.BROWSER_UA):
        calls.append(url)
        if "googleapis.com/youtube" in url:
            assert "NCERT" in url and "-exercise" in url
            return _resp(url, {"items": [{"id": {"videoId": "abcdefghijk"}, "snippet": {
                "title": "Reflection of light", "channelTitle": "Edu", "publishedAt": "2026-01-02T00:00:00Z",
                "thumbnails": {"high": {"url": "http://i.ytimg.com/x.jpg"}}}}]})
        if "engine=google_images" in url:
            return _resp(url, {"images_results": [{"original": "http://img/a.png", "title": "Mirror", "source": "s"}]})
        if "engine=google_news" in url:
            return _resp(url, {"error": "Google hasn't returned any results for this query."})
        if "wikinews" in url:
            return _resp(url, {"query": {"pages": [{"title": "Solar eclipse seen", "fullurl": "https://en.wikinews.org/a",
                                                    "extract": "Tuesday, April 26, 2025 A rare event…"}]}})
        if "engine=google&" in url:
            assert "filetype%3Apdf" in url
            return _resp(url, {"organic_results": [
                {"link": "https://ncert.nic.in/textbook/pdf/jesc110.pdf", "title": "Light — NCERT"},
                {"link": "https://signup.example.com/landing", "title": "Not a doc"}]})
        return _resp(url, {}, 404)

    monkeypatch.setattr(agents.SessionContentAgents, "_get", fake_get)
    content, status = agents.run_all("Grade 10 — Section A", "Physics", "Light — Reflection")
    assert status["educationalVideos"]["provider"] == "youtube-data-api"
    v = content["educationalVideos"][0]
    assert v["videoId"] == "abcdefghijk" and v["thumbnail"].startswith("https://")
    assert status["images"]["provider"] == "serpapi" and content["images"][0]["url"] == "https://img/a.png"
    # google_news said "no results" (an honest empty) → Wikinews answers behind it.
    assert status["currentAffairs"]["provider"] == "wikinews" and content["currentAffairs"][0]["date"] == "2025-04-26"
    docs = content["educationalDocuments"]
    assert len(docs) == 1 and docs[0]["source"].startswith("PDF · ncert.nic.in")


def test_agents_not_configured_and_query_pinning(monkeypatch):
    from app.config import get_settings
    from app.services.lesson_plan import agents

    s = get_settings()
    monkeypatch.setattr(s, "serpapi_api_key", "")
    monkeypatch.setattr(s, "youtube_api_key", "")
    res = agents.SessionContentAgents().run(agents.DOCUMENTS, "VI", "Maths", "Fractions", 5)
    assert res.status == "not_configured"
    assert agents.build_query(agents.IMAGES, "Class VI", "Maths", "Fractions").startswith("NCERT Class 6 Maths Fractions")
    assert agents.grade_number("Grade 10 — Section A") == 10
    ranked = agents.rank_by_recency([agents.AgentItem("old", "u", date="2015-01-01"),
                                     agents.AgentItem("new", "u", date="2099-01-01")], 5)
    assert ranked[0].title == "new"
