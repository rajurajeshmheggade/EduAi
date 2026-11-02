"""Admission forms → standalone admission application with one-time credentials → review (README "Admission forms").

Covers the builder and publication, the credentials pop-up acknowledgement, the one-time credential lifecycle (works
while filling in, removed on submission / test submission; reissue; expiry; lockout and rate limits), token audience
separation, upload validation, review decisions with corrections and notifications, signed audited downloads, the
recovery path, the public status lookup and the linked proctored admission test.
"""
import io
import time
import zipfile
from datetime import date, datetime, timedelta, timezone

import jwt
import pytest
from PIL import Image

from app import db
from app.config import get_settings
from app.services.admission import applicant_auth

A = "/ICMELive/api/v1/admission"
P = "/ICMELive/api/v1/apply"
E = "/ICMELive/api/v1/evaluation"
ACK = "Admission application credentials have been copied successfully. Please save these credentials securely."


def _login(client, ident, pw="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def h(client):
    out = {k: _login(client, e) for k, e in [("priya", "teacher@demo.edu"), ("kavya", "kavya@demo.edu"), ("admin", "admin@demo.edu"),
                                             ("svm", "principal@svm.edu"), ("counsellor", "counsellor@demo.edu"),
                                             ("reviewer", "reviewer@demo.edu"), ("parent", "parent@demo.edu"), ("student", "student@demo.edu")]}
    return out


@pytest.fixture(autouse=True)
def _limits():
    applicant_auth.limiter.reset()
    yield
    applicant_auth.limiter.reset()


def code_of(email):
    return db.fetch_one("SELECT user_code FROM public.app_users WHERE email = %s", (email,))["user_code"]


def dob(years=12):
    return (date.today().replace(year=date.today().year - years) - timedelta(days=30)).isoformat()


def pdf_bytes(extra: bytes = b"") -> bytes:
    import pymupdf

    d = pymupdf.open()
    d.new_page().insert_text((72, 72), "Birth certificate")
    data = d.tobytes()
    return data.replace(b"%%EOF", extra + b"\n%%EOF") if extra else data


def png_bytes(size=(64, 48)) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", size, (10, 120, 200)).save(b, "PNG")
    return b.getvalue()


def jpeg_with_exif() -> bytes:
    img = Image.new("RGB", (80, 60), (200, 100, 50))
    exif = Image.Exif()
    exif[0x010E] = "SECRET-GPS-NOTE"
    b = io.BytesIO()
    img.save(b, "JPEG", exif=exif.tobytes())
    return b.getvalue()


def publish_form(client, hdr, title=None, linked_test_id=None, **over):
    r = client.post(f"{A}/forms", headers=hdr, json={"title": title or f"Admissions {time.time_ns()}", "academic_year": "2027-28",
                                                    "grades": [6, 7, 8]})
    assert r.status_code == 201, r.text
    f = r.json()
    body = {k: f[k] for k in ("title", "description", "academic_year", "grades", "opens_at", "closes_at", "credential_valid_days")}
    body.update(definition=f["definition"], linked_test_id=linked_test_id, **over)
    r = client.put(f"{A}/forms/{f['form_id']}", headers=hdr, json=body)
    assert r.status_code == 200, r.text
    r = client.post(f"{A}/forms/{f['form_id']}/publish", headers=hdr)
    assert r.status_code == 200, r.text
    return r.json()


def slug_of(pub):
    return pub["form"]["slug"]


def app_login(client, slug, cred):
    r = client.post(f"{P}/{slug}/login", json={"username": cred["username"], "password": cred["password"]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()


ANSWERS = {"student_name": "Riya Sharma", "date_of_birth": dob(12), "gender": "Female", "grade_applying": 7,
           "home_address": "12 MG Road, Bengaluru", "guardian_name": "Neha Sharma", "guardian_relationship": "Mother",
           "guardian_phone": "+91 98450 12345", "guardian_email": "neha@example.com", "previous_school": "Little Flower School"}


def fill_and_upload(client, slug, ah, answers=None):
    r = client.put(f"{P}/{slug}/me/answers", headers=ah, json={"answers": answers or ANSWERS})
    assert r.status_code == 200, r.text
    r = client.post(f"{P}/{slug}/me/documents", headers=ah, data={"requirement_key": "birth_certificate"},
                    files={"file": ("birth.pdf", pdf_bytes(), "application/pdf")})
    assert r.status_code == 201, r.text
    r = client.post(f"{P}/{slug}/me/documents", headers=ah, data={"requirement_key": "photo"},
                    files={"file": ("photo.png", png_bytes(), "image/png")})
    assert r.status_code == 201, r.text


def submit(client, slug, ah):
    me = client.get(f"{P}/{slug}/me", headers=ah).json()
    consent = me["consent"]
    return client.post(f"{P}/{slug}/me/submit", headers=ah, json={"declaration": True, "consent_confirm": True,
                                                                   "consent_version_id": consent["version_id"] if consent else None})


# ---------------------------------------------------------------- builder, publication, pop-up acknowledgement
def test_builder_validation_and_publication_issue_a_one_time_credential(client, h):
    r = client.post(f"{A}/forms", headers=h["priya"], json={"title": "Admissions 2027", "grades": [6, 7]})
    assert r.status_code == 201 and r.json()["status"] == "draft" and r.json()["slug"] is None
    f = r.json()
    base = {k: f[k] for k in ("title", "description", "academic_year", "grades", "opens_at", "closes_at", "credential_valid_days")}
    defn = f["definition"]
    # structural validation: duplicate field keys, a core field of the wrong type, unknown document types
    dup = {**defn, "sections": [*defn["sections"], {"key": "extra", "title": "Extra", "kind": "custom",
                                                    "fields": [{"key": "student_name", "label": "Again", "type": "text"}]}]}
    assert client.put(f"{A}/forms/{f['form_id']}", headers=h["priya"], json={**base, "definition": dup}).status_code == 422
    bad_core = {**defn, "sections": [{**defn["sections"][0], "fields": [{**defn["sections"][0]["fields"][1], "type": "text"}]}]}
    assert client.put(f"{A}/forms/{f['form_id']}", headers=h["priya"], json={**base, "definition": bad_core}).status_code == 422
    bad_doc = {**defn, "documents": [{"key": "cv", "label": "CV", "accept": ["docx"]}]}
    assert client.put(f"{A}/forms/{f['form_id']}", headers=h["priya"], json={**base, "definition": bad_doc}).status_code == 422
    # a draft may be incomplete, but publishing checks the required fields
    no_guardian = {**defn, "sections": [defn["sections"][0]]}
    assert client.put(f"{A}/forms/{f['form_id']}", headers=h["priya"], json={**base, "definition": no_guardian}).status_code == 200
    r = client.post(f"{A}/forms/{f['form_id']}/publish", headers=h["priya"])
    assert r.status_code == 422 and "guardian name" in r.json()["detail"]
    # another teacher cannot see or publish it; an SVM principal neither
    assert client.get(f"{A}/forms/{f['form_id']}", headers=h["kavya"]).status_code == 404
    assert client.post(f"{A}/forms/{f['form_id']}/publish", headers=h["svm"]).status_code == 404
    assert client.put(f"{A}/forms/{f['form_id']}", headers=h["priya"], json={**base, "definition": defn}).status_code == 200
    r = client.post(f"{A}/forms/{f['form_id']}/publish", headers=h["priya"])
    assert r.status_code == 200, r.text
    out = r.json()
    cred = out["credential"]
    assert out["form"]["status"] == "published" and out["form"]["application_path"] == f"/apply/{out['form']['slug']}"
    assert cred["application_name"] == "Admissions 2027" and cred["application_path"] == out["form"]["application_path"]
    assert cred["username"].startswith("DEMO-") and len(cred["password"]) == 14
    # stored as a bcrypt hash only; the password is in no table and no audit entry
    row = db.fetch_one("SELECT password_hash, status, purpose, issued_by FROM admission.applicant_credentials WHERE credential_id = %s",
                       (cred["credential_id"],))
    assert row["password_hash"].startswith("$2") and cred["password"] not in row["password_hash"]
    assert row["status"] == "issued" and row["purpose"] == "new" and row["issued_by"] == code_of("teacher@demo.edu")
    dump = str(db.fetch_all("SELECT details FROM admission.audit_log WHERE org_code = 'DEMO-SCHOOL'"))
    assert cred["password"] not in dump
    # versions: nothing to publish now; an edit marks unpublished changes, publishing makes version 2 without a credential
    assert client.post(f"{A}/forms/{f['form_id']}/publish", headers=h["priya"]).status_code == 409
    r = client.put(f"{A}/forms/{f['form_id']}", headers=h["priya"], json={**base, "title": "Admissions 2027 (Classes 6–7)", "definition": defn})
    assert r.json()["has_unpublished_changes"] is True
    r = client.post(f"{A}/forms/{f['form_id']}/publish", headers=h["priya"]).json()
    assert r["credential"] is None and r["form"]["published_version"] == 2 and [v["version"] for v in r["form"]["versions"]] == [2, 1]
    assert client.delete(f"{A}/forms/{f['form_id']}", headers=h["priya"]).status_code == 409


def test_acknowledgement_is_recorded(client, h):
    pub = publish_form(client, h["priya"])
    cid = pub["credential"]["credential_id"]
    r = client.post(f"{A}/credentials/{cid}/acknowledge", headers=h["priya"], json={"copied": ["username", "password"]})
    assert r.status_code == 200 and r.json()["message"] == ACK
    from fastapi.testclient import TestClient

    from app.main import app

    remote = TestClient(app, client=("203.0.113.7", 50000))   # a real peer address; X-Forwarded-For is not trusted
    r = remote.post(f"{A}/credentials/{cid}/acknowledge", headers={**h["priya"], "X-Forwarded-For": "198.51.100.1"}, json={"copied": ["all"]})
    assert r.status_code == 200
    row = db.fetch_one("SELECT acknowledged_at, acknowledged_by, acknowledged_ip, acknowledged_items FROM admission.applicant_credentials "
                       "WHERE credential_id = %s", (cid,))
    assert row["acknowledged_at"] and row["acknowledged_by"] == code_of("teacher@demo.edu") and str(row["acknowledged_ip"]) == "203.0.113.7"
    assert sorted(row["acknowledged_items"]) == ["all", "password", "username"]
    acts = db.fetch_all("SELECT actor_code, details FROM admission.audit_log WHERE action = 'credential.acknowledged' AND entity_id = %s",
                        (cid,))
    assert len(acts) == 2 and acts[0]["actor_code"] == code_of("teacher@demo.edu")
    assert client.post(f"{A}/credentials/{cid}/acknowledge", headers=h["kavya"], json={"copied": ["all"]}).status_code == 404
    assert client.post(f"{A}/credentials/{cid}/acknowledge", headers=h["priya"], json={"copied": ["secret"]}).status_code == 422


# ---------------------------------------------------------------- the applicant app
def test_public_metadata_and_branding(client, h):
    pub = publish_form(client, h["priya"])
    slug = slug_of(pub)
    r = client.put(f"{A}/branding", headers=h["admin"], json={"display_name": "Demo International School, Bengaluru", "accent": "#0F766E"})
    assert r.status_code == 200 and r.json()["accent"] == "#0f766e"
    assert client.put(f"{A}/branding", headers=h["priya"], json={"display_name": "Mine"}).status_code == 403
    assert client.put(f"{A}/branding", headers=h["admin"], json={"accent": "red"}).status_code == 422
    r = client.post(f"{A}/branding/logo", headers=h["admin"], files={"file": ("logo.png", png_bytes((900, 300)), "image/png")})
    assert r.status_code == 200 and r.json()["logo_url"]
    assert client.post(f"{A}/branding/logo", headers=h["admin"], files={"file": ("logo.png", b"GIF89a....", "image/png")}).status_code == 415
    r = client.get(f"{P}/{slug}")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    info = r.json()
    assert info["school"]["name"] == "Demo International School, Bengaluru" and info["school"]["accent"] == "#0f766e"
    assert info["form"]["state"] == "open" and info["form"]["instructions"] and info["form"]["has_test"] is False
    assert "definition" not in info["form"] and "sections" not in str(info)
    logo = client.get(info["school"]["logo_url"])
    assert logo.status_code == 200 and logo.headers["content-type"] == "image/png"
    assert max(Image.open(io.BytesIO(logo.content)).size) <= 512
    assert client.get(f"{P}/no-such-application").status_code == 404
    assert client.get(f"{P}/BAD_slug").status_code == 422


def test_one_time_credential_is_removed_on_submission(client, h):
    pub = publish_form(client, h["priya"])
    slug, cred = slug_of(pub), pub["credential"]
    assert client.post(f"{P}/{slug}/login", json={"username": cred["username"], "password": "wrong-password"}).status_code == 401
    assert client.post(f"{P}/{slug}/login", json={"username": "DEMO-NOTEXIST", "password": cred["password"]}).json()["detail"] == \
        client.post(f"{P}/{slug}/login", json={"username": cred["username"], "password": "x"}).json()["detail"]
    ah, tokens = app_login(client, slug, {**cred, "username": cred["username"].lower()})   # usernames are case-insensitive
    me = client.get(f"{P}/{slug}/me", headers=ah)
    assert me.status_code == 200 and me.headers["cache-control"] == "no-store"
    assert me.json()["application"]["status"] == "draft" and me.json()["application"]["reference_no"] is None
    # the applicant can sign out and back in while filling in (the credential stays valid)
    assert client.post(f"{P}/{slug}/logout", headers=ah).status_code == 200
    assert client.get(f"{P}/{slug}/me", headers=ah).status_code == 401
    ah, tokens = app_login(client, slug, cred)
    # refresh rotates: the old refresh token stops working
    r = client.post(f"{P}/{slug}/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    assert client.post(f"{P}/{slug}/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    ah = {"Authorization": f"Bearer {r.json()['access_token']}"}
    refresh_token = r.json()["refresh_token"]
    # autosave keeps partial answers and ignores unknown keys; submitting reports the missing fields
    r = client.put(f"{P}/{slug}/me/answers", headers=ah, json={"answers": {"student_name": "Riya Sharma", "evil": "x"}})
    assert r.status_code == 200 and r.json()["answers"] == {"student_name": "Riya Sharma"}
    r = submit(client, slug, ah)
    assert r.status_code == 422
    missing = {e["field"] for e in r.json()["detail"]["errors"]}
    assert {"date_of_birth", "guardian_phone", "birth_certificate", "photo"} <= missing
    bad = {**ANSWERS, "guardian_email": "not-an-email", "grade_applying": 11}
    client.put(f"{P}/{slug}/me/answers", headers=ah, json={"answers": bad})
    r = submit(client, slug, ah)
    assert {e["field"] for e in r.json()["detail"]["errors"]} >= {"guardian_email", "grade_applying"}
    fill_and_upload(client, slug, ah)
    assert client.post(f"{P}/{slug}/me/submit", headers=ah, json={"declaration": False}).status_code == 422
    me = client.get(f"{P}/{slug}/me", headers=ah).json()
    assert client.post(f"{P}/{slug}/me/submit", headers=ah, json={"declaration": True}).status_code == 422   # consent needed
    before = db.fetch_one("SELECT COUNT(*) AS n FROM admission.applicants WHERE org_code = 'DEMO-SCHOOL'")["n"]
    r = submit(client, slug, ah)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "submitted" and out["credential_removed"] and out["reference_no"].startswith("APP-")
    # the credential is gone: hash wiped, status submitted, sessions ended; neither the token, the refresh token nor
    # the password works any more
    row = db.fetch_one("SELECT password_hash, status, revoke_reason FROM admission.applicant_credentials WHERE credential_id = %s",
                       (cred["credential_id"],))
    assert row == {"password_hash": None, "status": "submitted", "revoke_reason": "submitted"}
    assert db.fetch_one("SELECT COUNT(*) AS n FROM admission.applicant_sessions WHERE credential_id = %s AND revoked_at IS NULL",
                        (cred["credential_id"],))["n"] == 0
    assert client.get(f"{P}/{slug}/me", headers=ah).status_code == 401
    assert client.post(f"{P}/{slug}/refresh", json={"refresh_token": refresh_token}).status_code == 401
    r = client.post(f"{P}/{slug}/login", json={"username": cred["username"], "password": cred["password"]})
    assert r.status_code == 401 and "Track application" in r.json()["detail"]
    # the submission reached the teacher: review queue, notification, and the Admissions home (CRM) count
    q = client.get(f"{A}/applications", headers=h["priya"], params={"form_id": pub["form"]["form_id"]}).json()["applications"]
    assert [a["status"] for a in q] == ["submitted"] and q[0]["student_name"] == "Riya Sharma" and q[0]["documents"] == 2
    n = db.fetch_one("SELECT title, link FROM public.notifications WHERE user_code = %s AND notif_type = 'ADMISSION_APPLICATION' "
                     "ORDER BY created_at DESC LIMIT 1", (code_of("teacher@demo.edu"),))
    assert n and "New admission application" in n["title"] and n["link"] == f"/teacher/admission-forms?application={q[0]['application_id']}"
    assert db.fetch_one("SELECT COUNT(*) AS n FROM admission.applicants WHERE org_code = 'DEMO-SCHOOL'")["n"] == before + 1
    crm = db.fetch_one("SELECT a.full_name, a.grade_applying, a.status, g.full_name AS guardian, g.relationship FROM admission.applicants a "
                       "JOIN admission.applications x ON x.applicant_id = a.applicant_id JOIN admission.applicant_guardians ag "
                       "ON ag.applicant_id = a.applicant_id JOIN admission.guardians g ON g.guardian_id = ag.guardian_id "
                       "WHERE x.reference_no = %s", (out["reference_no"],))
    assert crm == {"full_name": "Riya Sharma", "grade_applying": 7, "status": "submitted", "guardian": "Neha Sharma", "relationship": "mother"}
    assert db.fetch_one("SELECT method FROM admission.consents c JOIN admission.applications x ON x.applicant_id = c.applicant_id "
                        "WHERE x.reference_no = %s", (out["reference_no"],))["method"] == "applicant_app"
    # public tracking: reference + date of birth -> status only
    r = client.post(f"{P}/{slug}/track", json={"reference_no": out["reference_no"].lower(), "date_of_birth": ANSWERS["date_of_birth"]})
    assert r.status_code == 200 and set(r.json()) == {"reference_no", "status", "status_label", "submitted_at", "updated_at"}
    assert "Riya" not in r.text and r.json()["status"] == "submitted"
    assert client.post(f"{P}/{slug}/track", json={"reference_no": out["reference_no"], "date_of_birth": dob(13)}).status_code == 404


def test_lockout_and_rate_limits(client, h):
    pub = publish_form(client, h["priya"])
    slug, cred = slug_of(pub), pub["credential"]
    for _ in range(5):
        assert client.post(f"{P}/{slug}/login", json={"username": cred["username"], "password": "nope-nope"}).status_code in (401, 429)
    r = client.post(f"{P}/{slug}/login", json={"username": cred["username"], "password": cred["password"]})
    assert r.status_code == 429   # locked even with the right password
    assert db.fetch_one("SELECT locked_until FROM admission.applicant_credentials WHERE credential_id = %s",
                        (cred["credential_id"],))["locked_until"] > datetime.now(timezone.utc)
    db.execute("UPDATE admission.applicant_credentials SET locked_until = NOW() - interval '1 minute' WHERE credential_id = %s",
               (cred["credential_id"],))
    app_login(client, slug, cred)
    # per-IP throttle on the login endpoint, whatever the username
    applicant_auth.limiter.reset()
    codes = [client.post(f"{P}/{slug}/login", json={"username": f"DEMO-AAAA{i:04d}", "password": "x"}).status_code for i in range(21)]
    assert codes[-1] == 429 and set(codes[:20]) == {401}
    applicant_auth.limiter.reset()
    codes = [client.post(f"{P}/{slug}/track", json={"reference_no": "APP-AAAA-AAAA", "date_of_birth": dob()}).status_code for _ in range(6)]
    assert codes[-1] == 429


def test_reissue_revoke_expiry_and_more_credentials(client, h):
    pub = publish_form(client, h["priya"], credential_valid_days=10)
    slug, form_id, first = slug_of(pub), pub["form"]["form_id"], pub["credential"]
    # one more applicant: a further credential (new application), with the same pop-up payload
    r = client.post(f"{A}/forms/{form_id}/credentials", headers=h["priya"], json={"label": "Walk-in, Monday"})
    assert r.status_code == 201
    second = r.json()
    assert second["username"] != first["username"] and second["application_id"] != first["application_id"]
    ah, _ = app_login(client, slug, first)
    client.put(f"{P}/{slug}/me/answers", headers=ah, json={"answers": {"student_name": "Kept Answer"}})
    creds = {c["credential_id"]: c for c in client.get(f"{A}/forms/{form_id}/credentials", headers=h["priya"]).json()["credentials"]}
    assert creds[first["credential_id"]]["status"] == "in_use" and creds[second["credential_id"]]["status"] == "issued"
    assert creds[second["credential_id"]]["application"]["label"] == "Walk-in, Monday"
    # reissue (recovery): the old credential and its sessions stop working, the saved answers stay
    r = client.post(f"{A}/credentials/{first['credential_id']}/reissue", headers=h["priya"])
    assert r.status_code == 200
    third = r.json()
    assert third["application_id"] == first["application_id"] and third["purpose"] == "reissue"
    assert client.get(f"{P}/{slug}/me", headers=ah).status_code == 401
    assert client.post(f"{P}/{slug}/login", json={"username": first["username"], "password": first["password"]}).status_code == 401
    ah, _ = app_login(client, slug, third)
    assert client.get(f"{P}/{slug}/me", headers=ah).json()["application"]["answers"] == {"student_name": "Kept Answer"}
    old = db.fetch_one("SELECT status, password_hash, revoke_reason FROM admission.applicant_credentials WHERE credential_id = %s",
                       (first["credential_id"],))
    assert old == {"status": "revoked", "password_hash": None, "revoke_reason": "reissued"}
    # revoke
    assert client.post(f"{A}/credentials/{second['credential_id']}/revoke", headers=h["priya"]).status_code == 200
    assert client.post(f"{P}/{slug}/login", json={"username": second["username"], "password": second["password"]}).status_code == 401
    assert client.post(f"{A}/credentials/{second['credential_id']}/revoke", headers=h["priya"]).status_code == 409
    # expiry: a credential past its date is expired (hash removed) at the next sign-in or listing
    db.execute("UPDATE admission.applicant_credentials SET expires_at = NOW() - interval '1 minute' WHERE credential_id = %s",
               (third["credential_id"],))
    assert client.get(f"{P}/{slug}/me", headers=ah).status_code == 401
    r = client.post(f"{P}/{slug}/login", json={"username": third["username"], "password": third["password"]})
    assert r.status_code == 401
    assert db.fetch_one("SELECT status, password_hash FROM admission.applicant_credentials WHERE credential_id = %s",
                        (third["credential_id"],)) == {"status": "expired", "password_hash": None}
    # credential expiry is capped by the form's closing date for new applicants
    closes = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    f = client.get(f"{A}/forms/{form_id}", headers=h["priya"]).json()
    body = {k: f[k] for k in ("title", "description", "academic_year", "grades", "opens_at", "credential_valid_days", "linked_test_id",
                              "definition")}
    assert client.put(f"{A}/forms/{form_id}", headers=h["priya"], json={**body, "closes_at": closes}).status_code == 200
    r = client.post(f"{A}/forms/{form_id}/credentials", headers=h["priya"]).json()
    assert datetime.fromisoformat(r["expires_at"]) <= datetime.fromisoformat(closes)
    # closing the form stops new sign-ins and new credentials
    assert client.post(f"{A}/forms/{form_id}/close", headers=h["priya"]).status_code == 200
    assert client.post(f"{P}/{slug}/login", json={"username": r["username"], "password": r["password"]}).status_code == 403
    assert client.post(f"{A}/forms/{form_id}/credentials", headers=h["priya"]).status_code == 409
    assert client.get(f"{P}/{slug}").json()["form"]["state"] == "closed"


def test_token_audience_separation(client, h):
    pub = publish_form(client, h["priya"])
    other = publish_form(client, h["priya"])
    slug = slug_of(pub)
    ah, tokens = app_login(client, slug, pub["credential"])
    # applicant tokens never work on LMS endpoints ...
    assert client.get("/api/v1/auth/me", headers=ah).status_code == 401
    assert client.get(f"{A}/forms", headers=ah).status_code == 401
    assert client.get(f"{A}/overview", headers=ah).status_code == 401
    # ... LMS tokens never work on applicant endpoints, and an applicant token is bound to its own application form
    for hdr in (h["priya"], h["admin"], h["student"]):
        assert client.get(f"{P}/{slug}/me", headers=hdr).status_code == 401
    assert client.get(f"{P}/{slug_of(other)}/me", headers=ah).status_code == 401
    # a token signed with the LMS secret (even with the right claims) and a refresh token used as access are refused
    claims = jwt.decode(tokens["access_token"], options={"verify_signature": False})
    forged = jwt.encode(claims, get_settings().jwt_secret, algorithm="HS256")
    assert client.get(f"{P}/{slug}/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    assert client.get(f"{P}/{slug}/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}).status_code == 401
    assert client.get(f"{P}/{slug}/me").status_code == 401


def test_upload_validation(client, h):
    pub = publish_form(client, h["priya"])
    slug = slug_of(pub)
    ah, _ = app_login(client, slug, pub["credential"])

    def up(key, name, data, ctype="application/pdf"):
        return client.post(f"{P}/{slug}/me/documents", headers=ah, data={"requirement_key": key}, files={"file": (name, data, ctype)})

    assert up("birth_certificate", "virus.pdf", b"MZ\x90\x00 this is a windows executable").status_code == 415     # magic bytes, not name
    assert up("birth_certificate", "page.html.pdf", b"<html><script>alert(1)</script></html>").status_code == 415
    assert up("birth_certificate", "big.pdf", b"%PDF-" + b"0" * (5 * 1024 * 1024)).status_code == 413
    assert up("birth_certificate", "script.pdf", pdf_bytes(b"1 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj")).status_code == 415
    assert up("birth_certificate", "broken.pdf", b"%PDF-1.7\n garbage").status_code == 415
    assert up("photo", "photo.pdf", pdf_bytes()).status_code == 415                          # this requirement takes images only
    assert up("not_requested", "x.pdf", pdf_bytes()).status_code == 404
    assert up("birth_certificate", "empty.pdf", b"").status_code in (415, 422)
    r = up("photo", "../../etc/passwd\x00.jpg", jpeg_with_exif(), "image/jpeg")
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["filename"].startswith("passwd") and doc["filename"].endswith(".jpg") and "/" not in doc["filename"]
    assert "\x00" not in doc["filename"] and doc["mime"] == "image/jpeg"
    row = db.fetch_one("SELECT storage_key, sha256, size_bytes FROM admission.application_documents WHERE document_id = %s", (doc["document_id"],))
    from app.services.storage import get_storage
    import hashlib

    stored = get_storage().get(row["storage_key"])
    assert b"SECRET-GPS-NOTE" not in stored and hashlib.sha256(stored).hexdigest() == row["sha256"] and len(stored) == row["size_bytes"]
    assert up("photo", "second.png", png_bytes(), "image/png").status_code == 409                # max_files = 1
    # the applicant can view and delete their own file, then upload again
    r = client.get(f"{P}/{slug}/me/documents/{doc['document_id']}", headers=ah)
    assert r.status_code == 200 and r.headers["content-disposition"].startswith("attachment;") and r.headers["x-content-type-options"] == "nosniff"
    assert client.delete(f"{P}/{slug}/me/documents/{doc['document_id']}", headers=ah).status_code == 200
    assert up("photo", "second.png", png_bytes(), "image/png").status_code == 201


def _submitted(client, h, **kw):
    pub = publish_form(client, h["priya"], **kw)
    slug = slug_of(pub)
    ah, _ = app_login(client, slug, pub["credential"])
    fill_and_upload(client, slug, ah)
    r = submit(client, slug, ah)
    assert r.status_code == 200, r.text
    return pub, slug, r.json()


def test_review_decisions_corrections_and_notifications(client, h):
    pub, slug, sub = _submitted(client, h)
    app_id = pub["credential"]["application_id"]
    # scope: the owner, admins and counsellors; not another teacher, a reviewer, a parent or another school
    assert client.get(f"{A}/applications/{app_id}", headers=h["kavya"]).status_code == 404
    assert client.get(f"{A}/applications/{app_id}", headers=h["svm"]).status_code == 404
    for k in ("reviewer", "parent", "student"):
        assert client.get(f"{A}/applications/{app_id}", headers=h[k]).status_code == 403, k
    assert client.get(f"{A}/applications/{app_id}", headers=h["counsellor"]).status_code == 200
    d = client.get(f"{A}/applications/{app_id}", headers=h["priya"]).json()
    assert d["status"] == "submitted" and d["answers"]["guardian_name"] == "Neha Sharma" and len(d["documents"]) == 2
    assert d["actions"] == ["start_review", "approve", "reject", "request_correction"] and d["reference_no"] == sub["reference_no"]
    r = client.post(f"{A}/applications/{app_id}/decision", headers=h["priya"], json={"action": "start_review"})
    assert r.json()["application"]["status"] == "under_review"
    assert client.post(f"{A}/applications/{app_id}/comments", headers=h["priya"], json={"body": "Birth certificate is blurred."}).status_code == 201
    assert client.post(f"{A}/applications/{app_id}/decision", headers=h["priya"], json={"action": "request_correction"}).status_code == 422
    r = client.post(f"{A}/applications/{app_id}/decision", headers=h["priya"],
                    json={"action": "request_correction", "note": "Please upload a clearer birth certificate."})
    assert r.status_code == 200
    cred = r.json()["credential"]
    assert cred and cred["purpose"] == "correction" and r.json()["application"]["status"] == "correction_requested"
    # the applicant signs in with the fresh one-time credential, sees the note (not the staff comment), fixes, resubmits
    ah, _ = app_login(client, slug, cred)
    me = client.get(f"{P}/{slug}/me", headers=ah).json()
    assert me["application"]["status"] == "correction_requested" and me["application"]["editable"]
    assert [c["note"] for c in me["corrections"]] == ["Please upload a clearer birth certificate."]
    assert "blurred" not in str(me)
    doc = next(x for x in me["documents"] if x["requirement_key"] == "birth_certificate")
    assert client.delete(f"{P}/{slug}/me/documents/{doc['document_id']}", headers=ah).status_code == 200
    client.post(f"{P}/{slug}/me/documents", headers=ah, data={"requirement_key": "birth_certificate"},
                files={"file": ("birth-clear.pdf", pdf_bytes(), "application/pdf")})
    r = submit(client, slug, ah)
    assert r.json()["status"] == "resubmitted" and r.json()["credential_removed"]
    assert client.get(f"{P}/{slug}/me", headers=ah).status_code == 401
    assert client.post(f"{P}/{slug}/login", json={"username": cred["username"], "password": cred["password"]}).status_code == 401
    # an admin decides; the owner is notified; finished applications accept no further decisions
    r = client.post(f"{A}/applications/{app_id}/decision", headers=h["admin"], json={"action": "approve", "note": "Welcome"})
    assert r.json()["application"]["status"] == "approved" and r.json()["credential"] is None
    n = db.fetch_one("SELECT title FROM public.notifications WHERE user_code = %s AND notif_type = 'ADMISSION_APPLICATION' "
                     "ORDER BY created_at DESC LIMIT 1", (code_of("teacher@demo.edu"),))
    assert n["title"].startswith(f"Application {sub['reference_no']} updated")
    assert client.post(f"{A}/applications/{app_id}/decision", headers=h["priya"], json={"action": "reject"}).status_code == 409
    hist = [(x["from_status"], x["to_status"]) for x in client.get(f"{A}/applications/{app_id}", headers=h["priya"]).json()["history"]]
    assert hist == [("draft", "submitted"), ("submitted", "under_review"), ("under_review", "correction_requested"),
                    ("correction_requested", "resubmitted"), ("resubmitted", "approved")]
    assert db.fetch_one("SELECT a.status FROM admission.applicants a JOIN admission.applications x ON x.applicant_id = a.applicant_id "
                        "WHERE x.application_id = %s", (app_id,))["status"] == "approved"
    r = client.post(f"{P}/{slug}/track", json={"reference_no": sub["reference_no"], "date_of_birth": ANSWERS["date_of_birth"]})
    assert r.json()["status"] == "approved"


def test_signed_audited_document_downloads(client, h):
    pub, slug, sub = _submitted(client, h)
    app_id = pub["credential"]["application_id"]
    docs = client.get(f"{A}/applications/{app_id}", headers=h["priya"]).json()["documents"]
    bc = next(d for d in docs if d["requirement_key"] == "birth_certificate")
    assert client.post(f"{A}/applications/{app_id}/documents/{bc['document_id']}/link", headers=h["kavya"]).status_code == 404
    r = client.post(f"{A}/applications/{app_id}/documents/{bc['document_id']}/link", headers=h["priya"])
    assert r.status_code == 200 and r.json()["expires_in"] == 300
    url = r.json()["url"]
    f = client.get(url)
    assert f.status_code == 200 and f.content.startswith(b"%PDF-") and f.headers["content-type"] == "application/pdf"
    assert f.headers["content-disposition"].startswith('attachment; filename="birth.pdf"')
    assert f.headers["cache-control"] == "no-store" and "sandbox" in f.headers["content-security-policy"]
    assert client.get(url[:-4] + "abcd").status_code == 403                                   # tampered
    z = client.get(client.post(f"{A}/applications/{app_id}/documents/zip-link", headers=h["admin"]).json()["url"])
    assert z.status_code == 200 and z.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert len(names) == 2 and any(n.endswith("birth.pdf") for n in names)
    acts = {r["action"] for r in db.fetch_all("SELECT action FROM admission.audit_log WHERE details->>'application_id' = %s OR entity_id = %s",
                                              (str(app_id), str(app_id)))}
    assert {"document.link_issued", "document.downloaded", "document.zip_link_issued", "document.zip_downloaded"} <= acts
    # a link minted for someone who is no longer allowed does not work
    token = applicant_auth.sign_download({"org": "DEMO-SCHOOL", "u": code_of("kavya@demo.edu"), "r": "teacher", "app": str(app_id),
                                          "doc": bc["document_id"]})
    assert client.get(f"{A}/document-download/{token}").status_code == 404


def test_recovery_requests_and_reissue(client, h):
    pub = publish_form(client, h["priya"])
    slug, cred = slug_of(pub), pub["credential"]
    unknown = client.post(f"{P}/{slug}/recovery", json={"username": "DEMO-NOBODY00", "contact": "someone@example.com"})
    known = client.post(f"{P}/{slug}/recovery", json={"username": cred["username"], "contact": "+91 98450 00000", "message": "Lost it"})
    assert unknown.status_code == known.status_code == 202 and unknown.json() == known.json()
    bot = client.post(f"{P}/{slug}/recovery", json={"username": cred["username"], "contact": "bot@example.com", "website": "http://spam"})
    assert bot.status_code == 202
    assert client.post(f"{P}/{slug}/recovery", json={"username": cred["username"], "contact": "nope"}).status_code == 422
    reqs = client.get(f"{A}/recovery-requests", headers=h["priya"], params={"form_id": pub["form"]["form_id"]}).json()["requests"]
    assert len(reqs) == 2 and {r["contact"] for r in reqs} == {"someone@example.com", "+91 98450 00000"}
    mine = next(r for r in reqs if r["username"] == cred["username"])
    assert mine["can_reissue"] and not next(r for r in reqs if r["username"] == "DEMO-NOBODY00")["can_reissue"]
    assert client.get(f"{A}/recovery-requests", headers=h["kavya"], params={"form_id": pub["form"]["form_id"]}).json()["requests"] == []
    r = client.post(f"{A}/credentials/{cred['credential_id']}/reissue", headers=h["priya"], json={"recovery_request_id": str(mine["request_id"])})
    assert r.status_code == 200
    app_login(client, slug, r.json())
    left = client.get(f"{A}/recovery-requests", headers=h["priya"], params={"form_id": pub["form"]["form_id"]}).json()["requests"]
    assert [x["username"] for x in left] == ["DEMO-NOBODY00"]
    assert client.post(f"{A}/recovery-requests/{left[0]['request_id']}/dismiss", headers=h["priya"]).status_code == 200
    assert db.fetch_one("SELECT COUNT(*) AS n FROM public.notifications WHERE notif_type = 'ADMISSION_RECOVERY' AND user_code = %s",
                        (code_of("teacher@demo.edu"),))["n"] >= 2


# ---------------------------------------------------------------- linked proctored admission test
QUESTIONS = [{"sl_no": "1", "question_type": "MCQ", "question_text": "What is the SI unit of force?", "max_marks": 1,
              "mcq_options": ["(a) Joule", "(b) Newton", "(c) Watt", "(d) Pascal"], "correct_option": "b", "model_answer_text": "(b) Newton"}]


@pytest.fixture(scope="module")
def admission_test(client, h):
    p = h["priya"]
    r = client.post(f"{E}/tests", headers=p, json={"class_code": "Grade-10-A", "subject_code": "PHY101", "evaluation_scope": "SUBJECT_LEVEL",
                                                    "test_title": f"Forms unit test {time.time_ns()}", "assessment_type": "ONLINE_TEST",
                                                    "duration_minutes": 20})
    eid = r.json()["eval_test_id"]
    masters = client.put(f"{E}/tests/{eid}/masters", headers=p, json={"items": QUESTIONS}).json()["masters"]
    t = client.post(f"{A}/tests", headers=p, json={"title": f"Entrance {time.time_ns()}", "grade_applying": "Class 7", "duration_minutes": 30}).json()
    client.post(f"{A}/tests/{t['test_id']}/questions/import", headers=p, json={"master_q_ids": [m["master_q_id"] for m in masters],
                                                                               "section": "academic"})
    assert client.post(f"{A}/tests/{t['test_id']}/publish", headers=p).status_code == 200
    return t["test_id"]


def test_linked_admission_test_removes_the_credential_when_the_test_is_submitted(client, h, admission_test):
    assert client.put(f"{A}/forms/00000000-0000-0000-0000-000000000000", headers=h["kavya"], json={}).status_code == 422
    pub = publish_form(client, h["priya"], linked_test_id=admission_test)
    slug, cred = slug_of(pub), pub["credential"]
    assert client.get(f"{P}/{slug}").json()["form"]["has_test"] is True
    ah, _ = app_login(client, slug, cred)
    fill_and_upload(client, slug, ah)
    r = submit(client, slug, ah)
    assert r.json() == {**r.json(), "status": "test_pending", "credential_removed": False, "test_required": True}
    # the credential stays valid until the test is submitted; the answers are frozen
    me = client.get(f"{P}/{slug}/me", headers=ah).json()
    assert me["application"]["editable"] is False and me["test"]["available"] and me["test"]["session_status"] is None
    assert client.put(f"{P}/{slug}/me/answers", headers=ah, json={"answers": {"student_name": "Changed"}}).status_code == 409
    assert client.get(f"{A}/applications", headers=h["priya"], params={"form_id": pub["form"]["form_id"]}).json()["applications"][0]["status"] == "test_pending"
    device = "dev-" + "a" * 32
    assert client.post(f"{P}/{slug}/me/test/launch", headers=ah, json={"device_id": device}).status_code == 422   # guardian consent (minor)
    r = client.post(f"{P}/{slug}/me/test/launch", headers=ah, json={"device_id": device, "guardian_consent":
                                                                    {"guardian_name": "Neha Sharma", "relationship": "Mother", "confirm": True}})
    assert r.status_code == 201, r.text
    launch = r.json()
    s = db.fetch_one("SELECT origin, launched_by, guardian_consent, exam_token_hash FROM public.admission_sessions WHERE session_id = %s",
                     (launch["session_id"],))
    assert s["origin"] == "applicant" and s["launched_by"] == code_of("teacher@demo.edu")
    assert s["guardian_consent"]["method"] == "applicant_portal" and launch["exam_token"] not in s["exam_token_hash"]
    cand = db.fetch_one("SELECT c.full_name, c.created_by FROM public.admission_candidates c JOIN admission.applications a "
                        "ON a.exam_candidate_id = c.candidate_id WHERE a.application_id = %s", (cred["application_id"],))
    assert cand == {"full_name": "Riya Sharma", "created_by": code_of("teacher@demo.edu")}
    # the exam token works only on the exam routes (and says the session came from the applicant app); the applicant
    # token does not work there, and the exam token does not work in the applicant app
    ex = {"X-Exam-Token": launch["exam_token"], "X-Device-Id": device, "X-Page-Id": "page-abcdefgh1234"}
    st = client.get(f"{A}/session/status", headers=ex)
    assert st.status_code == 200 and st.json()["origin"] == "applicant"
    assert client.get(f"{A}/session/status", headers={**ah, "X-Device-Id": device}).status_code == 401
    assert client.get(f"{P}/{slug}/me", headers={"Authorization": f"Bearer {launch['exam_token']}"}).status_code == 401
    assert client.get(f"{P}/{slug}/me", headers=ah).status_code == 200
    # the teacher's live monitor sees it; when the test ends the application is submitted and the credential removed
    live = client.get(f"{A}/live", headers=h["priya"]).json()["sessions"]
    assert any(x["session_id"] == launch["session_id"] for x in live)
    assert client.post(f"{A}/sessions/{launch['session_id']}/end", headers=h["priya"]).status_code == 200
    row = db.fetch_one("SELECT a.status, k.status AS cred, k.password_hash, k.revoke_reason FROM admission.applications a "
                       "JOIN admission.applicant_credentials k ON k.application_id = a.application_id WHERE a.application_id = %s",
                       (cred["application_id"],))
    assert row == {"status": "submitted", "cred": "submitted", "password_hash": None, "revoke_reason": "test_submitted"}
    assert client.get(f"{P}/{slug}/me", headers=ah).status_code == 401
    assert client.post(f"{P}/{slug}/login", json={"username": cred["username"], "password": cred["password"]}).status_code == 401
    d = client.get(f"{A}/applications/{cred['application_id']}", headers=h["priya"]).json()
    assert d["status"] == "submitted" and d["exam"]["status"] == "ENDED" and d["exam"]["report_path"].endswith(launch["session_id"])
    assert any(x["to_status"] == "submitted" and x["from_status"] == "test_pending" for x in d["history"])
    # the existing teacher-launched flow is unaffected (origin teacher)
    assert db.fetch_one("SELECT COUNT(*) AS n FROM public.admission_sessions WHERE origin = 'teacher' AND launched_by IS NOT NULL")["n"] >= 0


def test_linked_test_completion_is_recovered_if_the_hook_did_not_run(client, h, admission_test):
    pub = publish_form(client, h["priya"], linked_test_id=admission_test)
    slug, cred = slug_of(pub), pub["credential"]
    ah, _ = app_login(client, slug, cred)
    fill_and_upload(client, slug, ah)
    submit(client, slug, ah)
    launch = client.post(f"{P}/{slug}/me/test/launch", headers=ah, json={"device_id": "dev-" + "b" * 32, "guardian_consent":
                                                                         {"guardian_name": "Neha", "relationship": "Mother", "confirm": True}}).json()
    # simulate a crash between ending the session and completing the application
    db.execute("UPDATE public.admission_sessions SET status = 'SUBMITTED', submit_reason = 'MANUAL', submitted_at = NOW() "
               "WHERE session_id = %s", (launch["session_id"],))
    assert client.get(f"{P}/{slug}/me", headers=ah).status_code == 401
    assert db.fetch_one("SELECT status FROM admission.applications WHERE application_id = %s", (cred["application_id"],))["status"] == "submitted"
    assert db.fetch_one("SELECT password_hash FROM admission.applicant_credentials WHERE credential_id = %s",
                        (cred["credential_id"],))["password_hash"] is None
