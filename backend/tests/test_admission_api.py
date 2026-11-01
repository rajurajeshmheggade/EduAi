"""Pravesh Milestone 1 API: principal / counsellor / parent flows on top of row-level security (seeded data)."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

A = "/ICMELive/api/v1/admission"
NS = uuid.UUID("6a1f0f3e-5b2a-4d0e-9a51-7a6f3f0c2b11")


def sid(*parts):
    return str(uuid.uuid5(NS, "/".join(parts)))


AARAV, DIYA, AYAAN = sid("DEMO-SCHOOL", "applicant", "Aarav Verma"), sid("DEMO-SCHOOL", "applicant", "Diya Verma"), sid("DEMO-SCHOOL", "applicant", "Ayaan Irfan")


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]


@pytest.fixture(scope="module")
def h(client):
    out = {}
    for k, e in [("demo", "admin@demo.edu"), ("svm", "principal@svm.edu"), ("kps", "principal@kps.edu"),
                 ("counsellor", "counsellor@demo.edu"), ("reviewer", "reviewer@demo.edu"), ("sunita", "parent@demo.edu"),
                 ("irfan", "irfan@demo.edu"), ("lakshmi", "parent@svm.edu"), ("teacher", "teacher@demo.edu")]:
        out[k], _ = _login(client, e)
    out["super"], _ = _login(client, "superadmin", "superadmin")
    return out


def test_new_roles_land_on_their_home(client):
    for email, home in [("counsellor@demo.edu", "/admissions/counsellor"), ("reviewer@demo.edu", "/admissions/reviewer"),
                        ("parent@demo.edu", "/parent")]:
        _, user = _login(client, email)
        assert user["home_route"] == home


def test_principal_sees_only_own_school(client, h):
    demo = client.get(f"{A}/overview", headers=h["demo"]).json()
    svm = client.get(f"{A}/overview", headers=h["svm"]).json()
    assert demo["applicants"]["total"] == 8 and svm["applicants"]["total"] == 3
    assert {g["grade"] for g in demo["applicants"]["by_grade"]} == {6, 7, 8, 9, 10, 11, 12}
    names = {a["full_name"] for a in client.get(f"{A}/applicants", headers=h["svm"]).json()["applicants"]}
    assert names == {"Karthik Iyer", "Nandini Raghavan", "Pranav Srinivasan"}
    # the platform owner picks a school explicitly
    kps = client.get(f"{A}/applicants", headers=h["super"], params={"org_code": "KPS-STATE"}).json()["applicants"]
    assert {a["full_name"] for a in kps} == {"Ananya Gowda", "Rakesh Hegde"}
    assert demo["consent_version"] == {"version": 1, "languages": ["en", "hi", "kn", "ta"]}


def test_role_access_rules(client, h):
    assert client.get(f"{A}/overview", headers=h["counsellor"]).status_code == 200
    assert client.get(f"{A}/applicants", headers=h["reviewer"]).status_code == 200
    for path in ("/team", "/audit", "/retention", "/breaches", "/consent-versions"):
        assert client.get(A + path, headers=h["counsellor"]).status_code == 403, path
    for path in ("/overview", "/applicants", "/audit"):
        assert client.get(A + path, headers=h["sunita"]).status_code == 403, path
    assert client.get(f"{A}/parent/home", headers=h["demo"]).status_code == 403
    assert client.get(f"{A}/overview", headers=h["teacher"]).status_code == 403


def test_parent_home_consent_flow_and_family_isolation(client, h):
    home = client.get(f"{A}/parent/home", headers=h["sunita"]).json()
    kids = {c["full_name"]: c for c in home["children"]}
    assert set(kids) == {"Aarav Verma", "Diya Verma"} and home["guardian"]["preferred_language"] == "hi"
    assert kids["Aarav Verma"]["consent"]["decision"] == "granted" and kids["Aarav Verma"]["consent"]["current"]
    assert kids["Diya Verma"]["consent"] is None and home["consent_languages"] == ["en", "hi", "kn", "ta"]

    text = client.get(f"{A}/parent/consent", headers=h["sunita"], params={"applicant_id": DIYA, "lang": "ta"}).json()
    assert text["language"] == "ta" and text["draft_translation"] and "Demo International School" in text["body"]
    assert client.get(f"{A}/parent/consent", headers=h["sunita"], params={"applicant_id": AYAAN}).status_code == 404

    body = {"applicant_id": DIYA, "version_id": text["version_id"], "decision": "granted"}
    assert client.post(f"{A}/parent/consents", headers=h["sunita"], json=body).status_code == 422   # must tick the box
    r = client.post(f"{A}/parent/consents", headers=h["sunita"], json={**body, "confirm": True})
    assert r.status_code == 201 and r.json()["version"] == 1
    # another family's child: refused (and the database would refuse it too)
    assert client.post(f"{A}/parent/consents", headers=h["sunita"], json={**body, "applicant_id": AYAAN, "confirm": True}).status_code == 404
    # withdrawal is a new record; latest decision wins
    assert client.post(f"{A}/parent/consents", headers=h["sunita"], json={**body, "decision": "withdrawn"}).status_code == 201
    kids = {c["full_name"]: c for c in client.get(f"{A}/parent/home", headers=h["sunita"]).json()["children"]}
    assert kids["Diya Verma"]["consent"]["decision"] == "withdrawn"
    # other parents never see Sunita's children
    assert {c["full_name"] for c in client.get(f"{A}/parent/home", headers=h["irfan"]).json()["children"]} == {"Ayaan Irfan"}
    assert {c["full_name"] for c in client.get(f"{A}/parent/home", headers=h["lakshmi"]).json()["children"]} == {"Karthik Iyer"}

    audit = client.get(f"{A}/audit", headers=h["demo"], params={"entity": "applicant"}).json()["entries"]
    actions = [e["action"] for e in audit if e["entity_id"] == DIYA]
    assert actions[:2] == ["consent.withdrawn", "consent.granted"]
    assert all("Diya" not in str(e["details"]) for e in audit)                  # no personal data in the audit trail
    assert not any(e["entity_id"] == DIYA for e in client.get(f"{A}/audit", headers=h["svm"]).json()["entries"])


def test_parent_language_and_requests(client, h):
    assert client.put(f"{A}/parent/language", headers=h["irfan"], json={"language": "kn"}).json() == {"language": "kn"}
    assert client.get(f"{A}/parent/home", headers=h["irfan"]).json()["guardian"]["preferred_language"] == "kn"
    assert client.get(f"{A}/parent/home", headers=h["sunita"]).json()["guardian"]["preferred_language"] == "hi"   # untouched

    r = client.post(f"{A}/parent/requests", headers=h["irfan"], json={"kind": "erasure", "applicant_id": AYAAN, "details": "Please delete"})
    assert r.status_code == 201
    rid = r.json()["request_id"]
    due = datetime.fromisoformat(r.json()["due_at"].replace("Z", "+00:00"))
    assert timedelta(days=29) < due - datetime.now(timezone.utc) <= timedelta(days=30)
    assert client.post(f"{A}/parent/requests", headers=h["irfan"], json={"kind": "access", "applicant_id": AARAV}).status_code == 404
    assert [x["request_id"] for x in client.get(f"{A}/parent/requests", headers=h["sunita"]).json()["requests"]] == []

    reqs = client.get(f"{A}/data-requests", headers=h["demo"]).json()["requests"]
    mine = next(x for x in reqs if x["request_id"] == rid)
    assert mine["kind"] == "erasure" and mine["applicant_name"] == "Ayaan Irfan" and mine["guardian_name"] == "Mohammed Irfan"
    assert client.get(f"{A}/data-requests", headers=h["svm"]).json()["requests"] == []
    done = client.patch(f"{A}/data-requests/{rid}", headers=h["demo"], json={"status": "completed", "resolution_note": "Erased on request"})
    assert done.status_code == 200
    assert client.patch(f"{A}/data-requests/{rid}", headers=h["svm"], json={"status": "rejected"}).status_code == 404   # other school


def test_consent_versions_retention_breach_and_team(client, h):
    tpl = client.get(f"{A}/consent-templates", headers=h["svm"]).json()
    assert set(tpl["texts"]) == {"en", "hi", "kn", "ta"} and "Sri Vidya Mandir" in tpl["texts"]["en"]["body"]
    r = client.post(f"{A}/consent-versions", headers=h["svm"], json={"texts": {"en": tpl["texts"]["en"], "ta": tpl["texts"]["ta"]}})
    assert r.status_code == 201 and r.json() == {"version": 2, "languages": ["en", "ta"]}
    assert client.post(f"{A}/consent-versions", headers=h["svm"], json={"texts": {"ta": tpl["texts"]["ta"]}}).status_code == 422
    versions = client.get(f"{A}/consent-versions", headers=h["svm"]).json()["versions"]
    assert [v["version"] for v in versions] == [2, 1] and versions[0]["is_active"] and not versions[1]["is_active"]
    assert client.get(f"{A}/overview", headers=h["demo"]).json()["consent_version"]["version"] == 1   # DEMO unaffected
    # a parent of SVM now sees the new version; Hindi falls back to English (not translated in v2)
    lk = client.get(f"{A}/parent/home", headers=h["lakshmi"]).json()
    assert lk["consent_version"] == 2 and lk["consent_languages"] == ["en", "ta"]
    kid = lk["children"][0]["applicant_id"]
    assert client.get(f"{A}/parent/consent", headers=h["lakshmi"], params={"applicant_id": kid, "lang": "hi"}).json()["language"] == "en"

    assert client.put(f"{A}/retention", headers=h["demo"], json={"policies": {"audit_log": 100}}).status_code == 422
    ret = client.put(f"{A}/retention", headers=h["demo"], json={"policies": {"proctor_snapshots": 14}}).json()["policies"]
    assert next(p for p in ret if p["data_class"] == "proctor_snapshots")["retain_days"] == 14
    other = client.get(f"{A}/retention", headers=h["svm"]).json()["policies"]
    assert next(p for p in other if p["data_class"] == "proctor_snapshots")["retain_days"] == 30   # default, untouched

    detected = datetime.now(timezone.utc).replace(microsecond=0)
    b = client.post(f"{A}/breaches", headers=h["demo"], json={"detected_at": detected.isoformat(), "nature": "Lost USB with enquiry list",
                                                             "affected_count": 12})
    assert b.status_code == 201
    row = next(x for x in client.get(f"{A}/breaches", headers=h["demo"]).json()["breaches"] if x["breach_id"] == b.json()["breach_id"])
    assert datetime.fromisoformat(row["board_report_due_at"]) - datetime.fromisoformat(row["detected_at"]) == timedelta(hours=72)
    assert client.patch(f"{A}/breaches/{row['breach_id']}", headers=h["demo"], json={"status": "reported"}).status_code == 200
    assert client.get(f"{A}/breaches", headers=h["kps"]).json()["breaches"] == []

    m = client.post(f"{A}/team", headers=h["kps"], json={"role": "reviewer", "full_name": "Pooja Shetty", "email": "pooja.reviewer@kps.edu"})
    assert m.status_code == 201 and m.json()["temporary_password"]
    code = m.json()["user_code"]
    assert {x["user_code"] for x in client.get(f"{A}/team", headers=h["kps"]).json()["members"]} == {code}
    assert client.patch(f"{A}/team/{code}", headers=h["demo"], json={"is_active": False}).status_code == 404   # other school
    assert client.patch(f"{A}/team/{code}", headers=h["kps"], json={"is_active": False}).json()["is_active"] is False
    actions = {e["action"] for e in client.get(f"{A}/audit", headers=h["kps"]).json()["entries"]}
    assert {"team.member_added", "team.member_updated"} <= actions
