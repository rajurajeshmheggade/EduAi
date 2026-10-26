"""Landing-page demo requests + super-admin lead inbox."""
from app.routers import public

P = "/api/v1/public/demo-requests"
LEAD = {"full_name": "Asha Rao", "email": "asha@greenvalley.edu", "phone": "+91 98450 00000",
        "institution_name": "Green Valley School", "institution_type": "school", "role": "Principal",
        "student_count": "300-1000", "interests": ["attendance", "ai_evaluation"], "consent": True}


def _login(client, ident, pw):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": pw})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_demo_request_flow(client, admin):
    public._hits.clear()
    assert client.post(P, json={**LEAD, "consent": False}).status_code == 422
    assert client.post(P, json={**LEAD, "email": "not-an-email"}).status_code == 422
    assert client.post(P, json={**LEAD, "interests": ["mining"]}).status_code == 422
    assert client.post(P, json=LEAD).status_code == 201
    assert client.post(P, json={**LEAD, "full_name": "Bot", "website": "http://spam"}).status_code == 201  # honeypot

    sa = _login(client, "superadmin", "superadmin")
    inbox = client.get("/ICMELive/api/v1/admin/demo-requests", headers=sa).json()
    names = [r["full_name"] for r in inbox["requests"]]
    assert "Asha Rao" in names and "Bot" not in names and inbox["counts"]["NEW"] >= 1
    rid = next(r["request_id"] for r in inbox["requests"] if r["full_name"] == "Asha Rao")
    upd = client.patch(f"/ICMELive/api/v1/admin/demo-requests/{rid}", headers=sa, json={"status": "CONTACTED", "notes": "Call Mon"})
    assert upd.status_code == 200 and upd.json()["status"] == "CONTACTED"
    assert client.get("/ICMELive/api/v1/admin/demo-requests", headers=admin).status_code == 403  # institution admin: no


def test_demo_request_rate_limit(client):
    public._hits.clear()
    codes = [client.post(P, json={**LEAD, "email": f"x{i}@a.io"}).status_code for i in range(7)]
    assert codes[:5] == [201] * 5 and codes[5] == 429
    public._hits.clear()
