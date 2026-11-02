"""Pravesh (admissions) — Milestone 1: admissions team, DPDP core and the parent portal.

Every `admission.*` query runs through `db.tenant(...)`, so Postgres row-level security enforces school isolation
(and, for parents, family isolation). The role checks on each endpoint are a second layer, not the only one.
"""
from __future__ import annotations

import ipaddress
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import db
from ..security import CurrentUser, require_role
from ..services.admission import consent_templates as ct
from ..services.members import Email, Name, Password, Phone, create_member
from .admin import MemberPatch, _org, _patch_member, org_scope

router = APIRouter(prefix="/ICMELive/api/v1/admission", tags=["admission"])
principals = require_role("orgadmin", "superadmin")
staff = require_role("orgadmin", "superadmin", "counsellor", "reviewer")
parents = require_role("parent")

Lang = Literal["en", "hi", "kn", "ta"]
TEAM_ROLES = ("counsellor", "reviewer")
RETENTION_DEFAULTS = {"proctor_snapshots": 30, "proctor_events": 180, "unsuccessful_applicants": 180,
                      "withdrawn_enquiries": 90, "audit_log": 365}
RETENTION_MIN = {"audit_log": 365}   # processing logs are kept for at least a year
REQUEST_DUE_DAYS = 30                # school's own target; the DPDP Rules allow up to 90 days for grievances
RequestKind = Literal["access", "correction", "erasure", "consent_withdrawal", "grievance"]


# ---------------------------------------------------------------- helpers
def _ip(request: Request) -> str | None:
    """Client IP for consent evidence. X-Forwarded-For is not trusted (configure the proxy to set the peer address)."""
    host = request.client.host if request.client else None
    try:
        return str(ipaddress.ip_address(host)) if host else None
    except ValueError:
        return None


def _tx(user: CurrentUser, org: str):
    return db.tenant(org, user.user_code, user.role)


def _audit(conn, user: CurrentUser, action: str, entity: str, entity_id=None, details: dict | None = None,
           ip: str | None = None) -> None:
    """Append-only audit entry for the current tenant. `details` holds ids / field names only, never personal data."""
    conn.execute(
        "INSERT INTO admission.audit_log (org_code, actor_code, actor_role, action, entity, entity_id, details, ip) "
        "VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s, %s)",
        (user.user_code, user.role, action, entity, str(entity_id) if entity_id else None, Jsonb(details or {}), ip))


def _latest_consents(conn) -> dict:
    rows = conn.execute(
        "SELECT DISTINCT ON (applicant_id) applicant_id, decision, version, language, created_at "
        "FROM admission.consents WHERE applicant_id IS NOT NULL ORDER BY applicant_id, created_at DESC").fetchall()
    return {r["applicant_id"]: r for r in rows}


def _active_version(conn) -> dict | None:
    rows = conn.execute("SELECT version_id, version, language, title, body, purposes FROM admission.consent_versions "
                        "WHERE is_active ORDER BY language").fetchall()
    if not rows:
        return None
    return {"version": rows[0]["version"], "purposes": rows[0]["purposes"], "texts": {r["language"]: r for r in rows}}


# ---------------------------------------------------------------- staff: overview & applicants
@router.get("/overview")
def overview(org_code: str | None = None, user: CurrentUser = Depends(staff)):
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        grades = c.execute("SELECT grade_applying AS grade, COUNT(*) AS n FROM admission.applicants "
                           "GROUP BY grade_applying ORDER BY grade_applying").fetchall()
        latest = _latest_consents(c)
        req = c.execute("SELECT COUNT(*) FILTER (WHERE status IN ('open','in_progress')) AS open, "
                        "COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND due_at < NOW()) AS overdue "
                        "FROM admission.data_requests").fetchone()
        breaches = c.execute("SELECT COUNT(*) AS n FROM admission.breach_log WHERE status <> 'closed'").fetchone()["n"]
        active = _active_version(c)
    total = sum(g["n"] for g in grades)
    granted = sum(1 for v in latest.values() if v["decision"] == "granted")
    withdrawn = sum(1 for v in latest.values() if v["decision"] == "withdrawn")
    team = {r["user_role"]: r["n"] for r in db.fetch_all(
        "SELECT user_role, COUNT(*) AS n FROM public.app_users WHERE org_code = %s AND user_role IN ('counsellor','reviewer') "
        "AND is_active GROUP BY user_role", (org,))}
    return {
        "applicants": {"total": total, "by_grade": [{"grade": g["grade"], "count": g["n"]} for g in grades]},
        "consent": {"granted": granted, "withdrawn": withdrawn, "pending": total - granted - withdrawn},
        "requests": {"open": req["open"], "overdue": req["overdue"]},
        "breaches_open": breaches,
        "team": {"counsellors": team.get("counsellor", 0), "reviewers": team.get("reviewer", 0)},
        "consent_version": {"version": active["version"], "languages": sorted(active["texts"])} if active else None,
    }


@router.get("/applicants")
def applicants(org_code: str | None = None, grade: int | None = Query(default=None, ge=6, le=12),
               user: CurrentUser = Depends(staff)):
    """Minimal applicant list with consent status (the full admissions CRM arrives in Milestone 2)."""
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        rows = c.execute(
            "SELECT a.applicant_id, a.full_name, a.grade_applying, a.status, a.preferred_language, a.created_at, "
            "  COALESCE(json_agg(json_build_object('full_name', g.full_name, 'relationship', g.relationship)) "
            "           FILTER (WHERE g.guardian_id IS NOT NULL), '[]') AS guardians "
            "FROM admission.applicants a LEFT JOIN admission.applicant_guardians ag ON ag.applicant_id = a.applicant_id "
            "LEFT JOIN admission.guardians g ON g.guardian_id = ag.guardian_id "
            "WHERE (%s::int IS NULL OR a.grade_applying = %s::int) GROUP BY a.applicant_id ORDER BY a.grade_applying, a.full_name",
            (grade, grade)).fetchall()
        latest = _latest_consents(c)
    for r in rows:
        last = latest.get(r["applicant_id"])
        r["consent"] = {"decision": last["decision"], "version": last["version"], "at": last["created_at"]} if last else None
    return {"applicants": rows}


# ---------------------------------------------------------------- principal: admissions team
class TeamMemberIn(BaseModel):
    role: Literal["counsellor", "reviewer"]
    full_name: Name
    email: Email
    phone: Phone | None = None
    password: Password | None = None


@router.get("/team")
def team(org_code: str | None = None, user: CurrentUser = Depends(principals)):
    org = org_scope(user, org_code)
    rows = db.fetch_all(
        "SELECT user_code, full_name, email, phone, user_role AS role, is_active, created_at FROM public.app_users "
        "WHERE org_code = %s AND user_role IN ('counsellor','reviewer') ORDER BY user_role, full_name", (org,))
    return {"members": rows}


@router.post("/team", status_code=201)
def add_team_member(body: TeamMemberIn, request: Request, org_code: str | None = None, user: CurrentUser = Depends(principals)):
    org = _org(org_scope(user, org_code))
    code = f"{org['org_code'][:10].upper()}-{'C' if body.role == 'counsellor' else 'R'}{secrets.randbelow(10**5):05d}"
    out = create_member(org_code=org["org_code"], customer_code=org["customer_code"], role=body.role,
                        full_name=body.full_name, user_code=code, email=body.email, password=body.password,
                        created_by=user.user_code, phone=body.phone)
    with _tx(user, org["org_code"]) as c:
        _audit(c, user, "team.member_added", "app_user", code, {"role": body.role}, _ip(request))
    return out


@router.patch("/team/{user_code}")
def update_team_member(user_code: str, body: MemberPatch, request: Request, org_code: str | None = None,
                       user: CurrentUser = Depends(principals)):
    org = org_scope(user, org_code)
    m = db.call_row("usp_get_member", org, user_code)
    if not m or m["user_role"] not in TEAM_ROLES:
        raise HTTPException(404, "Team member not found")
    out = _patch_member(org, user_code, m["user_role"], body)
    with _tx(user, org) as c:
        _audit(c, user, "team.member_updated", "app_user", user_code,
               {"fields": sorted(k for k, v in body.model_dump(exclude_unset=True).items() if v not in (None, False))}, _ip(request))
    return out


# ---------------------------------------------------------------- principal: consent notice versions
class ConsentText(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=50, max_length=20_000)


class ConsentVersionIn(BaseModel):
    texts: dict[Lang, ConsentText]
    purposes: list[str] = Field(default_factory=lambda: list(ct.PURPOSES), min_length=1, max_length=12)


@router.get("/consent-templates")
def consent_templates(org_code: str | None = None, user: CurrentUser = Depends(principals)):
    org = _org(org_scope(user, org_code))
    return {"purposes": ct.PURPOSES, "draft_languages": list(ct.DRAFT_LANGUAGES),
            "texts": {lang: ct.render(lang, org["org_name"]) for lang in ct.LANGUAGES}}


@router.get("/consent-versions")
def consent_versions(org_code: str | None = None, user: CurrentUser = Depends(principals)):
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        rows = c.execute("SELECT version_id, version, language, title, body, purposes, is_active, created_by, created_at "
                         "FROM admission.consent_versions ORDER BY version DESC, language").fetchall()
        counts = {r["version"]: r["n"] for r in c.execute(
            "SELECT version, COUNT(*) AS n FROM admission.consents WHERE decision = 'granted' GROUP BY version").fetchall()}
    versions: dict[int, dict] = {}
    for r in rows:
        v = versions.setdefault(r["version"], {"version": r["version"], "is_active": r["is_active"], "purposes": r["purposes"],
                                               "created_by": r["created_by"], "created_at": r["created_at"],
                                               "granted_count": counts.get(r["version"], 0), "texts": []})
        v["texts"].append({"version_id": r["version_id"], "language": r["language"], "title": r["title"], "body": r["body"]})
    return {"versions": list(versions.values())}


@router.post("/consent-versions", status_code=201)
def publish_consent_version(body: ConsentVersionIn, request: Request, org_code: str | None = None,
                            user: CurrentUser = Depends(principals)):
    """Publishes a new version (English required). Earlier versions stay as evidence but stop being offered."""
    if "en" not in body.texts:
        raise HTTPException(422, "The English text is required")
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        nxt = c.execute("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM admission.consent_versions").fetchone()["v"]
        c.execute("UPDATE admission.consent_versions SET is_active = FALSE WHERE is_active")
        for lang, t in body.texts.items():
            c.execute("INSERT INTO admission.consent_versions (org_code, version, language, title, body, purposes, created_by) "
                      "VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s)",
                      (nxt, lang, t.title.strip(), t.body.strip(), body.purposes, user.user_code))
        _audit(c, user, "consent.version_published", "consent_version", nxt, {"languages": sorted(body.texts)}, _ip(request))
    return {"version": nxt, "languages": sorted(body.texts)}


# ---------------------------------------------------------------- principal: retention timers
class RetentionIn(BaseModel):
    policies: dict[Literal["proctor_snapshots", "proctor_events", "unsuccessful_applicants", "withdrawn_enquiries",
                           "audit_log"], int]


@router.get("/retention")
def retention(org_code: str | None = None, user: CurrentUser = Depends(principals)):
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        rows = {r["data_class"]: r for r in c.execute(
            "SELECT data_class, retain_days, updated_by, updated_at FROM admission.retention_policies").fetchall()}
    return {"policies": [{"data_class": k, "retain_days": rows[k]["retain_days"] if k in rows else d, "default_days": d,
                          "minimum_days": RETENTION_MIN.get(k, 1), "updated_by": rows.get(k, {}).get("updated_by"),
                          "updated_at": rows.get(k, {}).get("updated_at")} for k, d in RETENTION_DEFAULTS.items()]}


@router.put("/retention")
def set_retention(body: RetentionIn, request: Request, org_code: str | None = None, user: CurrentUser = Depends(principals)):
    for k, days in body.policies.items():
        if not RETENTION_MIN.get(k, 1) <= days <= 3650:
            raise HTTPException(422, f"{k}: keep between {RETENTION_MIN.get(k, 1)} and 3650 days")
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        for k, days in body.policies.items():
            c.execute("INSERT INTO admission.retention_policies (org_code, data_class, retain_days, updated_by) "
                      "VALUES (admission.current_org(), %s, %s, %s) ON CONFLICT (org_code, data_class) DO UPDATE "
                      "SET retain_days = EXCLUDED.retain_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()",
                      (k, days, user.user_code))
        _audit(c, user, "retention.updated", "retention_policy", None, {"policies": body.policies}, _ip(request))
    return retention(org_code, user)


# ---------------------------------------------------------------- principal: data-principal requests
class RequestIn(BaseModel):
    kind: RequestKind
    applicant_id: UUID | None = None
    guardian_id: UUID | None = None
    details: str | None = Field(default=None, max_length=4000)


class RequestPatch(BaseModel):
    status: Literal["open", "in_progress", "completed", "rejected"]
    resolution_note: str | None = Field(default=None, max_length=4000)


REQUEST_SELECT = (
    "SELECT r.request_id, r.kind, r.details, r.status, r.due_at, r.resolved_at, r.resolution_note, r.created_by, "
    "  r.created_at, r.applicant_id, a.full_name AS applicant_name, g.full_name AS guardian_name "
    "FROM admission.data_requests r LEFT JOIN admission.applicants a ON a.applicant_id = r.applicant_id "
    "LEFT JOIN admission.guardians g ON g.guardian_id = r.guardian_id ")


@router.get("/data-requests")
def data_requests(status: str | None = None, org_code: str | None = None, user: CurrentUser = Depends(principals)):
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        rows = c.execute(REQUEST_SELECT + "WHERE (%s::text IS NULL OR r.status = %s::text) ORDER BY r.due_at",
                         (status, status)).fetchall()
    return {"requests": rows}


@router.post("/data-requests", status_code=201)
def log_data_request(body: RequestIn, request: Request, org_code: str | None = None, user: CurrentUser = Depends(principals)):
    """Record a request received offline (phone, letter, at the counter)."""
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        row = c.execute("INSERT INTO admission.data_requests (org_code, applicant_id, guardian_id, kind, details, due_at, created_by) "
                        "VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s) RETURNING request_id",
                        (body.applicant_id, body.guardian_id, body.kind, body.details,
                         datetime.now(timezone.utc) + timedelta(days=REQUEST_DUE_DAYS), user.user_code)).fetchone()
        _audit(c, user, "request.logged", "data_request", row["request_id"], {"kind": body.kind}, _ip(request))
    return {"request_id": row["request_id"]}


@router.patch("/data-requests/{request_id}")
def update_data_request(request_id: UUID, body: RequestPatch, request: Request, org_code: str | None = None,
                        user: CurrentUser = Depends(principals)):
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        row = c.execute("UPDATE admission.data_requests SET status = %s, resolution_note = COALESCE(%s, resolution_note), "
                        "resolved_at = CASE WHEN %s IN ('completed','rejected') THEN NOW() ELSE NULL END "
                        "WHERE request_id = %s RETURNING request_id",
                        (body.status, body.resolution_note, body.status, request_id)).fetchone()
        if not row:
            raise HTTPException(404, "Request not found")
        _audit(c, user, "request.updated", "data_request", request_id, {"status": body.status}, _ip(request))
    return {"request_id": request_id, "status": body.status}


# ---------------------------------------------------------------- principal: breach log
class BreachIn(BaseModel):
    detected_at: datetime
    nature: str = Field(min_length=5, max_length=4000)
    data_affected: str | None = Field(default=None, max_length=2000)
    affected_count: int | None = Field(default=None, ge=0)
    actions_taken: str | None = Field(default=None, max_length=4000)


class BreachPatch(BaseModel):
    status: Literal["open", "reported", "closed"] | None = None
    actions_taken: str | None = Field(default=None, max_length=4000)
    board_notified_at: datetime | None = None
    principals_notified_at: datetime | None = None
    affected_count: int | None = Field(default=None, ge=0)


@router.get("/breaches")
def breaches(org_code: str | None = None, user: CurrentUser = Depends(principals)):
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        rows = c.execute("SELECT * FROM admission.breach_log ORDER BY detected_at DESC").fetchall()
    for r in rows:   # DPDP Rules 2025: detailed report to the Board within 72 hours of becoming aware
        r["board_report_due_at"] = r["detected_at"] + timedelta(hours=72)
    return {"breaches": rows}


@router.post("/breaches", status_code=201)
def log_breach(body: BreachIn, request: Request, org_code: str | None = None, user: CurrentUser = Depends(principals)):
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        row = c.execute("INSERT INTO admission.breach_log (org_code, detected_at, nature, data_affected, affected_count, "
                        "actions_taken, created_by) VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s) RETURNING breach_id",
                        (body.detected_at, body.nature, body.data_affected, body.affected_count, body.actions_taken,
                         user.user_code)).fetchone()
        _audit(c, user, "breach.logged", "breach", row["breach_id"], {}, _ip(request))
    return {"breach_id": row["breach_id"]}


@router.patch("/breaches/{breach_id}")
def update_breach(breach_id: UUID, body: BreachPatch, request: Request, org_code: str | None = None,
                  user: CurrentUser = Depends(principals)):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(422, "Nothing to update")
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        sets = ", ".join(f"{k} = %s" for k in fields)   # keys come from the model, not from the client
        row = c.execute(f"UPDATE admission.breach_log SET {sets}, updated_at = NOW() WHERE breach_id = %s RETURNING breach_id",
                        (*fields.values(), breach_id)).fetchone()
        if not row:
            raise HTTPException(404, "Breach record not found")
        _audit(c, user, "breach.updated", "breach", breach_id, {"fields": sorted(fields)}, _ip(request))
    return {"breach_id": breach_id}


# ---------------------------------------------------------------- principal: audit log
@router.get("/audit")
def audit_log(entity: str | None = Query(default=None, max_length=48), action: str | None = Query(default=None, max_length=64),
              limit: int = Query(default=200, ge=1, le=1000), org_code: str | None = None, user: CurrentUser = Depends(principals)):
    org = org_scope(user, org_code)
    with _tx(user, org) as c:
        rows = c.execute("SELECT log_id, actor_code, actor_role, action, entity, entity_id, details, ip::text AS ip, created_at "
                         "FROM admission.audit_log WHERE (%s::text IS NULL OR entity = %s::text) "
                         "AND (%s::text IS NULL OR action = %s::text) ORDER BY log_id DESC LIMIT %s",
                         (entity, entity, action, action, limit)).fetchall()
    return {"entries": rows}


# ---------------------------------------------------------------- parent portal (row-level security: own family only)
class ConsentIn(BaseModel):
    applicant_id: UUID
    version_id: UUID
    decision: Literal["granted", "withdrawn"]
    confirm: bool = False


class ParentRequestIn(BaseModel):
    kind: RequestKind
    applicant_id: UUID | None = None
    details: str | None = Field(default=None, max_length=4000)


class LanguageIn(BaseModel):
    language: Lang


@router.get("/parent/home")
def parent_home(user: CurrentUser = Depends(parents)):
    with _tx(user, user.org_code) as c:
        guardians = c.execute("SELECT guardian_id, full_name, relationship, preferred_language FROM admission.guardians").fetchall()
        children = c.execute("SELECT applicant_id, full_name, grade_applying, status, preferred_language "
                             "FROM admission.applicants ORDER BY full_name").fetchall()
        latest = _latest_consents(c)
        active = _active_version(c)
        open_requests = c.execute("SELECT COUNT(*) AS n FROM admission.data_requests WHERE status IN ('open','in_progress')").fetchone()["n"]
    for ch in children:
        last = latest.get(ch["applicant_id"])
        ch["consent"] = {"decision": last["decision"], "version": last["version"], "at": last["created_at"],
                         "current": bool(active and last["version"] == active["version"])} if last else None
    org = db.fetch_one("SELECT org_name FROM public.organizations WHERE org_code = %s", (user.org_code,))
    return {"school": org["org_name"] if org else user.org_code, "guardian": guardians[0] if guardians else None,
            "children": children, "consent_version": active["version"] if active else None,
            "consent_languages": sorted(active["texts"]) if active else [], "open_requests": open_requests}


@router.get("/parent/consent")
def parent_consent_text(applicant_id: UUID, lang: Lang = "en", user: CurrentUser = Depends(parents)):
    with _tx(user, user.org_code) as c:
        child = c.execute("SELECT applicant_id, full_name, grade_applying FROM admission.applicants WHERE applicant_id = %s",
                          (applicant_id,)).fetchone()
        if not child:
            raise HTTPException(404, "Child not found")
        active = _active_version(c)
        last = _latest_consents(c).get(applicant_id)
    if not active:
        raise HTTPException(409, "The school has not published a consent notice yet")
    text = active["texts"].get(lang) or active["texts"]["en"]
    return {"child": child, "version": active["version"], "purposes": active["purposes"],
            "language": text["language"], "requested_language": lang, "version_id": text["version_id"],
            "title": text["title"], "body": text["body"], "draft_translation": text["language"] in ct.DRAFT_LANGUAGES,
            "current": {"decision": last["decision"], "version": last["version"], "at": last["created_at"]} if last else None}


@router.post("/parent/consents", status_code=201)
def parent_give_consent(body: ConsentIn, request: Request, user: CurrentUser = Depends(parents)):
    if body.decision == "granted" and not body.confirm:
        raise HTTPException(422, "Please tick the box to confirm you are the parent or guardian and agree")
    with _tx(user, user.org_code) as c:
        link = c.execute("SELECT ag.guardian_id FROM admission.applicant_guardians ag JOIN admission.guardians g "
                         "ON g.guardian_id = ag.guardian_id WHERE ag.applicant_id = %s LIMIT 1", (body.applicant_id,)).fetchone()
        if not link:
            raise HTTPException(404, "Child not found")
        ver = c.execute("SELECT version, language, is_active FROM admission.consent_versions WHERE version_id = %s",
                        (body.version_id,)).fetchone()
        if not ver or not ver["is_active"]:
            raise HTTPException(409, "This consent notice has been replaced; please read the current one")
        row = c.execute(
            "INSERT INTO admission.consents (org_code, applicant_id, guardian_id, version_id, version, language, decision, "
            "method, ip, user_agent, recorded_by) VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s, 'parent_portal', "
            "%s, %s, %s) RETURNING consent_id, created_at",
            (body.applicant_id, link["guardian_id"], body.version_id, ver["version"], ver["language"], body.decision,
             _ip(request), (request.headers.get("user-agent") or "")[:300] or None, user.user_code)).fetchone()
        _audit(c, user, f"consent.{body.decision}", "applicant", body.applicant_id,
               {"version": ver["version"], "language": ver["language"]}, _ip(request))
    return {"consent_id": row["consent_id"], "decision": body.decision, "version": ver["version"], "at": row["created_at"]}


@router.get("/parent/requests")
def parent_requests(user: CurrentUser = Depends(parents)):
    with _tx(user, user.org_code) as c:
        rows = c.execute(REQUEST_SELECT + "ORDER BY r.created_at DESC").fetchall()
    return {"requests": rows}


@router.post("/parent/requests", status_code=201)
def parent_new_request(body: ParentRequestIn, request: Request, user: CurrentUser = Depends(parents)):
    with _tx(user, user.org_code) as c:
        guardian = c.execute("SELECT guardian_id FROM admission.guardians LIMIT 1").fetchone()
        if not guardian:
            raise HTTPException(404, "Guardian record not found")
        if body.applicant_id and not c.execute("SELECT 1 FROM admission.applicants WHERE applicant_id = %s",
                                               (body.applicant_id,)).fetchone():
            raise HTTPException(404, "Child not found")
        row = c.execute("INSERT INTO admission.data_requests (org_code, applicant_id, guardian_id, kind, details, due_at, created_by) "
                        "VALUES (admission.current_org(), %s, %s, %s, %s, %s, %s) RETURNING request_id, due_at",
                        (body.applicant_id, guardian["guardian_id"], body.kind, body.details,
                         datetime.now(timezone.utc) + timedelta(days=REQUEST_DUE_DAYS), user.user_code)).fetchone()
        _audit(c, user, "request.raised", "data_request", row["request_id"], {"kind": body.kind}, _ip(request))
    return {"request_id": row["request_id"], "due_at": row["due_at"]}


@router.put("/parent/language")
def parent_language(body: LanguageIn, user: CurrentUser = Depends(parents)):
    with _tx(user, user.org_code) as c:
        c.execute("UPDATE admission.guardians SET preferred_language = %s", (body.language,))
    return {"language": body.language}
