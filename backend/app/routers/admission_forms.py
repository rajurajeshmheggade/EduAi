"""Admission forms (Teacher → Admission forms; Admin console → Admission forms): build, preview and publish a form,
issue one-time applicant credentials, review applications.

Teachers work on their own forms; org admins, super-admins (with ?org_code=) and counsellors on every form of the
school. Row-level security enforces the same (db.tenant with the caller's role); the checks here are a second layer.

GET  /form-meta · GET|POST /forms · GET|PUT|DELETE /forms/{id} · POST /forms/{id}/publish|close|reopen
GET|POST /forms/{id}/credentials · POST /credentials/{id}/acknowledge|revoke|reissue
GET  /recovery-requests · POST /recovery-requests/{id}/dismiss
GET  /applications · GET /applications/{id} · POST /applications/{id}/decision|comments
POST /applications/{id}/documents/{doc}/link · POST /applications/{id}/documents/zip-link · GET /document-download/{token}
GET|PUT /branding · POST|DELETE /branding/logo
"""
from __future__ import annotations

import re
import secrets
import tempfile
import zipfile
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, ValidationError, field_validator

from .. import db
from ..security import ADMIN_ROLES, CurrentUser, require_role
from ..services.admission import applicant_auth as auth
from ..services.admission import applications as wf
from ..services.admission.forms import GRADES, Definition, default_definition, grade_label
from ..services.admission_test import guard
from ..services.storage import get_storage
from ..services.uploads import content_disposition, validate_upload
from .admin import org_scope
from .admission import _ip

router = APIRouter(prefix="/ICMELive/api/v1/admission", tags=["admission-forms"], dependencies=[Depends(guard.no_store)])
builders = require_role("teacher", "orgadmin", "superadmin", "counsellor")
admins = require_role("orgadmin", "superadmin")
ACK_MESSAGE = "Admission application credentials have been copied successfully. Please save these credentials securely."
LOGO_MAX = 1024 * 1024
DOWNLOAD_MINUTES = 5


# ---------------------------------------------------------------- helpers
def _org(user: CurrentUser, org_code: str | None) -> str:
    return org_scope(user, org_code) if user.role in ADMIN_ROLES else user.org_code


def _tx(user: CurrentUser, org: str):
    return db.tenant(org, user.user_code, user.role)


def _form(c, form_id: UUID, *, lock: bool = False) -> dict:
    f = c.execute("SELECT * FROM admission.forms WHERE form_id = %s" + (" FOR UPDATE" if lock else ""), (form_id,)).fetchone()
    if not f:
        raise HTTPException(404, "Admission form not found")
    return f


def _application(c, application_id: UUID, *, lock: bool = False) -> dict:
    a = c.execute("SELECT * FROM admission.applications WHERE application_id = %s" + (" FOR UPDATE" if lock else ""),
                  (application_id,)).fetchone()
    if not a:
        raise HTTPException(404, "Application not found")
    return a


def _names(codes) -> dict[str, str]:
    codes = sorted({c for c in codes if c})
    if not codes:
        return {}
    return {r["user_code"]: r["full_name"] for r in db.fetch_all(
        "SELECT user_code, full_name FROM public.app_users WHERE user_code = ANY(%s)", (codes,))}


def _test_info(test_id) -> dict | None:
    if not test_id:
        return None
    t = db.fetch_one("SELECT test_id, title, status, duration_minutes, grade_applying, created_by FROM public.admission_tests "
                     "WHERE test_id = %s", (test_id,))
    return t


def _school(org: str) -> dict:
    o = db.fetch_one("SELECT org_name, brand_display_name FROM public.organizations WHERE org_code = %s", (org,)) or {}
    return {"name": o.get("brand_display_name") or o.get("org_name") or org}


def _path(slug: str | None) -> str | None:
    return f"/apply/{slug}" if slug else None


def _credential_payload(form: dict, cred: dict, application: dict) -> dict:
    """The pop-up content. The password exists only in this response."""
    return {"credential_id": cred["credential_id"], "application_id": application["application_id"], "username": cred["username"],
            "password": cred["password"], "expires_at": cred["expires_at"], "purpose": cred["purpose"],
            "application_name": form["title"], "application_path": _path(form["slug"]), "school_name": _school(form["org_code"])["name"]}


COUNTS_SQL = (
    "SELECT f.form_id, "
    "(SELECT COUNT(*) FROM admission.applications a WHERE a.form_id = f.form_id) AS applications, "
    "(SELECT COUNT(*) FROM admission.applications a WHERE a.form_id = f.form_id AND a.status = 'draft') AS drafts, "
    "(SELECT COUNT(*) FROM admission.applications a WHERE a.form_id = f.form_id AND a.status = 'test_pending') AS test_pending, "
    "(SELECT COUNT(*) FROM admission.applications a WHERE a.form_id = f.form_id AND a.status IN ('submitted','resubmitted','under_review')) AS to_review, "
    "(SELECT COUNT(*) FROM admission.applications a WHERE a.form_id = f.form_id AND a.status = 'correction_requested') AS corrections, "
    "(SELECT COUNT(*) FROM admission.applications a WHERE a.form_id = f.form_id AND a.status = 'approved') AS approved, "
    "(SELECT COUNT(*) FROM admission.applications a WHERE a.form_id = f.form_id AND a.status = 'rejected') AS rejected, "
    "(SELECT COUNT(*) FROM admission.applicant_credentials k WHERE k.form_id = f.form_id AND k.status IN ('issued','in_use') "
    "   AND k.expires_at > NOW()) AS live_credentials, "
    "(SELECT COUNT(*) FROM admission.recovery_requests r WHERE r.form_id = f.form_id AND r.status = 'open') AS open_recovery "
    "FROM admission.forms f WHERE f.form_id = ANY(%s)")


def _form_views(c, rows: list[dict], *, with_definition: bool = False) -> list[dict]:
    if not rows:
        return []
    counts = {r["form_id"]: r for r in c.execute(COUNTS_SQL, ([r["form_id"] for r in rows],)).fetchall()}
    names = _names(r["created_by"] for r in rows)
    out = []
    for r in rows:
        v = {k: r[k] for k in ("form_id", "title", "description", "academic_year", "grades", "status", "slug", "published_version",
                               "has_unpublished_changes", "opens_at", "closes_at", "credential_valid_days", "linked_test_id",
                               "created_by", "created_at", "updated_at", "published_at")}
        cnt = dict(counts.get(r["form_id"]) or {})
        cnt.pop("form_id", None)
        v.update(application_path=_path(r["slug"]), owner_name=names.get(r["created_by"]), counts=cnt,
                 grade_labels=[grade_label(g) for g in r["grades"]], linked_test=_test_info(r["linked_test_id"]))
        if with_definition:
            v["definition"] = r["definition"]
        out.append(v)
    return out


def _form_view(c, row: dict) -> dict:
    v = _form_views(c, [row], with_definition=True)[0]
    v["versions"] = c.execute("SELECT version, published_by, published_at FROM admission.form_versions WHERE form_id = %s "
                              "ORDER BY version DESC", (row["form_id"],)).fetchall()
    return v


# ---------------------------------------------------------------- meta
@router.get("/form-meta")
def form_meta(org_code: str | None = None, user: CurrentUser = Depends(builders)):
    """Default template, grade labels and the admission tests this user may link to a form."""
    org = _org(user, org_code)
    tests = db.fetch_all("SELECT test_id, title, grade_applying, duration_minutes, status, created_by FROM public.admission_tests "
                         "WHERE org_code = %s AND status = 'PUBLISHED' AND (%s::text IS NULL OR created_by = %s::text) ORDER BY title",
                         (org, *([user.user_code] * 2 if user.role == "teacher" else [None] * 2)))
    return {"template": default_definition(), "grades": [{"value": g, "label": grade_label(g)} for g in GRADES],
            "linkable_tests": tests, "ack_message": ACK_MESSAGE,
            "limits": {"sections": 12, "fields_per_section": 40, "documents": 15, "max_mb": 10, "max_files": 5,
                       "credential_valid_days": [1, 365]}}


# ---------------------------------------------------------------- forms
Grade = Field(ge=-2, le=12)


class FormCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    academic_year: str | None = Field(default=None, max_length=20)
    grades: list[int] = Field(default_factory=lambda: list(range(1, 13)), max_length=15)


class FormIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    academic_year: str | None = Field(default=None, max_length=20)
    grades: list[int] = Field(max_length=15)
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    credential_valid_days: int = Field(default=30, ge=1, le=365)
    linked_test_id: UUID | None = None
    definition: Definition

    @field_validator("grades")
    @classmethod
    def _grades(cls, v: list[int]) -> list[int]:
        if any(g not in GRADES for g in v):
            raise ValueError("classes must be Nursery, LKG, UKG or Class 1–12")
        return sorted(set(v))

    @field_validator("title", "description", "academic_year")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return (v.strip() or None) if isinstance(v, str) else v


def _check_test(user: CurrentUser, org: str, test_id: UUID | None, *, published: bool) -> None:
    if not test_id:
        return
    t = db.fetch_one("SELECT status, created_by FROM public.admission_tests WHERE test_id = %s AND org_code = %s", (test_id, org))
    if not t or (user.role == "teacher" and t["created_by"] != user.user_code):
        raise HTTPException(422, "Choose one of your own admission tests")
    if published and t["status"] != "PUBLISHED":
        raise HTTPException(409, "Publish the linked admission test first")


@router.get("/forms")
def list_forms(org_code: str | None = None, user: CurrentUser = Depends(builders)):
    org = _org(user, org_code)
    with _tx(user, org) as c:
        wf.expire_due(c, actor=user.user_code)
        rows = c.execute("SELECT * FROM admission.forms WHERE status <> 'archived' ORDER BY updated_at DESC").fetchall()
        return {"forms": _form_views(c, rows)}


@router.post("/forms", status_code=201)
def create_form(body: FormCreate, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    org = _org(user, org_code)
    grades = sorted({g for g in body.grades if g in GRADES}) or list(range(1, 13))
    with _tx(user, org) as c:
        row = c.execute("INSERT INTO admission.forms (org_code, title, academic_year, definition, grades, created_by) "
                        "VALUES (admission.current_org(), %s, %s, %s, %s, %s) RETURNING *",
                        (body.title.strip(), (body.academic_year or "").strip() or None, Jsonb(default_definition()), grades,
                         user.user_code)).fetchone()
        wf.audit(c, user.user_code, user.role, "form.created", "admission_form", row["form_id"], {}, _ip(request))
        return _form_view(c, row)


@router.get("/forms/{form_id}")
def get_form(form_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        return _form_view(c, _form(c, form_id))


def _snapshot(f: dict) -> dict:
    return {**f["definition"], "title": f["title"], "description": f["description"], "grades": list(f["grades"]),
            "academic_year": f["academic_year"]}


@router.put("/forms/{form_id}")
def update_form(form_id: UUID, body: FormIn, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    """Saves the working copy. Before publication everything may change; afterwards edits wait for "Publish changes"
    (dates, credential validity and the linked test apply at once)."""
    org = _org(user, org_code)
    _check_test(user, org, body.linked_test_id, published=False)
    if body.closes_at and body.opens_at and body.closes_at <= body.opens_at:
        raise HTTPException(422, "The closing date must be after the opening date")
    with _tx(user, org) as c:
        f = _form(c, form_id, lock=True)
        if f["status"] == "archived":
            raise HTTPException(409, "This form is archived")
        if body.linked_test_id != f["linked_test_id"] and c.execute(
                "SELECT 1 FROM admission.applications WHERE form_id = %s AND (status = 'test_pending' OR exam_session_id IS NOT NULL) LIMIT 1",
                (form_id,)).fetchone():
            raise HTTPException(409, "Applicants are already taking the linked test; the test can no longer be changed")
        defn = body.definition.model_dump()
        row = c.execute(
            "UPDATE admission.forms SET title = %s, description = %s, academic_year = %s, grades = %s, opens_at = %s, closes_at = %s, "
            "credential_valid_days = %s, linked_test_id = %s, definition = %s, updated_at = NOW() WHERE form_id = %s RETURNING *",
            (body.title, body.description, body.academic_year, body.grades, body.opens_at, body.closes_at, body.credential_valid_days,
             body.linked_test_id, Jsonb(defn), form_id)).fetchone()
        if row["published_version"]:
            pub = c.execute("SELECT definition FROM admission.form_versions WHERE form_id = %s AND version = %s",
                            (form_id, row["published_version"])).fetchone()
            changed = pub["definition"] != _snapshot(row)
            row = c.execute("UPDATE admission.forms SET has_unpublished_changes = %s WHERE form_id = %s RETURNING *",
                            (changed, form_id)).fetchone()
        wf.audit(c, user.user_code, user.role, "form.updated", "admission_form", form_id, {}, _ip(request))
        return _form_view(c, row)


@router.delete("/forms/{form_id}")
def delete_form(form_id: UUID, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        f = _form(c, form_id, lock=True)
        if f["published_version"]:
            raise HTTPException(409, "A published form cannot be deleted; close it instead")
        c.execute("DELETE FROM admission.forms WHERE form_id = %s", (form_id,))
        wf.audit(c, user.user_code, user.role, "form.deleted", "admission_form", form_id, {}, _ip(request))
    return {"deleted": True}


def _slug(org: str, title: str) -> str:
    o = db.fetch_one("SELECT org_name FROM public.organizations WHERE org_code = %s", (org,)) or {}
    words = re.sub(r"[^a-z0-9]+", "-", f"{o.get('org_name') or org} {title}".lower()).strip("-")
    words = "-".join(words.split("-")[:8])[:56].strip("-") or "admissions"
    return f"{words}-{secrets.token_hex(3)}"


@router.post("/forms/{form_id}/publish")
def publish_form(form_id: UUID, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    """Snapshots the form as a new immutable version. The first publication creates the application URL and issues
    the first one-time credential (returned once, for the credentials pop-up)."""
    org = _org(user, org_code)
    with _tx(user, org) as c:
        f = _form(c, form_id, lock=True)
        if f["status"] == "archived":
            raise HTTPException(409, "This form is archived")
        if f["published_version"] and not f["has_unpublished_changes"]:
            raise HTTPException(409, "There are no changes to publish")
        try:
            defn = Definition.model_validate(f["definition"])
        except ValidationError as e:
            raise HTTPException(422, "; ".join(x["msg"].replace("Value error, ", "") for x in e.errors())) from None
        problems = defn.publish_problems()
        if not f["grades"]:
            problems.append("Choose at least one class open for admission")
        if f["closes_at"] and f["closes_at"] <= auth.now():
            problems.append("The closing date has passed")
        if problems:
            raise HTTPException(422, "; ".join(problems))
        _check_test(user, org, f["linked_test_id"], published=True)
        version = (f["published_version"] or 0) + 1
        c.execute("INSERT INTO admission.form_versions (org_code, form_id, version, definition, published_by) "
                  "VALUES (admission.current_org(), %s, %s, %s, %s)", (form_id, version, Jsonb(_snapshot(f)), user.user_code))
        first = f["slug"] is None
        f = c.execute("UPDATE admission.forms SET published_version = %s, has_unpublished_changes = FALSE, slug = COALESCE(slug, %s), "
                      "status = CASE WHEN status = 'draft' THEN 'published' ELSE status END, published_at = NOW(), published_by = %s, "
                      "updated_at = NOW() WHERE form_id = %s RETURNING *",
                      (version, _slug(org, f["title"]), user.user_code, form_id)).fetchone()
        # draft applications follow the newest version until they are submitted
        c.execute("UPDATE admission.applications SET version_id = (SELECT version_id FROM admission.form_versions "
                  "WHERE form_id = %s AND version = %s) WHERE form_id = %s AND status = 'draft'", (form_id, version, form_id))
        credential = None
        if first:
            app = wf.create_application(c, f, actor=user.user_code)
            cred = wf.issue_credential(c, f, app["application_id"], purpose="new", actor=user.user_code)
            credential = _credential_payload(f, cred, app)
            wf.audit(c, user.user_code, user.role, "credential.issued", "applicant_credential", cred["credential_id"],
                     {"application_id": str(app["application_id"]), "purpose": "new", "via": "publish"}, _ip(request))
        wf.audit(c, user.user_code, user.role, "form.published", "admission_form", form_id, {"version": version}, _ip(request))
        return {"form": _form_view(c, f), "credential": credential}


@router.post("/forms/{form_id}/close")
def close_form(form_id: UUID, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        f = _form(c, form_id, lock=True)
        if f["status"] != "published":
            raise HTTPException(409, "Only a published form can be closed")
        f = c.execute("UPDATE admission.forms SET status = 'closed', updated_at = NOW() WHERE form_id = %s RETURNING *", (form_id,)).fetchone()
        wf.audit(c, user.user_code, user.role, "form.closed", "admission_form", form_id, {}, _ip(request))
        return _form_view(c, f)


@router.post("/forms/{form_id}/reopen")
def reopen_form(form_id: UUID, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        f = _form(c, form_id, lock=True)
        if f["status"] != "closed":
            raise HTTPException(409, "The form is not closed")
        if f["closes_at"] and f["closes_at"] <= auth.now():
            raise HTTPException(409, "Move the closing date into the future first")
        f = c.execute("UPDATE admission.forms SET status = 'published', updated_at = NOW() WHERE form_id = %s RETURNING *", (form_id,)).fetchone()
        wf.audit(c, user.user_code, user.role, "form.reopened", "admission_form", form_id, {}, _ip(request))
        return _form_view(c, f)


# ---------------------------------------------------------------- credentials
CRED_LIST_SQL = (
    "SELECT k.*, a.status AS application_status, a.reference_no, a.student_name, a.label "
    "FROM admission.applicant_credentials k JOIN admission.applications a ON a.application_id = k.application_id ")


def _cred_rows(c, where: str, args: tuple) -> list[dict]:
    rows = c.execute(CRED_LIST_SQL + where + " ORDER BY k.issued_at DESC", args).fetchall()
    names = _names([r["issued_by"] for r in rows] + [r["acknowledged_by"] for r in rows])
    return [{**wf.credential_view(r), "issued_by_name": names.get(r["issued_by"]), "acknowledged_by_name": names.get(r["acknowledged_by"]),
             "application": {"status": r["application_status"], "label": r["label"], "student_name": r["student_name"],
                             "reference_no": r["reference_no"] if r["application_status"] != "draft" else None}} for r in rows]


@router.get("/forms/{form_id}/credentials")
def list_credentials(form_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        _form(c, form_id)
        wf.expire_due(c, form_id=form_id, actor=user.user_code)
        return {"credentials": _cred_rows(c, "WHERE k.form_id = %s", (form_id,))}


class NewCredentialIn(BaseModel):
    label: str | None = Field(default=None, max_length=120)


@router.post("/forms/{form_id}/credentials", status_code=201)
def new_credential(form_id: UUID, request: Request, body: NewCredentialIn | None = None, org_code: str | None = None,
                   user: CurrentUser = Depends(builders)):
    """A further one-time credential for this application form: one per applicant (a new application each)."""
    label = ((body.label if body else None) or "").strip() or None
    with _tx(user, _org(user, org_code)) as c:
        f = _form(c, form_id)
        if f["status"] != "published":
            raise HTTPException(409, "Credentials can be issued while the form is published (open)")
        if f["closes_at"] and f["closes_at"] <= auth.now():
            raise HTTPException(409, "The closing date has passed")
        app = wf.create_application(c, f, actor=user.user_code, label=label)
        cred = wf.issue_credential(c, f, app["application_id"], purpose="new", actor=user.user_code)
        wf.audit(c, user.user_code, user.role, "credential.issued", "applicant_credential", cred["credential_id"],
                 {"application_id": str(app["application_id"]), "purpose": "new"}, _ip(request))
        return _credential_payload(f, cred, app)


class AckIn(BaseModel):
    copied: list[Literal["username", "password", "all"]] = Field(min_length=1, max_length=3)


@router.post("/credentials/{credential_id}/acknowledge")
def acknowledge(credential_id: UUID, body: AckIn, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    """Records that the issuer copied the credentials (who, when, from where, which items)."""
    with _tx(user, _org(user, org_code)) as c:
        row = c.execute(
            "UPDATE admission.applicant_credentials SET acknowledged_at = COALESCE(acknowledged_at, NOW()), "
            "acknowledged_by = COALESCE(acknowledged_by, %s), acknowledged_ip = COALESCE(acknowledged_ip, %s::inet), "
            "acknowledged_items = ARRAY(SELECT DISTINCT unnest(acknowledged_items || %s::text[]) ORDER BY 1) "
            "WHERE credential_id = %s RETURNING credential_id, acknowledged_at, acknowledged_by, acknowledged_items",
            (user.user_code, _ip(request), sorted(set(body.copied)), credential_id)).fetchone()
        if not row:
            raise HTTPException(404, "Credential not found")
        wf.audit(c, user.user_code, user.role, "credential.acknowledged", "applicant_credential", credential_id,
                 {"copied": sorted(set(body.copied))}, _ip(request))
    return {**row, "message": ACK_MESSAGE}


def _cred(c, credential_id: UUID) -> dict:
    k = c.execute("SELECT * FROM admission.applicant_credentials WHERE credential_id = %s FOR UPDATE", (credential_id,)).fetchone()
    if not k:
        raise HTTPException(404, "Credential not found")
    return k


@router.post("/credentials/{credential_id}/revoke")
def revoke(credential_id: UUID, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        k = _cred(c, credential_id)
        if k["status"] not in wf.LIVE:
            raise HTTPException(409, "This credential is no longer active")
        c.execute("UPDATE admission.applicant_credentials SET status = 'revoked', password_hash = NULL, revoked_at = NOW(), "
                  "revoked_by = %s, revoke_reason = 'teacher' WHERE credential_id = %s", (user.user_code, credential_id))
        wf.end_sessions(c, k["application_id"], "teacher")
        wf.audit(c, user.user_code, user.role, "credential.revoked", "applicant_credential", credential_id, {}, _ip(request))
        return {"credentials": _cred_rows(c, "WHERE k.credential_id = %s", (credential_id,))}


class ReissueIn(BaseModel):
    recovery_request_id: UUID | None = None


@router.post("/credentials/{credential_id}/reissue")
def reissue(credential_id: UUID, request: Request, body: ReissueIn | None = None, org_code: str | None = None,
            user: CurrentUser = Depends(builders)):
    """Recovery path: the old credential stops working and a new one-time credential is issued for the same
    application (its saved answers and documents stay)."""
    rr_id = body.recovery_request_id if body else None
    with _tx(user, _org(user, org_code)) as c:
        k = _cred(c, credential_id)
        app = _application(c, k["application_id"], lock=True)
        if app["status"] not in ("draft", "test_pending", "correction_requested"):
            raise HTTPException(409, "This application has been submitted; its credentials cannot be reissued")
        f = _form(c, k["form_id"])
        if f["status"] == "archived":
            raise HTTPException(409, "This form is archived")
        wf.remove_credentials(c, app["application_id"], reason="reissued", actor=user.user_code)
        cred = wf.issue_credential(c, f, app["application_id"], actor=user.user_code, replaces=credential_id,
                                   purpose="correction" if app["status"] == "correction_requested" else "reissue")
        if rr_id:
            n = c.execute("UPDATE admission.recovery_requests SET status = 'resolved', resolved_at = NOW(), resolved_by = %s, "
                          "new_credential_id = %s WHERE request_id = %s AND form_id = %s AND status = 'open'",
                          (user.user_code, cred["credential_id"], rr_id, f["form_id"])).rowcount
            if not n:
                raise HTTPException(404, "Recovery request not found or already handled")
        wf.audit(c, user.user_code, user.role, "credential.reissued", "applicant_credential", cred["credential_id"],
                 {"replaces": str(credential_id), "application_id": str(app["application_id"]),
                  "recovery_request_id": str(rr_id) if rr_id else None}, _ip(request))
        return _credential_payload(f, cred, app)


# ---------------------------------------------------------------- recovery requests
@router.get("/recovery-requests")
def recovery_requests(form_id: UUID | None = None, status: Literal["open", "resolved", "dismissed"] | None = "open",
                      org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        rows = c.execute(
            "SELECT r.request_id, r.form_id, f.title AS form_title, r.username, r.contact, r.message, r.status, r.created_at, "
            "r.resolved_at, r.resolved_by, r.credential_id, k.status AS credential_status, a.application_id, a.status AS application_status, "
            "a.label, a.student_name FROM admission.recovery_requests r JOIN admission.forms f ON f.form_id = r.form_id "
            "LEFT JOIN admission.applicant_credentials k ON k.credential_id = r.credential_id "
            "LEFT JOIN admission.applications a ON a.application_id = r.application_id "
            "WHERE (%s::uuid IS NULL OR r.form_id = %s::uuid) AND (%s::text IS NULL OR r.status = %s::text) ORDER BY r.created_at DESC LIMIT 500",
            (form_id, form_id, status, status)).fetchall()
    for r in rows:
        r["can_reissue"] = bool(r["credential_id"] and r["application_status"] in ("draft", "test_pending", "correction_requested")
                                and r["status"] == "open")
    return {"requests": rows}


@router.post("/recovery-requests/{request_id}/dismiss")
def dismiss_recovery(request_id: UUID, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        n = c.execute("UPDATE admission.recovery_requests SET status = 'dismissed', resolved_at = NOW(), resolved_by = %s "
                      "WHERE request_id = %s AND status = 'open'", (user.user_code, request_id)).rowcount
        if not n:
            raise HTTPException(404, "Recovery request not found or already handled")
        wf.audit(c, user.user_code, user.role, "recovery.dismissed", "recovery_request", request_id, {}, _ip(request))
    return {"status": "dismissed"}


# ---------------------------------------------------------------- applications
def _exam(session_id, user: CurrentUser) -> dict | None:
    if not session_id:
        return None
    s = db.fetch_one(
        "SELECT s.session_id, s.status, s.submit_reason, s.integrity_score, s.integrity_band, s.warnings_count, s.submitted_at, "
        "t.title AS test_title, r.status AS report_status, r.report_json->'scores' AS scores FROM public.admission_sessions s "
        "JOIN public.admission_tests t ON t.test_id = s.test_id LEFT JOIN public.admission_reports r ON r.session_id = s.session_id "
        "WHERE s.session_id = %s", (session_id,))
    if not s:
        return None
    sc = s.pop("scores") or {}
    s.update(composite=sc.get("composite"), band=sc.get("label"), academic_pct=sc.get("academic_pct"),
             report_path=(f"/teacher/admissions/reports/{session_id}" if user.role == "teacher" else f"/admin/admission-reports/{session_id}")
             if s["status"] in ("SUBMITTED", "ENDED") else None)
    return s


def _actions(status: str) -> list[str]:
    if status in ("submitted", "resubmitted"):
        return ["start_review", "approve", "reject", "request_correction"]
    if status == "under_review":
        return ["approve", "reject", "request_correction"]
    return []


APP_LIST_SQL = (
    "SELECT a.application_id, a.form_id, f.title AS form_title, a.reference_no, a.status, a.student_name, a.date_of_birth, "
    "a.grade_applying, a.label, a.submitted_at, a.updated_at, a.created_at, a.submission_count, a.exam_session_id, "
    "(SELECT COUNT(*) FROM admission.application_documents d WHERE d.application_id = a.application_id) AS documents "
    "FROM admission.applications a JOIN admission.forms f ON f.form_id = a.form_id ")


@router.get("/applications")
def list_applications(form_id: UUID | None = None, status: str | None = Query(default=None, max_length=24),
                      include_drafts: bool = False, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        rows = c.execute(APP_LIST_SQL + "WHERE (%s::uuid IS NULL OR a.form_id = %s::uuid) AND (%s::text IS NULL OR a.status = %s::text) "
                         "AND (%s OR a.status <> 'draft') ORDER BY COALESCE(a.submitted_at, a.updated_at) DESC LIMIT 1000",
                         (form_id, form_id, status, status, include_drafts or status == "draft")).fetchall()
    exams = {r["session_id"]: r for r in db.fetch_all(
        "SELECT s.session_id, s.status, s.integrity_band, r.report_json->'scores'->>'label' AS band FROM public.admission_sessions s "
        "LEFT JOIN public.admission_reports r ON r.session_id = s.session_id WHERE s.session_id = ANY(%s)",
        ([r["exam_session_id"] for r in rows if r["exam_session_id"]],))} if any(r["exam_session_id"] for r in rows) else {}
    for r in rows:
        r["grade_label"] = grade_label(r["grade_applying"])
        r["status_label"] = wf.STATUS_LABEL.get(r["status"], r["status"])
        if r["status"] == "draft":
            r["reference_no"] = None
        e = exams.get(r.pop("exam_session_id"))
        r["exam"] = {"status": e["status"], "integrity_band": e["integrity_band"], "band": e["band"]} if e else None
    return {"applications": rows}


def _detail(c, app: dict, user: CurrentUser) -> dict:
    form = _form(c, app["form_id"])
    version = c.execute("SELECT version, definition FROM admission.form_versions WHERE version_id = %s", (app["version_id"],)).fetchone() \
        if app["version_id"] else None
    docs = c.execute("SELECT document_id, requirement_key, filename, mime, size_bytes, sha256, uploaded_at FROM admission.application_documents "
                     "WHERE application_id = %s ORDER BY requirement_key, uploaded_at", (app["application_id"],)).fetchall()
    history = c.execute("SELECT from_status, to_status, actor_code, actor_role, note, visible_to_applicant, created_at "
                        "FROM admission.application_status_history WHERE application_id = %s ORDER BY created_at, history_id",
                        (app["application_id"],)).fetchall()
    comments = c.execute("SELECT comment_id, author_code, author_role, body, created_at FROM admission.application_comments "
                         "WHERE application_id = %s ORDER BY created_at", (app["application_id"],)).fetchall()
    creds = _cred_rows(c, "WHERE k.application_id = %s", (app["application_id"],))
    names = _names([h["actor_code"] for h in history] + [x["author_code"] for x in comments])
    for h in history:
        h["actor_name"] = names.get(h["actor_code"]) or ("Applicant" if h["actor_role"] == "applicant" else "System"
                                                         if h["actor_role"] == wf.SYSTEM else h["actor_code"])
    for x in comments:
        x["author_name"] = names.get(x["author_code"], x["author_code"])
    defn = (version or {}).get("definition") or {**form["definition"], "title": form["title"]}
    labels = {d["key"]: d["label"] for d in defn.get("documents", [])}
    for d in docs:
        d["requirement_label"] = labels.get(d["requirement_key"], d["requirement_key"])
    return {
        "application_id": app["application_id"], "form_id": app["form_id"], "form_title": form["title"],
        "reference_no": app["reference_no"] if app["status"] != "draft" else None, "status": app["status"],
        "status_label": wf.STATUS_LABEL.get(app["status"], app["status"]), "student_name": app["student_name"],
        "date_of_birth": app["date_of_birth"], "grade_applying": app["grade_applying"], "grade_label": grade_label(app["grade_applying"]),
        "label": app["label"], "answers": app["answers"] if app["status"] != "draft" else {}, "version": (version or {}).get("version"),
        "definition": defn, "documents": docs, "history": history, "comments": comments, "credentials": creds,
        "submitted_at": app["submitted_at"], "decided_at": app["decided_at"], "updated_at": app["updated_at"],
        "submission_count": app["submission_count"], "exam": _exam(app["exam_session_id"], user), "actions": _actions(app["status"]),
        "crm_applicant_id": app["applicant_id"],
    }


@router.get("/applications/{application_id}")
def get_application(application_id: UUID, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        app = _application(c, application_id)
        out = _detail(c, app, user)
        wf.audit(c, user.user_code, user.role, "application.viewed", "application", application_id, {}, _ip(request))
        return out


class DecisionIn(BaseModel):
    action: Literal["start_review", "approve", "reject", "request_correction"]
    note: str | None = Field(default=None, max_length=4000)


@router.post("/applications/{application_id}/decision")
def decide(application_id: UUID, body: DecisionIn, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    """Review decisions. A corrections request reopens the application and issues a fresh one-time credential (shown
    once in the response); the note is shown to the applicant."""
    note = (body.note or "").strip() or None
    if body.action == "request_correction" and (not note or len(note) < 5):
        raise HTTPException(422, "Tell the applicant what to correct (at least a few words)")
    org = _org(user, org_code)
    to = {"start_review": "under_review", "approve": "approved", "reject": "rejected", "request_correction": "correction_requested"}[body.action]
    with _tx(user, org) as c:
        app = _application(c, application_id, lock=True)
        if body.action not in _actions(app["status"]):
            raise HTTPException(409, f"This application is {wf.STATUS_LABEL.get(app['status'], app['status']).lower()}; "
                                     "that decision is not available")
        f = _form(c, app["form_id"])
        decided = body.action in ("approve", "reject")
        c.execute("UPDATE admission.applications SET status = %s, decided_at = CASE WHEN %s THEN NOW() ELSE decided_at END, "
                  "decided_by = CASE WHEN %s THEN %s ELSE decided_by END WHERE application_id = %s",
                  (to, decided, decided, user.user_code, application_id))
        wf.record(c, application_id, app["status"], to, actor=user.user_code, role=user.role, note=note,
                  visible=body.action == "request_correction")
        credential = None
        if body.action == "request_correction":
            wf.remove_credentials(c, application_id, reason="correction", actor=user.user_code)
            cred = wf.issue_credential(c, f, application_id, purpose="correction", actor=user.user_code)
            credential = _credential_payload(f, cred, app)
            wf.audit(c, user.user_code, user.role, "credential.issued", "applicant_credential", cred["credential_id"],
                     {"application_id": str(application_id), "purpose": "correction"}, _ip(request))
        wf.set_crm_status(c, app, to)
        wf.audit(c, user.user_code, user.role, f"application.{body.action}", "application", application_id,
                 {"from": app["status"], "to": to}, _ip(request))
        app = _application(c, application_id)
        out = _detail(c, app, user)
    wf.notify_owner(org, f, app, "decided", actor=user.user_code)
    return {"application": out, "credential": credential}


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


@router.post("/applications/{application_id}/comments", status_code=201)
def comment(application_id: UUID, body: CommentIn, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    with _tx(user, _org(user, org_code)) as c:
        _application(c, application_id)
        row = c.execute("INSERT INTO admission.application_comments (org_code, application_id, author_code, author_role, body) "
                        "VALUES (admission.current_org(), %s, %s, %s, %s) RETURNING comment_id, created_at",
                        (application_id, user.user_code, user.role, body.body.strip())).fetchone()
        wf.audit(c, user.user_code, user.role, "application.commented", "application", application_id, {}, _ip(request))
    return row


# ---------------------------------------------------------------- documents: audited, short-lived signed downloads
def _link(token: str) -> str:
    return f"{router.prefix}/document-download/{token}"


@router.post("/applications/{application_id}/documents/{document_id}/link")
def document_link(application_id: UUID, document_id: UUID, request: Request, org_code: str | None = None,
                  user: CurrentUser = Depends(builders)):
    org = _org(user, org_code)
    with _tx(user, org) as c:
        d = c.execute("SELECT document_id FROM admission.application_documents WHERE document_id = %s AND application_id = %s",
                      (document_id, application_id)).fetchone()
        if not d:
            raise HTTPException(404, "Document not found")
        wf.audit(c, user.user_code, user.role, "document.link_issued", "application_document", document_id,
                 {"application_id": str(application_id)}, _ip(request))
    token = auth.sign_download({"org": org, "u": user.user_code, "r": user.role, "app": str(application_id), "doc": str(document_id)},
                               DOWNLOAD_MINUTES)
    return {"url": _link(token), "expires_in": DOWNLOAD_MINUTES * 60}


@router.post("/applications/{application_id}/documents/zip-link")
def documents_zip_link(application_id: UUID, request: Request, org_code: str | None = None, user: CurrentUser = Depends(builders)):
    org = _org(user, org_code)
    with _tx(user, org) as c:
        app = _application(c, application_id)
        n = c.execute("SELECT COUNT(*) AS n FROM admission.application_documents WHERE application_id = %s", (application_id,)).fetchone()["n"]
        if not n:
            raise HTTPException(404, "This application has no documents")
        wf.audit(c, user.user_code, user.role, "document.zip_link_issued", "application", application_id, {"documents": n}, _ip(request))
    token = auth.sign_download({"org": org, "u": user.user_code, "r": user.role, "app": str(app["application_id"]), "doc": "zip"},
                               DOWNLOAD_MINUTES)
    return {"url": _link(token), "expires_in": DOWNLOAD_MINUTES * 60}


@router.get("/document-download/{token}", include_in_schema=False)
def document_download(token: str, request: Request):
    """The signed link carries who asked for it; row-level security is applied again as that person."""
    t = auth.read_download(token)
    u = db.fetch_one("SELECT is_active, user_role, org_code FROM public.app_users WHERE user_code = %s", (t["u"],))
    if not u or not u["is_active"] or u["user_role"] != t["r"]:
        raise HTTPException(403, "This download link is no longer valid")
    storage = get_storage()
    headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
               "Content-Security-Policy": "default-src 'none'; sandbox"}
    with db.tenant(t["org"], t["u"], t["r"]) as c:
        app = c.execute("SELECT application_id, reference_no FROM admission.applications WHERE application_id = %s", (t["app"],)).fetchone()
        if not app:
            raise HTTPException(404, "Document not found")
        if t["doc"] == "zip":
            docs = c.execute("SELECT document_id, requirement_key, filename, storage_key FROM admission.application_documents "
                             "WHERE application_id = %s ORDER BY requirement_key, uploaded_at", (t["app"],)).fetchall()
        else:
            docs = c.execute("SELECT document_id, requirement_key, filename, mime, storage_key FROM admission.application_documents "
                             "WHERE document_id = %s AND application_id = %s", (t["doc"], t["app"])).fetchall()
        if not docs:
            raise HTTPException(404, "Document not found")
        wf.audit(c, t["u"], t["r"], "document.downloaded" if t["doc"] != "zip" else "document.zip_downloaded",
                 "application_document" if t["doc"] != "zip" else "application",
                 t["doc"] if t["doc"] != "zip" else t["app"], {"application_id": t["app"], "files": len(docs)}, _ip(request))
    if t["doc"] != "zip":
        d = docs[0]
        return Response(storage.get(d["storage_key"]), media_type=d["mime"],
                        headers={**headers, "Content-Disposition": content_disposition(d["filename"])})
    buf = tempfile.SpooledTemporaryFile(max_size=32 * 1024 * 1024)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for i, d in enumerate(docs, 1):
            z.writestr(f"{i:02d}-{d['requirement_key']}-{d['filename']}", storage.get(d["storage_key"]))
    buf.seek(0)
    name = f"{app['reference_no']}-documents.zip"
    return StreamingResponse(iter(lambda: buf.read(1024 * 256), b""), media_type="application/zip",
                             headers={**headers, "Content-Disposition": content_disposition(name)})


# ---------------------------------------------------------------- branding (admins)
def _branding(org: str) -> dict:
    o = db.fetch_one("SELECT org_name, brand_display_name, brand_accent, brand_logo_key FROM public.organizations WHERE org_code = %s", (org,))
    if not o:
        raise HTTPException(404, "Institution not found")
    return {"org_name": o["org_name"], "display_name": o["brand_display_name"], "accent": o["brand_accent"],
            "logo_url": get_storage().signed_url(o["brand_logo_key"], 10) if o["brand_logo_key"] else None}


class BrandingIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    accent: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


@router.get("/branding")
def get_branding(org_code: str | None = None, user: CurrentUser = Depends(builders)):
    return _branding(_org(user, org_code))


@router.put("/branding")
def put_branding(body: BrandingIn, request: Request, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = _org(user, org_code)
    name = (body.display_name or "").strip() or None
    if name and len(name) < 2:
        raise HTTPException(422, "The display name is too short")
    db.execute("UPDATE public.organizations SET brand_display_name = %s, brand_accent = %s WHERE org_code = %s",
               (name, body.accent.lower() if body.accent else None, org))
    with _tx(user, org) as c:
        wf.audit(c, user.user_code, user.role, "branding.updated", "organization", org, {"fields": ["display_name", "accent"]}, _ip(request))
    return _branding(org)


@router.post("/branding/logo")
def upload_logo(request: Request, file: UploadFile = File(...), org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = _org(user, org_code)
    up = validate_upload(file, allowed=("png", "jpg"), max_bytes=LOGO_MAX, max_image_side=512)
    key = f"branding/{org}/logo-{secrets.token_hex(6)}{up.ext}"
    get_storage().put(key, up.data, up.mime)
    old = db.fetch_one("SELECT brand_logo_key FROM public.organizations WHERE org_code = %s", (org,))
    db.execute("UPDATE public.organizations SET brand_logo_key = %s WHERE org_code = %s", (key, org))
    if old and old["brand_logo_key"]:
        try:
            get_storage().delete(old["brand_logo_key"])
        except Exception:  # noqa: BLE001 — already gone
            pass
    with _tx(user, org) as c:
        wf.audit(c, user.user_code, user.role, "branding.logo_uploaded", "organization", org, {"sha256": up.sha256[:16]}, _ip(request))
    return _branding(org)


@router.delete("/branding/logo")
def delete_logo(request: Request, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = _org(user, org_code)
    old = db.fetch_one("SELECT brand_logo_key FROM public.organizations WHERE org_code = %s", (org,))
    db.execute("UPDATE public.organizations SET brand_logo_key = NULL WHERE org_code = %s", (org,))
    if old and old["brand_logo_key"]:
        try:
            get_storage().delete(old["brand_logo_key"])
        except Exception:  # noqa: BLE001
            pass
    with _tx(user, org) as c:
        wf.audit(c, user.user_code, user.role, "branding.logo_removed", "organization", org, {}, _ip(request))
    return _branding(org)
