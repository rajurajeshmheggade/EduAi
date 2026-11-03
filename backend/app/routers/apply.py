"""The standalone admission application (/apply/<slug> in the front end) — public and applicant endpoints.

Public:     GET /{slug} (branding + form metadata) · GET /{slug}/logo · POST /{slug}/login|refresh|recovery|track
Applicant:  POST /{slug}/logout · GET /{slug}/me · PUT /{slug}/me/answers · POST /{slug}/me/documents ·
            GET|DELETE /{slug}/me/documents/{id} · POST /{slug}/me/submit · POST /{slug}/me/test/launch

Security: applicant access tokens have their own audience and signing key (LMS tokens are refused here and applicant
tokens everywhere else); each request re-checks the session and the one-time credential in the database; every query
runs under row-level security as role `applicant` for exactly one application (or `applicant_gate` before sign-in);
login and recovery are rate limited per IP and a credential locks after 5 wrong passwords; responses are never cached;
the client IP comes from the socket (X-Forwarded-For is not trusted).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Path, Request, UploadFile
from fastapi.responses import Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..security import verify_password
from ..services.admission import applicant_auth as auth
from ..services.admission import applications as wf
from ..services.admission.forms import EMAIL_RE, PHONE_RE, clean_draft, core_values, document_problems, grade_label, validate_answers
from ..services.admission_test import config as test_cfg
from ..services.admission_test import guard
from ..services.admission_test.sessions import OPEN as EXAM_OPEN
from ..services.storage import get_storage
from ..services.uploads import content_disposition, validate_upload
from .admission import _ip

router = APIRouter(prefix="/ICMELive/api/v1/apply", tags=["admission-apply"], dependencies=[Depends(guard.no_store)])
Slug = Path(pattern=r"^[a-z0-9][a-z0-9-]{5,79}$")
L = auth.limiter
GENERIC_LOGIN = "These sign-in details are not valid. If you have already submitted your application, use Track application."
GATE = "applicant_gate"


# ---------------------------------------------------------------- resolution and context
def _resolve(slug: str) -> tuple[str, UUID]:
    with db.get_tenant_pool().connection() as conn, conn.transaction():
        conn.execute(f"SET LOCAL ROLE {db.TENANT_ROLE}")
        row = conn.execute("SELECT org_code, form_id FROM admission.resolve_form_slug(%s)", (slug,)).fetchone()
    if not row:
        raise HTTPException(404, "This admission application was not found")
    return row["org_code"], row["form_id"]


def _gate(org: str):
    return db.tenant(org, "anonymous", GATE)


def _form_state(f: dict) -> str:
    t = auth.now()
    if f["status"] != "published" or (f["closes_at"] and f["closes_at"] <= t):
        return "closed"
    if f["opens_at"] and f["opens_at"] > t:
        return "not_open"
    return "open"


def _school(org: str, slug: str) -> dict:
    o = db.fetch_one("SELECT org_name, brand_display_name, brand_accent, brand_logo_key FROM public.organizations WHERE org_code = %s",
                     (org,)) or {}
    return {"name": o.get("brand_display_name") or o.get("org_name") or org, "accent": o.get("brand_accent"),
            "logo_url": f"{router.prefix}/{slug}/logo?v={(o.get('brand_logo_key') or '')[-12:-4]}" if o.get("brand_logo_key") else None}


@dataclass
class Applicant:
    org: str
    form_id: UUID
    application_id: str
    session_id: str
    credential_id: str
    slug: str

    def tx(self):
        return db.tenant(self.org, self.application_id, "applicant")


def applicant(request: Request, slug: str = Slug, authorization: str | None = Header(default=None)) -> Applicant:
    if not authorization or not authorization.lower().startswith("bearer ") or len(authorization) > 2000:
        raise HTTPException(401, "Please sign in to the admission application.")
    data = auth.decode_access(authorization[7:].strip())
    org, form_id = _resolve(slug)
    if data.get("org") != org or data.get("form") != str(form_id):
        raise HTTPException(401, "Please sign in to the admission application.")
    a = Applicant(org, form_id, data["sub"], data["sid"], data.get("cid", ""), slug)
    L.hit(f"apl-req:{a.application_id}", 600, 60)
    finalise = False
    with a.tx() as c:
        s = c.execute(
            "SELECT s.revoked_at, s.expires_at, k.status AS cred_status, k.expires_at AS cred_expires, k.credential_id, "
            "a.status AS app_status, a.exam_session_id FROM admission.applicant_sessions s "
            "JOIN admission.applicant_credentials k ON k.credential_id = s.credential_id "
            "JOIN admission.applications a ON a.application_id = s.application_id WHERE s.session_id = %s", (a.session_id,)).fetchone()
        live = bool(s and not s["revoked_at"] and s["expires_at"] > auth.now() and s["cred_status"] in wf.LIVE
                    and str(s["credential_id"]) == a.credential_id)
        if live and s["cred_expires"] <= auth.now():
            wf.expire_due(c, application_id=a.application_id, actor=f"app:{a.application_id}")
            live = False
        elif live and s["app_status"] == "test_pending" and wf.exam_done(s["exam_session_id"]):
            finalise = True   # the exam hook did not run (e.g. a crash): complete it now
        elif live:
            c.execute("UPDATE admission.applicant_sessions SET last_seen_at = NOW() WHERE session_id = %s", (a.session_id,))
    if finalise:
        wf.on_exam_finished({"origin": "applicant", "org_code": org, "session_id": s["exam_session_id"]})
        raise HTTPException(401, "Your application has been submitted. These credentials are no longer valid.")
    if not live:
        raise HTTPException(401, "Your session has ended. Please sign in again.")
    return a


# ---------------------------------------------------------------- public
@router.get("/{slug}")
def public_info(request: Request, slug: str = Slug):
    L.hit(f"apl-pub:{_ip(request)}", 240, 60)
    org, form_id = _resolve(slug)
    with _gate(org) as c:
        f = c.execute("SELECT form_id, title, description, academic_year, grades, status, opens_at, closes_at, linked_test_id, "
                      "published_version FROM admission.forms WHERE form_id = %s", (form_id,)).fetchone()
        v = c.execute("SELECT definition FROM admission.form_versions WHERE form_id = %s AND version = %s",
                      (form_id, f["published_version"])).fetchone()
    defn = v["definition"] if v else {}
    return {"school": _school(org, slug),
            "form": {"title": defn.get("title", f["title"]), "description": defn.get("description"), "academic_year": f["academic_year"],
                     "grades": [{"value": g, "label": grade_label(g)} for g in defn.get("grades", f["grades"])],
                     "instructions": defn.get("instructions", ""), "opens_at": f["opens_at"], "closes_at": f["closes_at"],
                     "state": _form_state(f), "has_test": bool(f["linked_test_id"]),
                     "documents": [{"label": d["label"], "required": d.get("required", False)} for d in defn.get("documents", [])]}}


@router.get("/{slug}/logo")
def public_logo(request: Request, slug: str = Slug):
    L.hit(f"apl-pub:{_ip(request)}", 240, 60)
    org, _ = _resolve(slug)
    o = db.fetch_one("SELECT brand_logo_key FROM public.organizations WHERE org_code = %s", (org,))
    if not o or not o["brand_logo_key"]:
        raise HTTPException(404, "No logo")
    key = o["brand_logo_key"]
    return Response(get_storage().get(key), media_type="image/png" if key.endswith(".png") else "image/jpeg",
                    headers={"Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff",
                             "Content-Security-Policy": "default-src 'none'"})


class LoginIn(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=1, max_length=200)


def _tokens(org: str, form_id, sess_id, application_id, credential_id, refresh: str, expires_at) -> dict:
    return {"access_token": auth.issue_access(session_id=sess_id, application_id=application_id, credential_id=credential_id,
                                              org_code=org, form_id=form_id),
            "refresh_token": refresh, "token_type": "bearer", "expires_in": auth.ACCESS_MINUTES * 60, "session_expires_at": expires_at}


@router.post("/{slug}/login")
def login(body: LoginIn, request: Request, slug: str = Slug):
    ip = _ip(request) or "unknown"
    L.hit(f"apl-login:{ip}", 20, 300, message="Too many sign-in attempts. Please wait a few minutes and try again.")
    org, form_id = _resolve(slug)
    username = auth.normalise_username(body.username)
    outcome, out = "invalid", None
    with _gate(org) as c:
        f = c.execute("SELECT * FROM admission.forms WHERE form_id = %s", (form_id,)).fetchone()
        k = c.execute("SELECT * FROM admission.applicant_credentials WHERE username = %s AND form_id = %s FOR UPDATE",
                      (username, form_id)).fetchone()
        t = auth.now()
        if not k or k["status"] not in wf.LIVE or not k["password_hash"]:
            auth.dummy_verify(body.password)
        elif k["locked_until"] and k["locked_until"] > t:
            auth.dummy_verify(body.password)
            outcome = "locked"
        elif not verify_password(body.password, k["password_hash"]):
            n = k["failed_attempts"] + 1
            lock = n >= auth.MAX_FAILED
            c.execute("UPDATE admission.applicant_credentials SET failed_attempts = %s, locked_until = %s WHERE credential_id = %s",
                      (0 if lock else n, t + timedelta(minutes=auth.LOCK_MINUTES) if lock else None, k["credential_id"]))
            wf.audit(c, str(k["application_id"]), GATE, "applicant.login_failed", "applicant_credential", k["credential_id"],
                     {"locked": lock}, ip if ip != "unknown" else None)
            outcome = "locked" if lock else "invalid"
        elif k["expires_at"] <= t:
            wf.expire_due(c, application_id=k["application_id"], actor="system")
            outcome = "expired"
        elif k["purpose"] != "correction" and _form_state(f) == "closed":
            outcome = "closed"
        elif _form_state(f) == "not_open":
            outcome = "not_open"
        else:
            c.execute("UPDATE admission.applicant_credentials SET status = 'in_use', failed_attempts = 0, locked_until = NULL, "
                      "first_login_at = COALESCE(first_login_at, NOW()), last_login_at = NOW() WHERE credential_id = %s", (k["credential_id"],))
            refresh, refresh_hash = auth.new_refresh()
            expires = t + timedelta(hours=auth.SESSION_HOURS)
            sess = c.execute("INSERT INTO admission.applicant_sessions (org_code, credential_id, application_id, refresh_hash, expires_at, "
                             "ip, user_agent) VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s) RETURNING session_id",
                             (k["credential_id"], k["application_id"], refresh_hash, expires, ip if ip != "unknown" else None,
                              (request.headers.get("user-agent") or "")[:300] or None)).fetchone()
            wf.audit(c, str(k["application_id"]), GATE, "applicant.login", "applicant_credential", k["credential_id"],
                     {"session_id": str(sess["session_id"])}, ip if ip != "unknown" else None)
            out = _tokens(org, form_id, sess["session_id"], k["application_id"], k["credential_id"], refresh, expires)
            outcome = "ok"
    if outcome == "ok":
        return out
    if outcome == "locked":
        raise HTTPException(429, "Too many attempts. Please wait 15 minutes, or use “Forgot password?” to ask the school for help.")
    if outcome == "expired":
        raise HTTPException(401, "These credentials have expired. Use “Forgot password?” to ask the school for new ones.")
    if outcome == "closed":
        raise HTTPException(403, "Applications for this form are closed.")
    if outcome == "not_open":
        raise HTTPException(403, "Applications have not opened yet." + (f" They open on {f['opens_at']:%d %b %Y}." if f["opens_at"] else ""))
    raise HTTPException(401, GENERIC_LOGIN)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=200)


@router.post("/{slug}/refresh")
def refresh(body: RefreshIn, request: Request, slug: str = Slug):
    L.hit(f"apl-refresh:{_ip(request)}", 60, 300)
    org, form_id = _resolve(slug)
    out = None
    with _gate(org) as c:
        s = c.execute("SELECT s.*, k.status AS cred_status, k.expires_at AS cred_expires, k.form_id FROM admission.applicant_sessions s "
                      "JOIN admission.applicant_credentials k ON k.credential_id = s.credential_id WHERE s.refresh_hash = %s FOR UPDATE OF s",
                      (auth.hash_token(body.refresh_token),)).fetchone()
        if s and s["form_id"] == form_id and not s["revoked_at"] and s["expires_at"] > auth.now() and s["cred_status"] in wf.LIVE \
                and s["cred_expires"] > auth.now():
            token, token_hash = auth.new_refresh()
            c.execute("UPDATE admission.applicant_sessions SET refresh_hash = %s, last_seen_at = NOW() WHERE session_id = %s",
                      (token_hash, s["session_id"]))
            out = _tokens(org, form_id, s["session_id"], s["application_id"], s["credential_id"], token, s["expires_at"])
    if not out:
        raise HTTPException(401, "Your session has ended. Please sign in again.")
    return out


@router.post("/{slug}/logout")
def logout(a: Applicant = Depends(applicant)):
    with a.tx() as c:
        c.execute("UPDATE admission.applicant_sessions SET revoked_at = NOW(), revoke_reason = 'logout' WHERE session_id = %s",
                  (a.session_id,))
        wf.audit(c, a.application_id, "applicant", "applicant.logout", "applicant_session", a.session_id)
    return {"ok": True}


class RecoveryIn(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    contact: str = Field(min_length=5, max_length=255)
    message: str | None = Field(default=None, max_length=1000)
    website: str | None = Field(default=None, max_length=200)   # honeypot

    @field_validator("contact")
    @classmethod
    def _contact(cls, v: str) -> str:
        v = v.strip()
        if not (EMAIL_RE.match(v) or PHONE_RE.match(v)):
            raise ValueError("enter the email address or mobile number the school can reach you on")
        return v


RECOVERY_REPLY = ("Thank you. If these details match an application, the school will contact you with new credentials. "
                  "For your security, the school never sends passwords by email.")


@router.post("/{slug}/recovery", status_code=202)
def recovery(body: RecoveryIn, request: Request, slug: str = Slug):
    """Forgot password / credentials: files a request the teacher resolves by reissuing a one-time credential. The
    reply is the same whether or not the username exists."""
    ip = _ip(request) or "unknown"
    if body.website:
        return {"message": RECOVERY_REPLY}
    L.hit(f"apl-recovery:{ip}", 5, 3600, message="Too many requests. Please try again later.")
    org, form_id = _resolve(slug)
    username = auth.normalise_username(body.username)
    req_id = uuid4()
    with _gate(org) as c:
        k = c.execute("SELECT credential_id, application_id FROM admission.applicant_credentials WHERE username = %s AND form_id = %s",
                      (username, form_id)).fetchone()
        # at most 3 requests a day per username (more add nothing for the school; the reply stays the same)
        dup = L.count(f"apl-rec-user:{form_id}:{username}", 86400) >= 3
        if not dup:
            L.hit(f"apl-rec-user:{form_id}:{username}", 1000, 86400)
            c.execute("INSERT INTO admission.recovery_requests (request_id, org_code, form_id, username, credential_id, application_id, "
                      "contact, message, ip) VALUES (%s, admission.current_org(), %s, %s, %s, %s, %s, %s, %s)",
                      (req_id, form_id, username[:32], k["credential_id"] if k else None, k["application_id"] if k else None,
                       body.contact, (body.message or "").strip() or None, ip if ip != "unknown" else None))
            wf.audit(c, "anonymous", GATE, "recovery.requested", "recovery_request", req_id, {"matched": bool(k)},
                     ip if ip != "unknown" else None)
        f = c.execute("SELECT form_id, title, created_by FROM admission.forms WHERE form_id = %s", (form_id,)).fetchone()
    if not dup:
        wf.notify_owner(org, f, {"request_id": str(req_id)}, "recovery")
    return {"message": RECOVERY_REPLY}


class TrackIn(BaseModel):
    reference_no: str = Field(min_length=6, max_length=20)
    date_of_birth: date


TRACK_PUBLIC = {"test_pending": "Awaiting admission test", "submitted": "Received — waiting for review", "under_review": "Under review",
                "correction_requested": "Corrections requested — the school will send you new credentials",
                "resubmitted": "Corrected application received", "approved": "Approved", "rejected": "Not approved"}


@router.post("/{slug}/track")
def track(body: TrackIn, request: Request, slug: str = Slug):
    """Public status lookup: reference number + date of birth -> status only."""
    ip = _ip(request) or "unknown"
    ref = body.reference_no.strip().upper()
    L.hit(f"apl-track:{ip}", 10, 600, message="Too many lookups. Please try again in a few minutes.")
    L.hit(f"apl-track-ref:{ref}", 5, 600, message="Too many lookups. Please try again in a few minutes.")
    org, form_id = _resolve(slug)
    with _gate(org) as c:
        row = c.execute("SELECT status, submitted_at, updated_at FROM admission.lookup_application_status(%s, %s, %s)",
                        (form_id, ref, body.date_of_birth)).fetchone()
    if not row:
        raise HTTPException(404, "No application matches this reference number and date of birth.")
    return {"reference_no": ref, "status": row["status"], "status_label": TRACK_PUBLIC.get(row["status"], row["status"]),
            "submitted_at": row["submitted_at"], "updated_at": row["updated_at"]}


# ---------------------------------------------------------------- applicant
def _load(c, a: Applicant, *, lock: bool = False) -> tuple[dict, dict, dict]:
    app = c.execute("SELECT * FROM admission.applications WHERE application_id = %s" + (" FOR UPDATE" if lock else ""),
                    (a.application_id,)).fetchone()
    if not app:
        raise HTTPException(401, "Please sign in again.")
    form = c.execute("SELECT * FROM admission.forms WHERE form_id = %s", (app["form_id"],)).fetchone()
    if app["status"] == "draft" or not app["version_id"]:
        ver = c.execute("SELECT version_id, version, definition FROM admission.form_versions WHERE form_id = %s AND version = %s",
                        (form["form_id"], form["published_version"])).fetchone()
    else:
        ver = c.execute("SELECT version_id, version, definition FROM admission.form_versions WHERE version_id = %s",
                        (app["version_id"],)).fetchone()
    return app, form, ver


def _docs(c, application_id) -> list[dict]:
    return c.execute("SELECT document_id, requirement_key, filename, mime, size_bytes, uploaded_at FROM admission.application_documents "
                     "WHERE application_id = %s ORDER BY uploaded_at", (application_id,)).fetchall()


def _consent(c) -> dict | None:
    v = c.execute("SELECT version_id, version, language, title, body FROM admission.consent_versions WHERE is_active "
                  "ORDER BY (language = 'en') DESC LIMIT 1").fetchone()
    return v


def _test(form: dict, app: dict) -> dict | None:
    if not form["linked_test_id"]:
        return None
    t = db.fetch_one("SELECT title, duration_minutes, instructions, status FROM public.admission_tests WHERE test_id = %s",
                     (form["linked_test_id"],))
    if not t:
        return None
    s = db.fetch_one("SELECT session_id, status, submit_reason FROM public.admission_sessions WHERE session_id = %s",
                     (app["exam_session_id"],)) if app["exam_session_id"] else None
    return {"title": t["title"], "duration_minutes": t["duration_minutes"], "instructions": t["instructions"],
            "available": t["status"] == "PUBLISHED", "session_status": s["status"] if s else None,
            "locked": bool(s and s["status"] == "LOCKED")}


@router.get("/{slug}/me")
def me(a: Applicant = Depends(applicant)):
    with a.tx() as c:
        app, form, ver = _load(c, a)
        docs = _docs(c, a.application_id)
        notes = c.execute("SELECT to_status, note, created_at FROM admission.application_status_history WHERE application_id = %s "
                          "ORDER BY created_at DESC", (a.application_id,)).fetchall()
        cred = c.execute("SELECT username, expires_at, purpose FROM admission.applicant_credentials WHERE credential_id = %s",
                         (a.credential_id,)).fetchone()
        consent = _consent(c)
    defn = ver["definition"] if ver else {}
    return {"application": {"status": app["status"], "status_label": wf.STATUS_LABEL.get(app["status"]),
                            "reference_no": app["reference_no"] if app["status"] != "draft" else None,
                            "answers": app["answers"], "last_saved_at": app["last_saved_at"], "submitted_at": app["submitted_at"],
                            "editable": app["status"] in wf.EDITABLE, "submission_count": app["submission_count"]},
            "form": {"title": defn.get("title", form["title"]), "version": ver["version"] if ver else None, "definition": defn,
                     "grades": [{"value": g, "label": grade_label(g)} for g in defn.get("grades", form["grades"])],
                     "closes_at": form["closes_at"], "has_test": bool(form["linked_test_id"])},
            "documents": docs, "corrections": [n for n in notes if n["to_status"] == "correction_requested"],
            "credential": {"username": cred["username"], "expires_at": cred["expires_at"]} if cred else None,
            "consent": consent, "test": _test(form, app)}


class AnswersIn(BaseModel):
    answers: dict[str, Any] = Field(max_length=200)


@router.put("/{slug}/me/answers")
def save_answers(body: AnswersIn, a: Applicant = Depends(applicant)):
    """Autosave (partial answers allowed). Required fields and formats are checked on submission."""
    L.hit(f"apl-save:{a.application_id}", 240, 600, message="Saving too often. Please wait a moment.")
    with a.tx() as c:
        app, form, ver = _load(c, a, lock=True)
        if app["status"] not in wf.EDITABLE:
            raise HTTPException(409, "This application can no longer be changed")
        try:
            answers = clean_draft(ver["definition"], body.answers)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        row = c.execute("UPDATE admission.applications SET answers = %s, last_saved_at = NOW(), "
                        "version_id = CASE WHEN status = 'draft' THEN %s ELSE version_id END WHERE application_id = %s "
                        "RETURNING last_saved_at", (Jsonb(answers), ver["version_id"], a.application_id)).fetchone()
    return {"saved_at": row["last_saved_at"], "answers": answers}


@router.post("/{slug}/me/documents", status_code=201)
def upload_document(request: Request, requirement_key: str = Form(..., pattern=r"^[a-z][a-z0-9_]{1,39}$"), file: UploadFile = File(...),
                    a: Applicant = Depends(applicant)):
    L.hit(f"apl-upload:{a.application_id}", 60, 3600, message="Too many uploads. Please try again later.")
    with a.tx() as c:
        app, form, ver = _load(c, a)
        if app["status"] not in wf.EDITABLE:
            raise HTTPException(409, "This application can no longer be changed")
        req = next((d for d in ver["definition"].get("documents", []) if d["key"] == requirement_key), None)
        if not req:
            raise HTTPException(404, "This document is not requested on the form")
        n = c.execute("SELECT COUNT(*) AS n FROM admission.application_documents WHERE application_id = %s AND requirement_key = %s",
                      (a.application_id, requirement_key)).fetchone()["n"]
        if n >= req.get("max_files", 1):
            raise HTTPException(409, f"Remove the uploaded file first (at most {req.get('max_files', 1)} for “{req['label']}”)")
    up = validate_upload(file, allowed=req.get("accept") or ("pdf", "jpg", "png"), max_bytes=int(req.get("max_mb", 5)) * 1024 * 1024)
    doc_id = uuid4()
    key = f"admission-applications/{a.org}/{a.application_id}/{doc_id.hex}{up.ext}"
    get_storage().put(key, up.data, up.mime)
    try:
        with a.tx() as c:
            app = c.execute("SELECT status FROM admission.applications WHERE application_id = %s FOR UPDATE", (a.application_id,)).fetchone()
            n = c.execute("SELECT COUNT(*) AS n FROM admission.application_documents WHERE application_id = %s AND requirement_key = %s",
                          (a.application_id, requirement_key)).fetchone()["n"]
            if app["status"] not in wf.EDITABLE or n >= req.get("max_files", 1):
                raise HTTPException(409, "This document can no longer be added")
            row = c.execute("INSERT INTO admission.application_documents (document_id, org_code, application_id, requirement_key, filename, "
                            "mime, size_bytes, sha256, storage_key) VALUES (%s, admission.current_org(), %s, %s, %s, %s, %s, %s, %s) "
                            "RETURNING document_id, requirement_key, filename, mime, size_bytes, uploaded_at",
                            (doc_id, a.application_id, requirement_key, up.filename, up.mime, up.size, up.sha256, key)).fetchone()
            wf.audit(c, a.application_id, "applicant", "document.uploaded", "application_document", doc_id,
                     {"requirement": requirement_key, "mime": up.mime, "size": up.size}, _ip(request))
    except BaseException:
        get_storage().delete(key)
        raise
    return row


@router.get("/{slug}/me/documents/{document_id}")
def own_document(document_id: UUID, a: Applicant = Depends(applicant)):
    with a.tx() as c:
        d = c.execute("SELECT filename, mime, storage_key FROM admission.application_documents WHERE document_id = %s",
                      (document_id,)).fetchone()
    if not d:
        raise HTTPException(404, "Document not found")
    return Response(get_storage().get(d["storage_key"]), media_type=d["mime"],
                    headers={"Content-Disposition": content_disposition(d["filename"]), "Cache-Control": "no-store",
                             "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"})


@router.delete("/{slug}/me/documents/{document_id}")
def delete_document(document_id: UUID, request: Request, a: Applicant = Depends(applicant)):
    with a.tx() as c:
        app = c.execute("SELECT status FROM admission.applications WHERE application_id = %s FOR UPDATE", (a.application_id,)).fetchone()
        if app["status"] not in wf.EDITABLE:
            raise HTTPException(409, "This application can no longer be changed")
        d = c.execute("DELETE FROM admission.application_documents WHERE document_id = %s RETURNING storage_key, requirement_key",
                      (document_id,)).fetchone()
        if not d:
            raise HTTPException(404, "Document not found")
        wf.audit(c, a.application_id, "applicant", "document.deleted", "application_document", document_id,
                 {"requirement": d["requirement_key"]}, _ip(request))
    try:
        get_storage().delete(d["storage_key"])
    except Exception:  # noqa: BLE001 — already gone
        pass
    return {"deleted": True}


class SubmitIn(BaseModel):
    declaration: bool
    consent_version_id: UUID | None = None
    consent_confirm: bool = False


@router.post("/{slug}/me/submit")
def submit(body: SubmitIn, request: Request, a: Applicant = Depends(applicant)):
    """Final submission. Without a linked admission test the one-time credential is removed now (hash wiped, sessions
    ended); with one, the application waits for the test and the credential is removed when the test is submitted."""
    if not body.declaration:
        raise HTTPException(422, "Please confirm the declaration before submitting")
    ip = _ip(request)
    with a.tx() as c:
        app, form, ver = _load(c, a, lock=True)
        if app["status"] not in wf.EDITABLE:
            raise HTTPException(409, "This application has already been submitted")
        defn = ver["definition"]
        grades = defn.get("grades") or form["grades"]
        answers, errors = validate_answers(defn, app["answers"], grades)
        counts: dict[str, int] = {}
        for d in _docs(c, a.application_id):
            counts[d["requirement_key"]] = counts.get(d["requirement_key"], 0) + 1
        errors += document_problems(defn, counts)
        if errors:
            raise HTTPException(422, {"message": "Please complete the highlighted fields", "errors": errors})
        consent = _consent(c)
        if consent and not (body.consent_confirm and body.consent_version_id == consent["version_id"]):
            raise HTTPException(422, "Please read the privacy notice and tick the box to give consent")
        core = core_values(defn, answers)
        test = form["linked_test_id"] if app["status"] == "draft" else None
        if test and not db.fetch_one("SELECT 1 FROM public.admission_tests WHERE test_id = %s AND status = 'PUBLISHED'", (test,)):
            raise HTTPException(409, "The admission test is not available yet. Please try again later or contact the school.")
        to = "test_pending" if test else ("submitted" if app["status"] == "draft" else "resubmitted")
        c.execute("UPDATE admission.applications SET status = %s, answers = %s, version_id = %s, student_name = %s, date_of_birth = %s, "
                  "grade_applying = %s, submitted_at = NOW(), submission_count = submission_count + 1, last_saved_at = NOW() "
                  "WHERE application_id = %s",
                  (to, Jsonb(answers), ver["version_id"], core["student_name"], core["date_of_birth"], int(core["grade_applying"]),
                   a.application_id))
        wf.record(c, a.application_id, app["status"], to, actor=a.application_id, role="applicant")
        removed = 0
        if to != "test_pending":
            removed = wf.remove_credentials(c, a.application_id, reason="submitted", actor=a.application_id)
        wf.audit(c, a.application_id, "applicant", "application.submitted", "application", a.application_id,
                 {"status": to, "credential_removed": bool(removed)}, ip)
        app = c.execute("SELECT * FROM admission.applications WHERE application_id = %s", (a.application_id,)).fetchone()
        wf.sync_crm(c, app, defn, consent=consent, ip=ip, user_agent=request.headers.get("user-agent"))
    if to != "test_pending":
        wf.notify_owner(a.org, form, app, "resubmitted" if to == "resubmitted" else "submitted")
    return {"status": to, "status_label": wf.STATUS_LABEL[to], "reference_no": app["reference_no"],
            "credential_removed": to != "test_pending", "test_required": to == "test_pending"}


class GuardianConsentIn(BaseModel):
    guardian_name: str = Field(min_length=2, max_length=200)
    relationship: str = Field(min_length=2, max_length=60)
    confirm: bool


class LaunchIn(BaseModel):
    device_id: str = Field(pattern=r"^[A-Za-z0-9_-]{16,64}$")
    guardian_consent: GuardianConsentIn | None = None


@router.post("/{slug}/me/test/launch", status_code=201)
def launch_test(body: LaunchIn, a: Applicant = Depends(applicant)):
    """Starts (or re-opens on this device) the linked proctored admission test. The candidate is created from the
    application; the session belongs to the form's owner, who sees it on the live monitor and in the results. The exam
    token is returned once and works only on the exam routes."""
    with a.tx() as c:
        app, form, ver = _load(c, a)
    if app["status"] != "test_pending" or not form["linked_test_id"]:
        raise HTTPException(409, "There is no admission test to take for this application")
    test = db.fetch_one("SELECT test_id, status, grade_applying FROM public.admission_tests WHERE test_id = %s", (form["linked_test_id"],))
    if not test or test["status"] != "PUBLISHED":
        raise HTTPException(409, "The admission test is not available yet. Please contact the school.")
    is_minor = wf.minor(app["date_of_birth"])
    consent = None
    if is_minor:
        g = body.guardian_consent
        if not g or not g.confirm:
            raise HTTPException(422, "A parent or guardian must agree to the supervised (camera, microphone level, screen) test")
        consent = {"guardian_name": g.guardian_name.strip(), "relationship": g.relationship.strip(), "method": "applicant_portal",
                   "confirmed_by": f"applicant:{a.application_id}", "confirmed_at": auth.now().isoformat()}
    core = core_values(ver["definition"], app["answers"])
    owner = form["created_by"]
    with db.connection() as conn:
        cand_id = app["exam_candidate_id"]
        if not cand_id:
            cand_id = conn.execute(
                "INSERT INTO public.admission_candidates (org_code, full_name, dob, grade_applying, guardian_name, guardian_email, "
                "guardian_phone, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING candidate_id",
                (a.org, app["student_name"], app["date_of_birth"], grade_label(app["grade_applying"]), core.get("guardian_name"),
                 core.get("guardian_email"), core.get("guardian_phone"), owner)).fetchone()["candidate_id"]
    if not app["exam_candidate_id"]:
        with a.tx() as c, wf.as_system(c, f"app:{a.application_id}"):
            c.execute("UPDATE admission.applications SET exam_candidate_id = %s WHERE application_id = %s AND exam_candidate_id IS NULL",
                      (cand_id, a.application_id))
    if db.fetch_one("SELECT 1 FROM public.admission_sessions WHERE test_id = %s AND candidate_id = %s AND status IN ('SUBMITTED','ENDED')",
                    (test["test_id"], cand_id)):
        raise HTTPException(409, "The admission test has already been completed")
    token, token_hash = guard.new_exam_token()
    expires = auth.now() + timedelta(minutes=test_cfg.TUNABLES["exam_token_ttl_minutes"])
    with db.connection() as conn:
        open_s = conn.execute("SELECT session_id, status FROM public.admission_sessions WHERE test_id = %s AND candidate_id = %s "
                              "AND status = ANY(%s) FOR UPDATE", (test["test_id"], cand_id, list(EXAM_OPEN))).fetchone()
        if open_s and open_s["status"] == "LOCKED":
            raise HTTPException(423, "The test is locked after three date-of-birth mismatches. Please contact the school.")
        if open_s:
            row = conn.execute("UPDATE public.admission_sessions SET exam_token_hash = %s, token_expires_at = %s, device_id = %s, "
                               "active_page_id = NULL, guardian_consent = COALESCE(%s, guardian_consent), updated_at = NOW() "
                               "WHERE session_id = %s RETURNING session_id, status",
                               (token_hash, expires, body.device_id, Jsonb(consent) if consent else None, open_s["session_id"])).fetchone()
            action = "session_relaunched"
        else:
            row = conn.execute("INSERT INTO public.admission_sessions (test_id, candidate_id, org_code, launched_by, exam_token_hash, "
                               "token_expires_at, device_id, guardian_consent, origin) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'applicant') "
                               "RETURNING session_id, status",
                               (test["test_id"], cand_id, a.org, owner, token_hash, expires, body.device_id,
                                Jsonb(consent) if consent else None)).fetchone()
            action = "session_launched"
        guard.audit(a.org, action, actor=f"app:{a.application_id}", role="applicant", test_id=test["test_id"], session_id=row["session_id"],
                    details={"candidate_id": str(cand_id), "minor": is_minor, "guardian_consent": bool(consent), "origin": "applicant"},
                    conn=conn)
    with a.tx() as c, wf.as_system(c, f"app:{a.application_id}"):
        c.execute("UPDATE admission.applications SET exam_session_id = %s WHERE application_id = %s", (row["session_id"], a.application_id))
        wf.audit(c, a.application_id, "applicant", "application.test_launched", "application", a.application_id,
                 {"exam_session_id": str(row["session_id"])})
    return {"session_id": row["session_id"], "exam_token": token, "expires_at": expires, "status": row["status"]}
