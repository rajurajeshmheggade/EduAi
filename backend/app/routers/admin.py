"""Institution administration (RBAC matrix 2.2).

superadmin: onboard institutions (+ their first admin). orgadmin: settings, teachers, classes, class teacher and
subject-teacher assignment, read-only student directory and institution-wide attendance. Students are created by
the class teacher (see classroom router), never here.
"""
from __future__ import annotations

from datetime import date, time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg import errors as pg_errors
from pydantic import BaseModel, Field, StringConstraints, model_validator

from .. import db
from ..config import get_settings
from ..security import CurrentUser, hash_password, require_role
from ..services import attendance as att
from ..services import notifications as notif
from ..services.members import Code, Email, Name, Password, Phone, create_member, temp_password

router = APIRouter(prefix="/ICMELive/api/v1/admin", tags=["admin"])

superadmin_only = require_role("superadmin")
admins = require_role("orgadmin", "superadmin")
Level = Literal["school", "college", "coaching"]
AIModule = Literal["rag_chatbot", "ai_avatar_tutor", "ocr_evaluation", "capability_analysis"]
Gender = Literal["female", "male", "other", "undisclosed"]   # set by the admin; drives the avatar tutor's voice
ALL_MODULES: list[str] = ["rag_chatbot", "ai_avatar_tutor", "ocr_evaluation", "capability_analysis"]


def org_scope(user: CurrentUser, org_code: str | None) -> str:
    """orgadmins are pinned to their own tenant; superadmins may act on any tenant via ?org_code=."""
    if user.role == "superadmin" and org_code:
        if not db.fetch_one("SELECT 1 FROM public.organizations WHERE org_code = %s", (org_code,)):
            raise HTTPException(404, "Institution not found")
        return org_code
    return user.org_code


def _org(org_code: str) -> dict:
    org = db.fetch_one("SELECT * FROM public.organizations WHERE org_code = %s", (org_code,))
    if not org:
        raise HTTPException(404, "Institution not found")
    return org


def _active_teacher(org_code: str, code: str | None) -> None:
    if code is None:
        return
    t = db.call_row("usp_get_member", org_code, code)
    if not t or t["user_role"] != "teacher" or not t["is_active"]:
        raise HTTPException(422, f"{code} is not an active teacher in this institution")


# ---------------------------------------------------------------- institutions (superadmin)
class AdminAccount(BaseModel):
    full_name: Name
    email: Email
    user_code: Code
    password: Password | None = None


class OrgCreate(BaseModel):
    org_code: Code
    org_name: Name
    institution_level: Level = "school"
    city: str | None = Field(default=None, max_length=100)
    contact_email: Email | None = None
    contact_phone: Phone | None = None
    year_code: str = Field(default="2026-27", max_length=32)
    cycle_code: str = Field(default="Term-1", max_length=32)
    board_or_affiliation: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=500)
    max_students: int | None = Field(default=None, gt=0, le=1_000_000)
    ai_modules: list[AIModule] = Field(default_factory=lambda: list(ALL_MODULES))
    admin: AdminAccount


_PROFILE_SQL = (
    "UPDATE public.organizations SET board_or_affiliation = %s, address = %s, max_students = %s, "
    "ai_modules = %s::text[] WHERE org_code = %s"
)


@router.get("/organizations")
def list_orgs(_: CurrentUser = Depends(superadmin_only)):
    return {"organizations": db.call_rows("usp_list_orgs")}


@router.post("/organizations", status_code=status.HTTP_201_CREATED)
def create_org(body: OrgCreate, user: CurrentUser = Depends(superadmin_only)):
    with db.connection() as conn:  # one transaction: no institution without its admin
        conn.execute(
            "SELECT public.usp_create_org(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (body.org_code, user["customer_code"], body.org_name, body.institution_level, body.city,
             body.contact_email, body.contact_phone, body.year_code, body.cycle_code),
        )
        conn.execute(_PROFILE_SQL, (body.board_or_affiliation, body.address, body.max_students,
                                    sorted(set(body.ai_modules)), body.org_code))
        admin = create_member(
            org_code=body.org_code, customer_code=user["customer_code"], role="orgadmin",
            full_name=body.admin.full_name, user_code=body.admin.user_code, email=body.admin.email,
            password=body.admin.password, created_by=user.user_code, conn=conn,
        )
    return {"org_code": body.org_code, "org_name": body.org_name, "admin": admin}


@router.post("/organizations/{org_code}/admins", status_code=status.HTTP_201_CREATED)
def create_org_admin(org_code: str, body: AdminAccount, user: CurrentUser = Depends(superadmin_only)):
    """FR-SA-03: additional institution admins."""
    org = _org(org_scope(user, org_code))
    return create_member(
        org_code=org["org_code"], customer_code=org["customer_code"], role="orgadmin", full_name=body.full_name,
        user_code=body.user_code, email=body.email, password=body.password, created_by=user.user_code,
    )


@router.get("/organizations/{org_code}/admins")
def list_org_admins(org_code: str, user: CurrentUser = Depends(superadmin_only)):
    return {"admins": db.call_rows("usp_list_members", org_scope(user, org_code), "orgadmin", None)}


# ---------------------------------------------------------------- settings & overview
class OrgSettings(BaseModel):
    org_name: Name | None = None
    institution_level: Level | None = None
    attendance_threshold: float | None = Field(default=None, ge=0, le=100)
    current_year_code: str | None = Field(default=None, max_length=32)
    current_cycle_code: str | None = Field(default=None, max_length=32)
    board_or_affiliation: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=500)
    # Plan / licensing fields: platform super-admin only
    is_active: bool | None = None
    max_students: int | None = Field(default=None, gt=0, le=1_000_000)
    ai_modules: list[AIModule] | None = None


@router.get("/settings")
def get_settings_(org_code: str | None = None, user: CurrentUser = Depends(admins)):
    return _org(org_scope(user, org_code))


@router.put("/settings")
def update_settings(body: OrgSettings, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    plan_fields = body.is_active is not None or body.max_students is not None or body.ai_modules is not None
    if plan_fields and user.role != "superadmin":
        raise HTTPException(403, "Only the platform administrator can change the plan, modules or suspend an institution")
    with db.connection() as conn:
        conn.execute("SELECT public.usp_update_org_settings(%s,%s,%s,%s,%s,%s,%s)",
                     (org, body.org_name, body.institution_level, body.attendance_threshold,
                      body.current_year_code, body.current_cycle_code, body.is_active))
        conn.execute(
            "UPDATE public.organizations SET board_or_affiliation = COALESCE(%s, board_or_affiliation), "
            "address = COALESCE(%s, address), max_students = COALESCE(%s, max_students), "
            "ai_modules = COALESCE(%s::text[], ai_modules) WHERE org_code = %s",
            (body.board_or_affiliation, body.address, body.max_students,
             sorted(set(body.ai_modules)) if body.ai_modules is not None else None, org),
        )
    return _org(org)


@router.get("/overview")
def overview(org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = _org(org_scope(user, org_code))
    code = org["org_code"]
    counts = db.fetch_one(
        "SELECT "
        " (SELECT COUNT(*) FROM public.app_users WHERE org_code=%s AND user_role='teacher' AND is_active) AS teachers,"
        " (SELECT COUNT(*) FROM public.app_users WHERE org_code=%s AND user_role='student' AND is_active) AS students,"
        " (SELECT COUNT(*) FROM public.classes WHERE org_code=%s AND is_active) AS classes,"
        " (SELECT COUNT(*) FROM public.classes WHERE org_code=%s AND is_active AND class_teacher_code IS NULL)"
        "   AS classes_without_teacher,"
        " (SELECT COUNT(*) FROM public.class_subjects WHERE org_code=%s AND teacher_code IS NULL)"
        "   AS subjects_without_teacher",
        (code,) * 5,
    )
    today = date.today()
    first, last = att.month_bounds(today.strftime("%Y-%m"))
    today_rows = db.call_rows("usp_org_attendance_summary", code, today, today)
    month_rows = db.call_rows("usp_org_attendance_summary", code, first, last)
    return {
        "organization": org,
        "counts": counts,
        "attendance_today": _sum(today_rows),
        "attendance_month": _sum(month_rows),
    }


def _sum(rows: list[dict]) -> dict:
    statuses = []
    for r in rows:
        for s in att.STATUSES:
            statuses += [s] * int(r[s])
    return att.tally(statuses)


@router.get("/attendance/summary")
def attendance_summary(month: str = Query(pattern=r"^\d{4}-\d{2}$"), org_code: str | None = None,
                       user: CurrentUser = Depends(admins)):
    org = _org(org_scope(user, org_code))
    first, last = att.month_bounds(month)
    rows = db.call_rows("usp_org_attendance_summary", org["org_code"], first, last)
    out = []
    for r in rows:
        t = _sum([r])
        out.append({"class_code": r["class_code"], "subject_code": r["subject_code"],
                    "sessions": r["sessions"], **t,
                    "is_below_threshold": t["percentage"] is not None
                    and t["percentage"] < float(org["attendance_threshold"])})
    return {"month": month, "threshold": float(org["attendance_threshold"]), "rows": out, "overall": _sum(rows)}


# ---------------------------------------------------------------- teachers
# Stricter than the shared `Phone` type (used elsewhere for optional contact/guardian numbers): teacher phone
# is mandatory and format-checked per the admin dashboard requirements, without changing the shared type's
# behaviour for other callers (org contact numbers, admission team members, student guardians, etc).
TeacherPhone = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9+][0-9+\-\s]{6,19}$")]


class TeacherCreate(BaseModel):
    user_code: Code = Field(description="Employee code")
    full_name: Name
    email: Email
    phone: TeacherPhone
    qualification: str | None = Field(default=None, max_length=200)
    gender: Gender | None = None
    password: Password


class MemberPatch(BaseModel):
    full_name: Name | None = None
    phone: Phone | None = None
    gender: Gender | None = None
    is_active: bool | None = None
    reset_password: bool = False


@router.get("/teachers")
def list_teachers(org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    return {"teachers": db.call_rows("usp_list_members", org, "teacher", None)}


@router.post("/teachers", status_code=status.HTTP_201_CREATED)
def create_teacher(body: TeacherCreate, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = _org(org_scope(user, org_code))
    return create_member(
        org_code=org["org_code"], customer_code=org["customer_code"], role="teacher", full_name=body.full_name,
        user_code=body.user_code, email=body.email, password=body.password, created_by=user.user_code,
        year_code=org["current_year_code"], cycle_code=org["current_cycle_code"], phone=body.phone,
        qualification=body.qualification, gender=body.gender,
    )


@router.patch("/teachers/{user_code}")
def update_teacher(user_code: str, body: MemberPatch, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    return _patch_member(org, user_code, "teacher", body)


def _patch_member(org: str, user_code: str, role: str, body: MemberPatch, **extra) -> dict:
    m = db.call_row("usp_get_member", org, user_code)
    if not m or m["user_role"] != role:
        raise HTTPException(404, f"{role.capitalize()} not found")
    pw = temp_password() if body.reset_password else None
    db.call_scalar(
        "usp_update_member", org, user_code, body.full_name, body.phone, extra.get("roll_number"),
        extra.get("guardian_name"), extra.get("guardian_phone"), body.is_active, hash_password(pw) if pw else None,
    )
    if pw:
        db.execute("UPDATE public.app_users SET must_change_password = TRUE WHERE org_code = %s AND user_code = %s",
                   (org, user_code))
    if body.gender is not None:
        db.execute("UPDATE public.app_users SET gender = %s WHERE org_code = %s AND user_code = %s", (body.gender, org, user_code))
    out = db.call_rows("usp_list_members", org, role, m["class_code"])
    row = next(r for r in out if r["user_code"] == user_code)
    return {**row, "temporary_password": pw}


# ---------------------------------------------------------------- classes & subject teachers
class ClassCreate(BaseModel):
    class_code: Code
    class_name: Name
    class_teacher_code: str | None = None
    year_code: str | None = Field(default=None, max_length=32)
    cycle_code: str | None = Field(default=None, max_length=32)
    room_number: str | None = Field(default=None, max_length=32)
    grade_number: int | None = Field(default=None, ge=1, le=12, description="Class 1-12, used to match library books")
    board: str | None = Field(default=None, max_length=32, description="CBSE / NCERT / State board — sets the Digital "
                                                                        "Library's DIKSHA board for this class's teachers and students")


class ClassUpdate(BaseModel):
    class_name: Name
    class_teacher_code: str | None = None
    is_active: bool = True
    room_number: str | None = Field(default=None, max_length=32)
    grade_number: int | None = Field(default=None, ge=1, le=12)
    board: str | None = Field(default=None, max_length=32)


class ClassSubject(BaseModel):
    subject_name: Name
    teacher_code: str | None = None
    subject_type: Literal["THEORY", "LAB", "COACHING_TEST"] = "THEORY"


def _validate_board(board: str | None) -> str | None:
    """Canonical board name (matched case-insensitively against DIKSHA_BOARDS), or None if not set."""
    if not board:
        return None
    match = next((b for b in get_settings().diksha_board_list if b.lower() == board.strip().lower()), None)
    if not match:
        raise HTTPException(422, f"Board must be one of: {', '.join(get_settings().diksha_board_list)}")
    return match


def _set_room(org: str, class_code: str, room: str | None, grade: int | None = None, board: str | None = None) -> None:
    db.execute("UPDATE public.classes SET room_number = %s, grade_number = %s, board = %s WHERE org_code = %s AND class_code = %s",
               (room or None, grade, _validate_board(board), org, class_code))


@router.get("/classes")
def list_classes(org_code: str | None = None, user: CurrentUser = Depends(admins)):
    return {"classes": db.call_rows("usp_list_classes", org_scope(user, org_code))}


@router.post("/classes", status_code=status.HTTP_201_CREATED)
def create_class(body: ClassCreate, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = _org(org_scope(user, org_code))
    _active_teacher(org["org_code"], body.class_teacher_code)
    db.call_scalar("usp_create_class", org["org_code"], body.class_code, body.class_name,
                   body.year_code or org["current_year_code"], body.cycle_code or org["current_cycle_code"],
                   body.class_teacher_code)
    _set_room(org["org_code"], body.class_code, body.room_number, body.grade_number, body.board)
    return _class(org["org_code"], body.class_code)


@router.put("/classes/{class_code}")
def update_class(class_code: str, body: ClassUpdate, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _active_teacher(org, body.class_teacher_code)
    if not db.call_scalar("usp_update_class", org, class_code, body.class_name, body.class_teacher_code, body.is_active):
        raise HTTPException(404, "Class not found")
    _set_room(org, class_code, body.room_number, body.grade_number, body.board)
    return _class(org, class_code)


@router.put("/classes/{class_code}/subjects/{subject_code}")
def upsert_class_subject(class_code: str, subject_code: Code, body: ClassSubject, org_code: str | None = None,
                         user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    if not db.call_row("usp_get_class", org, class_code):
        raise HTTPException(404, "Class not found")
    _active_teacher(org, body.teacher_code)
    with db.connection() as conn:
        conn.execute("SELECT public.usp_upsert_class_subject(%s,%s,%s,%s,%s)",
                     (org, class_code, subject_code, body.subject_name, body.teacher_code))
        conn.execute("UPDATE public.class_subjects SET subject_type = %s "
                     "WHERE org_code = %s AND class_code = %s AND subject_code = %s",
                     (body.subject_type, org, class_code, subject_code))
    return _class(org, class_code)


@router.delete("/classes/{class_code}/subjects/{subject_code}")
def delete_class_subject(class_code: str, subject_code: str, org_code: str | None = None,
                         user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    if not db.call_scalar("usp_delete_class_subject", org, class_code, subject_code):
        raise HTTPException(404, "Subject not found in this class")
    return _class(org, class_code)


def _class(org: str, class_code: str) -> dict:
    row = next((c for c in db.call_rows("usp_list_classes", org) if c["class_code"] == class_code), None)
    if not row:
        raise HTTPException(404, "Class not found")
    return row


# ---------------------------------------------------------------- students (read-only for admins)
@router.get("/students")
def list_students(class_code: str | None = None, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    return {"students": db.call_rows("usp_list_members", org_scope(user, org_code), "student", class_code)}


# ---------------------------------------------------------------- timetable (FR-AD-07)
ScheduleType = Literal["WEEKLY", "MONTHLY", "YEARLY"]


class TimetableSlot(BaseModel):
    class_code: str = Field(min_length=1, max_length=64)
    subject_code: str = Field(min_length=1, max_length=64)
    teacher_code: str | None = Field(default=None, description="Defaults to the class subject's teacher")
    day_of_week: int = Field(ge=1, le=7, description="ISO day: 1 = Monday ... 7 = Sunday")
    period_number: int = Field(ge=1, le=12)
    start_time: time
    end_time: time
    room_number: str | None = Field(default=None, max_length=32)
    schedule_type: ScheduleType = Field(default="WEEKLY", description="How this period recurs")
    effective_from: date | None = Field(default=None, description="First date this period applies from (optional)")
    effective_to: date | None = Field(default=None, description="Last date this period applies until (optional)")
    is_online: bool = False
    online_url: str | None = Field(default=None, max_length=500)
    change_reason: str | None = Field(default=None, max_length=300, description="Why this period is changing (optional)")

    @model_validator(mode="after")
    def _check(self) -> "TimetableSlot":
        if self.is_online and not (self.online_url or "").strip():
            raise ValueError("Online classes need a meeting URL")
        if self.effective_from and self.effective_to and self.effective_to < self.effective_from:
            raise ValueError("The end date must be on or after the start date")
        return self


class TimetableStatusUpdate(BaseModel):
    status: Literal["DRAFT", "PUBLISHED"]


def list_slots(org: str, class_code: str | None = None, teacher_code: str | None = None,
              student_view: bool = False) -> list[dict]:
    rows = db.call_rows("usp_list_timetable", org, class_code, teacher_code, student_view,
                        casts=[None, None, None, "boolean"])
    for r in rows:  # TIME -> "HH:MM" for the UI
        r["start_time"] = r["start_time"].strftime("%H:%M")
        r["end_time"] = r["end_time"].strftime("%H:%M")
    return rows


@router.get("/timetable")
def list_timetable(class_code: str | None = None, teacher_code: str | None = None, org_code: str | None = None,
                   user: CurrentUser = Depends(admins)):
    return {"slots": list_slots(org_scope(user, org_code), class_code, teacher_code)}


def _record_timetable_change(org: str, class_code: str, day: int, period: int, kind: str, old: dict | None,
                             new: dict | None, reason: str | None, user: CurrentUser) -> None:
    """Records the before/after in timetable_slot_changes (#3A), then notifies the affected class's students,
    the old/new teacher and the class teacher, and the institution's admins — but only once the class's
    timetable is actually PUBLISHED (#3E): a change to a still-draft timetable isn't visible to anyone yet,
    so there is nothing to notify about."""
    db.execute(
        "INSERT INTO public.timetable_slot_changes(org_code, class_code, slot_id, day_of_week, period_number, "
        "change_kind, old_subject_name, old_teacher_name, old_start_time, old_end_time, new_subject_name, "
        "new_teacher_name, new_start_time, new_end_time, reason, changed_by, changed_by_name) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (org, class_code, (new or old or {}).get("slot_id"), day, period, kind,
         (old or {}).get("subject_name"), (old or {}).get("teacher_name"), (old or {}).get("start_time"), (old or {}).get("end_time"),
         (new or {}).get("subject_name"), (new or {}).get("teacher_name"), (new or {}).get("start_time"), (new or {}).get("end_time"),
         reason, user.user_code, _display_name_of(org, user.user_code)),
    )
    c = db.fetch_one("SELECT class_name, class_teacher_code, timetable_status FROM public.classes "
                     "WHERE org_code = %s AND class_code = %s", (org, class_code))
    if not c or c["timetable_status"] != "PUBLISHED":
        return  # draft: recorded for audit, nobody is notified until it's published

    students = [r["user_code"] for r in db.fetch_all(
        "SELECT user_code FROM public.app_users WHERE org_code = %s AND class_code = %s "
        "AND user_role = 'student' AND is_active", (org, class_code))]
    admins_of_org = [r["user_code"] for r in db.fetch_all(
        "SELECT user_code FROM public.app_users WHERE org_code = %s AND user_role = 'orgadmin' AND is_active", (org,))]
    teachers = [t for t in {(old or {}).get("teacher_code"), (new or {}).get("teacher_code"), c["class_teacher_code"]} if t]

    subject = (new or old or {}).get("subject_name") or "A period"
    if kind == "CANCELLED":
        title, body = f"{subject} removed from {c['class_name']}'s timetable", \
            f"Day {day}, period {period} ({(old or {}).get('start_time')}-{(old or {}).get('end_time')}) was removed." + (f" Reason: {reason}" if reason else "")
    else:
        title, body = f"{subject} period updated for {c['class_name']}", \
            f"Day {day}, period {period} changed" + (f": {reason}" if reason else ".")
    dedup = f"TTCHG:{class_code}:{day}:{period}:{user.user_code}"
    notif.notify_many(org, students, "TIMETABLE_CHANGE", title, body, "/student/timetable", dedup + ":student")
    notif.notify_many(org, teachers, "TIMETABLE_CHANGE", title, body, "/teacher/timetable", dedup + ":teacher")
    notif.notify_many(org, admins_of_org, "TIMETABLE_CHANGE", title, body, "/admin-dashboard?tab=timetable", dedup + ":admin")


def _display_name_of(org: str, user_code: str) -> str | None:
    m = db.call_row("usp_get_member", org, user_code)
    return m["full_name"] if m else None


@router.put("/timetable")
def upsert_timetable_slot(body: TimetableSlot, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Create or replace the period for (class, day, period). Teacher double-booking is rejected with 409."""
    org = org_scope(user, org_code)
    if body.end_time <= body.start_time:
        raise HTTPException(422, "End time must be after start time")
    subject = db.fetch_one(
        "SELECT 1 FROM public.class_subjects WHERE org_code = %s AND class_code = %s AND subject_code = %s",
        (org, body.class_code, body.subject_code))
    if not subject:
        raise HTTPException(422, f"{body.subject_code} is not a subject of {body.class_code}")
    _active_teacher(org, body.teacher_code)
    before = next((s for s in list_slots(org, body.class_code) if s["day_of_week"] == body.day_of_week
                   and s["period_number"] == body.period_number), None)
    try:
        slot_id = db.call_scalar(
            "usp_upsert_timetable_slot", org, body.class_code, body.subject_code, body.teacher_code,
            body.day_of_week, body.period_number, body.start_time, body.end_time, body.room_number, user.user_code,
            body.schedule_type, body.effective_from, body.effective_to, body.is_online, body.online_url,
            casts=[None, None, None, None, "smallint", "smallint", "time", "time", None, None,
                  None, "date", "date", "boolean", None],
        )
    except pg_errors.RaiseException as e:
        kind, _, detail = (e.diag.message_primary or str(e)).partition(": ")
        raise HTTPException(409, detail if kind in ("TEACHER_CLASH", "CLASS_CLASH") else str(e))
    after = next(x for x in list_slots(org, body.class_code) if x["slot_id"] == slot_id)
    if before and (before["subject_code"] != after["subject_code"] or before["teacher_code"] != after["teacher_code"]
                  or before["start_time"] != after["start_time"] or before["end_time"] != after["end_time"]):
        _record_timetable_change(org, body.class_code, body.day_of_week, body.period_number, "UPDATED",
                                 before, after, body.change_reason, user)
    return after


@router.delete("/timetable/{slot_id}")
def delete_timetable_slot(slot_id: str, org_code: str | None = None, reason: str | None = Query(default=None, max_length=300),
                          user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    row = db.fetch_one("DELETE FROM public.timetable_slots WHERE org_code = %s AND slot_id::text = %s "
                       "RETURNING slot_id, class_code, day_of_week, period_number, subject_code, teacher_code, "
                       "start_time, end_time", (org, slot_id))
    if not row:
        raise HTTPException(404, "Timetable slot not found")
    subj = db.fetch_one(
        "SELECT subject_name FROM public.class_subjects WHERE org_code = %s AND class_code = %s AND subject_code = %s",
        (org, row["class_code"], row["subject_code"]))
    old = {**row, "subject_name": subj["subject_name"] if subj else row["subject_code"],
        "teacher_name": _display_name_of(org, row["teacher_code"]) if row["teacher_code"] else None,
        "start_time": row["start_time"].strftime("%H:%M"), "end_time": row["end_time"].strftime("%H:%M")}
    _record_timetable_change(org, row["class_code"], row["day_of_week"], row["period_number"], "CANCELLED",
                             old, None, reason, user)
    return {"deleted": slot_id}


@router.patch("/classes/{class_code}/timetable-status")
def set_timetable_status(class_code: str, body: TimetableStatusUpdate, org_code: str | None = None,
                         user: CurrentUser = Depends(admins)):
    """Draft/publish workflow (#6): a DRAFT class's timetable is hidden from /my-timetable until published."""
    org = org_scope(user, org_code)
    row = db.fetch_one(
        "UPDATE public.classes SET timetable_status = %s, "
        "timetable_published_at = CASE WHEN %s = 'PUBLISHED' THEN NOW() ELSE timetable_published_at END, "
        "timetable_published_by = CASE WHEN %s = 'PUBLISHED' THEN %s ELSE timetable_published_by END "
        "WHERE org_code = %s AND class_code = %s "
        "RETURNING class_code, timetable_status, timetable_published_at",
        (body.status, body.status, body.status, user.user_code, org, class_code))
    if not row:
        raise HTTPException(404, "Class not found")
    return row


# ---------------------------------------------------------------- holidays (#10)
HolidayType = Literal["PUBLIC", "SCHOOL"]
HolidayScope = Literal["SCHOOL_WIDE", "CLASS"]
HolidayStatus = Literal["DRAFT", "PUBLISHED"]


class HolidayBody(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    start_date: date
    end_date: date
    holiday_type: HolidayType = "SCHOOL"
    description: str | None = Field(default=None, max_length=1000)
    scope: HolidayScope = "SCHOOL_WIDE"
    class_codes: list[str] = Field(default_factory=list, description="Required when scope = CLASS")
    is_full_day: bool = True
    status: HolidayStatus = "PUBLISHED"

    @model_validator(mode="after")
    def _check(self) -> "HolidayBody":
        if self.end_date < self.start_date:
            raise ValueError("The end date must be on or after the start date")
        if self.scope == "CLASS" and not self.class_codes:
            raise ValueError("Pick at least one class for a class-specific holiday")
        if self.scope == "SCHOOL_WIDE":
            self.class_codes = []
        return self


@router.get("/holidays")
def list_holidays(start: date | None = None, end: date | None = None, class_code: str | None = None,
                  org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    lo = start or date.today()
    hi = end or date(lo.year + 1, lo.month, lo.day)
    rows = db.call_rows("usp_list_holidays", org, class_code, lo, hi, False, casts=[None, None, None, None, "boolean"])
    return {"holidays": rows}


@router.post("/holidays", status_code=status.HTTP_201_CREATED)
def create_holiday(body: HolidayBody, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    row = db.fetch_one(
        "INSERT INTO public.holidays(org_code, name, start_date, end_date, holiday_type, description, scope, "
        "class_codes, is_full_day, status, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s::text[],%s,%s,%s) RETURNING *",
        (org, body.name, body.start_date, body.end_date, body.holiday_type, body.description, body.scope,
         body.class_codes, body.is_full_day, body.status, user.user_code))
    return row


@router.put("/holidays/{holiday_id}")
def update_holiday(holiday_id: str, body: HolidayBody, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    row = db.fetch_one(
        "UPDATE public.holidays SET name = %s, start_date = %s, end_date = %s, holiday_type = %s, description = %s, "
        "scope = %s, class_codes = %s::text[], is_full_day = %s, status = %s WHERE org_code = %s AND holiday_id::text = %s RETURNING *",
        (body.name, body.start_date, body.end_date, body.holiday_type, body.description, body.scope,
         body.class_codes, body.is_full_day, body.status, org, holiday_id))
    if not row:
        raise HTTPException(404, "Holiday not found")
    return row


@router.delete("/holidays/{holiday_id}")
def delete_holiday(holiday_id: str, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    row = db.fetch_one("DELETE FROM public.holidays WHERE org_code = %s AND holiday_id::text = %s RETURNING holiday_id",
                       (org, holiday_id))
    if not row:
        raise HTTPException(404, "Holiday not found")
    return {"deleted": holiday_id}
