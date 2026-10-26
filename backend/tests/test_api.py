import json
import time

import pytest

from scripts.sample_pdf import build_sample_textbook

BASE = "/ICMELive/api/v1"


def _upload(client, headers, subject, title, data=None):
    r = client.post(
        f"{BASE}/curriculum/upload-textbook",
        headers=headers,
        data={"title": title, "subject_code": subject, "year_code": "2026-27", "cycle_code": "Term-1", "class_code": "Grade-10-A"},
        files={"file": ("book.pdf", data or build_sample_textbook(), "application/pdf")},
    )
    return r


def _wait_job(client, headers, job_id, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        job = client.get(f"{BASE}/curriculum/jobs/{job_id}", headers=headers).json()
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(0.3)
    raise AssertionError("job timeout")


@pytest.fixture(scope="module")
def physics(client, teacher):
    r = _upload(client, teacher, "PHY101", "Foundations of Physics")
    assert r.status_code == 202, r.text
    body = r.json()
    job = _wait_job(client, teacher, body["job_id"])
    assert job["status"] == "completed", job.get("error")
    return {"textbook_id": body["textbook_id"], "job": job}


@pytest.fixture(scope="module")
def published_physics(client, teacher, physics):
    """Publishes the physics textbook (first use happens after the unpublished-gating test)."""
    p = client.post(f"{BASE}/curriculum/textbooks/{physics['textbook_id']}/publish", headers=teacher, json={"published": True})
    assert p.status_code == 200
    return physics


# ---------------------------------------------------------------- auth / RBAC
def test_health_reports_pgvector(client):
    r = client.get("/health").json()
    assert r["status"] == "ok" and r["pgvector"]


def test_login_returns_jwt_claims_and_home_route(client):
    r = client.post("/api/v1/auth/login", json={"email": "teacher@demo.edu", "password": "Passw0rd!"}).json()
    assert r["user"]["role"] == "teacher" and r["user"]["home_route"] == "/teacher/dashboard"
    assert "password_hash" not in json.dumps(r)
    import jwt as pyjwt

    claims = pyjwt.decode(r["access_token"], options={"verify_signature": False})
    assert {"user_id", "role", "org_code", "allowed_subjects"} <= claims.keys()
    assert claims["allowed_subjects"] == ["PHY101", "MATH-12"]


def test_bad_password_and_missing_token(client):
    assert client.post("/api/v1/auth/login", json={"email": "teacher@demo.edu", "password": "nope"}).status_code == 401
    assert client.get(f"{BASE}/curriculum/textbooks/PHY101").status_code == 401


def test_refresh_token(client):
    login = client.post("/api/v1/auth/login", json={"email": "student@demo.edu", "password": "Passw0rd!"}).json()
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert r.status_code == 200 and r.json()["user"]["role"] == "student"
    # an access token must not work as a refresh token
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": login["access_token"]}).status_code == 401


def test_student_cannot_upload_and_admin_cannot_upload(client, student, admin):
    assert _upload(client, student, "PHY101", "Test book").status_code == 403
    assert _upload(client, admin, "PHY101", "Test book").status_code == 403


def test_teacher_subject_scope_enforced(client, teacher):
    assert _upload(client, teacher, "CHEM-99", "Test book").status_code == 403


def test_upload_rejects_non_pdf(client, teacher):
    r = _upload(client, teacher, "PHY101", "bad", data=b"not a pdf at all")
    assert r.status_code == 415


# ---------------------------------------------------------------- vectorization
def test_vectorization_indexes_chunks_with_metadata(client, teacher, physics):
    job = physics["job"]
    assert job["detail"]["chunks"] >= 4 and job["progress"] == 100
    r = client.get(f"{BASE}/curriculum/textbooks/PHY101", headers=teacher).json()
    tb = next(t for t in r["textbooks"] if t["textbook_id"] == physics["textbook_id"])
    assert tb["vector_status"] == "indexed" and tb["total_pages"] >= 5
    assert [c["chapter_title"] for c in tb["chapters"]] == [
        "Motion", "Force and Laws of Motion", "Gravitation", "Work, Energy and Power"]
    assert tb["pdf_url"].startswith("http")


def test_signed_pdf_url_serves_pdf(client, teacher, physics):
    tb = client.get(f"{BASE}/curriculum/textbooks/PHY101", headers=teacher).json()["textbooks"][0]
    path = "/files/" + tb["pdf_url"].rsplit("/files/", 1)[1]
    r = client.get(path)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert client.get("/files/tampered.token.value").status_code == 403


def test_corrupt_pdf_marks_job_failed(client, teacher):
    r = _upload(client, teacher, "PHY101", "Broken", data=b"%PDF-1.4 this is not really a pdf")
    assert r.status_code == 202
    job = _wait_job(client, teacher, r.json()["job_id"])
    assert job["status"] == "failed" and job["error"]
    tbs = client.get(f"{BASE}/curriculum/textbooks/PHY101", headers=teacher).json()["textbooks"]
    assert next(t for t in tbs if t["textbook_id"] == r.json()["textbook_id"])["vector_status"] == "failed"


# ---------------------------------------------------------------- publish gating
def test_student_sees_nothing_until_published(client, teacher, student, physics):
    assert client.get(f"{BASE}/curriculum/textbooks/PHY101", headers=student).json()["textbooks"] == []
    q = {"query": "What is Newton's second law?", "subject_code": "PHY101", "stream": False}
    r = client.post(f"{BASE}/rag/query", headers=student, json=q).json()
    assert r["citations"] == []  # unpublished content is never retrievable by students

    published = client.post(f"{BASE}/curriculum/textbooks/{physics['textbook_id']}/publish", headers=teacher, json={"published": True})
    assert published.status_code == 200
    ids = [t["textbook_id"] for t in client.get(f"{BASE}/curriculum/textbooks/PHY101", headers=student).json()["textbooks"]]
    assert ids == [physics["textbook_id"]]


def test_cannot_publish_unindexed(client, teacher):
    r = _upload(client, teacher, "PHY101", "Broken2", data=b"%PDF-1.4 junk")
    _wait_job(client, teacher, r.json()["job_id"])
    p = client.post(f"{BASE}/curriculum/textbooks/{r.json()['textbook_id']}/publish", headers=teacher, json={"published": True})
    assert p.status_code == 409


# ---------------------------------------------------------------- k=3 RAG
def test_rag_returns_exactly_k3_grounded_with_citations(client, student, published_physics):
    physics = published_physics
    q = {"query": "What does Newton's second law say about force, mass and acceleration?",
         "subject_code": "PHY101", "textbook_id": physics["textbook_id"], "stream": False}
    r = client.post(f"{BASE}/rag/query", headers=student, json=q)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["k"] == 3 and len(body["citations"]) == 3
    assert all(c["textbook_id"] == physics["textbook_id"] for c in body["citations"])
    sims = [c["similarity"] for c in body["citations"]]
    assert sims == sorted(sims, reverse=True)
    top = body["citations"][0]
    assert top["chapter_title"] == "Force and Laws of Motion"  # semantically closest chunk ranks first
    assert f"[Page {top['page_number']}]" in body["answer"]


def test_rag_client_cannot_override_k(client, student, published_physics):
    q = {"query": "What is acceleration?", "subject_code": "PHY101", "stream": False, "k": 10, "top_k": 10}
    assert len(client.post(f"{BASE}/rag/query", headers=student, json=q).json()["citations"]) == 3


def test_rag_sse_stream_and_history(client, student, published_physics):
    q = {"query": "Explain the law of conservation of energy", "subject_code": "PHY101", "current_page": 5}
    with client.stream("POST", f"{BASE}/rag/query", headers=student, json=q) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        raw = "".join(r.iter_text())
    events = [e for e in raw.split("\n\n") if e.strip()]
    assert events[0].startswith("event: meta") and events[-1].startswith("event: done")
    meta = json.loads(events[0].split("data: ", 1)[1])
    assert len(meta["citations"]) == 3
    text = "".join(json.loads(e.split("data: ", 1)[1])["text"] for e in events if e.startswith("event: token"))
    assert "energy" in text.lower()

    hist = client.get(f"{BASE}/rag/history/{meta['session_id']}", headers=student).json()["messages"]
    assert len(hist) == 1 and len(hist[0]["retrieved_pages"]) == 3


def test_rag_subject_authorisation(client, student_phy_only):
    q = {"query": "anything about algebra", "subject_code": "MATH-12", "stream": False}
    assert client.post(f"{BASE}/rag/query", headers=student_phy_only, json=q).status_code == 403


def test_rag_is_scoped_to_subject(client, teacher, student, published_physics):
    physics = published_physics
    r = _upload(client, teacher, "MATH-12", "Maths Book")
    assert _wait_job(client, teacher, r.json()["job_id"])["status"] == "completed"
    client.post(f"{BASE}/curriculum/textbooks/{r.json()['textbook_id']}/publish", headers=teacher, json={"published": True})
    q = {"query": "Newton's second law force acceleration", "subject_code": "PHY101", "stream": False}
    cites = client.post(f"{BASE}/rag/query", headers=student, json=q).json()["citations"]
    assert cites and all(c["textbook_id"] == physics["textbook_id"] for c in cites)


def test_rag_validation_and_rbac(client, student, admin):
    assert client.post(f"{BASE}/rag/query", headers=student, json={"query": "x", "subject_code": "PHY101"}).status_code == 422
    q = {"query": "valid question", "subject_code": "PHY101", "stream": False}
    assert client.post(f"{BASE}/rag/query", headers=admin, json=q).status_code == 403


def test_voice_transcription_unavailable_in_mock_mode(client, student):
    r = client.post("/ICMELive/transcribe-audio", headers=student, files={"audio": ("a.webm", b"123", "audio/webm")})
    assert r.status_code == 501


# ---------------------------------------------------------------- k=3 stored procedure (FRD 6.3)
def test_usp_match_four_arg_signature(published_physics):
    from app import db
    from app.providers import get_embedder

    emb = db.vec_literal(get_embedder().embed(["gravitation universal law"])[0])
    rows = db.call_rows("usp_match_textbook_chunks_k3", "PHY101", None, emb, 3, casts=[None, "uuid", "vector", None])
    assert len(rows) <= 3  # only published books are returned by default
    assert all(float(r["similarity"]) <= 1.0 for r in rows)


# ---------------------------------------------------------------- How-to-Teach
def test_generate_edit_export_teaching_guide(client, teacher, student, physics):
    body = {"textbook_id": physics["textbook_id"], "chapter_number": 2, "duration_minutes": 45, "institution_level": "college"}
    assert client.post(f"{BASE}/curriculum/generate-teaching-guide", headers=student, json=body).status_code == 403
    r = client.post(f"{BASE}/curriculum/generate-teaching-guide", headers=teacher, json=body)
    assert r.status_code == 200, r.text
    g = r.json()
    assert g["chapter_title"] == "Force and Laws of Motion" and g["institution_level"] == "college"
    assert g["lesson_plan_markdown"] and g["analogies_and_hooks"]["opening_hook"]
    assert g["board_work_blueprint"] and g["common_misconceptions"]
    assert 3 <= len(g["formative_questions"]) <= 5

    u = client.put(f"{BASE}/curriculum/guides/{g['guide_id']}", headers=teacher, json={"lesson_plan_markdown": "# Edited plan"})
    assert u.json()["lesson_plan_markdown"] == "# Edited plan"
    assert u.json()["common_misconceptions"] == g["common_misconceptions"]  # untouched sections preserved

    pdf = client.get(f"{BASE}/curriculum/guides/{g['guide_id']}/export.pdf", headers=teacher)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    listed = client.get(f"{BASE}/curriculum/guides/{physics['textbook_id']}", headers=teacher).json()["guides"]
    assert any(x["guide_id"] == g["guide_id"] for x in listed)


def test_guide_validation(client, teacher, physics):
    bad_duration = {"textbook_id": physics["textbook_id"], "chapter_number": 2, "duration_minutes": 50}
    assert client.post(f"{BASE}/curriculum/generate-teaching-guide", headers=teacher, json=bad_duration).status_code == 422
    missing = {"textbook_id": physics["textbook_id"], "chapter_number": 99, "duration_minutes": 45}
    assert client.post(f"{BASE}/curriculum/generate-teaching-guide", headers=teacher, json=missing).status_code == 404
