"""Student side of teacher-assigned Online Tests and Assignments (FRD v3.2).

Online test (FR-TST-03/04): start -> autosave answers -> submit (or auto-submit at time-up) -> AI evaluation.
Assignment (FR-ASG-02/03): download the question paper -> upload a PDF (re-upload allowed until reviewed / due)
-> OCR + AI evaluation. Scorecards (FR-DSP-01) are shown instantly or after the teacher publishes, per assessment.
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import db
from ..config import get_settings
from ..security import CurrentUser, ensure_module, require_role
from ..services.evaluation import analytics, assessments as rules, documents, slno
from ..services.storage import build_key, get_storage

router = APIRouter(prefix="/ICMELive/api/v1/assessments", tags=["assessments"])
student_only = require_role("student")
MODULE = "ocr_evaluation"
MAX_ANSWER_CHARS = 10_000
STUDENT_TYPES = ("ONLINE_TEST", "ASSIGNMENT")


# ---------------------------------------------------------------- helpers
def _me(user: CurrentUser) -> dict:
    me = db.call_row("usp_get_member", user.org_code, user.user_code)
    if not me or not me["class_code"]:
        raise HTTPException(404, "You are not enrolled in a class")
    return me


def _assessment(user: CurrentUser, test_id: UUID) -> dict:
    me = _me(user)
    t = db.fetch_one(
        "SELECT t.*, cs.subject_name, c.class_name FROM public.evaluation_tests t "
        "JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code AND cs.subject_code = t.subject_code "
        "JOIN public.classes c ON c.org_code = t.org_code AND c.class_code = t.class_code "
        "WHERE t.eval_test_id = %s AND t.org_code = %s AND t.class_code = %s AND t.is_assigned "
        "AND t.assessment_type IN ('ONLINE_TEST', 'ASSIGNMENT')", (test_id, user.org_code, me["class_code"]))
    if not t:
        raise HTTPException(404, "Assessment not found")
    return t


def _script(t: dict, user: CurrentUser) -> dict | None:
    return db.fetch_one("SELECT * FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s AND student_user_code = %s",
                        (t["eval_test_id"], user.user_code))


def _my_status(s: dict | None) -> str:
    if not s:
        return "NOT_STARTED"
    return {"IN_PROGRESS": "IN_PROGRESS", "UPLOADED": "EVALUATING", "QUEUED": "EVALUATING",
            "OCR_IN_PROGRESS": "EVALUATING", "EVALUATED": "EVALUATED", "REVIEWED": "EVALUATED",
            "FAILED": "FAILED"}[s["processing_status"]]


def _questions(test_id: UUID) -> list[dict]:
    # never expose model answers / correct options before evaluation
    return db.fetch_all(
        "SELECT sl_no, question_type, question_text, mcq_options, max_marks FROM public.evaluation_master_questions "
        "WHERE eval_test_id = %s ORDER BY display_order", (test_id,))


def _view(t: dict, s: dict | None, *, with_questions: bool) -> dict:
    status = _my_status(s)
    deadline = rules.attempt_deadline(t, s["started_at"]) if s and s.get("started_at") and t["duration_minutes"] else None
    visible = rules.results_visible(t, s)
    out = {
        "eval_test_id": t["eval_test_id"], "assessment_type": t["assessment_type"], "test_title": t["test_title"],
        "subject_code": t["subject_code"], "subject_name": t.get("subject_name"), "class_name": t.get("class_name"),
        "evaluation_scope": t["evaluation_scope"], "chapter_title": t["chapter_title"], "instructions": t["instructions"],
        "duration_minutes": t["duration_minutes"], "available_from": t["available_from"], "due_at": t["due_at"],
        "allow_late": t["allow_late"], "results_release": t["results_release"],
        "total_max_marks": t["total_max_marks"], "total_questions": t["total_questions"],
        "question_paper_url": get_storage().signed_url(t["question_paper_key"])
        if t["assessment_type"] == "ASSIGNMENT" and t["question_paper_key"] else None,
        "window": rules.window(t),
        "my": {
            "status": status, "started_at": s and s.get("started_at"), "deadline": deadline,
            "seconds_left": max(0, int((deadline - rules.now()).total_seconds())) if deadline and status == "IN_PROGRESS" else None,
            "submitted_at": s and s.get("submitted_at"), "is_late": bool(s and s.get("is_late")),
            "file_name": s and s.get("uploaded_pdf_filename"),
            "file_url": get_storage().signed_url(s["script_key"]) if s and s.get("script_key") else None,
            "submitted_by_teacher": bool(s and s.get("submission_mode") == "TEACHER_FOLDER_UPLOAD"),
            "error": s and s.get("error"),
        },
        "result_available": visible,
        "result_pending_publish": bool(s and status == "EVALUATED" and not visible),
        "score": {"obtained": s["total_obtained_marks"], "max": s["total_max_marks"], "percentage": s["percentage"],
                  "grade": analytics.grade_for(float(s["percentage"]), float(t["pass_percentage"]))} if visible else None,
    }
    if with_questions:
        out["questions"] = _questions(t["eval_test_id"])
        if s and s["submission_mode"] == "ONLINE_TEST_UI":
            out["answers"] = s.get("answers_json") or {}
            out["flagged"] = list(s.get("flagged_sl_nos") or [])
    return out


# ---------------------------------------------------------------- list & detail
@router.get("/my")
def my_assessments(assessment_type: Literal["ONLINE_TEST", "ASSIGNMENT"] | None = None,
                   user: CurrentUser = Depends(student_only)):
    me = _me(user)
    tests = db.fetch_all(
        "SELECT t.*, cs.subject_name, c.class_name FROM public.evaluation_tests t "
        "JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code AND cs.subject_code = t.subject_code "
        "JOIN public.classes c ON c.org_code = t.org_code AND c.class_code = t.class_code "
        "WHERE t.org_code = %s AND t.class_code = %s AND t.is_assigned AND t.assessment_type IN ('ONLINE_TEST','ASSIGNMENT') "
        "AND (%s::text IS NULL OR t.assessment_type = %s::text) ORDER BY t.due_at NULLS LAST, t.created_at DESC",
        (user.org_code, me["class_code"], assessment_type, assessment_type))
    out = []
    for t in tests:
        s = _script(t, user)
        if s and s["processing_status"] == "IN_PROGRESS" and rules.finalize_expired(t):
            s = _script(t, user)
        out.append(_view(t, s, with_questions=False))
    return {"assessments": out,
            "pending": sum(1 for a in out if a["my"]["status"] in ("NOT_STARTED", "IN_PROGRESS") and a["window"]["open"])}


@router.get("/my/{test_id}")
def my_assessment(test_id: UUID, user: CurrentUser = Depends(student_only)):
    t = _assessment(user, test_id)
    rules.finalize_expired(t)
    s = _script(t, user)
    # online-test questions only once the student has started; assignment questions are always shown
    show = t["assessment_type"] == "ASSIGNMENT" or (s is not None and s["submission_mode"] == "ONLINE_TEST_UI")
    return _view(t, s, with_questions=show)


# ---------------------------------------------------------------- online test (FR-TST-03/04)
class Answers(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict)
    flagged: list[str] = Field(default_factory=list, max_length=200)


def _clean_answers(t: dict, body: Answers) -> tuple[dict, list[str]]:
    qs = {q["sl_no"]: q for q in _questions(t["eval_test_id"])}
    clean = {}
    for k, v in body.answers.items():
        code = slno.normalise(k)
        if code not in qs:
            raise HTTPException(422, f"Unknown SL.No {k}")
        v = (v or "").strip()
        if len(v) > MAX_ANSWER_CHARS:
            raise HTTPException(422, f"SL.No {k}: answer is too long")
        if v and qs[code]["question_type"] == "MCQ":
            letter = slno.option_letter(v, list(qs[code]["mcq_options"] or []))
            if not letter:
                raise HTTPException(422, f"SL.No {k}: choose one of the options")
            v = letter
        if v:
            clean[code] = v
    flagged = sorted({slno.normalise(f) for f in body.flagged} & set(qs))
    return clean, flagged


def _open_attempt(t: dict, user: CurrentUser) -> dict:
    s = _script(t, user)
    if not s or s["submission_mode"] != "ONLINE_TEST_UI":
        raise HTTPException(409, "Start the test first")
    if s["processing_status"] != "IN_PROGRESS":
        raise HTTPException(409, "This test has already been submitted")
    return s


@router.post("/my/{test_id}/start")
def start_test(test_id: UUID, user: CurrentUser = Depends(student_only)):
    ensure_module(user, MODULE)
    t = _assessment(user, test_id)
    if t["assessment_type"] != "ONLINE_TEST":
        raise HTTPException(409, "This is an assignment — upload your answer PDF instead")
    s = _script(t, user)
    if s:  # resume an open attempt; one attempt only
        if s["processing_status"] != "IN_PROGRESS":
            raise HTTPException(409, "You have already taken this test")
        return my_assessment(test_id, user)
    w = rules.window(t)
    if not w["open"]:
        raise HTTPException(409, w["reason"])
    if not t["total_questions"]:
        raise HTTPException(409, "This test has no questions yet")
    try:
        db.execute(
            "INSERT INTO public.evaluation_candidate_scripts(eval_test_id, org_code, student_user_code, submission_mode, "
            "processing_status, started_at, total_max_marks, is_late) VALUES (%s,%s,%s,'ONLINE_TEST_UI','IN_PROGRESS',NOW(),%s,%s)",
            (test_id, user.org_code, user.user_code, t["total_max_marks"], bool(w.get("late"))))
    except pg_errors.UniqueViolation:
        pass  # double click / two tabs: the first insert wins
    return my_assessment(test_id, user)


@router.put("/my/{test_id}/answers")
def autosave(test_id: UUID, body: Answers, user: CurrentUser = Depends(student_only)):
    t = _assessment(user, test_id)
    s = _open_attempt(t, user)
    if rules.now() > rules.attempt_deadline(t, s["started_at"]) + rules.GRACE:
        rules.finalize_expired(t)
        raise HTTPException(409, "Time is up — your saved answers were submitted")
    answers, flagged = _clean_answers(t, body)
    db.execute("UPDATE public.evaluation_candidate_scripts SET answers_json = %s, flagged_sl_nos = %s WHERE script_id = %s",
               (Jsonb(answers), flagged, s["script_id"]))
    return {"saved": len(answers), "seconds_left": max(0, int((rules.attempt_deadline(t, s["started_at"]) - rules.now()).total_seconds()))}


@router.post("/my/{test_id}/submit")
@router.post("/{test_id}/submit-online-test", include_in_schema=False)  # FRD v3.2 path
def submit_test(test_id: UUID, body: Answers, user: CurrentUser = Depends(student_only)):
    ensure_module(user, MODULE)
    t = _assessment(user, test_id)
    s = _open_attempt(t, user)
    deadline = rules.attempt_deadline(t, s["started_at"])
    on_time = rules.now() <= deadline + rules.GRACE
    answers = _clean_answers(t, body)[0] if on_time else (s["answers_json"] or {})  # late: autosaved answers only
    submitted_at = rules.now() if on_time else deadline
    late = bool(s["is_late"] or (t["due_at"] and submitted_at > t["due_at"]))
    row = db.fetch_one(
        "UPDATE public.evaluation_candidate_scripts SET answers_json = %s, processing_status = 'QUEUED', submitted_at = %s, "
        "is_late = %s WHERE script_id = %s AND processing_status = 'IN_PROGRESS' RETURNING script_id",
        (Jsonb(answers), submitted_at, late, s["script_id"]))
    if row:
        rules.queue_evaluation(test_id, [str(row["script_id"])])
    return my_assessment(test_id, user)


# ---------------------------------------------------------------- assignment upload (FR-ASG-02/03)
@router.post("/my/{test_id}/upload")
@router.post("/{test_id}/submit-assignment-pdf", include_in_schema=False)  # FRD v3.2 path
def upload_assignment(test_id: UUID, file: UploadFile = File(...), user: CurrentUser = Depends(student_only)):
    ensure_module(user, MODULE)
    t = _assessment(user, test_id)
    if t["assessment_type"] != "ASSIGNMENT":
        raise HTTPException(409, "This is an online test — take it in the test runner")
    w = rules.window(t)
    if not w["open"]:
        raise HTTPException(409, w["reason"])
    if t["status"] == "DRAFT":
        raise HTTPException(409, "This assignment is not ready yet")
    s = _script(t, user)
    if s and (s["processing_status"] == "REVIEWED" or t["status"] == "PUBLISHED"):
        raise HTTPException(409, "Your teacher has already finalised this assignment")
    if s and s["processing_status"] in ("QUEUED", "OCR_IN_PROGRESS"):
        raise HTTPException(409, "Your previous upload is still being evaluated")
    cfg = get_settings()
    data = file.file.read(cfg.eval_max_script_mb * 1024 * 1024 + 1)
    if len(data) > cfg.eval_max_script_mb * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {cfg.eval_max_script_mb} MB")
    if not documents.is_pdf(data):
        raise HTTPException(415, "Upload your answers as a PDF (scan or photos combined into one PDF)")
    try:
        pages = documents.pdf_page_count(data)
    except Exception:  # noqa: BLE001 — corrupt / encrypted
        raise HTTPException(422, "That PDF could not be opened — try exporting it again")
    if pages > cfg.eval_max_script_pages:
        raise HTTPException(422, f"PDF has {pages} pages (limit {cfg.eval_max_script_pages})")
    me = _me(user)
    cls = db.call_row("usp_get_class", t["org_code"], t["class_code"]) or {}
    name = (file.filename or f"{user.user_code}.pdf")[:255]
    key = build_key(user["customer_code"], t["org_code"], cls.get("year_code"), cls.get("cycle_code"), t["subject_code"],
                    f"Evaluation-{str(t['eval_test_id'])[:8]}", f"student-uploads/{user.user_code}.pdf")
    get_storage().put(key, data, "application/pdf")
    late = bool(w.get("late"))
    with db.connection() as conn:
        if s:
            conn.execute("DELETE FROM public.evaluation_slno_results WHERE script_id = %s", (s["script_id"],))
            row = conn.execute(
                "UPDATE public.evaluation_candidate_scripts SET uploaded_pdf_filename = %s, script_key = %s, page_count = %s, "
                "submission_mode = 'STUDENT_PDF_UPLOAD', processing_status = 'QUEUED', submitted_at = NOW(), is_late = %s, "
                "total_obtained_marks = 0, percentage = 0, attempted_questions_count = 0, unanswered_questions_count = 0, "
                "overall_ai_feedback = NULL, error = NULL, evaluated_at = NULL, match_method = 'code', match_score = 1 "
                "WHERE script_id = %s RETURNING script_id", (name, key, pages, late, s["script_id"])).fetchone()
        else:
            row = conn.execute(
                "INSERT INTO public.evaluation_candidate_scripts(eval_test_id, org_code, student_user_code, uploaded_pdf_filename, "
                "script_key, page_count, match_method, match_score, total_max_marks, submission_mode, processing_status, "
                "submitted_at, is_late) VALUES (%s,%s,%s,%s,%s,%s,'code',1,%s,'STUDENT_PDF_UPLOAD','QUEUED',NOW(),%s) "
                "RETURNING script_id", (test_id, t["org_code"], me["user_code"], name, key, pages, t["total_max_marks"], late)
            ).fetchone()
    rules.queue_evaluation(test_id, [str(row["script_id"])])
    return my_assessment(test_id, user)


# ---------------------------------------------------------------- scorecard (FR-DSP-01)
@router.get("/my/{test_id}/report")
def my_report(test_id: UUID, user: CurrentUser = Depends(student_only)):
    t = _assessment(user, test_id)
    s = _script(t, user)
    if not rules.results_visible(t, s):
        raise HTTPException(404, "Results are not available yet")
    return analytics.script_report(t, s, lambda k: get_storage().signed_url(k) if k else None)
