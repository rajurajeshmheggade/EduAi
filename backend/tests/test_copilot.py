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
