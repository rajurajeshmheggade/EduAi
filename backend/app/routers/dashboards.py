"""Role dashboards: one aggregated request per screen (teacher, student, admin) instead of many small calls."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..security import CurrentUser, require_role
from ..services import attendance as att
from ..services.evaluation import analytics
from .admin import list_slots, org_scope

router = APIRouter(prefix="/ICMELive/api/v1/dashboard", tags=["dashboard"])
DONE = ("EVALUATED", "REVIEWED")


def _iso_today() -> tuple[date, int]:
    today = date.today()
    return today, today.isoweekday()


def _pct(rows: list[dict]) -> dict:
    return att.tally(r["status"] for r in rows)


# ---------------------------------------------------------------- teacher
@router.get("/teacher")
def teacher_dashboard(user: CurrentUser = Depends(require_role("teacher"))):
    org, me = user.org_code, user.user_code
    today, dow = _iso_today()
    classes = db.call_rows("usp_teacher_classes", org, me)
    pairs = {(c["class_code"], s["subject_code"]) for c in classes for s in c["subjects"]}

    # Today's periods + whether attendance for that exact period is already saved
    slots = [s for s in list_slots(org, None, me) if s["day_of_week"] == dow]
    marked = {(r["class_code"], r["subject_code"], r["session_slot"]) for r in db.fetch_all(
        "SELECT DISTINCT class_code, subject_code, session_slot FROM public.attendance_records "
        "WHERE org_code = %s AND attendance_date = %s", (org, today))}
    for s in slots:
        s["attendance_marked"] = (s["class_code"], s["subject_code"], f"Period-{s['period_number']}") in marked

    # Homework submissions waiting for this teacher's review
    hw = db.fetch_all(
        "SELECT h.homework_id, h.title, h.class_code, h.subject_code, h.due_date, "
        "COUNT(x.*) FILTER (WHERE x.status = 'SUBMITTED') AS to_review, COUNT(x.*) AS submitted "
        "FROM public.homeworks h LEFT JOIN public.homework_submissions x ON x.homework_id = h.homework_id "
        "WHERE h.org_code = %s AND h.assigned_by = %s GROUP BY h.homework_id ORDER BY h.due_date DESC LIMIT 50", (org, me))
    hw_review = [h for h in hw if h["to_review"]]

    # Tests / assignments / exams for subjects this teacher teaches
    tests = [t for t in db.call_rows("usp_eval_list_tests", org, None, None) if (t["class_code"], t["subject_code"]) in pairs]
    by_test = {r["eval_test_id"]: r for r in db.fetch_all(
        "SELECT eval_test_id, COUNT(*) FILTER (WHERE processing_status = 'FAILED') AS failed, "
        "COUNT(*) FILTER (WHERE student_user_code IS NULL) AS unmatched, "
        "COUNT(*) FILTER (WHERE processing_status IN ('QUEUED','OCR_IN_PROGRESS')) AS evaluating "
        "FROM public.evaluation_candidate_scripts WHERE org_code = %s GROUP BY eval_test_id", (org,))}
    now = datetime.now(timezone.utc)
    active, attention, recent = [], [], []
    for t in tests:
        extra = by_test.get(t["eval_test_id"], {})
        item = {k: t[k] for k in ("eval_test_id", "assessment_type", "test_title", "class_name", "subject_name", "status",
                                  "due_at", "is_assigned", "class_students", "submitted", "evaluated", "average_percentage",
                                  "scripts", "total_questions")}
        if t["is_assigned"] and t["due_at"] and t["due_at"] > now:
            active.append(item)
        reasons = []
        if t["status"] == "DRAFT":
            reasons.append("questions not added")
        if extra.get("failed"):
            reasons.append(f"{extra['failed']} failed to evaluate")
        if extra.get("unmatched"):
            reasons.append(f"{extra['unmatched']} unmatched script(s)")
        if t["assessment_type"] != "OFFLINE_EXAM" and t["status"] in ("READY", "EVALUATED") and not t["is_assigned"]:
            reasons.append("not assigned to the class yet")
        if t["evaluated"] and t["status"] == "EVALUATED" and t["results_release"] == "ON_PUBLISH":
            reasons.append("results not published")
        if reasons:
            attention.append({**item, "reasons": reasons})
        if t["evaluated"]:
            recent.append(item)
    active.sort(key=lambda x: x["due_at"])

    # This month's attendance per class/subject the teacher handles
    first, last = att.month_bounds(today.strftime("%Y-%m"))
    month = []
    for r in db.call_rows("usp_org_attendance_summary", org, first, last):
        if (r["class_code"], r["subject_code"]) in pairs:
            statuses = [s for s in att.STATUSES for _ in range(int(r[s]))]
            month.append({"class_code": r["class_code"], "subject_code": r["subject_code"], "sessions": r["sessions"],
                          **att.tally(statuses)})

    students = sum(c["student_count"] for c in classes)
    return {
        "today": today, "weekday": dow,
        "kpis": {
            "classes": len(classes), "students": students, "periods_today": len(slots),
            "attendance_pending": sum(1 for s in slots if not s["attendance_marked"]),
            "homework_to_review": sum(h["to_review"] for h in hw_review),
            "active_assessments": len(active), "needs_attention": len(attention),
        },
        "classes": classes,
        "today_slots": slots,
        "homework_to_review": hw_review[:6],
        "active_assessments": active[:6],
        "attention": attention[:8],
        "recent_results": recent[:6],
        "attendance_month": month,
    }


# ---------------------------------------------------------------- student
@router.get("/student")
def student_dashboard(user: CurrentUser = Depends(require_role("student"))):
    org = user.org_code
    me = db.call_row("usp_get_member", org, user.user_code)
    if not me or not me["class_code"]:
        raise HTTPException(404, "You are not enrolled in a class")
    today, dow = _iso_today()
    threshold_row = db.fetch_one("SELECT attendance_threshold FROM public.organizations WHERE org_code = %s", (org,))
    threshold = float(threshold_row["attendance_threshold"]) if threshold_row else 75.0

    first, last = att.month_bounds(today.strftime("%Y-%m"))
    year_ago = date(today.year - 1, today.month, 1)
    marks = db.call_rows("usp_student_attendance", org, user.user_code, year_ago, last)
    month = _pct([m for m in marks if first <= m["attendance_date"] <= last])
    overall = _pct(marks)
    by_subject: dict[str, list[dict]] = {}
    for m in marks:
        if first <= m["attendance_date"] <= last:
            by_subject.setdefault(m["subject_code"], []).append(m)

    slots = [s for s in list_slots(org, me["class_code"], None) if s["day_of_week"] == dow]
    homework = [h for h in db.call_rows("usp_student_homework", org, user.user_code) if h["status"] == "PENDING"]
    homework.sort(key=lambda h: h["due_date"])

    # Assigned online tests / assignments, and visible results of every kind
    rows = db.fetch_all(
        "SELECT t.eval_test_id, t.assessment_type, t.test_title, t.subject_code, cs.subject_name, t.due_at, t.available_from, "
        "t.allow_late, t.status, t.results_release, t.pass_percentage, t.duration_minutes, t.is_assigned, t.exam_date, "
        "s.processing_status, s.total_obtained_marks, s.total_max_marks, s.percentage, s.evaluated_at "
        "FROM public.evaluation_tests t JOIN public.class_subjects cs ON cs.org_code = t.org_code "
        "AND cs.class_code = t.class_code AND cs.subject_code = t.subject_code "
        "LEFT JOIN public.evaluation_candidate_scripts s ON s.eval_test_id = t.eval_test_id AND s.student_user_code = %s "
        "WHERE t.org_code = %s AND t.class_code = %s", (user.user_code, org, me["class_code"]))
    now = datetime.now(timezone.utc)
    upcoming, results = [], []
    for r in rows:
        kind = r["assessment_type"]
        if kind != "OFFLINE_EXAM" and r["is_assigned"] and r["processing_status"] in (None, "IN_PROGRESS"):
            open_now = (not r["available_from"] or r["available_from"] <= now) and (
                not r["due_at"] or r["due_at"] >= now or r["allow_late"])
            if open_now or (r["available_from"] and r["available_from"] > now):
                upcoming.append({"eval_test_id": r["eval_test_id"], "assessment_type": kind, "title": r["test_title"],
                                 "subject_name": r["subject_name"], "due_at": r["due_at"], "opens_at": r["available_from"]
                                 if r["available_from"] and r["available_from"] > now else None,
                                 "in_progress": r["processing_status"] == "IN_PROGRESS",
                                 "duration_minutes": r["duration_minutes"]})
        visible = r["processing_status"] in DONE and (
            r["status"] == "PUBLISHED" or (kind != "OFFLINE_EXAM" and r["results_release"] == "INSTANT"))
        if visible:
            pct = float(r["percentage"])
            results.append({"eval_test_id": r["eval_test_id"], "assessment_type": kind, "title": r["test_title"],
                            "subject_name": r["subject_name"], "obtained": r["total_obtained_marks"], "max": r["total_max_marks"],
                            "percentage": pct, "grade": analytics.grade_for(pct, float(r["pass_percentage"])),
                            "date": r["evaluated_at"]})
    upcoming.sort(key=lambda u: (u["opens_at"] is not None, u["due_at"] or now))
    results.sort(key=lambda x: x["date"] or now, reverse=True)
    avg = round(sum(r["percentage"] for r in results) / len(results), 1) if results else None
    names = {s["subject_code"]: s["subject_name"] for s in db.fetch_all(
        "SELECT subject_code, subject_name FROM public.class_subjects WHERE org_code = %s AND class_code = %s",
        (org, me["class_code"]))}

    return {
        "today": today, "weekday": dow, "threshold": threshold, "class_code": me["class_code"],
        "kpis": {"attendance_month": month["percentage"], "attendance_overall": overall["percentage"],
                 "homework_pending": len(homework), "to_do": len(upcoming), "average_score": avg,
                 "results": len(results)},
        "attendance_month": month,
        "attendance_by_subject": [{"subject_code": k, "subject_name": names.get(k, k), **_pct(v)} for k, v in sorted(by_subject.items())],
        "today_slots": slots,
        "homework": homework[:5],
        "upcoming": upcoming[:6],
        "results": results[:6],
        "subjects": [{"subject_code": k, "subject_name": v} for k, v in sorted(names.items())],
    }


# ---------------------------------------------------------------- admin
@router.get("/admin")
def admin_dashboard(org_code: str | None = None, user: CurrentUser = Depends(require_role("orgadmin", "superadmin"))):
    org = org_scope(user, org_code)
    today = date.today()
    since = today - timedelta(days=27)
    daily = db.fetch_all(
        "SELECT attendance_date AS d, COUNT(*) FILTER (WHERE status = 'present') AS present, "
        "COUNT(*) FILTER (WHERE status = 'absent') AS absent, COUNT(*) FILTER (WHERE status = 'late') AS late, "
        "COUNT(*) FILTER (WHERE status = 'excused') AS excused FROM public.attendance_records "
        "WHERE org_code = %s AND attendance_date BETWEEN %s AND %s GROUP BY attendance_date ORDER BY attendance_date",
        (org, since, today))
    trend = []
    for r in daily[-14:]:
        countable = r["present"] + r["absent"] + r["late"]
        trend.append({"date": r["d"], "marks": countable + r["excused"],
                      "percentage": round(100 * (r["present"] + r["late"]) / countable, 1) if countable else None})

    first, last = att.month_bounds(today.strftime("%Y-%m"))
    per_class: dict[str, list[str]] = {}
    for r in db.call_rows("usp_org_attendance_summary", org, first, last):
        per_class.setdefault(r["class_code"], []).extend(s for s in att.STATUSES for _ in range(int(r[s])))
    names = {c["class_code"]: c["class_name"] for c in db.fetch_all(
        "SELECT class_code, class_name FROM public.classes WHERE org_code = %s", (org,))}
    class_attendance = sorted(({"class_code": k, "class_name": names.get(k, k), **att.tally(v)} for k, v in per_class.items()),
                              key=lambda x: x["class_code"])

    assess = db.fetch_one(
        "SELECT COUNT(*) FILTER (WHERE assessment_type = 'ONLINE_TEST') AS online_tests, "
        "COUNT(*) FILTER (WHERE assessment_type = 'ASSIGNMENT') AS assignments, "
        "COUNT(*) FILTER (WHERE assessment_type = 'OFFLINE_EXAM') AS offline_exams, "
        "COUNT(*) FILTER (WHERE is_assigned AND due_at > NOW()) AS open_now "
        "FROM public.evaluation_tests WHERE org_code = %s", (org,))
    scripts = db.fetch_one(
        "SELECT COUNT(*) FILTER (WHERE processing_status IN ('EVALUATED','REVIEWED')) AS evaluated, "
        "COUNT(*) FILTER (WHERE processing_status = 'REVIEWED') AS teacher_reviewed, "
        "ROUND(AVG(percentage) FILTER (WHERE processing_status IN ('EVALUATED','REVIEWED')), 1) AS average_percentage "
        "FROM public.evaluation_candidate_scripts WHERE org_code = %s", (org,))
    recent_users = db.fetch_all(
        "SELECT full_name, user_role, class_code, created_at FROM public.app_users WHERE org_code = %s "
        "AND user_role IN ('teacher','student') ORDER BY created_at DESC LIMIT 6", (org,))
    return {"attendance_trend": trend, "class_attendance": class_attendance,
            "assessments": {**assess, **scripts}, "recent_members": recent_users}
