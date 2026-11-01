"""Admission tests — results and reports (the test's teacher; org admins read only).

GET  /results?test_id=            completed sessions with composite, band, academic, HQ, integrity, submit reason
GET  /results.csv?test_id=        CSV export (formula-injection safe)
GET  /reports/{session_id}        cached report_json + short-lived signed URLs (ID photo, evidence thumbnails)
POST /reports/{session_id}/regenerate
GET  /reports/{session_id}/evidence/{event_id}   302 to a 5-minute signed URL
"""
from __future__ import annotations

import csv
import io
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse

from .. import db
from ..security import CurrentUser, require_role
from ..services.admission_test import config as cfg
from ..services.admission_test import guard, sessions
from ..services.admission_test.report import schedule
from ..services.storage import get_storage
from .admission_tests import org_of, test_for

router = APIRouter(prefix="/ICMELive/api/v1/admission", tags=["admission-reports"], dependencies=[Depends(guard.no_store)])
readers = require_role("teacher", "orgadmin", "superadmin")
teachers = require_role("teacher")
EVIDENCE_URL_MINUTES = 5

REASON = {"MANUAL": "Submitted", "TIME_UP": "Time up", "AUTO_VIOLATION": "Auto-submitted (rules)", "ENDED_BY_TEACHER": "Ended by teacher"}


def _session_for(user: CurrentUser, session_id: UUID, org_code: str | None = None) -> dict:
    s = sessions.load(session_id)
    if not s or s["org_code"] != org_of(user, org_code) or (user.role == "teacher" and user.user_code not in (s["test_owner"], s["launched_by"])):
        raise HTTPException(404, "Session not found")
    return s


def _results(user: CurrentUser, test_id: UUID | None, org_code: str | None) -> list[dict]:
    org = org_of(user, org_code)
    if test_id:
        test_for(user, test_id, org_code=org_code)
    rows = db.fetch_all(
        "SELECT s.session_id, s.test_id, t.title AS test_title, c.full_name AS candidate_name, c.grade_applying, s.status, s.submit_reason, "
        "s.started_at, s.submitted_at, s.integrity_score, s.integrity_band, s.warnings_count, r.status AS report_status, "
        "r.report_json->'scores' AS scores, r.generated_at FROM public.admission_sessions s "
        "JOIN public.admission_tests t ON t.test_id = s.test_id JOIN public.admission_candidates c ON c.candidate_id = s.candidate_id "
        "LEFT JOIN public.admission_reports r ON r.session_id = s.session_id "
        "WHERE s.org_code = %s AND s.status IN ('SUBMITTED','ENDED') AND (%s::uuid IS NULL OR s.test_id = %s::uuid) "
        "AND (%s::text IS NULL OR t.created_by = %s::text OR s.launched_by = %s::text) ORDER BY s.submitted_at DESC",
        (org, test_id, test_id, *([user.user_code] * 3 if user.role == "teacher" else [None] * 3)))
    out = []
    for r in rows:
        sc = r.pop("scores") or {}
        out.append({**r, "composite": sc.get("composite"), "band": sc.get("label"), "academic_pct": sc.get("academic_pct"),
                    "hq_composite": sc.get("hq_composite"), "hq_band": sc.get("hq_band"), "submit_label": REASON.get(r["submit_reason"] or "", "")})
    return out


@router.get("/results")
def results(test_id: UUID | None = None, org_code: str | None = None, user: CurrentUser = Depends(readers)):
    return {"results": _results(user, test_id, org_code)}


def _cell(v) -> str:
    """CSV cells starting with = + - @ (or tab / CR) are prefixed with ' so spreadsheets do not run them as formulas."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


@router.get("/results.csv")
def results_csv(test_id: UUID | None = None, org_code: str | None = None, user: CurrentUser = Depends(readers)):
    rows = _results(user, test_id, org_code)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Candidate", "Grade applying", "Test", "Submitted", "Submit reason", "Composite", "Recommendation", "Academic %", "HQ",
                "HQ band", "Integrity", "Integrity band", "Warnings", "Report"])
    for r in rows:
        w.writerow([_cell(x) for x in (r["candidate_name"], r["grade_applying"], r["test_title"], r["submitted_at"], r["submit_label"],
                                       r["composite"], r["band"], r["academic_pct"], r["hq_composite"], r["hq_band"], r["integrity_score"],
                                       r["integrity_band"], r["warnings_count"], r["report_status"])])
    resp = Response(buf.getvalue().encode("utf-8-sig"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="admission-results.csv"'})
    return guard.headers(resp)


@router.get("/reports/{session_id}")
def report(session_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(readers)):
    s = _session_for(user, session_id, org_code)
    r = db.fetch_one("SELECT * FROM public.admission_reports WHERE session_id = %s", (session_id,))
    if not r:
        raise HTTPException(404, "No report yet: the session has not been submitted")
    storage = get_storage()
    photo = storage.signed_url(s["id_photo_key"], EVIDENCE_URL_MINUTES) if s["id_photo_key"] else None
    # Evidence is listed live (the snapshot of the event that triggered an auto-submit can land after the report was
    # composed; files purged after the retention period simply drop out).
    rows = db.fetch_all("SELECT event_id, code, server_ts, details, evidence_key FROM public.admission_proctor_events "
                        "WHERE session_id = %s AND evidence_key IS NOT NULL ORDER BY server_ts", (session_id,))
    ev = {str(e["event_id"]): storage.signed_url(e["evidence_key"], EVIDENCE_URL_MINUTES) for e in rows}
    evidence = [{"event_id": e["event_id"], "code": e["code"], "label": cfg.FLAGS[e["code"]].label,
                 "t_offset_s": round((e["server_ts"] - s["started_at"]).total_seconds(), 1) if s["started_at"] else 0,
                 "kind": (e["details"] or {}).get("evidence", "webcam")} for e in rows]
    guard.audit(s["org_code"], "report_viewed", actor=user.user_code, role=user.role, test_id=s["test_id"], session_id=session_id,
                details={"evidence_links": len(ev)})
    return {"status": r["status"], "error": r["error"], "generated_at": r["generated_at"], "version": r["version"], "report": r["report_json"],
            "photo_url": photo, "evidence_urls": ev, "evidence": evidence, "url_minutes": EVIDENCE_URL_MINUTES}


@router.post("/reports/{session_id}/regenerate")
def regenerate(session_id: UUID, user: CurrentUser = Depends(teachers)):
    s = _session_for(user, session_id)
    if s["status"] not in sessions.DONE or not s["started_at"]:
        raise HTTPException(409, "Only submitted sessions have a report")
    guard.limiter.hit(f"adm-regen:{session_id}", 5, 600, message="This report was regenerated recently. Try again later.")
    guard.audit(s["org_code"], "report_regenerated", actor=user.user_code, role=user.role, test_id=s["test_id"], session_id=session_id)
    schedule(session_id)
    return {"status": "PENDING"}


@router.get("/reports/{session_id}/evidence/{event_id}")
def evidence(session_id: UUID, event_id: int, org_code: str | None = None, user: CurrentUser = Depends(readers)):
    s = _session_for(user, session_id, org_code)
    e = db.fetch_one("SELECT evidence_key FROM public.admission_proctor_events WHERE session_id = %s AND event_id = %s", (session_id, event_id))
    if not e or not e["evidence_key"]:
        raise HTTPException(404, "No evidence for this event (it may have been deleted after the retention period)")
    guard.audit(s["org_code"], "evidence_viewed", actor=user.user_code, role=user.role, test_id=s["test_id"], session_id=session_id,
                details={"event_id": event_id})
    return guard.headers(RedirectResponse(get_storage().signed_url(e["evidence_key"], EVIDENCE_URL_MINUTES), status_code=302))
