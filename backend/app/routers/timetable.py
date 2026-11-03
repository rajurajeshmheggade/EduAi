"""Date-level timetable management for the admin console (spec 5.1-5.4; orgadmin + superadmin).

The weekly template stays at GET/PUT/DELETE /admin/timetable (admin router). This router adds what works on real
dates: the calendar (class-wise / teacher-wise / whole institution, any date range), dated sessions (add, edit or
substitute one date, cancel one date, restore the weekly period), a dry-run conflict check, copy from another date or
week, the bell schedule (periods + named breaks), working days and the rooms master. All writes are serialised per
institution and validated by the same SQL conflict rules as the weekly template.
"""
from __future__ import annotations

from datetime import date, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from psycopg import errors as pg_errors
from pydantic import BaseModel, Field, field_validator, model_validator

from .. import db
from ..security import CurrentUser, require_role
from ..services import timetable as tt
from .admin import _active_teacher, _record_timetable_change, notify_timetable_change, org_scope

router = APIRouter(prefix="/ICMELive/api/v1/admin", tags=["timetable"])
admins = require_role("orgadmin", "superadmin")
RoomType = Literal["CLASSROOM", "LAB", "HALL", "OTHER"]


def _class_or_404(org: str, class_code: str) -> dict:
    c = db.fetch_one("SELECT class_code, class_name, timetable_status FROM public.classes "
                     "WHERE org_code = %s AND class_code = %s", (org, class_code))
    if not c:
        raise HTTPException(404, "Class not found")
    return c


# ---------------------------------------------------------------- calendar (5.4)
@router.get("/timetable/calendar")
def calendar(start: date, end: date, class_code: str | None = None, teacher_code: str | None = None,
             org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Concrete sessions for [start, end] (at most 92 days): the whole institution, one class, or one teacher.
    Includes cancelled periods and periods falling on holidays (status), and every holiday in the range."""
    org = org_scope(user, org_code)
    tt.check_range(start, end)
    if class_code:
        _class_or_404(org, class_code)
    sessions = tt.resolve(org, start, end, class_code, teacher_code)
    holidays = db.call_rows("usp_list_holidays", org, class_code, start, end, False,
                            casts=[None, None, None, None, "boolean"])
    return {"start": start, "end": end, "today": date.today(), "sessions": sessions, "holidays": holidays,
            "working_days": tt.working_days(org), "bell_schedule": tt.bell_schedule(org)}


# ---------------------------------------------------------------- conflicts (5.3)
class _Times(BaseModel):
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def _times(self):
        if self.end_time <= self.start_time:
            raise ValueError("End time must be after start time")
        return self


class ConflictCheck(_Times):
    class_code: str = Field(min_length=1, max_length=64)
    period_number: int = Field(ge=1, le=12)
    subject_code: str | None = Field(default=None, max_length=64)
    teacher_code: str | None = Field(default=None, max_length=64)
    room_number: str | None = Field(default=None, max_length=32)
    is_online: bool = False
    session_date: date | None = Field(default=None, description="Check a dated session on this date")
    day_of_week: int | None = Field(default=None, ge=1, le=7, description="Or check a weekly period on this ISO weekday")
    effective_from: date | None = None
    effective_to: date | None = None

    @model_validator(mode="after")
    def _one_mode(self):
        if (self.session_date is None) == (self.day_of_week is None):
            raise ValueError("Give either session_date (dated session) or day_of_week (weekly period)")
        return self


def _teacher_for(org: str, class_code: str, subject_code: str | None, teacher_code: str | None) -> str | None:
    if teacher_code:
        _active_teacher(org, teacher_code)
        return teacher_code
    return tt.class_subject(org, class_code, subject_code)["teacher_code"] if subject_code else None


@router.post("/timetable/check-conflicts")
def check_conflicts(body: ConflictCheck, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Dry run: every conflict the period would have (errors block a save, warnings don't). Nothing is written."""
    org = org_scope(user, org_code)
    _class_or_404(org, body.class_code)
    found = tt.conflicts(org, class_code=body.class_code, period=body.period_number, start=body.start_time,
                         end=body.end_time, teacher_code=_teacher_for(org, body.class_code, body.subject_code, body.teacher_code),
                         room=body.room_number, is_online=body.is_online, session_date=body.session_date,
                         day=body.day_of_week, effective_from=body.effective_from, effective_to=body.effective_to)
    return {"ok": not tt.errors_of(found), "conflicts": found}


# ---------------------------------------------------------------- dated sessions (5.1, 5.3)
class DatedSession(_Times):
    class_code: str = Field(min_length=1, max_length=64)
    session_date: date
    period_number: int = Field(ge=1, le=12)
    subject_code: str = Field(min_length=1, max_length=64)
    teacher_code: str | None = Field(default=None, max_length=64, description="Defaults to the subject teacher")
    room_number: str | None = Field(default=None, max_length=32)
    is_online: bool = False
    online_url: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=300, description="Reason / remark, shown with the change")
    original_period_number: int | None = Field(default=None, ge=1, le=12,
                                               description="Moving a session to another period: the period it was in")

    @model_validator(mode="after")
    def _online(self):
        if self.is_online and not (self.online_url or "").strip():
            raise ValueError("Online classes need a meeting URL")
        if not self.is_online:
            self.online_url = None
        return self


def _view(s: dict | None) -> dict | None:
    if not s:
        return None
    return {k: s[k] for k in ("slot_id", "subject_name", "teacher_name", "teacher_code", "start_time", "end_time")}


@router.put("/timetable/sessions")
def save_session(body: DatedSession, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Create or replace the session of a class on one date and period. Over a weekly period it becomes that date's
    override (e.g. a substitute teacher or another subject); otherwise it is an extra session. 409 lists every
    conflict; nothing is saved then."""
    org = org_scope(user, org_code)
    _class_or_404(org, body.class_code)
    subject = tt.class_subject(org, body.class_code, body.subject_code)
    _active_teacher(org, body.teacher_code)
    teacher = body.teacher_code or subject["teacher_code"]
    moving = body.original_period_number not in (None, body.period_number)
    before = tt.session_at(org, body.class_code, body.session_date,
                           body.original_period_number if moving else body.period_number)
    if moving and (not before or before["status"] != "SCHEDULED"):
        raise HTTPException(404, f"Nothing is scheduled in period {body.original_period_number} on that date")
    try:
        with db.connection() as conn:
            tt.lock(conn, org)
            if moving:
                tt.cancel_session(conn, org, before, body.note, user.user_code)
            found = tt.conflicts(org, class_code=body.class_code, period=body.period_number, start=body.start_time,
                                 end=body.end_time, teacher_code=teacher, room=body.room_number,
                                 is_online=body.is_online, session_date=body.session_date, conn=conn)
            if tt.errors_of(found):
                raise tt.Conflict(found)
            entry_id = tt.save_entry(conn, org, class_code=body.class_code, session_date=body.session_date,
                                     period=body.period_number, kind="SESSION", subject_code=body.subject_code,
                                     teacher_code=teacher, start=body.start_time, end=body.end_time,
                                     room=body.room_number, is_online=body.is_online, online_url=body.online_url,
                                     note=body.note, user_code=user.user_code)
    except tt.Conflict as e:
        return tt.conflict_response(e.conflicts)
    except pg_errors.RaiseException as e:  # a concurrent edit got there first
        raise HTTPException(409, (e.diag.message_primary or str(e)).partition(": ")[2] or str(e))
    after = tt.session_at(org, body.class_code, body.session_date, body.period_number)
    live_before = before if before and before["status"] == "SCHEDULED" else None
    changed = not live_before or moving or any(live_before[k] != after[k] for k in (
        "subject_code", "teacher_code", "start_time", "end_time", "room_number", "is_online"))
    if changed:
        _record_timetable_change(org, body.class_code, body.session_date.isoweekday(), body.period_number,
                                 "UPDATED" if live_before else "ADDED", _view(live_before), _view(after), body.note,
                                 user, session_date=body.session_date, entry_id=str(entry_id))
    return {"session": after, "warnings": [c for c in found if c["severity"] == "warning"]}


class CancelBody(BaseModel):
    class_code: str = Field(min_length=1, max_length=64)
    session_date: date
    period_number: int = Field(ge=1, le=12)
    reason: str | None = Field(default=None, max_length=300)


@router.post("/timetable/sessions/cancel")
def cancel_session(body: CancelBody, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Take one period off one date (delete for that date). The weekly template is untouched."""
    org = org_scope(user, org_code)
    _class_or_404(org, body.class_code)
    with db.connection() as conn:
        tt.lock(conn, org)
        s = tt.session_at(org, body.class_code, body.session_date, body.period_number, conn=conn)
        if not s or s["status"] != "SCHEDULED":
            raise HTTPException(404, "Nothing is scheduled in that period on that date")
        tt.cancel_session(conn, org, s, body.reason, user.user_code)
    _record_timetable_change(org, body.class_code, body.session_date.isoweekday(), body.period_number, "CANCELLED",
                             _view(s), None, body.reason, user, session_date=body.session_date,
                             entry_id=str(s["entry_id"]) if s["entry_id"] else None)
    return {"cancelled": s["session_key"], "session": tt.session_at(org, body.class_code, body.session_date,
                                                                    body.period_number)}


@router.delete("/timetable/sessions/{entry_id}")
def delete_dated_entry(entry_id: str, org_code: str | None = None,
                       reason: str | None = Query(default=None, max_length=300), user: CurrentUser = Depends(admins)):
    """Remove a dated entry: an extra session disappears; an override or cancellation is undone, so that date
    follows the weekly period again (checked for conflicts first)."""
    org = org_scope(user, org_code)
    try:
        with db.connection() as conn:
            tt.lock(conn, org)
            e = conn.execute("DELETE FROM public.timetable_dated_entries WHERE org_code = %s AND entry_id::text = %s "
                             "RETURNING *", (org, entry_id)).fetchone()
            if not e:
                raise HTTPException(404, "Dated timetable entry not found")
            restored = tt.session_at(org, e["class_code"], e["session_date"], e["period_number"], conn=conn)
            if restored and restored["status"] == "SCHEDULED":
                found = tt.conflicts(org, class_code=restored["class_code"], period=restored["period_number"],
                                     start=tt._t(restored["start_time"]), end=tt._t(restored["end_time"]),
                                     teacher_code=restored["teacher_code"], room=restored["room_number"],
                                     is_online=restored["is_online"], session_date=e["session_date"], conn=conn)
                if tt.errors_of(found):
                    raise tt.Conflict(found)
    except tt.Conflict as ex:
        return tt.conflict_response(ex.conflicts)
    old = None
    if e["entry_kind"] == "SESSION":
        subj = db.fetch_one("SELECT subject_name FROM public.class_subjects WHERE org_code = %s AND class_code = %s "
                            "AND subject_code = %s", (org, e["class_code"], e["subject_code"]))
        teacher = db.call_row("usp_get_member", org, e["teacher_code"]) if e["teacher_code"] else None
        old = {"subject_name": subj["subject_name"] if subj else e["subject_code"], "teacher_code": e["teacher_code"],
               "teacher_name": teacher["full_name"] if teacher else None,
               "start_time": tt.hhmm(e["start_time"]), "end_time": tt.hhmm(e["end_time"])}
    if not old and not restored:  # an orphaned cancellation: nothing anyone could see changed
        return {"deleted": entry_id, "restored": None}
    kind = "RESTORED" if restored else "CANCELLED"
    _record_timetable_change(org, e["class_code"], e["session_date"].isoweekday(), e["period_number"], kind,
                             old, _view(restored), reason, user, session_date=e["session_date"], entry_id=entry_id)
    return {"deleted": entry_id, "restored": restored}


# ---------------------------------------------------------------- copy from another date / week (5.3)
class _CopyScope(BaseModel):
    class_codes: list[str] = Field(default_factory=list, max_length=200,
                                   description="One or several classes; empty (and no teacher) = whole institution")
    teacher_code: str | None = Field(default=None, max_length=64, description="Copy only this teacher's sessions")
    mode: Literal["skip", "overwrite"] = Field(default="skip", description="What to do when the target period is taken")
    replace_target: bool = Field(default=False, description="Also cancel the target's other periods (class scope)")
    dry_run: bool = False

    @model_validator(mode="after")
    def _scope(self):
        if self.teacher_code and self.class_codes:
            raise ValueError("Copy either classes or a teacher, not both")
        if self.teacher_code and self.replace_target:
            raise ValueError("Replacing the whole target day works for classes, not for a single teacher")
        self.class_codes = list(dict.fromkeys(self.class_codes))
        return self


class CopyBody(_CopyScope):
    source_date: date
    target_dates: list[date] = Field(default_factory=list, max_length=tt.MAX_COPY_DAYS)
    target_start: date | None = None
    target_end: date | None = None

    @model_validator(mode="after")
    def _targets(self):
        if bool(self.target_dates) == bool(self.target_start or self.target_end):
            raise ValueError("Give either target_dates or a target_start / target_end range")
        if self.target_start or self.target_end:
            if not (self.target_start and self.target_end):
                raise ValueError("A target range needs both target_start and target_end")
            if self.target_end < self.target_start:
                raise ValueError("The end date must be on or after the start date")
            if (self.target_end - self.target_start).days + 1 > tt.MAX_COPY_DAYS:
                raise ValueError(f"Copy to at most {tt.MAX_COPY_DAYS} days at a time")
        if self.source_date in self.target_dates:
            raise ValueError("The source date can't also be a target")
        return self


class CopyWeekBody(_CopyScope):
    source_week: date = Field(description="Any date in the week to copy (weeks run Monday-Sunday)")
    target_week: date = Field(description="Any date in the first target week")
    weeks: int = Field(default=1, ge=1, le=8, description="Repeat into this many consecutive weeks")

    @field_validator("source_week", "target_week")
    @classmethod
    def _monday(cls, v: date) -> date:
        return tt.week_of(v)[0]

    @model_validator(mode="after")
    def _distinct(self):
        last = self.target_week + timedelta(weeks=self.weeks - 1)
        if self.target_week <= self.source_week <= last:
            raise ValueError("The source week can't also be a target week")
        return self


def _check_scope(org: str, body: _CopyScope) -> None:
    for c in body.class_codes:
        _class_or_404(org, c)
    _active_teacher(org, body.teacher_code)


def _after_copy(org: str, report: dict, user: CurrentUser) -> dict:
    """Audit every written / cancelled session; one notification per affected class rather than one per period."""
    if report["dry_run"]:
        return report
    per_class: dict[str, list[date]] = {}
    for c in report["copied"]:
        kind = "UPDATED" if c["action"] == "REPLACED" else "ADDED"
        new = {k: c[k] for k in ("subject_name", "teacher_name", "teacher_code", "start_time", "end_time")}
        _record_timetable_change(org, c["class_code"], c["date"].isoweekday(), c["period_number"], kind, c["replaced"],
                                 new, f"Copied from {tt.nice_date(c['source_date'])}", user, session_date=c["date"],
                                 notify=False)
        per_class.setdefault(c["class_code"], []).append(c["date"])
    for c in report["cancelled"]:
        _record_timetable_change(org, c["class_code"], c["date"].isoweekday(), c["period_number"], "CANCELLED", c, None,
                                 "Replaced by a copied timetable", user, session_date=c["date"], notify=False)
        per_class.setdefault(c["class_code"], []).append(c["date"])
    today = date.today()
    for n, (class_code, dates) in enumerate(per_class.items()):
        upcoming = sorted({d for d in dates if d >= today})
        if not upcoming:
            continue
        span = tt.nice_date(upcoming[0]) + (f" – {tt.nice_date(upcoming[-1])}" if len(upcoming) > 1 else "")
        teachers = sorted({x["teacher_code"] for x in report["copied"] + report["cancelled"]
                           if x["class_code"] == class_code and x.get("teacher_code")})
        notify_timetable_change(org, class_code, teachers, f"Timetable updated for {{cls}} ({span})",
                                f"The timetable for {span} was updated by copying another day's timetable.",
                                f"TTCOPY:{report['batch']}:{n}")  # unique per copy and class; fits dedup_key(160)
    return report


@router.post("/timetable/copy")
def copy_from_date(body: CopyBody, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Copy one date's timetable (classes, a teacher, or the whole institution) to other dates or a date range.
    Periods that would clash on the target are skipped and reported; non-working days in a range are skipped."""
    org = org_scope(user, org_code)
    _check_scope(org, body)
    if body.target_dates:
        targets, explicit = sorted(set(body.target_dates)), True
    else:
        n = (body.target_end - body.target_start).days + 1
        targets = [d for d in (body.target_start + timedelta(days=i) for i in range(n)) if d != body.source_date]
        explicit = False
    report = tt.copy_days(org, [(body.source_date, d) for d in targets], class_codes=body.class_codes,
                          teacher_code=body.teacher_code, mode=body.mode, replace_target=body.replace_target,
                          dry_run=body.dry_run, user_code=user.user_code, report_non_working=explicit)
    report["batch"] = db.fetch_one("SELECT uuid_generate_v4()::text AS v")["v"]
    return _after_copy(org, report, user)


@router.post("/timetable/copy-week")
def copy_week(body: CopyWeekBody, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Copy a whole week (Monday-Sunday) onto one or more following weeks, day by day."""
    org = org_scope(user, org_code)
    _check_scope(org, body)
    pairs = [(body.source_week + timedelta(days=i), body.target_week + timedelta(weeks=w, days=i))
             for w in range(body.weeks) for i in range(7)]
    report = tt.copy_days(org, pairs, class_codes=body.class_codes, teacher_code=body.teacher_code, mode=body.mode,
                          replace_target=body.replace_target, dry_run=body.dry_run, user_code=user.user_code,
                          report_non_working=False)
    report["batch"] = db.fetch_one("SELECT uuid_generate_v4()::text AS v")["v"]
    return _after_copy(org, report, user)


# ---------------------------------------------------------------- working days (5.2)
class WorkingDaysBody(BaseModel):
    working_days: list[int] = Field(min_length=1, max_length=7, description="ISO weekdays, 1 = Monday ... 7 = Sunday")

    @field_validator("working_days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in v):
            raise ValueError("Days are ISO weekdays 1 (Monday) to 7 (Sunday)")
        return sorted(set(v))


def _closed_day_periods(org: str, days: list[int]) -> int:
    row = db.fetch_one("SELECT COUNT(*) AS n FROM public.timetable_slots WHERE org_code = %s "
                       "AND NOT (day_of_week = ANY(%s::smallint[]))", (org, days))
    return int(row["n"])


@router.get("/timetable/working-days")
def get_working_days(org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    days = tt.working_days(org)
    return {"working_days": days, "weekly_periods_on_closed_days": _closed_day_periods(org, days)}


@router.put("/timetable/working-days")
def set_working_days(body: WorkingDaysBody, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Which weekdays the institution schedules classes on. Weekly periods on a closed day are kept (they reappear
    if the day is reopened) but don't produce sessions; nothing new can be scheduled on a closed day."""
    org = org_scope(user, org_code)
    db.execute("INSERT INTO public.timetable_settings(org_code, working_days, updated_by) VALUES (%s, %s::smallint[], %s) "
               "ON CONFLICT (org_code) DO UPDATE SET working_days = EXCLUDED.working_days, "
               "updated_by = EXCLUDED.updated_by, updated_at = NOW()", (org, body.working_days, user.user_code))
    return {"working_days": body.working_days, "weekly_periods_on_closed_days": _closed_day_periods(org, body.working_days)}


# ---------------------------------------------------------------- bell schedule: periods + breaks (5.3)
class BellItem(_Times):
    item_kind: Literal["PERIOD", "BREAK"] = "PERIOD"
    period_number: int | None = Field(default=None, ge=1, le=12)
    label: str | None = Field(default=None, max_length=60)

    @model_validator(mode="after")
    def _kind(self):
        if self.item_kind == "PERIOD" and self.period_number is None:
            raise ValueError("A period needs a period number")
        if self.item_kind == "BREAK":
            self.period_number = None
            self.label = (self.label or "").strip() or "Break"
        return self


class BellBody(BaseModel):
    day_of_week: int | None = Field(default=None, ge=1, le=7,
                                    description="Empty = the default bell; 1-7 = that weekday's own bell")
    items: list[BellItem] = Field(default_factory=list, max_length=30,
                                  description="Empty removes that weekday's own bell (or resets the default)")

    @model_validator(mode="after")
    def _consistent(self):
        nums = [i.period_number for i in self.items if i.item_kind == "PERIOD"]
        if len(nums) != len(set(nums)):
            raise ValueError("Each period number may appear only once")
        ordered = sorted(self.items, key=lambda i: i.start_time)
        for a, b in zip(ordered, ordered[1:]):
            if b.start_time < a.end_time:
                raise ValueError(f"{a.label or f'Period {a.period_number}'} and {b.label or f'Period {b.period_number}'} overlap")
        self.items = ordered
        return self


@router.get("/timetable/bell-schedule")
def get_bell_schedule(org_code: str | None = None, user: CurrentUser = Depends(admins)):
    return tt.bell_schedule(org_scope(user, org_code))


@router.put("/timetable/bell-schedule")
def set_bell_schedule(body: BellBody, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    with db.connection() as conn:
        tt.lock(conn, org)
        configured = conn.execute("SELECT EXISTS (SELECT 1 FROM public.timetable_bell_items WHERE org_code = %s) AS v",
                                  (org,)).fetchone()["v"]
        if body.day_of_week is not None and not configured:
            # First customisation is a single weekday: keep the built-in bell as the default for the other days.
            conn.execute("INSERT INTO public.timetable_bell_items(org_code, day_of_week, item_kind, period_number, label, "
                         "start_time, end_time) SELECT %s, NULL, item_kind, period_number, label, start_time, end_time "
                         "FROM public.usp_bell_schedule(%s)", (org, org))
        conn.execute("DELETE FROM public.timetable_bell_items WHERE org_code = %s AND day_of_week IS NOT DISTINCT FROM %s",
                     (org, body.day_of_week))
        for i in body.items:
            conn.execute("INSERT INTO public.timetable_bell_items(org_code, day_of_week, item_kind, period_number, label, "
                         "start_time, end_time) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                         (org, body.day_of_week, i.item_kind, i.period_number, (i.label or "").strip() or None,
                          i.start_time, i.end_time))
    return tt.bell_schedule(org)


# ---------------------------------------------------------------- rooms master (5.3 room clashes)
class RoomBody(BaseModel):
    room_code: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9][A-Za-z0-9 ._\-/]*$")
    room_name: str | None = Field(default=None, max_length=120)
    room_type: RoomType = "CLASSROOM"
    capacity: int | None = Field(default=None, gt=0, le=10_000)
    is_active: bool = True

    @field_validator("room_code")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


@router.get("/rooms")
def list_rooms(org_code: str | None = None, user: CurrentUser = Depends(admins)):
    return {"rooms": db.fetch_all("SELECT room_id, room_code, room_name, room_type, capacity, is_active FROM public.rooms "
                                  "WHERE org_code = %s ORDER BY upper(room_code)", (org_scope(user, org_code),))}


@router.post("/rooms", status_code=status.HTTP_201_CREATED)
def create_room(body: RoomBody, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    return db.fetch_one("INSERT INTO public.rooms(org_code, room_code, room_name, room_type, capacity, is_active, created_by) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING room_id, room_code, room_name, room_type, capacity, is_active",
                        (org, body.room_code, body.room_name, body.room_type, body.capacity, body.is_active, user.user_code))


@router.put("/rooms/{room_id}")
def update_room(room_id: str, body: RoomBody, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Renaming a room also renames it on the weekly timetable, dated sessions and class home rooms."""
    org = org_scope(user, org_code)
    with db.connection() as conn:
        old = conn.execute("SELECT room_code FROM public.rooms WHERE org_code = %s AND room_id::text = %s",
                           (org, room_id)).fetchone()
        if not old:
            raise HTTPException(404, "Room not found")
        row = conn.execute("UPDATE public.rooms SET room_code = %s, room_name = %s, room_type = %s, capacity = %s, "
                           "is_active = %s WHERE org_code = %s AND room_id::text = %s "
                           "RETURNING room_id, room_code, room_name, room_type, capacity, is_active",
                           (body.room_code, body.room_name, body.room_type, body.capacity, body.is_active, org,
                            room_id)).fetchone()
        if old["room_code"] != body.room_code:
            for table in ("timetable_slots", "timetable_dated_entries", "classes"):
                conn.execute(f"UPDATE public.{table} SET room_number = %s "  # noqa: S608 - fixed table names
                             "WHERE org_code = %s AND upper(btrim(room_number)) = upper(%s)",
                             (body.room_code, org, old["room_code"]))
    return row


@router.delete("/rooms/{room_id}")
def delete_room(room_id: str, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Removes the room from the picklist. Periods that name it keep their room text (and its clash checks)."""
    org = org_scope(user, org_code)
    row = db.fetch_one("DELETE FROM public.rooms WHERE org_code = %s AND room_id::text = %s RETURNING room_id",
                       (org, room_id))
    if not row:
        raise HTTPException(404, "Room not found")
    return {"deleted": room_id}
