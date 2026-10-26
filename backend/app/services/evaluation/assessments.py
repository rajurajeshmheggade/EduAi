"""Timing rules for teacher-assigned online tests and assignments (FR-TST-03/04, FR-ASG-02).

Online test: one attempt; deadline = started_at + duration, capped at due_at unless late work is allowed.
Answers are accepted up to a short network grace after the deadline; an attempt left open past its deadline is
submitted automatically with whatever was autosaved (checked lazily whenever the test is looked at).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ... import db
from ...workers.tasks import enqueue

GRACE = timedelta(seconds=60)
DONE = ("EVALUATED", "REVIEWED")


def now() -> datetime:
    return datetime.now(timezone.utc)


def attempt_deadline(test: dict, started_at: datetime) -> datetime:
    end = started_at + timedelta(minutes=int(test["duration_minutes"] or 0))
    if test.get("due_at") and not test.get("allow_late"):
        end = min(end, test["due_at"])
    return end


def window(test: dict) -> dict:
    """Whether a student can start/submit right now, and why not."""
    t = now()
    if not test["is_assigned"]:
        return {"open": False, "reason": "Not assigned"}
    if test.get("available_from") and t < test["available_from"]:
        return {"open": False, "reason": "Not open yet", "opens_at": test["available_from"]}
    if test.get("due_at") and t > test["due_at"] and not test.get("allow_late"):
        return {"open": False, "reason": "Due date has passed", "late": True}
    return {"open": True, "late": bool(test.get("due_at") and t > test["due_at"])}


def results_visible(test: dict, script: dict | None) -> bool:
    if not script or script["processing_status"] not in DONE:
        return False
    return test["status"] == "PUBLISHED" or test.get("results_release") == "INSTANT"


def queue_evaluation(test_id, script_ids: list[str]) -> str:
    job_id = db.call_scalar("usp_create_job", "answer_evaluation", str(test_id))
    enqueue("evaluate_test", test_id=str(test_id), job_id=str(job_id), script_ids=[str(s) for s in script_ids])
    return str(job_id)


def finalize_expired(test: dict) -> int:
    """Auto-submit online-test attempts whose time ran out (timer expiry, closed browser…)."""
    if test.get("assessment_type") != "ONLINE_TEST":
        return 0
    open_attempts = db.fetch_all(
        "SELECT script_id, started_at FROM public.evaluation_candidate_scripts "
        "WHERE eval_test_id = %s AND processing_status = 'IN_PROGRESS'", (test["eval_test_id"],))
    expired = []
    for a in open_attempts:
        deadline = attempt_deadline(test, a["started_at"])
        if now() > deadline + GRACE:
            row = db.fetch_one(
                "UPDATE public.evaluation_candidate_scripts SET processing_status = 'QUEUED', submitted_at = %s, "
                "is_late = (%s::timestamptz IS NOT NULL AND %s > %s::timestamptz) "
                "WHERE script_id = %s AND processing_status = 'IN_PROGRESS' RETURNING script_id",
                (deadline, test.get("due_at"), deadline, test.get("due_at"), a["script_id"]))
            if row:  # another request may have finalised it first
                expired.append(str(row["script_id"]))
    if expired:
        queue_evaluation(test["eval_test_id"], expired)
    return len(expired)
