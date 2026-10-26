"""Classroom: class rosters, class-teacher student enrolment, subject-wise attendance (FR-T3-01/02, FR-S4-04).

Rules
- Only the CLASS TEACHER of a class creates / edits / imports students, and only into that class.
- Attendance for (class, subject) may be marked by that subject's teacher or by the class teacher.
- Students see only their own attendance, subject-wise and month-wise.
- Timetable (read side, FR-TE-01 / FR-ST-03) and homework (FR-TE-04 / FR-ST-04) live here too; the timetable is
  built by admins (admin router).
"""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, ValidationError

from .. import db
from ..security import ADMIN_ROLES, CurrentUser, require_role
from ..services import attendance as att
from ..services import attendance_export as att_export
from ..services.members import Code, Email, Name, Password, Phone, create_member, new_student_code
from ..services.storage import build_key, get_storage
from .admin import MemberPatch, _patch_member, list_slots, org_scope

router = APIRouter(prefix="/ICMELive/api/v1/classroom", tags=["classroom"])

teacher_only = require_role("teacher")
student_only = require_role("student")
staff = require_role("teacher", "orgadmin", "superadmin")
Status = Literal["present", "absent", "late", "excused"]
Slot = Field(default="Period-1", min_length=1, max_length=32, pattern=r"^[A-Za-z0-9 ._\-]+$")
MAX_CSV_ROWS = 500
MAX_HOMEWORK_MB = 10
# Allowed homework uploads, identified by magic bytes rather than the client-supplied content type.
_FILE_TYPES = {b"%PDF": ("application/pdf", ".pdf"), b"\x89PNG": ("image/png", ".png"),
               b"\xff\xd8\xff": ("image/jpeg", ".jpg")}


# ---------------------------------------------------------------- authorisation helpers
def _class_or_404(org: str, class_code: str) -> dict:
    c = db.call_row("usp_get_class", org, class_code)
    if not c:
        raise HTTPException(404, "Class not found")
    return c


def _require_class_teacher(user: CurrentUser, class_code: str) -> dict:
    c = _class_or_404(user.org_code, class_code)
    if c["class_teacher_code"] != user.user_code or not c["is_active"]:
        raise HTTPException(403, "Only the class teacher of this class can manage its students")
    return c


def _can_view_class(user: CurrentUser, class_code: str) -> dict:
    c = _class_or_404(user.org_code, class_code)
    if user.role in ADMIN_ROLES:
        return c
    mine = {x["class_code"] for x in db.call_rows("usp_teacher_classes", user.org_code, user.user_code)}
    if class_code not in mine:
        raise HTTPException(403, "You are not assigned to this class")
    return c


def _require_marker(user: CurrentUser, class_code: str, subject_code: str) -> dict:
    c = _class_or_404(user.org_code, class_code)
    if not db.call_scalar("usp_can_mark_attendance", user.org_code, user.user_code, class_code, subject_code):
        raise HTTPException(403, "You can mark attendance only for subjects you teach or for your own class")
    return c


def _threshold(org: str) -> float:
    row = db.fetch_one("SELECT attendance_threshold FROM public.organizations WHERE org_code = %s", (org,))
    return float(row["attendance_threshold"]) if row else 75.0


# ---------------------------------------------------------------- teacher: classes & students
@router.get("/my-classes")
def my_classes(user: CurrentUser = Depends(teacher_only)):
    return {"classes": db.call_rows("usp_teacher_classes", user.org_code, user.user_code)}


@router.get("/classes/{class_code}/students")
def class_students(class_code: str, user: CurrentUser = Depends(staff)):
    c = _can_view_class(user, class_code)
    return {
        "class_code": class_code,
        "class_name": c["class_name"],
        "is_class_teacher": c["class_teacher_code"] == user.user_code,
        "students": db.call_rows("usp_list_members", user.org_code, "student", class_code),
    }


class StudentCreate(BaseModel):
    full_name: Name
    user_code: Code | None = Field(default=None, description="Admission / registration number (auto if empty)")
    email: Email | None = None
    roll_number: str | None = Field(default=None, max_length=32)
    phone: Phone | None = None
    guardian_name: str | None = Field(default=None, max_length=200)
    guardian_phone: Phone | None = None
    password: Password | None = None


def _check_student_limit(org: str) -> None:
    """FR-SA-02 plan limit: max active students per institution (None = unlimited)."""
    row = db.fetch_one(
        "SELECT o.max_students, (SELECT COUNT(*) FROM public.app_users u WHERE u.org_code = o.org_code "
        "AND u.user_role = 'student' AND u.is_active) AS active FROM public.organizations o WHERE o.org_code = %s",
        (org,))
    if row and row["max_students"] is not None and row["active"] >= row["max_students"]:
        raise HTTPException(403, f"Student limit reached for this institution's plan ({row['max_students']}). "
                                 "Contact the platform administrator to upgrade.")


def _create_student(user: CurrentUser, c: dict, body: StudentCreate, conn=None) -> dict:
    _check_student_limit(user.org_code)
    subjects = [s["subject_code"] for s in db.fetch_all(
        "SELECT subject_code FROM public.class_subjects WHERE org_code = %s AND class_code = %s ORDER BY subject_code",
        (user.org_code, c["class_code"]))]
    return create_member(
        org_code=user.org_code, customer_code=user["customer_code"], role="student", full_name=body.full_name,
        user_code=body.user_code or new_student_code(user.org_code), email=body.email, password=body.password,
        created_by=user.user_code, year_code=c["year_code"], cycle_code=c["cycle_code"], class_code=c["class_code"],
        subjects=subjects, phone=body.phone, roll_number=body.roll_number, guardian_name=body.guardian_name,
        guardian_phone=body.guardian_phone, conn=conn,
    )


@router.post("/classes/{class_code}/students", status_code=status.HTTP_201_CREATED)
def create_student(class_code: str, body: StudentCreate, user: CurrentUser = Depends(teacher_only)):
    return _create_student(user, _require_class_teacher(user, class_code), body)


@router.post("/classes/{class_code}/students/import")
def import_students(class_code: str, file: UploadFile = File(...), user: CurrentUser = Depends(teacher_only)):
    """CSV columns (header row required): full_name, user_code, email, roll_number, phone, guardian_name,
    guardian_phone, password. Only full_name is mandatory. Each row is independent: good rows are created,
    bad rows are reported back."""
    c = _require_class_teacher(user, class_code)
    raw = file.file.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(413, "CSV exceeds 2 MB")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(415, "CSV must be UTF-8 encoded")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "full_name" not in [h.strip().lower() for h in reader.fieldnames]:
        raise HTTPException(422, "CSV must have a header row with at least a 'full_name' column")

    created, errors = [], []
    for i, row in enumerate(reader, start=2):
        if i - 1 > MAX_CSV_ROWS:
            errors.append({"row": i, "error": f"Only the first {MAX_CSV_ROWS} rows are imported"})
            break
        clean = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        if not any(clean.values()):
            continue
        try:
            body = StudentCreate(**{k: v for k, v in clean.items() if v and k in StudentCreate.model_fields})
            with db.connection() as conn:
                created.append(_create_student(user, c, body, conn=conn))
        except ValidationError as e:
            errors.append({"row": i, "error": "; ".join(f"{x['loc'][0]}: {x['msg']}" for x in e.errors())})
        except pg_errors.UniqueViolation:
            errors.append({"row": i, "error": "A user with this admission number or email already exists"})
        except HTTPException as e:
            errors.append({"row": i, "error": str(e.detail)})
    return {"created": created, "errors": errors}


class StudentPatch(MemberPatch):
    roll_number: str | None = Field(default=None, max_length=32)
    guardian_name: str | None = Field(default=None, max_length=200)
    guardian_phone: Phone | None = None


@router.patch("/classes/{class_code}/students/{user_code}")
def update_student(class_code: str, user_code: str, body: StudentPatch, user: CurrentUser = Depends(teacher_only)):
    _require_class_teacher(user, class_code)
    m = db.call_row("usp_get_member", user.org_code, user_code)
    if not m or m["class_code"] != class_code:
        raise HTTPException(404, "Student not found in this class")
    return _patch_member(user.org_code, user_code, "student", body, roll_number=body.roll_number,
                         guardian_name=body.guardian_name, guardian_phone=body.guardian_phone)


# ---------------------------------------------------------------- teacher: attendance
class Mark(BaseModel):
    student_user_code: str = Field(min_length=1, max_length=64)
    status: Status
    remarks: str | None = Field(default=None, max_length=300)


class AttendanceBatch(BaseModel):
    class_code: str
    subject_code: str
    attendance_date: date
    session_slot: str = Slot
    records: list[Mark] = Field(min_length=1, max_length=500)


@router.get("/attendance")
def attendance_day(
    class_code: str, subject_code: str, attendance_date: date, session_slot: str = Query("Period-1", max_length=32),
    user: CurrentUser = Depends(teacher_only),
):
    _require_marker(user, class_code, subject_code)
    rows = db.call_rows("usp_attendance_day", user.org_code, class_code, subject_code, attendance_date, session_slot)
    return {
        "class_code": class_code, "subject_code": subject_code, "attendance_date": attendance_date,
        "session_slot": session_slot, "is_marked": any(r["status"] for r in rows),
        "summary": att.tally(r["status"] for r in rows if r["status"]), "students": rows,
    }


@router.post("/attendance")
def save_attendance(body: AttendanceBatch, user: CurrentUser = Depends(teacher_only)):
    _require_marker(user, body.class_code, body.subject_code)
    if body.attendance_date > date.today():
        raise HTTPException(422, "Attendance cannot be marked for a future date")
    if body.attendance_date < date.today() - timedelta(days=366):
        raise HTTPException(422, "Attendance older than a year cannot be changed")
    codes = [r.student_user_code for r in body.records]
    if len(set(codes)) != len(codes):
        raise HTTPException(422, "Each student may appear only once per batch")
    roster = {r["user_code"] for r in db.call_rows("usp_list_members", user.org_code, "student", body.class_code)
              if r["is_active"]}
    unknown = sorted(set(codes) - roster)
    if unknown:
        raise HTTPException(422, f"Not active students of {body.class_code}: {', '.join(unknown[:10])}")
    saved = db.call_scalar(
        "usp_save_attendance", user.org_code, body.class_code, body.subject_code, body.attendance_date,
        body.session_slot, user.user_code, Jsonb([r.model_dump() for r in body.records]),
    )
    return {"saved": saved, "summary": att.tally(r.status for r in body.records)}


def _register(user: CurrentUser, class_code: str, subject_code: str, month: str,
              org_code: str | None = None) -> tuple[dict, dict]:
    org = org_scope(user, org_code)  # superadmin may view any institution's register
    if user.role in ADMIN_ROLES:
        c = _class_or_404(org, class_code)
    else:
        c = _require_marker(user, class_code, subject_code)
    try:
        first, last = att.month_bounds(month)
    except ValueError as e:
        raise HTTPException(422, str(e))
    marks = db.call_rows("usp_attendance_range", org, class_code, subject_code, first, last)
    marked = {m["student_user_code"] for m in marks}
    # Active students, plus since-deactivated ones who still have marks in this month.
    roster = [r for r in db.call_rows("usp_list_members", org, "student", class_code)
              if r["is_active"] or r["user_code"] in marked]
    reg = att.monthly_register(roster, marks, first, last, _threshold(org))
    return c, {"class_code": class_code, "class_name": c["class_name"], "subject_code": subject_code,
               "month": month, **reg}


@router.get("/attendance/register")
def attendance_register(class_code: str, subject_code: str, month: str = Query(pattern=r"^\d{4}-\d{2}$"),
                        org_code: str | None = None, user: CurrentUser = Depends(staff)):
    return _register(user, class_code, subject_code, month, org_code)[1]


@router.get("/attendance/register.csv")
def attendance_register_csv(class_code: str, subject_code: str, month: str = Query(pattern=r"^\d{4}-\d{2}$"),
                            org_code: str | None = None, user: CurrentUser = Depends(staff)):
    _, reg = _register(user, class_code, subject_code, month, org_code)
    abbrev = {"present": "P", "absent": "A", "late": "L", "excused": "LV"}
    buf = io.StringIO()
    w = csv.writer(buf)
    days = reg["marked_days"]
    w.writerow(["Roll", "Admission No", "Name", *[d[8:] for d in days], "Present", "Absent", "Late", "Leave", "%"])
    for s in reg["students"]:
        cells = ["/".join(abbrev[x] for x in s["days"].get(d, [])) for d in days]
        w.writerow([s["roll_number"] or "", s["student_user_code"], s["full_name"], *cells, s["present"], s["absent"],
                    s["late"], s["excused"], "" if s["percentage"] is None else s["percentage"]])
    name = f"attendance-{class_code}-{subject_code}-{month}.csv"
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _display_name(user: CurrentUser) -> str:
    me = db.call_row("usp_get_member", user.org_code, user.user_code)
    return f"{me['full_name']} ({user.user_code})" if me and me.get("full_name") else user.user_code


MAX_EXPORT_DAYS = 366
MAX_EXPORT_REGISTERS = 400
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/attendance/export")
def attendance_export(
    start: date, end: date,
    class_code: str | None = Query(default=None, max_length=64),
    subject_code: str | None = Query(default=None, max_length=64),
    report: att_export.Report = "register",
    fmt: Literal["xlsx", "csv"] = "xlsx",
    org_code: str | None = None,
    user: CurrentUser = Depends(staff),
):
    """Attendance export over a date range.

    Teachers: one class; a subject they may mark, or every subject of the class they may mark (all of them for the
    class teacher). Admins: any class, or the whole institution when class_code is omitted.
    """
    if end < start:
        raise HTTPException(422, "End date must be on or after the start date")
    if (end - start).days >= MAX_EXPORT_DAYS:
        raise HTTPException(422, "Export at most one year at a time")
    is_admin = user.role in ADMIN_ROLES
    org = org_scope(user, org_code) if is_admin else user.org_code
    if not is_admin and not class_code:
        raise HTTPException(422, "Choose a class to export")

    classes = [_class_or_404(org, class_code)] if class_code else \
        [c for c in db.call_rows("usp_list_classes", org) if c["is_active"]]
    threshold = _threshold(org)
    regs = []
    for c in classes:
        subjects = db.fetch_all(
            "SELECT subject_code, subject_name FROM public.class_subjects WHERE org_code = %s AND class_code = %s "
            "ORDER BY subject_code", (org, c["class_code"]))
        if subject_code:
            subjects = [s for s in subjects if s["subject_code"] == subject_code]
            if class_code and not subjects:
                raise HTTPException(404, "Subject not found in this class")
        if not is_admin:
            subjects = [s for s in subjects if db.call_scalar("usp_can_mark_attendance", org, user.user_code,
                                                               c["class_code"], s["subject_code"])]
            if not subjects:
                raise HTTPException(403, "You can export attendance only for subjects you teach or for your own class")
        roster_all = db.call_rows("usp_list_members", org, "student", c["class_code"])
        for s in subjects:
            marks = db.call_rows("usp_attendance_range", org, c["class_code"], s["subject_code"], start, end)
            marked = {m["student_user_code"] for m in marks}
            roster = [r for r in roster_all if r["is_active"] or r["user_code"] in marked]
            regs.append({"class_code": c["class_code"], "class_name": c["class_name"], "subject_code": s["subject_code"],
                         "subject_name": s["subject_name"], "reg": att.monthly_register(roster, marks, start, end, threshold)})
            if len(regs) > MAX_EXPORT_REGISTERS:
                raise HTTPException(422, "Too many registers in one export; narrow it to a class or subject")
    if not regs:
        raise HTTPException(404, "Nothing to export: no classes or subjects match")

    org_row = db.fetch_one("SELECT org_name FROM public.organizations WHERE org_code = %s", (org,))
    period = f"{start:%d %b %Y} – {end:%d %b %Y}"
    stem = "-".join(x for x in ("attendance", report, class_code or org, subject_code, f"{start:%Y%m%d}", f"{end:%Y%m%d}") if x)
    if fmt == "csv":
        data, media, name = att_export.to_csv(regs, report), "text/csv; charset=utf-8", f"{stem}.csv"
    else:
        meta = {"org_name": org_row["org_name"] if org_row else org, "period": period, "threshold": threshold,
                "generated_at": f"{date.today():%d %b %Y}", "generated_by": _display_name(user)}
        data, media, name = att_export.to_xlsx(regs, report, meta), XLSX, f"{stem}.xlsx"
    return Response(data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- student: own attendance
@router.get("/my-attendance")
def my_attendance(month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
                  user: CurrentUser = Depends(student_only)):
    month = month or date.today().strftime("%Y-%m")
    me = db.call_row("usp_get_member", user.org_code, user.user_code)
    if not me:
        raise HTTPException(404, "Student not found")
    subjects = db.fetch_all(
        "SELECT subject_code, subject_name FROM public.class_subjects WHERE org_code = %s AND class_code = %s",
        (user.org_code, me["class_code"]),
    )
    first, last = att.month_bounds(month)
    # Whole academic window for the trend (12 months back from the end of the selected month).
    window_start = date(first.year - 1, first.month, 1) + timedelta(days=31)
    window_start = date(window_start.year, window_start.month, 1)
    marks = db.call_rows("usp_student_attendance", user.org_code, user.user_code, window_start, last)
    return {"class_code": me["class_code"], **att.student_view(subjects, marks, month, _threshold(user.org_code))}


# ---------------------------------------------------------------- timetable: read side (FR-TE-01, FR-ST-03)
@router.get("/my-timetable")
def my_timetable(user: CurrentUser = Depends(require_role("teacher", "student"))):
    """Teachers: every period they teach. Students: their class's week."""
    if user.role == "teacher":
        slots = list_slots(user.org_code, None, user.user_code)
    else:
        me = db.call_row("usp_get_member", user.org_code, user.user_code)
        slots = list_slots(user.org_code, me["class_code"], None) if me and me["class_code"] else []
    return {"today": date.today().isoweekday(), "slots": slots}


# ---------------------------------------------------------------- homework (FR-TE-04, FR-ST-04)
def _read_upload(f: UploadFile | None) -> tuple[bytes, str, str] | None:
    if f is None or not f.filename:
        return None
    data = f.file.read(MAX_HOMEWORK_MB * 1024 * 1024 + 1)
    if len(data) > MAX_HOMEWORK_MB * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {MAX_HOMEWORK_MB} MB")
    for magic, (ctype, ext) in _FILE_TYPES.items():
        if data.startswith(magic):
            return data, ctype, ext
    raise HTTPException(415, "Only PDF, PNG or JPEG files are allowed")


def _store(user: CurrentUser, c: dict, subject: str, folder: str, upload: tuple[bytes, str, str]) -> str:
    data, ctype, ext = upload
    key = build_key(user["customer_code"], user.org_code, c["year_code"], c["cycle_code"], subject,
                    f"{folder}-{uuid4().hex[:10]}", f"file{ext}")
    get_storage().put(key, data, ctype)
    return key


def _signed(key: str | None) -> str | None:
    return get_storage().signed_url(key) if key else None


def _homework_or_404(org: str, homework_id: UUID) -> dict:
    hw = db.fetch_one("SELECT * FROM public.homeworks WHERE org_code = %s AND homework_id = %s", (org, homework_id))
    if not hw:
        raise HTTPException(404, "Homework not found")
    return hw


@router.post("/homework", status_code=status.HTTP_201_CREATED)
def create_homework(
    class_code: str = Form(..., max_length=64), subject_code: str = Form(..., max_length=64),
    title: str = Form(..., min_length=2, max_length=300), instructions: str = Form(..., min_length=2, max_length=5000),
    due_date: date = Form(...), attachment: UploadFile | None = File(None),
    user: CurrentUser = Depends(teacher_only),
):
    c = _require_marker(user, class_code, subject_code)  # subject teacher, class teacher or timetabled teacher
    if due_date < date.today():
        raise HTTPException(422, "Due date cannot be in the past")
    upload = _read_upload(attachment)
    key = _store(user, c, subject_code, "Homework", upload) if upload else None
    row = db.fetch_one(
        "INSERT INTO public.homeworks(org_code, class_code, subject_code, title, instructions, attachment_key, "
        "attachment_name, due_date, assigned_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING homework_id",
        (user.org_code, class_code, subject_code, title.strip(), instructions.strip(), key,
         (attachment.filename or "")[:255] if upload else None, due_date, user.user_code))
    return _homework_view(user.org_code, class_code, row["homework_id"])


def _homework_view(org: str, class_code: str, homework_id: UUID) -> dict:
    hw = next(h for h in db.call_rows("usp_list_homework", org, class_code, None) if h["homework_id"] == homework_id)
    return {**{k: v for k, v in hw.items() if k != "attachment_key"}, "attachment_url": _signed(hw["attachment_key"])}


@router.get("/homework")
def list_homework(class_code: str, subject_code: str | None = None, user: CurrentUser = Depends(staff)):
    _can_view_class(user, class_code)
    rows = db.call_rows("usp_list_homework", user.org_code, class_code, subject_code)
    return {"homework": [{**{k: v for k, v in h.items() if k != "attachment_key"},
                          "attachment_url": _signed(h["attachment_key"])} for h in rows]}


@router.delete("/homework/{homework_id}")
def delete_homework(homework_id: UUID, user: CurrentUser = Depends(teacher_only)):
    hw = _homework_or_404(user.org_code, homework_id)
    _require_marker(user, hw["class_code"], hw["subject_code"])
    db.execute("DELETE FROM public.homeworks WHERE homework_id = %s", (homework_id,))
    return {"deleted": str(homework_id)}


@router.get("/homework/{homework_id}/submissions")
def homework_submissions(homework_id: UUID, user: CurrentUser = Depends(teacher_only)):
    hw = _homework_or_404(user.org_code, homework_id)
    _require_marker(user, hw["class_code"], hw["subject_code"])
    rows = db.call_rows("usp_homework_submissions", user.org_code, homework_id)
    return {"homework_id": homework_id, "title": hw["title"],
            "submissions": [{**{k: v for k, v in r.items() if k != "file_key"}, "file_url": _signed(r["file_key"])}
                            for r in rows]}


class HomeworkReview(BaseModel):
    remarks: str | None = Field(default=None, max_length=2000)


@router.post("/homework/{homework_id}/submissions/{student_code}/review")
def review_homework(homework_id: UUID, student_code: str, body: HomeworkReview, user: CurrentUser = Depends(teacher_only)):
    hw = _homework_or_404(user.org_code, homework_id)
    _require_marker(user, hw["class_code"], hw["subject_code"])
    row = db.fetch_one(
        "UPDATE public.homework_submissions SET status = 'REVIEWED', teacher_remarks = %s, reviewed_at = NOW(), "
        "reviewed_by = %s WHERE homework_id = %s AND student_user_code = %s RETURNING hw_submission_id",
        ((body.remarks or "").strip() or None, user.user_code, homework_id, student_code))
    if not row:
        raise HTTPException(404, "This student has not submitted the homework yet")
    return {"reviewed": True}


@router.get("/my-homework")
def my_homework(user: CurrentUser = Depends(student_only)):
    rows = db.call_rows("usp_student_homework", user.org_code, user.user_code)
    today = date.today()
    out = [{**{k: v for k, v in r.items() if k not in ("attachment_key", "file_key")},
            "attachment_url": _signed(r["attachment_key"]), "file_url": _signed(r["file_key"]),
            "is_overdue": r["status"] == "PENDING" and r["due_date"] < today} for r in rows]
    return {"homework": out, "pending": sum(1 for r in out if r["status"] == "PENDING")}


@router.post("/my-homework/{homework_id}/submit")
def submit_homework(
    homework_id: UUID, notes: str | None = Form(None, max_length=5000), file: UploadFile | None = File(None),
    user: CurrentUser = Depends(student_only),
):
    hw = _homework_or_404(user.org_code, homework_id)
    me = db.call_row("usp_get_member", user.org_code, user.user_code)
    if not me or me["class_code"] != hw["class_code"]:
        raise HTTPException(404, "Homework not found")
    upload = _read_upload(file)
    if not upload and not (notes or "").strip():
        raise HTTPException(422, "Add a note or attach your work (PDF or photo)")
    prev = db.fetch_one("SELECT status, file_key, file_name FROM public.homework_submissions "
                        "WHERE homework_id = %s AND student_user_code = %s", (homework_id, user.user_code))
    if prev and prev["status"] == "REVIEWED":
        raise HTTPException(409, "Your teacher has already reviewed this homework")
    c = _class_or_404(user.org_code, hw["class_code"])
    key = _store(user, c, hw["subject_code"], "HomeworkSubmission", upload) if upload else (prev or {}).get("file_key")
    fname = (file.filename or "")[:255] if upload else (prev or {}).get("file_name")
    db.execute(
        "INSERT INTO public.homework_submissions(homework_id, org_code, student_user_code, submission_notes, "
        "file_key, file_name) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (homework_id, student_user_code) DO UPDATE SET "
        "submission_notes = EXCLUDED.submission_notes, file_key = EXCLUDED.file_key, "
        "file_name = EXCLUDED.file_name, submitted_at = NOW()",
        (homework_id, user.org_code, user.user_code, (notes or "").strip() or None, key, fname))
    return {"submitted": True, "status": "SUBMITTED"}
