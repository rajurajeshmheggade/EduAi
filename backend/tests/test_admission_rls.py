"""Pravesh Milestone 1 acceptance: two schools can never see or change each other's data.

Database level: every table in the `admission` schema is checked for row-level security, then every table is
queried / updated / deleted / inserted as the application role for one school, proving rows of the other school are
invisible and untouchable. Family isolation for parents and the API layer are tested on top of that.
Seed (scripts/seed_admission.py): DEMO-SCHOOL (CBSE, 8 applicants), SVM-ICSE (3), KPS-STATE (2).
"""
import uuid

import psycopg
import pytest

from app import db

A = "/ICMELive/api/v1/admission"
DEMO, SVM, KPS = "DEMO-SCHOOL", "SVM-ICSE", "KPS-STATE"
NS = uuid.UUID("6a1f0f3e-5b2a-4d0e-9a51-7a6f3f0c2b11")


def sid(*parts):
    return str(uuid.uuid5(NS, "/".join(parts)))


def tables():
    return [r["relname"] for r in db.fetch_all(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'admission' AND c.relkind = 'r' ORDER BY c.relname")]


# ---------------------------------------------------------------- structure
def test_every_admission_table_is_tenant_scoped_with_forced_rls():
    ts = tables()
    assert len(ts) >= 9
    for t in ts:
        cols = {r["column_name"] for r in db.fetch_all(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'admission' AND table_name = %s", (t,))}
        assert "org_code" in cols, t
        flags = db.fetch_one("SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                             "WHERE n.nspname = 'admission' AND c.relname = %s", (t,))
        assert flags["relrowsecurity"] and flags["relforcerowsecurity"], t
        pols = {r["policyname"] for r in db.fetch_all("SELECT policyname FROM pg_policies WHERE schemaname = 'admission' AND tablename = %s", (t,))}
        assert "tenant_isolation" in pols, t
    role = db.fetch_one("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'admission_app'")
    assert role == {"rolsuper": False, "rolbypassrls": False}


def test_evidence_tables_are_append_only_for_the_app():
    for t in ("consents", "audit_log"):
        priv = db.fetch_one("SELECT has_table_privilege('admission_app', %s, 'UPDATE') AS u, "
                            "has_table_privilege('admission_app', %s, 'DELETE') AS d, "
                            "has_table_privilege('admission_app', %s, 'INSERT') AS i", (f"admission.{t}",) * 3)
        assert priv == {"u": False, "d": False, "i": True}, t


# ---------------------------------------------------------------- data isolation, every table
@pytest.mark.parametrize("school,other", [(DEMO, SVM), (SVM, DEMO), (KPS, DEMO)])
def test_each_table_shows_and_changes_only_own_school(school, other):
    for t in tables():
        expected = db.fetch_one(f"SELECT COUNT(*) AS n FROM admission.{t} WHERE org_code = %s", (school,))["n"]
        others = db.fetch_one(f"SELECT COUNT(*) AS n FROM admission.{t} WHERE org_code = %s", (other,))["n"]
        with db.tenant(school, "TEST", "orgadmin") as c:
            seen = c.execute(f"SELECT DISTINCT org_code FROM admission.{t}").fetchall()
            assert {r["org_code"] for r in seen} <= {school}, t
            assert c.execute(f"SELECT COUNT(*) AS n FROM admission.{t}").fetchone()["n"] == expected, t
            # even an explicit filter for the other school returns nothing
            assert c.execute(f"SELECT COUNT(*) AS n FROM admission.{t} WHERE org_code = %s", (other,)).fetchone()["n"] == 0, t
            if t not in ("consents", "audit_log"):
                assert c.execute(f"UPDATE admission.{t} SET org_code = org_code WHERE org_code = %s", (other,)).rowcount == 0, t
                assert c.execute(f"DELETE FROM admission.{t} WHERE org_code = %s", (other,)).rowcount == 0, t
        # the other school's rows are all still there
        assert db.fetch_one(f"SELECT COUNT(*) AS n FROM admission.{t} WHERE org_code = %s", (other,))["n"] == others, t


def test_cannot_write_rows_for_another_school():
    inserts = [
        ("INSERT INTO admission.applicants (org_code, full_name, grade_applying) VALUES (%s, 'Intruder', 7)", (SVM,)),
        ("INSERT INTO admission.consent_versions (org_code, version, language, title, body) VALUES (%s, 99, 'en', 'x', 'y')", (SVM,)),
        ("INSERT INTO admission.audit_log (org_code, actor_code, actor_role, action, entity) VALUES (%s, 'X', 'orgadmin', 'x', 'y')", (SVM,)),
        ("INSERT INTO admission.retention_policies (org_code, data_class, retain_days) VALUES (%s, 'proctor_events', 5)", (SVM,)),
        ("INSERT INTO admission.breach_log (org_code, detected_at, nature, created_by) VALUES (%s, NOW(), 'test entry', 'X')", (SVM,)),
        ("INSERT INTO admission.data_requests (org_code, kind, due_at, created_by) VALUES (%s, 'access', NOW(), 'X')", (SVM,)),
    ]
    for sql, args in inserts:
        with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
            with db.tenant(DEMO, "TEST", "orgadmin") as c:
                c.execute(sql, args)
    # moving one of your own rows into another school is refused too
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, "TEST", "orgadmin") as c:
            c.execute("UPDATE admission.applicants SET org_code = %s WHERE applicant_id = %s", (SVM, sid(DEMO, "applicant", "Rahul Nair")))


def test_no_school_context_means_no_rows_and_no_escalation():
    with db.get_tenant_pool().connection() as conn:
        with conn.transaction():
            assert conn.execute("SELECT session_user AS s").fetchone()["s"] == "admission_login"
            conn.execute("SET LOCAL ROLE admission_app")
            for t in tables():
                assert conn.execute(f"SELECT COUNT(*) AS n FROM admission.{t}").fetchone()["n"] == 0, t
    # SQL running in a tenant session cannot become the owner / superuser ...
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="permission denied to set role"):
        with db.tenant(DEMO, "TEST", "orgadmin") as c:
            c.execute("SET LOCAL ROLE postgres")
    # ... and dropping back to the login role leaves no table access at all (NOINHERIT)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.tenant(DEMO, "TEST", "orgadmin") as c:
            c.execute("RESET ROLE")
            c.execute("SELECT COUNT(*) FROM admission.applicants")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.tenant(DEMO, "TEST", "orgadmin") as c:
            c.execute("SELECT COUNT(*) FROM public.app_users")   # nothing outside the admission schema


def test_tenant_context_does_not_leak_to_pooled_connections():
    with db.tenant(SVM, "TEST", "orgadmin") as c:
        assert c.execute("SELECT current_user AS u").fetchone()["u"] == "admission_app"
    for _ in range(5):   # pooled tenant connections come back as the bare login role with no school set
        with db.get_tenant_pool().connection() as conn:
            row = conn.execute("SELECT current_user AS u, current_setting('app.org_code', true) AS org").fetchone()
            assert row["u"] == "admission_login" and (row["org"] or "") == ""
    assert db.fetch_one("SELECT current_user AS u")["u"] == "postgres"   # the main pool is unaffected


# ---------------------------------------------------------------- family isolation (parents)
def test_parent_sees_only_own_family_and_no_staff_tables():
    with db.tenant(DEMO, "DEMO-P0001", "parent") as c:
        names = sorted(r["full_name"] for r in c.execute("SELECT full_name FROM admission.applicants").fetchall())
        assert names == ["Aarav Verma", "Diya Verma"]
        assert [r["full_name"] for r in c.execute("SELECT full_name FROM admission.guardians").fetchall()] == ["Sunita Verma"]
        assert {r["applicant_id"] for r in c.execute("SELECT applicant_id FROM admission.consents").fetchall()} <= {
            uuid.UUID(sid(DEMO, "applicant", "Aarav Verma")), uuid.UUID(sid(DEMO, "applicant", "Diya Verma"))}
        for t in ("retention_policies", "audit_log", "breach_log"):
            assert c.execute(f"SELECT COUNT(*) AS n FROM admission.{t}").fetchone()["n"] == 0, t
        # the consent notice itself is readable
        assert c.execute("SELECT COUNT(*) AS n FROM admission.consent_versions").fetchone()["n"] >= 4
    # consenting for another family's child, or creating applicants, is refused by the database
    other = sid(DEMO, "applicant", "Ayaan Irfan")
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, "DEMO-P0001", "parent") as c:
            c.execute("INSERT INTO admission.consents (org_code, applicant_id, version_id, version, language, decision, method, recorded_by) "
                      "VALUES (%s, %s, %s, 1, 'en', 'granted', 'parent_portal', 'DEMO-P0001')", (DEMO, other, sid(DEMO, "consent", "1", "en")))
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with db.tenant(DEMO, "DEMO-P0001", "parent") as c:
            c.execute("INSERT INTO admission.applicants (org_code, full_name, grade_applying) VALUES (%s, 'Sneaky', 6)", (DEMO,))


def test_erasure_keeps_consent_evidence_without_the_child():
    aid, gid = str(uuid.uuid4()), sid(DEMO, "guardian", "Kavitha Banerjee")
    db.execute("INSERT INTO admission.applicants (applicant_id, org_code, full_name, grade_applying) VALUES (%s, %s, 'To Erase', 6)", (aid, DEMO))
    db.execute("INSERT INTO admission.applicant_guardians (org_code, applicant_id, guardian_id) VALUES (%s, %s, %s)", (DEMO, aid, gid))
    db.execute("INSERT INTO admission.consents (org_code, applicant_id, guardian_id, version_id, version, language, decision, method, recorded_by) "
               "VALUES (%s, %s, %s, %s, 1, 'en', 'granted', 'in_person', 'TEST')", (DEMO, aid, gid, sid(DEMO, "consent", "1", "en")))
    with db.tenant(DEMO, "TEST", "orgadmin") as c:
        assert c.execute("DELETE FROM admission.applicants WHERE applicant_id = %s", (aid,)).rowcount == 1
    row = db.fetch_one("SELECT applicant_id, decision FROM admission.consents WHERE recorded_by = 'TEST' AND language = 'en' "
                       "AND method = 'in_person' ORDER BY created_at DESC LIMIT 1")
    assert row == {"applicant_id": None, "decision": "granted"}


def test_retention_job_purges_old_audit_entries_per_school():
    from datetime import datetime, timedelta, timezone

    from scripts import admission_retention

    old = datetime.now(timezone.utc) - timedelta(days=400)
    for org in (DEMO, SVM):
        db.execute("INSERT INTO admission.audit_log (org_code, actor_code, actor_role, action, entity, created_at) "
                   "VALUES (%s, 'RET-TEST', 'orgadmin', 'retention.test', 'test', %s)", (org, old))
    # SVM keeps logs for 3 years; DEMO uses the 365-day default (and nothing can go below the one-year minimum)
    db.execute("INSERT INTO admission.retention_policies (org_code, data_class, retain_days) VALUES (%s, 'audit_log', 1095) "
               "ON CONFLICT (org_code, data_class) DO UPDATE SET retain_days = 1095", (SVM,))
    dry = {(r["org"], r["data_class"]): r for r in admission_retention.run(dry_run=True)}
    assert dry[(DEMO, "audit_log")]["deleted"] >= 1 and dry[(SVM, "audit_log")]["deleted"] == 0
    assert db.fetch_one("SELECT COUNT(*) AS n FROM admission.audit_log WHERE actor_code = 'RET-TEST'")["n"] == 2   # dry run deletes nothing
    report = {(r["org"], r["data_class"]): r for r in admission_retention.run()}
    assert report[(DEMO, "proctor_snapshots")]["note"].startswith("not yet applicable")
    left = {r["org_code"] for r in db.fetch_all("SELECT org_code FROM admission.audit_log WHERE actor_code = 'RET-TEST'")}
    assert left == {SVM}
