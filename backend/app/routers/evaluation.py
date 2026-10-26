"""AI Evaluation Engine API (FRD "AI Evaluation" v3.1, FR-EV-01..13).

Teacher: create a subject/chapter-level test -> upload question paper + SL.No model answers (parse, preview, edit,
save with embeddings) -> upload the student script folder (filename -> roster matching, manual reassignment)
-> run the AI queue -> analytics, per-student reports, mark overrides -> publish to students.
Student: published reports only. Admin: read-only score register (class -> subject -> test) with CSV export.

Assessment types (FRD v3.2): OFFLINE_EXAM (teacher uploads a folder), ONLINE_TEST (students answer in the test
runner) and ASSIGNMENT (students upload their PDF; teachers may still upload a folder). Student-side endpoints for
online tests and assignments live in routers/assessments.py.
"""
from __future__ import annotations

import csv
import io
import zipfile
from datetime import date, datetime
from pathlib import PurePath
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import db
from ..config import get_settings
from ..providers import get_embedder
from ..security import ADMIN_ROLES, CurrentUser, ensure_module, require_role
from ..services.evaluation import analytics, assessments, documents, masters as master_parser, slno
from ..services.evaluation.matching import match_student
from ..services.storage import build_key, get_storage
from ..workers.tasks import enqueue
from .admin import org_scope

router = APIRouter(prefix="/ICMELive/api/v1/evaluation", tags=["evaluation"])
admin_router = APIRouter(prefix="/ICMELive/api/v1/admin", tags=["evaluation"])

teacher_only = require_role("teacher")
student_only = require_role("student")
staff = require_role("teacher", "orgadmin", "superadmin")
admins = require_role("orgadmin", "superadmin")
MODULE = "ocr_evaluation"
MAX_MASTER_MB = 20
MAX_ZIP_UNCOMPRESSED_MB = 600


# ---------------------------------------------------------------- helpers
def _can_teach(user: CurrentUser, class_code: str, subject_code: str) -> bool:
    return bool(db.call_scalar("usp_can_mark_attendance", user.org_code, user.user_code, class_code, subject_code))


def _test(user: CurrentUser, test_id: UUID, *, write: bool = False, org_code: str | None = None) -> dict:
    org = org_scope(user, org_code) if user.role in ADMIN_ROLES else user.org_code
    t = db.fetch_one("SELECT * FROM public.evaluation_tests WHERE eval_test_id = %s AND org_code = %s", (test_id, org))
    if not t:
        raise HTTPException(404, "Evaluation test not found")
    if user.role == "teacher":
        if not _can_teach(user, t["class_code"], t["subject_code"]):
            raise HTTPException(403, "You can evaluate only subjects you teach")
    elif write:
        raise HTTPException(403, "Only the subject teacher can change an evaluation")
    return t


def _script(test: dict, script_id: UUID) -> dict:
    s = db.fetch_one("SELECT * FROM public.evaluation_candidate_scripts WHERE script_id = %s AND eval_test_id = %s",
                     (script_id, test["eval_test_id"]))
    if not s:
        raise HTTPException(404, "Script not found")
    return s


def _signed(key: str | None) -> str | None:
    return get_storage().signed_url(key) if key else None


def _read(upload: UploadFile, max_mb: int) -> bytes:
    data = upload.file.read(max_mb * 1024 * 1024 + 1)
    if len(data) > max_mb * 1024 * 1024:
        raise HTTPException(413, f"{upload.filename} exceeds {max_mb} MB")
    return data


def _store(user: CurrentUser, test: dict, folder: str, filename: str, data: bytes, ctype: str) -> str:
    cls = db.call_row("usp_get_class", test["org_code"], test["class_code"]) or {}
    key = build_key(user["customer_code"], test["org_code"], cls.get("year_code"), cls.get("cycle_code"),
                    test["subject_code"], f"Evaluation-{str(test['eval_test_id'])[:8]}",
                    f"{folder}/{uuid4().hex[:8]}-{PurePath(filename).name}")
    get_storage().put(key, data, ctype)
    return key


def _test_view(t: dict) -> dict:
    row = next((x for x in db.call_rows("usp_eval_list_tests", t["org_code"], t["class_code"], t["subject_code"])
                if x["eval_test_id"] == t["eval_test_id"]), {})
    return {**row, "question_paper_name": t["question_paper_name"], "model_answer_name": t["model_answer_name"],
            "window": assessments.window(t) if t["assessment_type"] != "OFFLINE_EXAM" else None,
            "question_paper_url": _signed(t["question_paper_key"]), "model_answer_url": _signed(t["model_answer_key"]),
            "textbook_id": t["textbook_id"], "last_job_id": t["last_job_id"]}


def _masters(test_id: UUID) -> list[dict]:
    return db.fetch_all(
        "SELECT master_q_id, sl_no, display_order, question_type, question_text, mcq_options, correct_option, max_marks, "
        "model_answer_text, key_rubric_points, (model_answer_embedding IS NOT NULL) AS has_embedding "
        "FROM public.evaluation_master_questions "
        "WHERE eval_test_id = %s ORDER BY display_order", (test_id,))


# ---------------------------------------------------------------- tests (FR-EV-01, FR-TST-01, FR-ASG-01)
AssessmentType = Literal["OFFLINE_EXAM", "ONLINE_TEST", "ASSIGNMENT"]


class TestCreate(BaseModel):
    class_code: str = Field(min_length=1, max_length=64)
    subject_code: str = Field(min_length=1, max_length=64)
    evaluation_scope: Literal["SUBJECT_LEVEL", "CHAPTER_LEVEL"]
    test_title: str = Field(min_length=2, max_length=300)
    exam_date: date | None = None
    pass_percentage: float = Field(default=40, ge=0, le=100)
    textbook_id: UUID | None = None
    chapter_number: int | None = Field(default=None, ge=1)
    chapter_title: str | None = Field(default=None, max_length=300)
    assessment_type: AssessmentType = "OFFLINE_EXAM"
    instructions: str | None = Field(default=None, max_length=5000)
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    available_from: datetime | None = None
    due_at: datetime | None = None
    allow_late: bool = False
    results_release: Literal["INSTANT", "ON_PUBLISH"] = "INSTANT"


def _check_schedule(kind: str, duration: int | None, available_from: datetime | None, due_at: datetime | None) -> None:
    if kind == "ONLINE_TEST" and not duration:
        raise HTTPException(422, "Online tests need a duration in minutes")
    if available_from and due_at and due_at <= available_from:
        raise HTTPException(422, "Due date must be after the start date")


@router.get("/tests")
def list_tests(class_code: str | None = None, subject_code: str | None = None, assessment_type: AssessmentType | None = None,
               org_code: str | None = None, user: CurrentUser = Depends(staff)):
    org = org_scope(user, org_code) if user.role in ADMIN_ROLES else user.org_code
    rows = db.call_rows("usp_eval_list_tests", org, class_code, subject_code)
    if assessment_type:
        rows = [r for r in rows if r["assessment_type"] == assessment_type]
    if user.role == "teacher":
        rows = [r for r in rows if _can_teach(user, r["class_code"], r["subject_code"])]
    return {"tests": rows}


@router.post("/tests", status_code=status.HTTP_201_CREATED)
def create_test(body: TestCreate, user: CurrentUser = Depends(teacher_only)):
    ensure_module(user, MODULE)
    if not _can_teach(user, body.class_code, body.subject_code):
        raise HTTPException(403, "You can evaluate only subjects you teach")
    chapter_title = (body.chapter_title or "").strip() or None
    if body.evaluation_scope == "CHAPTER_LEVEL":
        if body.textbook_id and body.chapter_number:
            ch = next((c for c in db.call_rows("usp_list_chapters", body.textbook_id)
                       if c["chapter_number"] == body.chapter_number), None)
            tb = db.call_row("usp_get_textbook", body.textbook_id)
            if not ch or not tb or tb["org_code"] != user.org_code or tb["subject_code"] != body.subject_code:
                raise HTTPException(422, "Chapter not found in this subject's textbook")
            chapter_title = chapter_title or ch["chapter_title"]
        if not chapter_title:
            raise HTTPException(422, "Chapter-level evaluation needs a chapter")
    _check_schedule(body.assessment_type, body.duration_minutes, body.available_from, body.due_at)
    row = db.fetch_one(
        "INSERT INTO public.evaluation_tests(org_code, class_code, subject_code, evaluation_scope, textbook_id, "
        "chapter_number, chapter_title, test_title, exam_date, pass_percentage, created_by, assessment_type, "
        "instructions, duration_minutes, available_from, due_at, allow_late, results_release) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (user.org_code, body.class_code, body.subject_code, body.evaluation_scope,
         body.textbook_id if body.evaluation_scope == "CHAPTER_LEVEL" else None,
         body.chapter_number if body.evaluation_scope == "CHAPTER_LEVEL" else None,
         chapter_title if body.evaluation_scope == "CHAPTER_LEVEL" else None,
         body.test_title.strip(), body.exam_date, body.pass_percentage, user.user_code, body.assessment_type,
         (body.instructions or "").strip() or None,
         body.duration_minutes if body.assessment_type == "ONLINE_TEST" else None,
         body.available_from, body.due_at, body.allow_late,
         body.results_release if body.assessment_type != "OFFLINE_EXAM" else "ON_PUBLISH"))
    return _test_view(row)


class TestSettings(BaseModel):
    test_title: str | None = Field(default=None, min_length=2, max_length=300)
    instructions: str | None = Field(default=None, max_length=5000)
    exam_date: date | None = None
    pass_percentage: float | None = Field(default=None, ge=0, le=100)
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    available_from: datetime | None = None
    due_at: datetime | None = None
    allow_late: bool | None = None
    results_release: Literal["INSTANT", "ON_PUBLISH"] | None = None


@router.patch("/tests/{test_id}")
def update_settings(test_id: UUID, body: TestSettings, user: CurrentUser = Depends(teacher_only)):
    """Edit title / schedule. Fields not sent stay unchanged; send null dates explicitly via the UI to clear them."""
    t = _test(user, test_id, write=True)
    fields = body.model_dump(exclude_unset=True)
    merged = {**t, **fields}
    _check_schedule(t["assessment_type"], merged.get("duration_minutes"), merged.get("available_from"), merged.get("due_at"))
    if t["assessment_type"] != "ONLINE_TEST":
        fields.pop("duration_minutes", None)
    if "duration_minutes" in fields and db.fetch_one(
            "SELECT 1 FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s AND processing_status = 'IN_PROGRESS'",
            (test_id,)):
        raise HTTPException(409, "Students are taking this test right now — the duration can't change")
    if fields:
        cols = ", ".join(f"{k} = %s" for k in fields)
        db.execute(f"UPDATE public.evaluation_tests SET {cols}, updated_at = NOW() WHERE eval_test_id = %s",
                   (*[v.strip() if isinstance(v, str) else v for v in fields.values()], test_id))
    return _test_view(_test(user, test_id))


class AssignRequest(BaseModel):
    assigned: bool


@router.post("/tests/{test_id}/assign")
def assign(test_id: UUID, body: AssignRequest, user: CurrentUser = Depends(teacher_only)):
    """FR-TST-01 / FR-ASG-01: make an online test or assignment visible to the class (or withdraw it)."""
    ensure_module(user, MODULE)
    t = _test(user, test_id, write=True)
    if t["assessment_type"] == "OFFLINE_EXAM":
        raise HTTPException(409, "Offline exams are evaluated from a folder upload — nothing to assign")
    if body.assigned:
        if t["status"] == "DRAFT":
            raise HTTPException(409, "Save the questions and model answers before assigning")
        if not t["due_at"]:
            raise HTTPException(409, "Set a due date before assigning")
        db.execute("UPDATE public.evaluation_tests SET is_assigned = TRUE, assigned_at = COALESCE(assigned_at, NOW()), "
                   "updated_at = NOW() WHERE eval_test_id = %s", (test_id,))
    else:
        started = db.fetch_one("SELECT COUNT(*) AS n FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s "
                               "AND submission_mode <> 'TEACHER_FOLDER_UPLOAD'", (test_id,))["n"]
        if started:
            raise HTTPException(409, f"{started} student(s) have already started or submitted — it can't be withdrawn")
        db.execute("UPDATE public.evaluation_tests SET is_assigned = FALSE, updated_at = NOW() WHERE eval_test_id = %s",
                   (test_id,))
    return _test_view(_test(user, test_id))


@router.get("/tests/{test_id}")
def get_test(test_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(staff)):
    t = _test(user, test_id, org_code=org_code)
    assessments.finalize_expired(t)
    return {**_test_view(t), "masters": _masters(test_id)}


@router.delete("/tests/{test_id}")
def delete_test(test_id: UUID, user: CurrentUser = Depends(teacher_only)):
    t = _test(user, test_id, write=True)
    if t["status"] == "PUBLISHED":
        raise HTTPException(409, "Unpublish the results before deleting this test")
    if t["is_assigned"]:
        raise HTTPException(409, "Withdraw it from the class before deleting")
    db.execute("DELETE FROM public.evaluation_tests WHERE eval_test_id = %s", (test_id,))
    return {"deleted": str(test_id)}


# ---------------------------------------------------------------- masters (FR-EV-02/03/04)
@router.post("/tests/{test_id}/masters/parse")
def parse_masters(test_id: UUID, question_paper: UploadFile = File(...), model_answers: UploadFile = File(...),
                  user: CurrentUser = Depends(teacher_only)):
    """Stores both files and returns a draft SL.No table for the teacher to review — nothing is saved as questions yet."""
    ensure_module(user, MODULE)
    t = _test(user, test_id, write=True)
    files = []
    for up in (question_paper, model_answers):
        if documents.extension(up.filename or "") not in documents.MASTER_EXTENSIONS:
            raise HTTPException(415, f"{up.filename}: upload a PDF, DOCX, MD or TXT file")
        files.append(_read(up, MAX_MASTER_MB))
    try:
        result = master_parser.parse_masters(files[0], question_paper.filename or "question_paper",
                                             files[1], model_answers.filename or "model_answers")
    except documents.UnsupportedDocument as e:
        raise HTTPException(415, str(e))
    ctype = lambda n: "application/pdf" if n.lower().endswith(".pdf") else "application/octet-stream"  # noqa: E731
    qk = _store(user, t, "masters", question_paper.filename or "question_paper", files[0], ctype(question_paper.filename or ""))
    ak = _store(user, t, "masters", model_answers.filename or "model_answers", files[1], ctype(model_answers.filename or ""))
    db.execute("UPDATE public.evaluation_tests SET question_paper_key = %s, question_paper_name = %s, model_answer_key = %s, "
               "model_answer_name = %s, updated_at = NOW() WHERE eval_test_id = %s",
               (qk, (question_paper.filename or "")[:255], ak, (model_answers.filename or "")[:255], test_id))
    return result.as_dict()


class MasterItem(BaseModel):
    sl_no: str = Field(min_length=1, max_length=32)
    question_type: Literal["MCQ", "SHORT_ANSWER", "DESCRIPTIVE", "NUMERICAL"] = "DESCRIPTIVE"
    question_text: str = Field(min_length=1, max_length=10_000)
    max_marks: float = Field(gt=0, le=1000)
    model_answer_text: str = Field(default="", max_length=20_000)
    key_rubric_points: list[str] = Field(default_factory=list, max_length=50)
    mcq_options: list[str] = Field(default_factory=list, max_length=8)
    correct_option: str | None = Field(default=None, max_length=300)


class MastersSave(BaseModel):
    items: list[MasterItem] = Field(min_length=1, max_length=200)


@router.put("/tests/{test_id}/masters")
def save_masters(test_id: UUID, body: MastersSave, reset_evaluations: bool = False,
                 user: CurrentUser = Depends(teacher_only)):
    """Saves the reviewed SL.No table and embeds every model answer (FR-EV-03). Changing questions after scripts
    were graded invalidates those results, so it needs ?reset_evaluations=true."""
    ensure_module(user, MODULE)
    t = _test(user, test_id, write=True)
    if t["status"] in ("PROCESSING", "PUBLISHED"):
        raise HTTPException(409, "Questions can't change while evaluating or after publishing")
    codes = [slno.normalise(i.sl_no) for i in body.items]
    if any(not c for c in codes) or len(set(codes)) != len(codes):
        raise HTTPException(422, "Every SL.No must be present and unique")
    for code, i in zip(codes, body.items):
        if i.question_type == "MCQ":
            i.mcq_options = [o.strip() for o in i.mcq_options if o.strip()]
            if len(i.mcq_options) < 2:
                raise HTTPException(422, f"SL.No {code}: an MCQ needs at least two options")
            # options are lettered (a), (b)… so answers can be matched by letter
            i.mcq_options = [o if slno.option_letter(o, []) and o.startswith("(") else f"({'abcdefgh'[k]}) {o}"
                             for k, o in enumerate(i.mcq_options)]
            i.correct_option = slno.option_letter(i.correct_option or "", i.mcq_options)
            if not i.correct_option:
                raise HTTPException(422, f"SL.No {code}: choose the correct option")
            if not i.model_answer_text.strip():
                i.model_answer_text = next(o for o in i.mcq_options if o[1:2] == i.correct_option)
        else:
            i.mcq_options, i.correct_option = [], None
            if not i.model_answer_text.strip():
                raise HTTPException(422, f"SL.No {code}: model answer is required")
    if db.fetch_one("SELECT 1 FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s "
                    "AND processing_status = 'IN_PROGRESS'", (test_id,)):
        raise HTTPException(409, "Students are taking this test right now — questions can't change")
    graded = db.fetch_one("SELECT COUNT(*) AS n FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s "
                          "AND processing_status IN ('EVALUATED','REVIEWED')", (test_id,))["n"]
    if graded and not reset_evaluations:
        raise HTTPException(409, f"{graded} script(s) are already evaluated. Saving new questions clears their "
                                 "results — confirm with reset_evaluations=true.")
    vectors = get_embedder().embed([f"{i.question_text}\n{i.model_answer_text}" for i in body.items])
    total = sum(i.max_marks for i in body.items)
    with db.connection() as conn:
        conn.execute("DELETE FROM public.evaluation_master_questions WHERE eval_test_id = %s", (test_id,))
        for order, (code, item, vec) in enumerate(zip(codes, body.items, vectors), start=1):
            conn.execute(
                "INSERT INTO public.evaluation_master_questions(eval_test_id, sl_no, display_order, question_type, "
                "question_text, mcq_options, correct_option, max_marks, model_answer_text, key_rubric_points, "
                "model_answer_embedding) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::vector)",
                (test_id, code, order, item.question_type, item.question_text.strip(), Jsonb(item.mcq_options),
                 item.correct_option, item.max_marks, item.model_answer_text.strip(),
                 Jsonb([p.strip() for p in item.key_rubric_points if p.strip()]), db.vec_literal(vec)))
        conn.execute("UPDATE public.evaluation_candidate_scripts SET processing_status = CASE "
                     "WHEN submission_mode = 'TEACHER_FOLDER_UPLOAD' THEN 'UPLOADED' ELSE 'QUEUED' END, "
                     "total_obtained_marks = 0, percentage = 0, attempted_questions_count = 0, "
                     "unanswered_questions_count = 0, overall_ai_feedback = NULL, evaluated_at = NULL, error = NULL, "
                     "total_max_marks = %s WHERE eval_test_id = %s", (total, test_id))
        conn.execute("UPDATE public.evaluation_tests SET total_max_marks = %s, total_questions = %s, status = 'READY', "
                     "updated_at = NOW() WHERE eval_test_id = %s", (total, len(body.items), test_id))
    # Students' own submissions are re-graded against the new questions straight away.
    resubmit = [str(r["script_id"]) for r in db.fetch_all(
        "SELECT script_id FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s AND processing_status = 'QUEUED'",
        (test_id,))]
    if resubmit:
        assessments.queue_evaluation(test_id, resubmit)
    return {**_test_view(_test(user, test_id)), "masters": _masters(test_id)}


# ---------------------------------------------------------------- scripts folder (FR-EV-05/06/07)
def _expand(uploads: list[UploadFile]) -> list[tuple[str, bytes]]:
    s = get_settings()
    out: list[tuple[str, bytes]] = []
    for up in uploads:
        name = PurePath(up.filename or "script.pdf").name
        data = _read(up, max(s.eval_max_script_mb, 200) if name.lower().endswith(".zip") else s.eval_max_script_mb)
        if data[:2] == b"PK" or name.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    infos = [i for i in z.infolist() if not i.is_dir() and i.filename.lower().endswith(".pdf")
                             and "__MACOSX" not in i.filename and not PurePath(i.filename).name.startswith(".")]
                    if sum(i.file_size for i in infos) > MAX_ZIP_UNCOMPRESSED_MB * 1024 * 1024:
                        raise HTTPException(413, f"{name}: ZIP content exceeds {MAX_ZIP_UNCOMPRESSED_MB} MB")
                    for i in infos:
                        if i.file_size > s.eval_max_script_mb * 1024 * 1024:
                            raise HTTPException(413, f"{i.filename} exceeds {s.eval_max_script_mb} MB")
                        out.append((PurePath(i.filename).name, z.read(i)))
            except zipfile.BadZipFile:
                raise HTTPException(415, f"{name} is not a valid ZIP archive")
        elif name.lower().endswith(".pdf") or documents.is_pdf(data):
            out.append((name, data))
        # anything else in a picked folder (thumbs.db, .docx …) is ignored
    if len(out) > s.eval_max_upload_files:
        raise HTTPException(413, f"At most {s.eval_max_upload_files} scripts per upload")
    return out


def _roster(test: dict) -> list[dict]:
    return [r for r in db.call_rows("usp_list_members", test["org_code"], "student", test["class_code"]) if r["is_active"]]


def _scripts_view(test: dict) -> dict:
    rows = db.fetch_all(
        "SELECT s.script_id, s.student_user_code, u.full_name AS student_name, u.roll_number, s.uploaded_pdf_filename, "
        "s.page_count, s.match_method, s.match_score, s.processing_status, s.error, s.total_obtained_marks, "
        "s.total_max_marks, s.percentage, s.attempted_questions_count, s.unanswered_questions_count, s.ocr_method, "
        "s.uploaded_at, s.evaluated_at, s.submission_mode, s.submitted_at, s.is_late, s.started_at "
        "FROM public.evaluation_candidate_scripts s "
        "LEFT JOIN public.app_users u ON u.org_code = s.org_code AND u.user_code = s.student_user_code "
        "WHERE s.eval_test_id = %s ORDER BY (s.student_user_code IS NULL) DESC, "
        "CASE WHEN u.roll_number ~ '^[0-9]+$' THEN lpad(u.roll_number, 12, '0') ELSE COALESCE(u.roll_number, '~') END, "
        "s.uploaded_pdf_filename",
        (test["eval_test_id"],))
    roster = _roster(test)
    with_script = {r["student_user_code"] for r in rows if r["student_user_code"]}
    return {"scripts": rows,
            "roster": [{"user_code": r["user_code"], "full_name": r["full_name"], "roll_number": r["roll_number"]}
                       for r in roster],
            "students_without_script": [r["full_name"] for r in roster if r["user_code"] not in with_script]}


@router.get("/tests/{test_id}/scripts")
def list_scripts(test_id: UUID, user: CurrentUser = Depends(teacher_only)):
    return _scripts_view(_test(user, test_id))


@router.post("/tests/{test_id}/scripts")
def upload_scripts(test_id: UUID, files: list[UploadFile] = File(...), user: CurrentUser = Depends(teacher_only)):
    """Folder / multi-PDF / ZIP upload. Filenames are matched to the class roster; a student's earlier script for this
    test is replaced. Returns the matching table for confirmation (FR-EV-07)."""
    ensure_module(user, MODULE)
    t = _test(user, test_id, write=True)
    if t["assessment_type"] == "ONLINE_TEST":
        raise HTTPException(409, "Online tests are answered by students in the test runner")
    if t["status"] in ("DRAFT", "PROCESSING", "PUBLISHED"):
        raise HTTPException(409, {"DRAFT": "Save the question paper and model answers first",
                                  "PROCESSING": "An evaluation is running — wait for it to finish",
                                  "PUBLISHED": "Unpublish the results before adding scripts"}[t["status"]])
    items = _expand(files)
    if not items:
        raise HTTPException(422, "No PDF answer scripts found in the upload")
    roster = _roster(t)
    existing = {r["student_user_code"]: r["script_id"] for r in db.fetch_all(
        "SELECT student_user_code, script_id FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s "
        "AND student_user_code IS NOT NULL", (test_id,))}
    taken: set[str] = set()
    report = []
    for name, data in items:
        if not documents.is_pdf(data):
            report.append({"file": name, "error": "Not a PDF"})
            continue
        try:
            pages = documents.pdf_page_count(data)
        except Exception:  # noqa: BLE001 — corrupt PDF
            report.append({"file": name, "error": "Corrupt or encrypted PDF"})
            continue
        code, method, score = match_student(name, roster, taken)
        if code:
            taken.add(code)
        key = _store(user, t, "scripts", name, data, "application/pdf")
        if code and code in existing:  # re-upload replaces the student's earlier script
            sid = existing[code]
            db.execute("DELETE FROM public.evaluation_slno_results WHERE script_id = %s", (sid,))
            db.execute("UPDATE public.evaluation_candidate_scripts SET uploaded_pdf_filename = %s, script_key = %s, "
                       "page_count = %s, match_method = %s, match_score = %s, processing_status = 'UPLOADED', "
                       "total_obtained_marks = 0, percentage = 0, attempted_questions_count = 0, "
                       "unanswered_questions_count = 0, overall_ai_feedback = NULL, error = NULL, evaluated_at = NULL, "
                       "submission_mode = 'TEACHER_FOLDER_UPLOAD', uploaded_at = NOW() WHERE script_id = %s",
                       (name[:255], key, pages, method, score, sid))
        else:
            sid = db.fetch_one(
                "INSERT INTO public.evaluation_candidate_scripts(eval_test_id, org_code, student_user_code, "
                "uploaded_pdf_filename, script_key, page_count, match_method, match_score, total_max_marks) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING script_id",
                (test_id, t["org_code"], code, name[:255], key, pages, method, score, t["total_max_marks"]))["script_id"]
        report.append({"file": name, "script_id": sid, "student_user_code": code, "match_method": method,
                       "match_score": score, "replaced": bool(code and code in existing)})
    return {"uploaded": report, **_scripts_view(t)}


class ScriptAssign(BaseModel):
    student_user_code: str | None = Field(default=None, max_length=64)


@router.patch("/tests/{test_id}/scripts/{script_id}")
def assign_script(test_id: UUID, script_id: UUID, body: ScriptAssign, user: CurrentUser = Depends(teacher_only)):
    """FR-EV-07: manual reassignment when a filename had a typo."""
    t = _test(user, test_id, write=True)
    s = _script(t, script_id)
    if s["processing_status"] in ("QUEUED", "OCR_IN_PROGRESS"):
        raise HTTPException(409, "This script is being evaluated")
    code = body.student_user_code
    if code and code not in {r["user_code"] for r in _roster(t)}:
        raise HTTPException(422, f"{code} is not an active student of {t['class_code']}")
    if code and db.fetch_one("SELECT 1 FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s "
                             "AND student_user_code = %s AND script_id <> %s", (test_id, code, script_id)):
        raise HTTPException(409, "That student already has a script in this test — remove it first")
    db.execute("DELETE FROM public.evaluation_slno_results WHERE script_id = %s", (script_id,))
    db.execute("UPDATE public.evaluation_candidate_scripts SET student_user_code = %s, match_method = %s, match_score = NULL, "
               "processing_status = 'UPLOADED', total_obtained_marks = 0, percentage = 0, attempted_questions_count = 0, "
               "unanswered_questions_count = 0, overall_ai_feedback = NULL, evaluated_at = NULL, error = NULL "
               "WHERE script_id = %s", (code, "manual" if code else None, script_id))
    return _scripts_view(t)


@router.delete("/tests/{test_id}/scripts/{script_id}")
def delete_script(test_id: UUID, script_id: UUID, user: CurrentUser = Depends(teacher_only)):
    t = _test(user, test_id, write=True)
    s = _script(t, script_id)
    if s["processing_status"] in ("QUEUED", "OCR_IN_PROGRESS"):
        raise HTTPException(409, "This script is being evaluated")
    db.execute("DELETE FROM public.evaluation_candidate_scripts WHERE script_id = %s", (script_id,))
    return _scripts_view(t)


# ---------------------------------------------------------------- run the AI queue (FR-EV-09/10)
class EvaluateRequest(BaseModel):
    script_ids: list[UUID] | None = None
    re_evaluate: bool = False  # re-run already evaluated scripts too


@router.post("/tests/{test_id}/evaluate", status_code=status.HTTP_202_ACCEPTED)
def run_evaluation(test_id: UUID, body: EvaluateRequest, user: CurrentUser = Depends(teacher_only)):
    ensure_module(user, MODULE)
    t = _test(user, test_id, write=True)
    if t["status"] == "DRAFT":
        raise HTTPException(409, "Save the question paper and model answers first")
    if t["status"] == "PUBLISHED":
        raise HTTPException(409, "Unpublish the results before re-evaluating")
    if t["status"] == "PROCESSING" and t["last_job_id"]:
        job = db.call_row("usp_get_job", t["last_job_id"])
        if job and job["status"] in ("queued", "running"):
            raise HTTPException(409, "An evaluation is already running for this test")
    ids = [str(x) for x in body.script_ids or []]
    if not ids and body.re_evaluate:
        ids = [str(r["script_id"]) for r in db.fetch_all(
            "SELECT script_id FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s "
            "AND student_user_code IS NOT NULL", (test_id,))]
    pending = db.fetch_one(
        "SELECT COUNT(*) AS n FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s AND student_user_code IS NOT NULL "
        "AND (cardinality(%s::uuid[]) = 0 OR script_id = ANY(%s::uuid[])) "
        "AND (cardinality(%s::uuid[]) > 0 OR processing_status IN ('UPLOADED','QUEUED','FAILED'))",
        (test_id, ids, ids, ids))["n"]
    if not pending:
        raise HTTPException(422, "No matched scripts waiting for evaluation")
    job_id = db.call_scalar("usp_create_job", "answer_evaluation", str(test_id))
    with db.connection() as conn:
        conn.execute("UPDATE public.evaluation_tests SET status = 'PROCESSING', last_job_id = %s, updated_at = NOW() "
                     "WHERE eval_test_id = %s", (job_id, test_id))
        conn.execute("UPDATE public.evaluation_candidate_scripts SET processing_status = 'QUEUED' WHERE eval_test_id = %s "
                     "AND student_user_code IS NOT NULL AND (cardinality(%s::uuid[]) = 0 OR script_id = ANY(%s::uuid[])) "
                     "AND (cardinality(%s::uuid[]) > 0 OR processing_status IN ('UPLOADED','FAILED'))",
                     (test_id, ids, ids, ids))
    enqueue("evaluate_test", test_id=str(test_id), job_id=str(job_id), script_ids=ids or None)
    return {"job_id": job_id, "scripts": pending}


@router.get("/jobs/{job_id}")
def job_status(job_id: UUID, user: CurrentUser = Depends(staff)):
    job = db.call_row("usp_get_job", job_id)
    if not job or job["job_type"] != "answer_evaluation":
        raise HTTPException(404, "Job not found")
    _test(user, UUID(job["ref_id"]))  # authorisation via the test
    return job


# ---------------------------------------------------------------- analytics, reports, overrides (FR-EV-11/12)
@router.get("/tests/{test_id}/dashboard")
def teacher_dashboard(test_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(staff)):
    t = _test(user, test_id, org_code=org_code)
    assessments.finalize_expired(t)
    return analytics.teacher_dashboard({**t, **_test_view(t)})


@router.get("/tests/{test_id}/scripts/{script_id}/report")
def script_report(test_id: UUID, script_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(staff)):
    t = _test(user, test_id, org_code=org_code)
    return analytics.script_report(t, _script(t, script_id), _signed)


class ResultOverride(BaseModel):
    awarded_marks: float = Field(default=0, ge=0)
    reset_to_ai: bool = False  # undo the teacher's edit: restore the AI's marks
    teacher_comment: str | None = Field(default=None, max_length=2000)
    feedback: str | None = Field(default=None, max_length=4000)


@router.patch("/tests/{test_id}/results/{result_id}")
def override_result(test_id: UUID, result_id: UUID, body: ResultOverride, user: CurrentUser = Depends(teacher_only)):
    """Teacher moderation for tests, assignments and exams — also after results are published (students then see
    the corrected marks). The AI's marks stay recorded in ai_awarded_marks; reset_to_ai restores them."""
    t = _test(user, test_id, write=True)
    r = db.fetch_one("SELECT r.*, s.processing_status FROM public.evaluation_slno_results r JOIN "
                     "public.evaluation_candidate_scripts s ON s.script_id = r.script_id "
                     "WHERE r.slno_result_id = %s AND r.eval_test_id = %s", (result_id, test_id))
    if not r:
        raise HTTPException(404, "Result not found")
    if not body.reset_to_ai and body.awarded_marks > float(r["max_marks"]):
        raise HTTPException(422, f"Marks cannot exceed {float(r['max_marks']):g}")
    with db.connection() as conn:
        if body.reset_to_ai:
            conn.execute("UPDATE public.evaluation_slno_results SET awarded_marks = ai_awarded_marks, teacher_override = FALSE, "
                         "teacher_comment = NULL WHERE slno_result_id = %s", (result_id,))
        else:
            conn.execute("UPDATE public.evaluation_slno_results SET awarded_marks = %s, teacher_override = TRUE, "
                         "teacher_comment = COALESCE(%s, teacher_comment), feedback = COALESCE(%s, feedback) "
                         "WHERE slno_result_id = %s",
                         (round(body.awarded_marks * 4) / 4, (body.teacher_comment or "").strip() or None,
                          (body.feedback or "").strip() or None, result_id))
        conn.execute("SELECT public.usp_eval_recompute_script(%s)", (r["script_id"],))
        # REVIEWED while any SL.No carries a teacher edit; back to EVALUATED when all edits are undone
        conn.execute("UPDATE public.evaluation_candidate_scripts SET processing_status = CASE WHEN EXISTS ("
                     "SELECT 1 FROM public.evaluation_slno_results WHERE script_id = %s AND teacher_override) "
                     "THEN 'REVIEWED' ELSE 'EVALUATED' END WHERE script_id = %s", (r["script_id"], r["script_id"]))
    return analytics.script_report(t, _script(t, r["script_id"]), _signed)


class PublishRequest(BaseModel):
    published: bool


@router.post("/tests/{test_id}/publish")
def publish(test_id: UUID, body: PublishRequest, user: CurrentUser = Depends(teacher_only)):
    t = _test(user, test_id, write=True)
    if body.published:
        if t["status"] not in ("EVALUATED", "PUBLISHED"):
            raise HTTPException(409, "Evaluate the scripts before publishing")
        db.execute("UPDATE public.evaluation_tests SET status = 'PUBLISHED', updated_at = NOW() WHERE eval_test_id = %s",
                   (test_id,))
    elif t["status"] == "PUBLISHED":
        db.execute("UPDATE public.evaluation_tests SET status = 'EVALUATED', updated_at = NOW() WHERE eval_test_id = %s",
                   (test_id,))
    return _test_view(_test(user, test_id))


# ---------------------------------------------------------------- score register (FR-EV-13)
def _register(t: dict) -> list[dict]:
    rows = db.call_rows("usp_eval_score_register", t["org_code"], t["eval_test_id"])
    for r in rows:
        done = r["processing_status"] in analytics.DONE
        r["grade"] = analytics.grade_for(float(r["percentage"]), float(t["pass_percentage"])) if done else None
        r["result"] = ("Pass" if float(r["percentage"]) >= float(t["pass_percentage"]) else "Fail") if done else None
    return rows


def _status_label(r: dict) -> str:
    return {"NOT_SUBMITTED": "Not submitted", "IN_PROGRESS": "In progress"}.get(r["processing_status"],
                                                                              r["processing_status"].title())


def _csv(t: dict, rows: list[dict]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"{t['test_title']} — {t['class_code']} / {t['subject_code']}"])
    w.writerow(["Rank", "Roll", "Admission No", "Student", "Submission", "Attempted", "Unanswered", "Marks", "Max",
                "%", "Grade", "Result", "Status", "Late"])
    for r in rows:
        w.writerow([r["rank_no"] or "", r["roll_number"] or "", r["student_user_code"] or "", r["student_name"] or "(unmatched)",
                    r["uploaded_pdf_filename"] or (r["submission_mode"] or "").replace("_", " ").title(),
                    r["attempted_questions"], r["unanswered_questions"],
                    f"{float(r['obtained_marks']):g}", f"{float(r['max_marks']):g}", f"{float(r['percentage']):g}",
                    r["grade"] or "", r["result"] or "", _status_label(r), "Yes" if r["is_late"] else ""])
    name = f"scores-{t['class_code']}-{t['subject_code']}-{str(t['eval_test_id'])[:8]}.csv"
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/tests/{test_id}/register")
def test_register(test_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(staff)):
    t = _test(user, test_id, org_code=org_code)
    assessments.finalize_expired(t)
    return {"test": _test_view(t), "rows": _register(t)}


@router.get("/tests/{test_id}/register.csv")
def test_register_csv(test_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(staff)):
    t = _test(user, test_id, org_code=org_code)
    return _csv(t, _register(t))


@admin_router.get("/evaluation-scores")
def admin_scores(class_code: str | None = None, subject_code: str | None = None, eval_test_id: UUID | None = None,
                 assessment_type: AssessmentType | None = None, org_code: str | None = None,
                 user: CurrentUser = Depends(admins)):
    """FR-EV-13 / FR-DSP-03: Class -> Subject -> Type -> Test explorer. Without a test id, lists the matching tests."""
    org = org_scope(user, org_code)
    tests = db.call_rows("usp_eval_list_tests", org, class_code, subject_code)
    if assessment_type:
        tests = [x for x in tests if x["assessment_type"] == assessment_type]
    if not eval_test_id:
        return {"tests": tests}
    t = _test(user, eval_test_id, org_code=org_code)
    return {"tests": tests, "test": _test_view(t), "rows": _register(t)}


admin_router.add_api_route("/assessment-scores", admin_scores, methods=["GET"])  # FRD v3.2 path


@admin_router.get("/evaluation-scores.csv")
def admin_scores_csv(eval_test_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    t = _test(user, eval_test_id, org_code=org_code)
    return _csv(t, _register(t))


# ---------------------------------------------------------------- student (FR-EV-11)
@router.get("/my-tests")
def my_tests(user: CurrentUser = Depends(student_only)):
    rows = db.fetch_all(
        "SELECT t.eval_test_id, t.test_title, t.evaluation_scope, t.chapter_title, t.subject_code, cs.subject_name, "
        "t.exam_date, t.pass_percentage, s.script_id, s.total_obtained_marks, s.total_max_marks, s.percentage, "
        "s.attempted_questions_count, s.unanswered_questions_count, s.evaluated_at "
        "FROM public.evaluation_tests t JOIN public.evaluation_candidate_scripts s ON s.eval_test_id = t.eval_test_id "
        "JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code "
        "AND cs.subject_code = t.subject_code "
        "WHERE t.org_code = %s AND t.status = 'PUBLISHED' AND t.assessment_type = 'OFFLINE_EXAM' AND s.student_user_code = %s "
        "AND s.processing_status IN ('EVALUATED','REVIEWED') ORDER BY COALESCE(t.exam_date, t.created_at::date) DESC",
        (user.org_code, user.user_code))
    for r in rows:
        r["grade"] = analytics.grade_for(float(r["percentage"]), float(r["pass_percentage"]))
    return {"tests": rows}


@router.get("/my-tests/{test_id}")
def my_report(test_id: UUID, user: CurrentUser = Depends(student_only)):
    t = db.fetch_one("SELECT * FROM public.evaluation_tests WHERE eval_test_id = %s AND org_code = %s AND status = 'PUBLISHED'",
                     (test_id, user.org_code))
    s = t and db.fetch_one(
        "SELECT * FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s AND student_user_code = %s "
        "AND processing_status IN ('EVALUATED','REVIEWED')", (test_id, user.user_code))
    if not t or not s:
        raise HTTPException(404, "No published evaluation found")
    return analytics.script_report(t, s, _signed)
