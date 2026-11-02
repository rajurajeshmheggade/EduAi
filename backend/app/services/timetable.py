"""Date-level timetable (spec 5.1-5.4): the weekly template stays the recurring pattern; dated entries add, override
or cancel single periods; holidays and working days apply on top. Everything that shows or checks a timetable on a
date goes through the resolver here (SQL: usp_resolve_timetable) so admin, teacher, student, dashboards and
attendance stay consistent.
"""
from __future__ import annotations

from datetime import date, time, timedelta
from typing import Any, Iterable

import psycopg
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from .. import db

MAX_RANGE_DAYS = 92          # calendar fetches (a month grid is at most 42 days)
MAX_COPY_DAYS = 62           # copy targets per request
ERROR_ORDER = ("NON_WORKING_DAY", "TEACHER_CLASH", "CLASS_CLASH", "ROOM_CLASH")
DAY_NAMES = ("", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def hhmm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t else None


def nice_date(d: date) -> str:
    return d.strftime("%a %d %b %Y")


class Conflict(Exception):
    """Raised inside a write transaction to roll it back and answer 409 with every conflict found."""

    def __init__(self, conflicts: list[dict]):
        super().__init__(conflicts[0]["message"] if conflicts else "Conflict")
        self.conflicts = conflicts


def errors_of(found: Iterable[dict]) -> list[dict]:
    return [c for c in found if c["severity"] == "error"]


def conflict_response(found: list[dict]) -> JSONResponse:
    """409 with a readable `detail` (first error, so existing clients keep working) plus the full `conflicts` list."""
    errs = errors_of(found)
    detail = errs[0]["message"] if errs else "Scheduling conflict"
    if len(errs) > 1:
        detail += f" (+{len(errs) - 1} more conflict{'s' if len(errs) > 2 else ''})"
    return JSONResponse({"detail": detail, "conflicts": jsonable_encoder(found)}, status_code=409)


def check_range(start: date, end: date, limit: int = MAX_RANGE_DAYS) -> None:
    if end < start:
        raise HTTPException(422, "The end date must be on or after the start date")
    if (end - start).days + 1 > limit:
        raise HTTPException(422, f"Pick a range of at most {limit} days")


def week_of(d: date) -> tuple[date, date]:
    mon = d - timedelta(days=d.isoweekday() - 1)
    return mon, mon + timedelta(days=6)


# ---------------------------------------------------------------- reads
def _q(conn: Any, sql: str, args: tuple) -> list[dict]:
    return list(conn.execute(sql, args).fetchall()) if conn is not None else db.fetch_all(sql, args)


def _fmt_session(r: dict) -> dict:
    r["start_time"] = hhmm(r["start_time"])
    r["end_time"] = hhmm(r["end_time"])
    r["session_key"] = f"{r['session_date'].isoformat()}:{r['class_code']}:{r['period_number']}"
    return r


def resolve(org: str, start: date, end: date, class_code: str | None = None, teacher_code: str | None = None,
            student_view: bool = False, conn: Any = None) -> list[dict]:
    """Concrete sessions per date (see usp_resolve_timetable): status SCHEDULED / CANCELLED / HOLIDAY,
    source TEMPLATE / OVERRIDE / DATED."""
    rows = _q(conn, "SELECT * FROM public.usp_resolve_timetable(%s,%s::date,%s::date,%s,%s,%s::boolean)",
              (org, start, end, class_code, teacher_code, student_view))
    return [_fmt_session(r) for r in rows]


def session_at(org: str, class_code: str, d: date, period: int, conn: Any = None) -> dict | None:
    return next((r for r in resolve(org, d, d, class_code, conn=conn) if r["period_number"] == period), None)


def scheduled_today(org: str, today: date, *, class_code: str | None = None, teacher_code: str | None = None) -> list[dict]:
    """What actually happens today for a teacher / class as teachers and students see it: published classes only,
    weekly periods inside their effective range on a working day, dated changes applied, holidays removed."""
    rows = resolve(org, today, today, class_code, teacher_code, student_view=True)
    return [r for r in rows if r["status"] == "SCHEDULED" and (teacher_code is None or r["teacher_code"] == teacher_code)]


def conflicts(org: str, *, class_code: str, period: int, start: time, end: time, teacher_code: str | None,
              room: str | None, is_online: bool, session_date: date | None = None, day: int | None = None,
              effective_from: date | None = None, effective_to: date | None = None, conn: Any = None) -> list[dict]:
    rows = _q(conn, "SELECT * FROM public.usp_timetable_conflicts(%s,%s,%s::smallint,%s::time,%s::time,%s,%s,"
                    "%s::boolean,%s::date,%s::smallint,%s::date,%s::date)",
              (org, class_code, period, start, end, teacher_code, room, is_online, session_date, day,
               effective_from, effective_to))
    for r in rows:
        r["start_time"], r["end_time"] = hhmm(r["start_time"]), hhmm(r["end_time"])
    rank = {k: i for i, k in enumerate(ERROR_ORDER)}
    rows.sort(key=lambda c: (c["severity"] != "error", rank.get(c["kind"], 9), str(c["conflict_date"] or "")))
    return rows


def class_subject(org: str, class_code: str, subject_code: str) -> dict:
    row = db.fetch_one("SELECT subject_code, subject_name, teacher_code FROM public.class_subjects "
                       "WHERE org_code = %s AND class_code = %s AND subject_code = %s", (org, class_code, subject_code))
    if not row:
        raise HTTPException(422, f"{subject_code} is not a subject of {class_code}")
    return row


def holiday_on(org: str, class_code: str, d: date, conn: Any = None) -> str | None:
    rows = _q(conn, "SELECT name FROM public.holidays WHERE org_code = %s AND status = 'PUBLISHED' AND is_full_day "
                    "AND %s::date BETWEEN start_date AND end_date AND (scope = 'SCHOOL_WIDE' OR %s = ANY(class_codes)) "
                    "ORDER BY start_date LIMIT 1", (org, d, class_code))
    return rows[0]["name"] if rows else None


# ---------------------------------------------------------------- settings: working days, bell schedule
def working_days(org: str, conn: Any = None) -> list[int]:
    rows = _q(conn, "SELECT public.usp_working_days(%s) AS v", (org,))
    return sorted(int(d) for d in rows[0]["v"])


def bell_schedule(org: str) -> dict:
    """{configured, default: [...], by_day: {"6": [...]}}; items are periods and named breaks ordered by time."""
    out: dict[str, Any] = {"configured": False, "default": [], "by_day": {}}
    for r in db.call_rows("usp_bell_schedule", org):
        out["configured"] = out["configured"] or r["is_configured"]
        item = {"item_kind": r["item_kind"], "period_number": r["period_number"], "label": r["label"],
                "start_time": hhmm(r["start_time"]), "end_time": hhmm(r["end_time"])}
        if r["day_of_week"] is None:
            out["default"].append(item)
        else:
            out["by_day"].setdefault(str(r["day_of_week"]), []).append(item)
    return out


# ---------------------------------------------------------------- writes
def lock(conn: Any, org: str) -> None:
    conn.execute("SELECT pg_advisory_xact_lock(hashtext('timetable:' || %s))", (org,))


def save_entry(conn: Any, org: str, *, class_code: str, session_date: date, period: int, kind: str,
               subject_code: str | None = None, teacher_code: str | None = None, start: time | None = None,
               end: time | None = None, room: str | None = None, is_online: bool = False,
               online_url: str | None = None, note: str | None = None, user_code: str,
               copied_from: date | None = None, skip_check: bool = True) -> str:
    row = conn.execute(
        "SELECT public.usp_save_dated_entry(%s,%s,%s::date,%s::smallint,%s,%s,%s,%s::time,%s::time,%s,%s::boolean,"
        "%s,%s,%s,%s::date,%s::boolean) AS v",
        (org, class_code, session_date, period, kind, subject_code, teacher_code, start, end, room, is_online,
         online_url, note, user_code, copied_from, skip_check)).fetchone()
    return row["v"]


def cancel_session(conn: Any, org: str, s: dict, note: str | None, user_code: str) -> None:
    """Takes a resolved SCHEDULED session off its date: an extra dated session is deleted; a weekly period (or its
    override) gets a CANCELLED entry for that date."""
    if s["source"] == "DATED":
        conn.execute("DELETE FROM public.timetable_dated_entries WHERE org_code = %s AND entry_id = %s",
                     (org, s["entry_id"]))
    else:
        save_entry(conn, org, class_code=s["class_code"], session_date=s["session_date"], period=s["period_number"],
                   kind="CANCELLED", note=note, user_code=user_code)


def _t(v: str | time | None) -> time | None:
    if v is None or isinstance(v, time):
        return v
    hh, mm = v.split(":")[:2]
    return time(int(hh), int(mm))


def _same(a: dict, b: dict) -> bool:
    keys = ("subject_code", "teacher_code", "start_time", "end_time", "room_number", "is_online", "online_url")
    return all(a.get(k) == b.get(k) for k in keys)


class _Retry(Exception):
    def __init__(self, bad: dict):
        self.bad = bad


def copy_days(org: str, pairs: list[tuple[date, date]], *, class_codes: list[str] | None, teacher_code: str | None,
              mode: str, replace_target: bool, dry_run: bool, user_code: str, report_non_working: bool) -> dict:
    """Copy the resolved sessions of each source date onto its target date, as dated entries.

    Scope: `class_codes` (one or several classes), `teacher_code` (that teacher's sessions) or neither (the whole
    institution). mode 'skip' keeps periods already scheduled on the target; 'overwrite' replaces them.
    `replace_target` (class / institution scope) also cancels the target's other periods, so the day ends up exactly
    like the source. Sessions that would clash with anything on the target date are skipped and reported; the rest
    are written in one transaction (rolled back again for a dry run)."""
    report: dict[str, Any] = {"dry_run": dry_run, "copied": [], "cancelled": [], "skipped": [], "unchanged": 0,
                              "days": 0, "non_working_days_skipped": 0}
    scope = set(class_codes or [])
    with db.connection() as conn:
        lock(conn, org)
        working = set(working_days(org, conn))
        all_classes = [r["class_code"] for r in conn.execute(
            "SELECT class_code FROM public.classes WHERE org_code = %s AND is_active", (org,)).fetchall()]
        try:
            with conn.transaction():
                for src, dst in pairs:
                    if dst.isoweekday() not in working:
                        report["non_working_days_skipped"] += 1
                        if report_non_working:
                            report["skipped"].append({"date": dst, "reason": "NON_WORKING_DAY", "class_code": None,
                                                      "period_number": None, "subject_name": None,
                                                      "message": f"{DAY_NAMES[dst.isoweekday()]} is not a working day",
                                                      "conflicts": []})
                        continue
                    report["days"] += 1
                    _copy_one(conn, org, src, dst, scope, teacher_code, mode, replace_target, user_code, report,
                              all_classes)
                if dry_run:
                    raise psycopg.Rollback()
        except psycopg.Rollback:  # pragma: no cover - swallowed by the transaction block itself
            pass
    return report


def _copy_one(conn: Any, org: str, src: date, dst: date, scope: set[str], teacher: str | None, mode: str,
              replace_target: bool, user_code: str, report: dict, all_classes: list[str]) -> None:
    in_scope = (lambda c: c in scope) if scope else (lambda c: True)
    src_rows = [r for r in resolve(org, src, src, conn=conn)
                if r["status"] == "SCHEDULED" and in_scope(r["class_code"]) and (not teacher or r["teacher_code"] == teacher)]
    dst_rows = resolve(org, dst, dst, conn=conn)
    on_dst = {(r["class_code"], r["period_number"]): r for r in dst_rows}
    holidays = {c: holiday_on(org, c, dst, conn) for c in {r["class_code"] for r in src_rows} | scope}

    def skip(s: dict, reason: str, message: str, found: list[dict] | None = None) -> None:
        report["skipped"].append({"date": dst, "source_date": src, "reason": reason, "class_code": s["class_code"],
                                  "period_number": s["period_number"], "subject_name": s["subject_name"],
                                  "message": message, "conflicts": found or []})

    if not src_rows and not replace_target:
        report["skipped"].append({"date": dst, "source_date": src, "reason": "NOTHING_TO_COPY", "class_code": None,
                                  "period_number": None, "subject_name": None,
                                  "message": f"Nothing is scheduled on {nice_date(src)} for this selection",
                                  "conflicts": []})
        return

    plan: list[tuple[dict, dict | None]] = []
    for s in src_rows:
        if holidays.get(s["class_code"]):
            skip(s, "HOLIDAY", f"{nice_date(dst)} is a holiday ({holidays[s['class_code']]}) for {s['class_code']}")
            continue
        existing = on_dst.get((s["class_code"], s["period_number"]))
        live = existing if existing and existing["status"] == "SCHEDULED" else None
        if live and _same(live, s):
            report["unchanged"] += 1
            continue
        if live and mode == "skip":
            skip(s, "OCCUPIED", f"Period {s['period_number']} of {s['class_code']} already has "
                                f"{live['subject_name'] or 'a session'} on {nice_date(dst)}")
            continue
        plan.append((s, existing))

    if replace_target and not teacher:
        keep = {(s["class_code"], s["period_number"]) for s in src_rows}
        targets = scope or set(all_classes)
        for r in dst_rows:
            key = (r["class_code"], r["period_number"])
            if r["status"] == "SCHEDULED" and r["class_code"] in targets and key not in keep \
                    and not holidays.get(r["class_code"]):
                cancel_session(conn, org, r, f"Replaced by the timetable of {nice_date(src)}", user_code)
                report["cancelled"].append({"date": dst, "class_code": r["class_code"], "period_number": r["period_number"],
                                            "subject_name": r["subject_name"], "start_time": r["start_time"],
                                            "end_time": r["end_time"], "teacher_code": r["teacher_code"],
                                            "teacher_name": r["teacher_name"]})

    # Write the whole plan, then re-check every written session against the final state of the day; anything that
    # still clashes is dropped and the rest rewritten, until the day is consistent.
    while plan:
        try:
            with conn.transaction():
                for s, _ in plan:
                    save_entry(conn, org, class_code=s["class_code"], session_date=dst, period=s["period_number"],
                               kind="SESSION", subject_code=s["subject_code"], teacher_code=s["teacher_code"],
                               start=_t(s["start_time"]), end=_t(s["end_time"]), room=s["room_number"],
                               is_online=s["is_online"], online_url=s["online_url"],
                               note=f"Copied from {nice_date(src)}", user_code=user_code, copied_from=src)
                bad = {}
                for s, _ in plan:
                    errs = errors_of(conflicts(org, class_code=s["class_code"], period=s["period_number"],
                                               start=_t(s["start_time"]), end=_t(s["end_time"]),
                                               teacher_code=s["teacher_code"], room=s["room_number"],
                                               is_online=s["is_online"], session_date=dst, conn=conn))
                    if errs:
                        bad[(s["class_code"], s["period_number"])] = errs
                if bad:
                    raise _Retry(bad)
            break
        except _Retry as e:
            for s, _ in plan:
                found = e.bad.get((s["class_code"], s["period_number"]))
                if found:
                    skip(s, "CONFLICT", found[0]["message"], found)
            plan = [p for p in plan if (p[0]["class_code"], p[0]["period_number"]) not in e.bad]

    for s, existing in plan:
        replaced = existing if existing and existing["status"] == "SCHEDULED" else None
        report["copied"].append({"date": dst, "source_date": src, "class_code": s["class_code"],
                                 "class_name": s["class_name"], "period_number": s["period_number"],
                                 "subject_name": s["subject_name"], "teacher_code": s["teacher_code"],
                                 "teacher_name": s["teacher_name"], "start_time": s["start_time"],
                                 "end_time": s["end_time"], "action": "REPLACED" if replaced else "ADDED",
                                 "replaced": {k: replaced[k] for k in ("subject_name", "teacher_name", "teacher_code",
                                                                      "start_time", "end_time")} if replaced else None})
