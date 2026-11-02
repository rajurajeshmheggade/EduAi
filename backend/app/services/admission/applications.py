"""Application workflow shared by the staff router, the applicant router and the admission-test hook: one-time
credentials (issue / remove), status changes with history, the copy into the admissions CRM, notifications.

Every function takes an open `db.tenant(...)` connection, so row-level security applies to the caller. Steps that a
caller's role may not do itself (ending applicant sessions, copying a submission into applicants / guardians /
consents) run under `as_system`, which switches the transaction's actor to `admission_system` and back; that role is
never carried by a token.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import date, timedelta
from typing import Iterator

from psycopg.types.json import Jsonb

from ... import db
from ...security import hash_password
from .. import notifications
from . import applicant_auth as auth
from .forms import core_values, grade_label

log = logging.getLogger("eduai.admission.forms")
LIVE = ("issued", "in_use")
EDITABLE = ("draft", "correction_requested")
QUEUE = ("submitted", "resubmitted", "under_review")
FINAL = ("approved", "rejected")
STATUS_LABEL = {"draft": "Draft", "test_pending": "Awaiting admission test", "submitted": "Submitted", "under_review": "Under review",
                "correction_requested": "Corrections requested", "resubmitted": "Resubmitted", "approved": "Approved",
                "rejected": "Not approved"}
SYSTEM = "admission_system"


def ctx(c) -> tuple[str, str]:
    row = c.execute("SELECT admission.current_actor_role() AS r, admission.current_actor() AS a").fetchone()
    return row["r"], row["a"]


@contextmanager
def as_system(c, actor: str) -> Iterator[None]:
    role, who = ctx(c)
    c.execute("SELECT set_config('app.user_role', %s, true), set_config('app.user_code', %s, true)", (SYSTEM, actor[:64]))
    yield   # on an exception the whole transaction rolls back, so the context is not restored
    c.execute("SELECT set_config('app.user_role', %s, true), set_config('app.user_code', %s, true)", (role, who))


def audit(c, actor_code: str, actor_role: str, action: str, entity: str, entity_id=None, details: dict | None = None,
          ip: str | None = None) -> None:
    """Append-only audit entry (identifiers only, never names, answers or passwords)."""
    c.execute("INSERT INTO admission.audit_log (org_code, actor_code, actor_role, action, entity, entity_id, details, ip) "
              "VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s, %s)",
              (actor_code[:64], actor_role[:16], action, entity, str(entity_id) if entity_id else None, Jsonb(details or {}), ip))


# ---------------------------------------------------------------- credentials
def credential_expiry(form: dict, purpose: str, valid_days: int | None = None):
    exp = auth.now() + timedelta(days=valid_days or form["credential_valid_days"])
    if purpose == "new" and form.get("closes_at") and form["closes_at"] < exp:
        exp = form["closes_at"]
    return exp


def issue_credential(c, form: dict, application_id, *, purpose: str, actor: str, replaces=None) -> dict:
    """Creates a live credential and returns it WITH the plain-text password (show once, never store)."""
    password = auth.new_password()
    expires = credential_expiry(form, purpose)
    for _ in range(5):   # username collisions are astronomically rare; retry rather than fail
        username = auth.new_username(form["org_code"])
        if not c.execute("SELECT 1 FROM admission.applicant_credentials WHERE username = %s", (username,)).fetchone():
            break
    row = c.execute(
        "INSERT INTO admission.applicant_credentials (org_code, form_id, application_id, username, password_hash, purpose, "
        "replaces_credential_id, expires_at, issued_by) VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s, %s, %s) "
        "RETURNING credential_id, username, status, purpose, expires_at, issued_at",
        (form["form_id"], application_id, username, hash_password(password), purpose, replaces, expires, actor)).fetchone()
    return {**row, "password": password}


def end_sessions(c, application_id, reason: str) -> int:
    with as_system(c, f"app:{application_id}"):
        return c.execute("UPDATE admission.applicant_sessions SET revoked_at = NOW(), revoke_reason = %s "
                         "WHERE application_id = %s AND revoked_at IS NULL", (reason, application_id)).rowcount


def remove_credentials(c, application_id, *, reason: str, actor: str) -> int:
    """Wipe the hash and revoke every live credential of the application, and end its sessions."""
    status = {"submitted": "submitted", "test_submitted": "submitted", "expired": "expired"}.get(reason, "revoked")
    n = c.execute("UPDATE admission.applicant_credentials SET status = %s, password_hash = NULL, revoked_at = NOW(), "
                  "revoked_by = %s, revoke_reason = %s WHERE application_id = %s AND status IN ('issued','in_use')",
                  (status, actor[:64], reason, application_id)).rowcount
    end_sessions(c, application_id, reason)
    return n


def expire_due(c, *, form_id=None, application_id=None, actor: str = "system") -> int:
    """Lazily mark credentials past their expiry as expired (the hash goes too)."""
    rows = c.execute("SELECT credential_id, application_id FROM admission.applicant_credentials WHERE status IN ('issued','in_use') "
                     "AND expires_at < NOW() AND (%s::uuid IS NULL OR form_id = %s::uuid) AND (%s::uuid IS NULL OR application_id = %s::uuid)",
                     (form_id, form_id, application_id, application_id)).fetchall()
    for r in rows:
        c.execute("UPDATE admission.applicant_credentials SET status = 'expired', password_hash = NULL, revoked_at = NOW(), "
                  "revoked_by = %s, revoke_reason = 'expired' WHERE credential_id = %s AND status IN ('issued','in_use')",
                  (actor[:64], r["credential_id"]))
        end_sessions(c, r["application_id"], "expired")
    return len(rows)


def credential_view(r: dict) -> dict:
    st = r["status"]
    if st in LIVE and r["expires_at"] < auth.now():
        st = "expired"
    return {k: r.get(k) for k in ("credential_id", "application_id", "username", "purpose", "issued_by", "issued_at", "expires_at",
                                  "acknowledged_at", "acknowledged_by", "acknowledged_items", "first_login_at", "last_login_at",
                                  "revoked_at", "revoke_reason", "locked_until")} | {"status": st}


# ---------------------------------------------------------------- applications
def create_application(c, form: dict, *, actor: str, label: str | None = None) -> dict:
    version = c.execute("SELECT version_id FROM admission.form_versions WHERE form_id = %s AND version = %s",
                        (form["form_id"], form["published_version"])).fetchone()
    for _ in range(5):
        ref = auth.new_reference()
        if not c.execute("SELECT 1 FROM admission.applications WHERE reference_no = %s", (ref,)).fetchone():
            break
    return c.execute(
        "INSERT INTO admission.applications (org_code, form_id, version_id, reference_no, label, created_by) "
        "VALUES (admission.current_org(), %s, %s, %s, %s, %s) RETURNING *",
        (form["form_id"], version["version_id"] if version else None, ref, label, actor)).fetchone()


def record(c, application_id, from_status: str | None, to_status: str, *, actor: str, role: str, note: str | None = None,
           visible: bool = False) -> None:
    c.execute("INSERT INTO admission.application_status_history (org_code, application_id, from_status, to_status, actor_code, "
              "actor_role, note, visible_to_applicant) VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s, %s)",
              (application_id, from_status, to_status, actor[:64], role[:16], note, visible))


def _gender(v) -> str:
    v = (v or "").strip().lower()
    return v if v in ("female", "male", "other") else "undisclosed"


def _relationship(v) -> str:
    v = (v or "").strip().lower()
    return v if v in ("mother", "father") else "guardian"


def sync_crm(c, app: dict, defn: dict, *, consent: dict | None = None, ip: str | None = None, user_agent: str | None = None) -> None:
    """Copy a submitted application into admission.applicants / guardians (Admissions home, counsellor list) and record
    the guardian's consent given in the applicant app. Idempotent per application."""
    core = core_values(defn, app["answers"])
    with as_system(c, f"app:{app['application_id']}"):
        dob = core.get("date_of_birth")
        args = (core.get("student_name"), dob, _gender(core.get("gender")) if core.get("gender") else None,
                int(core["grade_applying"]), core.get("previous_school"), app["status"])
        if app.get("applicant_id"):
            applicant_id = app["applicant_id"]
            c.execute("UPDATE admission.applicants SET full_name = %s, date_of_birth = %s, gender = %s, grade_applying = %s, "
                      "previous_school = %s, status = %s, updated_at = NOW() WHERE applicant_id = %s", (*args, applicant_id))
        else:
            applicant_id = c.execute(
                "INSERT INTO admission.applicants (org_code, full_name, date_of_birth, gender, grade_applying, previous_school, "
                "status, created_by) VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s, %s) RETURNING applicant_id",
                (*args, f"app:{app['application_id']}"[:64])).fetchone()["applicant_id"]
            c.execute("UPDATE admission.applications SET applicant_id = %s WHERE application_id = %s", (applicant_id, app["application_id"]))
        g = c.execute("SELECT ag.guardian_id FROM admission.applicant_guardians ag WHERE ag.applicant_id = %s AND ag.is_primary LIMIT 1",
                      (applicant_id,)).fetchone()
        gargs = (core.get("guardian_name"), _relationship(core.get("guardian_relationship")), core.get("guardian_phone"),
                 core.get("guardian_email"))
        if g:
            guardian_id = g["guardian_id"]
            c.execute("UPDATE admission.guardians SET full_name = %s, relationship = %s, phone = %s, email = %s WHERE guardian_id = %s",
                      (*gargs, guardian_id))
        else:
            guardian_id = c.execute("INSERT INTO admission.guardians (org_code, full_name, relationship, phone, email) "
                                    "VALUES (admission.current_org(), %s, %s, %s, %s) RETURNING guardian_id", gargs).fetchone()["guardian_id"]
            c.execute("INSERT INTO admission.applicant_guardians (org_code, applicant_id, guardian_id, is_primary) "
                      "VALUES (admission.current_org(), %s, %s, TRUE)", (applicant_id, guardian_id))
        if consent:
            seen = c.execute("SELECT 1 FROM admission.consents WHERE applicant_id = %s AND version_id = %s AND decision = 'granted' "
                             "AND method = 'applicant_app'", (applicant_id, consent["version_id"])).fetchone()
            if not seen:
                c.execute("INSERT INTO admission.consents (org_code, applicant_id, guardian_id, version_id, version, language, "
                          "decision, method, ip, user_agent, recorded_by) VALUES (admission.current_org(), %s, %s, %s, %s, %s, "
                          "'granted', 'applicant_app', %s, %s, %s)",
                          (applicant_id, guardian_id, consent["version_id"], consent["version"], consent["language"], ip,
                           (user_agent or "")[:300] or None, f"app:{app['application_id']}"[:64]))


def set_crm_status(c, app: dict, status: str) -> None:
    if app.get("applicant_id"):
        with as_system(c, f"app:{app['application_id']}"):
            c.execute("UPDATE admission.applicants SET status = %s, updated_at = NOW() WHERE applicant_id = %s",
                      (status, app["applicant_id"]))


# ---------------------------------------------------------------- notifications (public.notifications, main pool)
def owner_link(owner_code: str, application_id) -> str:
    u = db.fetch_one("SELECT user_role FROM public.app_users WHERE user_code = %s", (owner_code,))
    if u and u["user_role"] == "teacher":
        return f"/teacher/admission-forms?application={application_id}"
    if u and u["user_role"] == "counsellor":
        return f"/admissions/applications?application={application_id}"
    return f"/admin-dashboard?tab=admission-forms&application={application_id}"


def notify_owner(org: str, form: dict, app: dict, kind: str, *, actor: str | None = None) -> None:
    """In-app notification to the form's owner (identifiers and the form title only — no applicant data)."""
    owner = form["created_by"]
    if actor and actor == owner:
        return
    ref = app.get("reference_no")
    if kind == "submitted":
        title, body = f"New admission application · {form['title']}", f"Application {ref} is waiting in your review queue."
    elif kind == "resubmitted":
        title, body = f"Corrected application received · {form['title']}", f"Application {ref} was corrected and resubmitted."
    elif kind == "decided":
        title, body = f"Application {ref} updated · {form['title']}", f"Status: {STATUS_LABEL.get(app['status'], app['status'])}."
    else:
        title, body = f"Credential recovery request · {form['title']}", "An applicant asked for help signing in. Review it under Credentials."
    if app.get("application_id"):
        link = owner_link(owner, app["application_id"])
    else:
        role = (db.fetch_one("SELECT user_role FROM public.app_users WHERE user_code = %s", (owner,)) or {}).get("user_role")
        link = "/teacher/admission-forms?view=recovery" if role == "teacher" else (
            "/admissions/applications?view=recovery" if role == "counsellor" else "/admin-dashboard?tab=admission-forms&view=recovery")
    subject = app.get("application_id") or app.get("request_id")
    try:
        notifications.notify(org, owner, "ADMISSION_APPLICATION" if kind != "recovery" else "ADMISSION_RECOVERY", title[:300], body, link,
                             f"adm-form:{kind}:{subject}:{app.get('submission_count', 0)}:{app.get('status', '')}")
    except Exception:  # noqa: BLE001 — a notification never blocks a submission
        log.exception("admission notification failed")


# ---------------------------------------------------------------- admission test hook
def on_exam_finished(session: dict) -> None:
    """Called by the exam engine whenever an admission-test session ends. For a test taken from the applicant app this
    completes the application: status submitted, credential removed, sessions ended, teacher notified."""
    if session.get("origin") != "applicant":
        return
    org = session["org_code"]
    with db.tenant(org, f"exam:{session['session_id']}", SYSTEM) as c:
        app = c.execute("SELECT * FROM admission.applications WHERE exam_session_id = %s FOR UPDATE",
                        (session["session_id"],)).fetchone()
        if not app or app["status"] != "test_pending":
            return
        finalise_after_test(c, app)
        form = c.execute("SELECT * FROM admission.forms WHERE form_id = %s", (app["form_id"],)).fetchone()
        app = c.execute("SELECT * FROM admission.applications WHERE application_id = %s", (app["application_id"],)).fetchone()
    notify_owner(org, form, app, "submitted")


def finalise_after_test(c, app: dict) -> None:
    actor = f"app:{app['application_id']}"
    with as_system(c, actor):
        c.execute("UPDATE admission.applications SET status = 'submitted' WHERE application_id = %s", (app["application_id"],))
        record(c, app["application_id"], "test_pending", "submitted", actor=actor, role=SYSTEM, note="Admission test completed")
        remove_credentials(c, app["application_id"], reason="test_submitted", actor=actor)
        set_crm_status(c, app, "submitted")
        audit(c, actor, SYSTEM, "application.test_completed", "application", app["application_id"],
              {"exam_session_id": str(app["exam_session_id"])})


def exam_done(session_id) -> bool:
    if not session_id:
        return False
    s = db.fetch_one("SELECT status FROM public.admission_sessions WHERE session_id = %s", (session_id,))
    return bool(s and s["status"] in ("SUBMITTED", "ENDED"))


def minor(dob) -> bool:
    if not dob:
        return True
    d = dob if isinstance(dob, date) else date.fromisoformat(str(dob))
    t = date.today()
    return t.year - d.year - ((t.month, t.day) < (d.month, d.day)) < 18


__all__ = ["grade_label"]
