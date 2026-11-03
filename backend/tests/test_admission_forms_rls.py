"""Row-level security for the admission-forms tables (migration 029), proved against the database itself.

For every new table: forced RLS and its policies; another school's rows are invisible and untouchable; a teacher sees
only their own forms' data; an applicant only their own application; the pre-login gate only what login needs; parents,
integrity reviewers and unknown roles see nothing; the new roles cannot reach the Milestone 1 CRM / DPDP tables.
Database-enforced invariants (status machine, one-time credentials, append-only history) are checked too.
"""
import io
import time
import uuid
from datetime import date, timedelta

import psycopg
import pytest
from PIL import Image

from app import db
from app.services.admission import applicant_auth

A = "/ICMELive/api/v1/admission"
P = "/ICMELive/api/v1/apply"
DEMO, SVM = "DEMO-SCHOOL", "SVM-ICSE"
NEW = ["forms", "form_versions", "applications", "applicant_credentials", "applicant_sessions", "application_documents",
       "application_status_history", "application_comments", "recovery_requests"]
CRM = ["applicants", "guardians", "applicant_guardians", "consents", "data_requests", "retention_policies", "breach_log"]


def _login(client, ident, pw="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["user_code"]


def _pdf() -> bytes:
    import pymupdf

    d = pymupdf.open()
    d.new_page()
    return d.tobytes()


def _png() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (40, 40), (1, 2, 3)).save(b, "PNG")
    return b.getvalue()


def _publish(client, hdr, title):
    f = client.post(f"{A}/forms", headers=hdr, json={"title": title, "grades": [6, 7, 8]}).json()
    body = {k: f[k] for k in ("title", "description", "academic_year", "grades", "opens_at", "closes_at", "credential_valid_days",
                              "linked_test_id", "definition")}
    assert client.put(f"{A}/forms/{f['form_id']}", headers=hdr, json=body).status_code == 200
    r = client.post(f"{A}/forms/{f['form_id']}/publish", headers=hdr)
    assert r.status_code == 200, r.text
    return r.json()


def _apply(client, pub, cred, name):
    slug = pub["form"]["slug"]
    r = client.post(f"{P}/{slug}/login", json={"username": cred["username"], "password": cred["password"]})
    assert r.status_code == 200, r.text
    ah = {"Authorization": f"Bearer {r.json()['access_token']}"}
    dob = (date.today() - timedelta(days=365 * 12 + 40)).isoformat()
    answers = {"student_name": name, "date_of_birth": dob, "grade_applying": 7, "home_address": "1 Main Road",
               "guardian_name": f"{name} Parent", "guardian_relationship": "Father", "guardian_phone": "9845000000"}
    assert client.put(f"{P}/{slug}/me/answers", headers=ah, json={"answers": answers}).status_code == 200
    for key, fname, data in (("birth_certificate", "b.pdf", _pdf()), ("photo", "p.png", _png())):
        assert client.post(f"{P}/{slug}/me/documents", headers=ah, data={"requirement_key": key}, files={"file": (fname, data)}).status_code == 201
    consent = client.get(f"{P}/{slug}/me", headers=ah).json()["consent"]
    r = client.post(f"{P}/{slug}/me/submit", headers=ah, json={"declaration": True, "consent_confirm": True,
                                                                "consent_version_id": consent["version_id"]})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def world(client):
    applicant_auth.limiter.reset()
    priya, priya_code = _login(client, "teacher@demo.edu")
    kavya, kavya_code = _login(client, "kavya@demo.edu")
    svm, _ = _login(client, "principal@svm.edu")
    tag = time.time_ns()
    a = _publish(client, priya, f"RLS Priya {tag}")
    a1 = a["credential"]
    a2 = client.post(f"{A}/forms/{a['form']['form_id']}/credentials", headers=priya, json={}).json()
    _apply(client, a, a1, "Applicant One")
    # A2 signs in (a live session) but keeps a draft with one document
    slug = a["form"]["slug"]
    r = client.post(f"{P}/{slug}/login", json={"username": a2["username"], "password": a2["password"]})
    ah2 = {"Authorization": f"Bearer {r.json()['access_token']}"}
    client.post(f"{P}/{slug}/me/documents", headers=ah2, data={"requirement_key": "photo"}, files={"file": ("p.png", _png())})
    assert client.post(f"{A}/applications/{a1['application_id']}/comments", headers=priya, json={"body": "staff only"}).status_code == 201
    client.post(f"{P}/{slug}/recovery", json={"username": a2["username"], "contact": "x@example.com"})
    k = client.post(f"{A}/forms", headers=kavya, json={"title": f"RLS Kavya draft {tag}"}).json()
    s = _publish(client, svm, f"RLS SVM {tag}")
    _apply(client, s, s["credential"], "Other School Child")
    applicant_auth.limiter.reset()
    return {"a": a, "a1": a1["application_id"], "a2": a2["application_id"], "a2_cred": a2["credential_id"], "k": k["form_id"],
            "s": s, "s1": s["credential"]["application_id"], "priya": priya_code, "kavya": kavya_code}


def count(c, t, where="TRUE", args=()):
    return c.execute(f"SELECT COUNT(*) AS n FROM admission.{t} WHERE {where}", args).fetchone()["n"]


# ---------------------------------------------------------------- structure
def test_new_tables_have_forced_rls_policies_and_grants(world):
    for t in NEW:
        flags = db.fetch_one("SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                             "WHERE n.nspname = 'admission' AND c.relname = %s", (t,))
        assert flags == {"relrowsecurity": True, "relforcerowsecurity": True}, t
        pols = {r["policyname"]: r["permissive"] for r in db.fetch_all(
            "SELECT policyname, permissive FROM pg_policies WHERE schemaname = 'admission' AND tablename = %s", (t,))}
        assert pols["tenant_isolation"] == "PERMISSIVE" and pols["actor_scope"] == "RESTRICTIVE", t
        assert db.fetch_one("SELECT has_table_privilege('admission_app', %s, 'SELECT') AS s", (f"admission.{t}",))["s"], t
    for t in CRM:
        assert db.fetch_one("SELECT 1 FROM pg_policies WHERE schemaname = 'admission' AND tablename = %s AND policyname = 'forms_roles_excluded'",
                            (t,)), t
    # the pre-login lookups are SECURITY DEFINER, not callable by PUBLIC
    for fn in ("admission.resolve_form_slug(text)", "admission.lookup_application_status(uuid,text,date)"):
        assert db.fetch_one("SELECT has_function_privilege('public', %s, 'EXECUTE') AS p", (fn,))["p"] is False, fn
        assert db.fetch_one("SELECT has_function_privilege('admission_app', %s, 'EXECUTE') AS p", (fn,))["p"] is True, fn


# ---------------------------------------------------------------- tenants
@pytest.mark.parametrize("school,other", [(DEMO, SVM), (SVM, DEMO)])
def test_another_schools_rows_are_invisible_and_untouchable(world, school, other):
    for t in NEW:
        mine = db.fetch_one(f"SELECT COUNT(*) AS n FROM admission.{t} WHERE org_code = %s", (school,))["n"]
        theirs = db.fetch_one(f"SELECT COUNT(*) AS n FROM admission.{t} WHERE org_code = %s", (other,))["n"]
        assert theirs > 0 or t in ("applicant_sessions", "recovery_requests", "application_comments"), t
        with db.tenant(school, "TEST", "orgadmin") as c:
            assert count(c, t) == mine, t
            assert count(c, t, "org_code = %s", (other,)) == 0, t
            assert c.execute(f"DELETE FROM admission.{t} WHERE org_code = %s", (other,)).rowcount == 0, t
        assert db.fetch_one(f"SELECT COUNT(*) AS n FROM admission.{t} WHERE org_code = %s", (other,))["n"] == theirs, t
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, "TEST", "orgadmin") as c:
            c.execute("INSERT INTO admission.forms (org_code, title, definition, created_by) VALUES (%s, 'x', '{}', 'TEST')", (SVM,))
    # an application of another school cannot be reached even by id
    with db.tenant(DEMO, "TEST", "orgadmin") as c:
        assert count(c, "applications", "application_id = %s", (world["s1"],)) == 0


# ---------------------------------------------------------------- teachers
def test_teachers_see_only_their_own_forms(world):
    form_a = world["a"]["form"]["form_id"]
    with db.tenant(DEMO, world["priya"], "teacher") as c:
        assert count(c, "forms", "form_id = %s", (form_a,)) == 1 and count(c, "forms", "form_id = %s", (world["k"],)) == 0
        assert count(c, "forms", "created_by <> %s", (world["priya"],)) == 0
        assert count(c, "applications", "application_id = %s", (world["a1"],)) == 1
        assert count(c, "application_comments", "application_id = %s", (world["a1"],)) == 1
        assert count(c, "recovery_requests", "form_id = %s", (form_a,)) >= 1
        assert count(c, "applicant_sessions") == 0                     # never visible to staff teachers
    with db.tenant(DEMO, world["kavya"], "teacher") as c:
        assert count(c, "forms", "form_id = %s", (world["k"],)) == 1
        for t in ("forms", "form_versions", "applications", "applicant_credentials", "application_documents",
                  "application_status_history", "application_comments", "recovery_requests"):
            assert count(c, t, "form_id = %s" if t in ("forms", "form_versions", "applicant_credentials", "recovery_requests")
                         else "application_id IN (%s, %s)", (form_a,) if t in ("forms", "form_versions", "applicant_credentials",
                                                                               "recovery_requests") else (world["a1"], world["a2"])) == 0, t
        assert c.execute("UPDATE admission.applications SET label = 'x' WHERE application_id = %s", (world["a1"],)).rowcount == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, world["kavya"], "teacher") as c:
            c.execute("INSERT INTO admission.forms (org_code, title, definition, created_by) VALUES (%s, 'x', '{}', %s)", (DEMO, world["priya"]))
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, world["kavya"], "teacher") as c:
            c.execute("INSERT INTO admission.applications (org_code, form_id, reference_no, created_by) VALUES (%s, %s, 'APP-ZZZZ-ZZZZ', %s)",
                      (DEMO, form_a, world["kavya"]))


def test_teachers_never_reach_the_crm_or_dpdp_tables(world):
    with db.tenant(DEMO, world["priya"], "teacher") as c:
        for t in CRM:
            assert count(c, t) == 0, t
        assert count(c, "audit_log") == 0
        c.execute("INSERT INTO admission.audit_log (org_code, actor_code, actor_role, action, entity) "
                  "VALUES (admission.current_org(), %s, 'teacher', 'rls.test', 'test')", (world["priya"],))
        assert count(c, "consent_versions") == 0


# ---------------------------------------------------------------- applicants
def test_an_applicant_sees_only_their_own_application(world):
    a2 = str(world["a2"])
    with db.tenant(DEMO, a2, "applicant") as c:
        assert [str(r["application_id"]) for r in c.execute("SELECT application_id FROM admission.applications").fetchall()] == [a2]
        assert count(c, "application_documents", "application_id <> %s", (a2,)) == 0
        assert count(c, "application_documents") == 1
        assert {str(r["application_id"]) for r in c.execute("SELECT application_id FROM admission.applicant_credentials").fetchall()} == {a2}
        assert count(c, "applicant_sessions", "application_id <> %s", (a2,)) == 0 and count(c, "applicant_sessions") >= 1
        assert count(c, "application_comments") == 0 and count(c, "recovery_requests") == 0
        assert count(c, "application_status_history", "NOT visible_to_applicant") == 0
        assert count(c, "forms", "status = 'draft'") == 0 and count(c, "forms", "form_id = %s", (world["k"],)) == 0
        assert count(c, "form_versions") == count(c, "form_versions", "form_id IN (SELECT form_id FROM admission.forms)")
        for t in CRM:
            assert count(c, t) == 0, t
        assert count(c, "audit_log") == 0
        assert count(c, "consent_versions") >= 1                      # the notice they consent to
        # cannot change anyone else's application, nor delete credentials or documents of others
        assert c.execute("UPDATE admission.applications SET answers = '{}' WHERE application_id = %s", (world["a1"],)).rowcount == 0
        assert c.execute("DELETE FROM admission.applicant_credentials").rowcount == 0
        assert c.execute("DELETE FROM admission.application_documents WHERE application_id = %s", (world["a1"],)).rowcount == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, a2, "applicant") as c:
            c.execute("INSERT INTO admission.applications (org_code, form_id, reference_no, created_by) VALUES (%s, %s, 'APP-YYYY-YYYY', 'x')",
                      (DEMO, world["a"]["form"]["form_id"]))
    with pytest.raises(psycopg.errors.CheckViolation, match="cannot change from draft to approved"):
        with db.tenant(DEMO, a2, "applicant") as c:   # the status machine: an applicant cannot approve themselves
            c.execute("UPDATE admission.applications SET status = 'approved' WHERE application_id = %s", (a2,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.tenant(DEMO, a2, "applicant") as c:   # nor touch staff fields
            c.execute("UPDATE admission.applications SET label = 'VIP' WHERE application_id = %s", (a2,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, a2, "applicant") as c:
            c.execute("INSERT INTO admission.applicant_credentials (org_code, form_id, application_id, username, password_hash, expires_at, "
                      "issued_by) VALUES (%s, %s, %s, 'DEMO-ABCDEFGH', 'x', NOW() + interval '1 day', 'x')",
                      (DEMO, world["a"]["form"]["form_id"], a2))
    # once submitted, an applicant cannot change the answers (database rule, not only the API)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.tenant(DEMO, str(world["a1"]), "applicant") as c:
            c.execute("UPDATE admission.applications SET answers = '{}' WHERE application_id = %s", (world["a1"],))


def test_the_login_gate_sees_only_what_sign_in_needs(world):
    with db.tenant(DEMO, "anonymous", "applicant_gate") as c:
        assert count(c, "applicant_credentials") == db.fetch_one(
            "SELECT COUNT(*) AS n FROM admission.applicant_credentials WHERE org_code = %s", (DEMO,))["n"]
        for t in ("applications", "application_documents", "application_status_history", "application_comments", "recovery_requests"):
            assert count(c, t) == 0, t
        assert count(c, "forms", "status = 'draft'") == 0
        for t in CRM:
            assert count(c, t) == 0, t
        assert count(c, "consent_versions") == 0 and count(c, "audit_log") == 0
        c.execute("INSERT INTO admission.recovery_requests (org_code, form_id, username, contact) VALUES (admission.current_org(), %s, "
                  "'DEMO-GATETEST', 'gate@example.com')", (world["a"]["form"]["form_id"],))
        assert c.execute("UPDATE admission.recovery_requests SET status = 'resolved'").rowcount == 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, "anonymous", "applicant_gate") as c:
            c.execute("INSERT INTO admission.recovery_requests (org_code, form_id, username, contact, status, resolved_by) "
                      "VALUES (admission.current_org(), %s, 'X', 'x@example.com', 'resolved', 'me')", (world["a"]["form"]["form_id"],))


@pytest.mark.parametrize("role", ["parent", "reviewer", "student", "hacker"])
def test_other_roles_see_nothing_in_the_new_tables(world, role):
    with db.tenant(DEMO, "DEMO-P0001" if role == "parent" else "SOMEONE", role) as c:
        for t in NEW:
            assert count(c, t) == 0, (role, t)
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, "SOMEONE", role) as c:
            c.execute("INSERT INTO admission.forms (org_code, title, definition, created_by) VALUES (%s, 'x', '{}', 'SOMEONE')", (DEMO,))


# ---------------------------------------------------------------- database-enforced invariants
def test_status_machine_one_time_credentials_and_append_only_history(world):
    with pytest.raises(psycopg.errors.CheckViolation, match="cannot change from submitted to draft"):
        with db.tenant(DEMO, "TEST", "orgadmin") as c:
            c.execute("UPDATE admission.applications SET status = 'draft' WHERE application_id = %s", (world["a1"],))
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="Only the applicant submits"):
        with db.tenant(DEMO, world["priya"], "teacher") as c:
            c.execute("UPDATE admission.applications SET status = 'submitted', student_name = 'x', date_of_birth = '2014-01-01', "
                      "grade_applying = 7 WHERE application_id = %s", (world["a2"],))
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="Only the applicant changes the answers"):
        with db.tenant(DEMO, world["priya"], "teacher") as c:
            c.execute("UPDATE admission.applications SET answers = '{\"x\": 1}' WHERE application_id = %s", (world["a1"],))
    # a removed credential can never be revived, and a live one cannot get a new password
    with pytest.raises(psycopg.errors.CheckViolation, match="cannot be reactivated"):
        with db.tenant(DEMO, "TEST", "orgadmin") as c:
            c.execute("UPDATE admission.applicant_credentials SET status = 'issued', password_hash = 'x' WHERE application_id = %s",
                      (world["a1"],))
    with pytest.raises(psycopg.errors.CheckViolation, match="cannot be replaced"):
        with db.tenant(DEMO, "TEST", "orgadmin") as c:
            c.execute("UPDATE admission.applicant_credentials SET password_hash = '$2b$12$abc' WHERE credential_id = %s", (world["a2_cred"],))
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("UPDATE admission.applicant_credentials SET status = 'revoked' WHERE credential_id = %s", (world["a2_cred"],))  # hash must go
    for t, col in (("application_status_history", "note"), ("application_comments", "body"), ("form_versions", "published_by")):
        with pytest.raises(psycopg.errors.InsufficientPrivilege, match="append-only"):
            with db.tenant(DEMO, "TEST", "orgadmin") as c:
                c.execute(f"UPDATE admission.{t} SET {col} = 'changed' WHERE org_code = %s", (DEMO,))
        with pytest.raises(psycopg.errors.InsufficientPrivilege, match="append-only"):
            with db.tenant(DEMO, "TEST", "orgadmin") as c:
                c.execute(f"DELETE FROM admission.{t} WHERE org_code = %s", (DEMO,))
    # erasing a whole application still works (its history and comments go with it)
    app = db.fetch_one("SELECT application_id FROM admission.applications WHERE application_id = %s", (world["a1"],))
    with db.tenant(DEMO, "TEST", "orgadmin") as c:
        assert c.execute("DELETE FROM admission.recovery_requests WHERE application_id = %s", (app["application_id"],)).rowcount >= 0
        assert c.execute("DELETE FROM admission.applications WHERE application_id = %s", (app["application_id"],)).rowcount == 1
    assert db.fetch_one("SELECT COUNT(*) AS n FROM admission.application_status_history WHERE application_id = %s",
                        (app["application_id"],))["n"] == 0


def test_no_context_means_no_rows(world):
    with db.get_tenant_pool().connection() as conn, conn.transaction():
        conn.execute("SET LOCAL ROLE admission_app")
        for t in NEW:
            assert conn.execute(f"SELECT COUNT(*) AS n FROM admission.{t}").fetchone()["n"] == 0, t
        # the SECURITY DEFINER slug lookup answers only for a published slug, with the school and form id only
        row = conn.execute("SELECT * FROM admission.resolve_form_slug(%s)", (world["a"]["form"]["slug"],)).fetchone()
        assert set(row) == {"org_code", "form_id"} and row["org_code"] == DEMO
        assert conn.execute("SELECT * FROM admission.resolve_form_slug('nope-nope-nope')").fetchone() is None
        # status lookup needs a school context; without one it finds nothing
        assert conn.execute("SELECT * FROM admission.lookup_application_status(%s, 'APP-AAAA-AAAA', '2014-01-01')",
                            (uuid.UUID(str(world["a"]["form"]["form_id"])),)).fetchone() is None
