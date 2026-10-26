"""Attendance maths shared by the teacher register, the student view and admin summaries (FR-T3-02).

Percentage = (present + late) / (marked sessions - excused) x 100. Excused sessions don't count against
the student; a student with no countable sessions has no percentage (None) rather than 0%.
"""
from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from typing import Iterable

STATUSES = ("present", "absent", "late", "excused")


def month_bounds(month: str) -> tuple[date, date]:
    """'2026-10' -> (2026-10-01, 2026-10-31). Raises ValueError on bad input."""
    try:
        y, m = (int(x) for x in month.split("-", 1))
        first = date(y, m, 1)
    except (ValueError, TypeError) as e:
        raise ValueError("month must look like YYYY-MM") from e
    return first, date(y, m, calendar.monthrange(y, m)[1])


def tally(statuses: Iterable[str]) -> dict:
    c = {s: 0 for s in STATUSES}
    for s in statuses:
        if s in c:
            c[s] += 1
    total = sum(c.values())
    countable = total - c["excused"]
    pct = round(100 * (c["present"] + c["late"]) / countable, 1) if countable else None
    return {**c, "total": total, "percentage": pct}


def monthly_register(roster: list[dict], marks: list[dict], first: date, last: date, threshold: float) -> dict:
    """Pivot raw marks into a students x days grid with per-student and per-day totals (any date range)."""
    by_student: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    sessions: set[tuple[str, str]] = set()
    for m in marks:
        d = m["attendance_date"].isoformat()
        by_student[m["student_user_code"]][d].append(m["status"])
        sessions.add((d, m["session_slot"]))

    days = [date.fromordinal(o).isoformat() for o in range(first.toordinal(), last.toordinal() + 1)]
    marked_days = sorted({d for d, _ in sessions})
    students = []
    for r in roster:
        cells = by_student.get(r["user_code"], {})
        summary = tally(s for sts in cells.values() for s in sts)
        students.append({
            "student_user_code": r["user_code"],
            "full_name": r["full_name"],
            "roll_number": r.get("roll_number"),
            "days": {d: sts for d, sts in cells.items()},
            **summary,
            "is_defaulter": summary["percentage"] is not None and summary["percentage"] < threshold,
        })
    day_totals = {d: tally(s for st in students for s in st["days"].get(d, [])) for d in marked_days}
    pcts = [s["percentage"] for s in students if s["percentage"] is not None]
    return {
        "from": first.isoformat(),
        "to": last.isoformat(),
        "days": days,
        "marked_days": marked_days,
        "sessions_held": len(sessions),
        "threshold": threshold,
        "students": students,
        "day_totals": day_totals,
        "class_average": round(sum(pcts) / len(pcts), 1) if pcts else None,
        "defaulters": [s["student_user_code"] for s in students if s["is_defaulter"]],
    }


def student_view(subjects: list[dict], marks: list[dict], month: str, threshold: float) -> dict:
    """Subject-wise attendance for one student: the selected month in detail + a month-by-month trend.

    `marks` cover the whole academic window; `subjects` = [{subject_code, subject_name}] of the class.
    """
    names = {s["subject_code"]: s["subject_name"] for s in subjects}
    for m in marks:  # subjects with marks but since removed from the class still show
        names.setdefault(m["subject_code"], m["subject_code"])

    first, last = month_bounds(month)
    out = []
    for code, name in names.items():
        mine = [m for m in marks if m["subject_code"] == code]
        in_month = [m for m in mine if first <= m["attendance_date"] <= last]
        by_month: dict[str, list[str]] = defaultdict(list)
        for m in mine:
            by_month[m["attendance_date"].strftime("%Y-%m")].append(m["status"])
        overall = tally(m["status"] for m in mine)
        out.append({
            "subject_code": code,
            "subject_name": name,
            "month": tally(m["status"] for m in in_month),
            "overall": overall,
            "is_below_threshold": overall["percentage"] is not None and overall["percentage"] < threshold,
            "records": [
                {"date": m["attendance_date"].isoformat(), "session_slot": m["session_slot"],
                 "status": m["status"], "remarks": m.get("remarks")}
                for m in in_month
            ],
            "trend": [{"month": k, **tally(v)} for k, v in sorted(by_month.items())],
        })
    out.sort(key=lambda s: s["subject_code"])
    month_all = tally(m["status"] for m in marks if first <= m["attendance_date"] <= last)
    return {
        "month": month,
        "threshold": threshold,
        "summary": month_all,
        "overall": tally(m["status"] for m in marks),
        "subjects": out,
        "months": sorted({m["attendance_date"].strftime("%Y-%m") for m in marks} | {month}),
    }
