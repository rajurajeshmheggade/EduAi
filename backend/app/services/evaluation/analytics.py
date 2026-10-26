"""FR-EV-11/12: teacher dashboard analytics and the student report (rank, percentile, grade)."""
from __future__ import annotations

import re
import statistics
from collections import Counter
from uuid import UUID

from ... import db

DONE = ("EVALUATED", "REVIEWED")
GRADES = [(90, "A+"), (80, "A"), (70, "B+"), (60, "B"), (50, "C"), (40, "D")]


def grade_for(pct: float, pass_pct: float) -> str:
    if pct < pass_pct:
        return "F"
    return next((g for cut, g in GRADES if pct >= cut), "E")


def _num(x) -> float:
    return float(x) if x is not None else 0.0


def _evaluated(test_id: UUID) -> list[dict]:
    return db.fetch_all(
        "SELECT s.script_id, s.student_user_code, u.full_name AS student_name, u.roll_number, s.uploaded_pdf_filename, "
        "s.total_obtained_marks, s.total_max_marks, s.percentage, s.attempted_questions_count, "
        "s.unanswered_questions_count, s.overall_ai_feedback, s.processing_status "
        "FROM public.evaluation_candidate_scripts s "
        "LEFT JOIN public.app_users u ON u.org_code = s.org_code AND u.user_code = s.student_user_code "
        "WHERE s.eval_test_id = %s AND s.processing_status IN ('EVALUATED','REVIEWED') "
        "ORDER BY s.total_obtained_marks DESC, u.full_name", (test_id,))


def _norm_point(p: str) -> str:
    p = re.sub(r"\(\s*-?\s*\d+(?:\.\d+)?\s*m(?:arks?)?\s*\)", "", str(p), flags=re.I)
    return re.sub(r"\s+", " ", p).strip(" .;,").lower()


def teacher_dashboard(test: dict) -> dict:
    tid, pass_pct = test["eval_test_id"], _num(test["pass_percentage"])
    scripts = _evaluated(tid)
    pcts = [_num(s["percentage"]) for s in scripts]
    marks = [_num(s["total_obtained_marks"]) for s in scripts]
    counts = db.fetch_one(
        "SELECT COUNT(*) AS uploaded, COUNT(*) FILTER (WHERE student_user_code IS NULL) AS unmatched, "
        "COUNT(*) FILTER (WHERE processing_status = 'FAILED') AS failed, "
        "COUNT(*) FILTER (WHERE processing_status IN ('QUEUED','OCR_IN_PROGRESS')) AS in_progress "
        "FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s", (tid,))
    roster = db.fetch_one("SELECT COUNT(*) AS n FROM public.app_users WHERE org_code = %s AND class_code = %s "
                          "AND user_role = 'student' AND is_active", (test["org_code"], test["class_code"]))["n"]

    for rank, s in enumerate(scripts, start=1):
        s["grade"] = grade_for(_num(s["percentage"]), pass_pct)
    rows = db.fetch_all(
        "SELECT r.sl_no, r.is_attempted, r.awarded_marks, r.max_marks, r.missing_points "
        "FROM public.evaluation_slno_results r JOIN public.evaluation_candidate_scripts s ON s.script_id = r.script_id "
        "WHERE r.eval_test_id = %s AND s.processing_status IN ('EVALUATED','REVIEWED')", (tid,))
    masters = db.fetch_all("SELECT sl_no, display_order, question_text, max_marks FROM public.evaluation_master_questions "
                           "WHERE eval_test_id = %s ORDER BY display_order", (tid,))
    by_q: dict[str, list[dict]] = {}
    for r in rows:
        by_q.setdefault(r["sl_no"], []).append(r)

    questions = []
    for m in masters:
        rs = by_q.get(m["sl_no"], [])
        attempted = [r for r in rs if r["is_attempted"]]
        avg = statistics.fmean(_num(r["awarded_marks"]) for r in rs) if rs else None
        common = Counter(_norm_point(p) for r in attempted for p in (r["missing_points"] or []) if _norm_point(p))
        questions.append({
            "sl_no": m["sl_no"], "question_text": m["question_text"], "max_marks": _num(m["max_marks"]),
            "total_candidates": len(rs), "attempted_count": len(attempted), "unanswered_count": len(rs) - len(attempted),
            "attempt_rate": round(100 * len(attempted) / len(rs), 1) if rs else None,
            "not_answered_by_any_student": bool(rs) and not attempted,
            "avg_marks_scored": round(avg, 2) if avg is not None else None,
            "avg_percentage": round(100 * avg / _num(m["max_marks"]), 1) if avg is not None else None,
            "full_marks_count": sum(1 for r in rs if _num(r["awarded_marks"]) >= _num(r["max_marks"])),
            "common_missing_points": [{"point": p, "students": n} for p, n in common.most_common(3)],
        })

    buckets = [(0, 20), (20, 40), (40, 60), (60, 80), (80, 101)]
    return {
        "test": test,
        "submission": submission_progress(test),
        "overview": {
            "class_students": roster, "scripts_uploaded": counts["uploaded"], "unmatched_scripts": counts["unmatched"],
            "failed_scripts": counts["failed"], "in_progress": counts["in_progress"],
            "total_students_evaluated": len(scripts),
            "total_max_marks": _num(test["total_max_marks"]),
            "class_average_marks": round(statistics.fmean(marks), 2) if marks else None,
            "class_average_percentage": round(statistics.fmean(pcts), 2) if pcts else None,
            "median_percentage": round(statistics.median(pcts), 2) if pcts else None,
            "highest_marks": max(marks) if marks else None, "lowest_marks": min(marks) if marks else None,
            "pass_percentage": pass_pct, "passed": sum(1 for p in pcts if p >= pass_pct),
            "pass_rate": round(100 * sum(1 for p in pcts if p >= pass_pct) / len(pcts), 1) if pcts else None,
        },
        "top_scoring_students": scripts[:5],
        "low_scoring_students": sorted([s for s in scripts if _num(s["percentage"]) < pass_pct],
                                       key=lambda s: _num(s["total_obtained_marks"])),
        "question_analytics": questions,
        "unanswered_by_all": [q["sl_no"] for q in questions if q["not_answered_by_any_student"]],
        "most_skipped": sorted([q for q in questions if q["unanswered_count"] > 0],
                               key=lambda q: -q["unanswered_count"])[:5],
        "score_distribution": [{"range": f"{lo}-{min(hi, 100)}%", "students": sum(1 for p in pcts if lo <= p < hi)}
                               for lo, hi in buckets],
        "grade_distribution": dict(Counter(s["grade"] for s in scripts)),
    }


def submission_progress(test: dict) -> dict:
    """FR-DSP-02: enrolled vs submitted vs in-progress vs not submitted (with names) and late submissions."""
    rows = db.fetch_all(
        "SELECT u.user_code, u.full_name, u.roll_number, s.processing_status, s.is_late "
        "FROM public.app_users u LEFT JOIN public.evaluation_candidate_scripts s "
        "ON s.eval_test_id = %s AND s.student_user_code = u.user_code "
        "WHERE u.org_code = %s AND u.class_code = %s AND u.user_role = 'student' AND u.is_active "
        "ORDER BY CASE WHEN u.roll_number ~ '^[0-9]+$' THEN lpad(u.roll_number, 12, '0') ELSE COALESCE(u.roll_number, '~') END",
        (test["eval_test_id"], test["org_code"], test["class_code"]))
    not_submitted = [r for r in rows if r["processing_status"] is None]
    in_progress = [r for r in rows if r["processing_status"] == "IN_PROGRESS"]
    submitted = [r for r in rows if r["processing_status"] not in (None, "IN_PROGRESS")]
    return {
        "enrolled": len(rows), "submitted": len(submitted), "in_progress": len(in_progress),
        "not_submitted": len(not_submitted), "late": sum(1 for r in submitted if r["is_late"]),
        "evaluating": sum(1 for r in submitted if r["processing_status"] in ("UPLOADED", "QUEUED", "OCR_IN_PROGRESS")),
        "not_submitted_students": [{"user_code": r["user_code"], "full_name": r["full_name"], "roll_number": r["roll_number"]}
                                   for r in not_submitted],
        "in_progress_students": [r["full_name"] for r in in_progress],
        "due_at": test.get("due_at"),
    }


def script_report(test: dict, script: dict, signed_url) -> dict:
    """FR-EV-11 student report (also used by teachers / admins)."""
    tid, pass_pct = test["eval_test_id"], _num(test["pass_percentage"])
    others = [_num(s["total_obtained_marks"]) for s in _evaluated(tid)]
    mine = _num(script["total_obtained_marks"])
    done = script["processing_status"] in DONE
    rank = 1 + sum(1 for m in others if m > mine) if done else None
    below = sum(1 for m in others if m < mine)
    percentile = round(100 * below / (len(others) - 1), 1) if done and len(others) > 1 else (100.0 if done else None)
    items = db.fetch_all(
        "SELECT r.slno_result_id, r.sl_no, m.question_type, m.question_text, m.mcq_options, m.correct_option, "
        "m.model_answer_text, m.key_rubric_points, r.is_attempted, "
        "r.student_ocr_text, r.page_numbers, r.semantic_similarity, r.ai_awarded_marks, r.awarded_marks, r.max_marks, "
        "r.why_marks_given, r.missing_points, r.feedback, r.teacher_override, r.teacher_comment "
        "FROM public.evaluation_slno_results r JOIN public.evaluation_master_questions m ON m.master_q_id = r.master_q_id "
        "WHERE r.script_id = %s ORDER BY m.display_order", (script["script_id"],))
    pct = _num(script["percentage"])
    student = db.fetch_one("SELECT full_name, roll_number, class_code FROM public.app_users WHERE org_code = %s "
                           "AND user_code = %s", (script["org_code"], script["student_user_code"])) or {}
    return {
        "summary": {
            "eval_test_id": tid, "test_title": test["test_title"], "evaluation_scope": test["evaluation_scope"],
            "chapter_title": test["chapter_title"], "subject_code": test["subject_code"], "exam_date": test["exam_date"],
            "student_user_code": script["student_user_code"], "student_name": student.get("full_name"),
            "roll_number": student.get("roll_number"), "uploaded_pdf_filename": script["uploaded_pdf_filename"],
            "script_url": signed_url(script["script_key"]), "page_count": script["page_count"],
            "ocr_method": script["ocr_method"], "processing_status": script["processing_status"],
            "total_obtained_marks": mine, "total_max_marks": _num(script["total_max_marks"]), "percentage": pct,
            "grade": grade_for(pct, pass_pct) if done else None, "passed": pct >= pass_pct if done else None,
            "rank": rank, "out_of": len(others), "percentile": percentile,
            "attempted_questions_count": script["attempted_questions_count"],
            "unanswered_questions_count": script["unanswered_questions_count"],
            "overall_ai_feedback": script["overall_ai_feedback"], "error": script.get("error"),
            "assessment_type": test.get("assessment_type", "OFFLINE_EXAM"),
            "submission_mode": script.get("submission_mode"), "submitted_at": script.get("submitted_at"),
            "is_late": script.get("is_late", False),
        },
        "slno_wise_report": items,
    }
