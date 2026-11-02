"""What an "exam" is in each module, who its assigned teachers are, and what ending it means.

ONLINE_TEST   ref = evaluation_tests.eval_test_id (assigned to the student's class). Teachers: the teacher who created
              the test + the class's subject teacher. Starting = the student begins the timed attempt.
VIRTUAL_LAB   ref = virtual_lab_assignments.assignment_id. Teachers: the assigning teacher + the subject teacher.
              Starting = the student starts (or resumes) the lab.
AI_CLASSROOM  ref = 'nlp/<class>/<subject>/<chapter>' (chapter library) or 'textbook/<subject_code>' (textbook
              classroom). There is no exam entity: starting a proctored *classroom session* on that chapter / subject
              is the "exam". Teachers: the class's subject teacher for that subject, else the class teacher.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from ... import db
from ...security import CurrentUser
from ..evaluation import assessments as test_rules
from ..nlp_catalog import classroom_chapter_pdf_path

AI_CLASSROOM_RECENT_HOURS = 12


def now() -> datetime:
    return datetime.now(timezone.utc)


def section_of(class_code: str | None, class_name: str | None) -> str | None:
    """There is no section column: 'Grade 10 — Section A' / 'Grade-10-A' -> 'A'."""
    m = re.search(r"\bsection\s+([A-Za-z0-9]+)", class_name or "", re.I) or re.search(r"[-\s]([A-Za-z])$", class_code or "")
    return m.group(1).upper() if m else None


def _uuid(ref_id: str) -> UUID:
    try:
        return UUID(ref_id)
    except ValueError:
        raise HTTPException(404, "Exam not found") from None


def _teachers(org: str, codes: list[str | None]) -> list[str]:
    wanted = [c for c in dict.fromkeys(codes) if c]
    if not wanted:
        return []
    rows = db.fetch_all("SELECT user_code FROM public.app_users WHERE org_code = %s AND user_code = ANY(%s) "
                        "AND user_role = 'teacher' AND is_active", (org, wanted))
    have = {r["user_code"] for r in rows}
    return [c for c in wanted if c in have]


def student(user: CurrentUser) -> dict:
    me = db.fetch_one(
        "SELECT u.user_code, u.full_name, u.roll_number, u.class_code, c.class_name, c.year_code, c.class_teacher_code "
        "FROM public.app_users u LEFT JOIN public.classes c ON c.org_code = u.org_code AND c.class_code = u.class_code "
        "WHERE u.org_code = %s AND u.user_code = %s", (user.org_code, user.user_code))
    if not me or not me["class_code"]:
        raise HTTPException(404, "You are not enrolled in a class")
    return me


# ---------------------------------------------------------------- student side: resolve + validate an exam
def resolve_for_student(user: CurrentUser, module: str, ref_id: str) -> dict:
    """The exam the student wants to sit, if they may (404 when not theirs, 409 when it cannot be started now)."""
    me = student(user)
    if module == "ONLINE_TEST":
        t = db.fetch_one(
            "SELECT t.*, cs.subject_name, cs.teacher_code AS subject_teacher FROM public.evaluation_tests t "
            "JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code AND cs.subject_code = t.subject_code "
            "WHERE t.eval_test_id = %s AND t.org_code = %s AND t.class_code = %s AND t.is_assigned AND t.assessment_type = 'ONLINE_TEST'",
            (_uuid(ref_id), user.org_code, me["class_code"]))
        if not t:
            raise HTTPException(404, "Exam not found")
        s = db.fetch_one("SELECT processing_status FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s "
                         "AND student_user_code = %s", (t["eval_test_id"], user.user_code))
        if s and s["processing_status"] != "IN_PROGRESS":
            raise HTTPException(409, "You have already taken this test")
        if not s:
            w = test_rules.window(t)
            if not w["open"]:
                raise HTTPException(409, w["reason"])
        return {"module": module, "ref_id": str(t["eval_test_id"]), "title": t["test_title"], "class_code": me["class_code"],
                "subject_code": t["subject_code"], "teacher_codes": _teachers(user.org_code, [t["created_by"], t["subject_teacher"]])}
    if module == "VIRTUAL_LAB":
        a = db.fetch_one(
            "SELECT a.*, cs.teacher_code AS subject_teacher FROM public.virtual_lab_assignments a "
            "JOIN public.class_subjects cs ON cs.org_code = a.org_code AND cs.class_code = a.class_code AND cs.subject_code = a.subject_code "
            "WHERE a.assignment_id = %s AND a.org_code = %s AND a.class_code = %s AND a.year_code IS NOT DISTINCT FROM %s",
            (_uuid(ref_id), user.org_code, me["class_code"], me["year_code"]))
        if not a:
            raise HTTPException(404, "Exam not found")
        x = db.fetch_one("SELECT status FROM public.virtual_lab_attempts WHERE assignment_id = %s AND student_code = %s",
                         (a["assignment_id"], user.user_code))
        if x and x["status"] != "in_progress":
            raise HTTPException(409, "You have already submitted this lab")
        if not x and not _lab_workable(a):
            raise HTTPException(409, "This lab is not open")
        return {"module": module, "ref_id": str(a["assignment_id"]), "title": a["title"], "class_code": me["class_code"],
                "subject_code": a["subject_code"], "teacher_codes": _teachers(user.org_code, [a["teacher_code"], a["subject_teacher"]])}
    return _classroom(user, me, ref_id)


def _lab_workable(a: dict) -> bool:
    t = now()
    if a["status"] == "closed" or (a["available_from"] and a["available_from"] > t):
        return False
    return not (a["due_at"] and a["due_at"] < t and not a["allow_late"])


def _classroom(user: CurrentUser, me: dict, ref_id: str) -> dict:
    kind, _, rest = ref_id.partition("/")
    subjects = db.fetch_all("SELECT subject_code, subject_name, teacher_code FROM public.class_subjects WHERE org_code = %s "
                            "AND class_code = %s", (user.org_code, me["class_code"]))
    if kind == "nlp":
        parts = rest.split("/", 2)
        if len(parts) != 3 or not all(p.strip() for p in parts) or not classroom_chapter_pdf_path(*parts):
            raise HTTPException(404, "Chapter not found")
        class_label, subject, chapter = parts
        cs = next((s for s in subjects if s["subject_name"].strip().lower() == subject.strip().lower()), None)
        title = f"{chapter} ({subject})"
    elif kind == "textbook":
        cs = next((s for s in subjects if s["subject_code"] == rest), None)
        if not cs or not user.can_access_subject(rest):
            raise HTTPException(404, "Subject not found")
        title = f"{cs['subject_name']} textbook"
    else:
        raise HTTPException(404, "Exam not found")
    teachers = _teachers(user.org_code, [cs["teacher_code"] if cs else None]) or _teachers(user.org_code, [me["class_teacher_code"]])
    return {"module": "AI_CLASSROOM", "ref_id": ref_id, "title": f"AI Classroom · {title}"[:300], "class_code": me["class_code"],
            "subject_code": cs["subject_code"] if cs else None, "teacher_codes": teachers}


# ---------------------------------------------------------------- teacher side
def _assigned_tests(user: CurrentUser, test_id: UUID | None = None) -> list[dict]:
    return db.fetch_all(
        "SELECT t.eval_test_id::text AS ref_id, t.test_title AS title, t.class_code, c.class_name, t.subject_code, cs.subject_name, "
        "t.available_from, t.due_at, t.allow_late, t.is_assigned, t.duration_minutes FROM public.evaluation_tests t "
        "JOIN public.classes c ON c.org_code = t.org_code AND c.class_code = t.class_code "
        "JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code AND cs.subject_code = t.subject_code "
        "WHERE t.org_code = %s AND t.assessment_type = 'ONLINE_TEST' AND t.is_assigned AND (t.created_by = %s OR cs.teacher_code = %s) "
        "AND (%s::uuid IS NULL OR t.eval_test_id = %s::uuid) ORDER BY t.due_at NULLS LAST, t.created_at DESC",
        (user.org_code, user.user_code, user.user_code, test_id, test_id))


def _assigned_labs(user: CurrentUser, assignment_id: UUID | None = None) -> list[dict]:
    return db.fetch_all(
        "SELECT a.assignment_id::text AS ref_id, a.title, a.class_code, c.class_name, a.subject_code, cs.subject_name, "
        "a.available_from, a.due_at, a.allow_late, a.status FROM public.virtual_lab_assignments a "
        "JOIN public.classes c ON c.org_code = a.org_code AND c.class_code = a.class_code "
        "JOIN public.class_subjects cs ON cs.org_code = a.org_code AND cs.class_code = a.class_code AND cs.subject_code = a.subject_code "
        "WHERE a.org_code = %s AND (a.teacher_code = %s OR cs.teacher_code = %s) "
        "AND (%s::uuid IS NULL OR a.assignment_id = %s::uuid) ORDER BY a.due_at NULLS LAST, a.created_at DESC",
        (user.org_code, user.user_code, user.user_code, assignment_id, assignment_id))


def _classroom_groups(user: CurrentUser, ref_id: str | None = None) -> list[dict]:
    return db.fetch_all(
        "SELECT s.ref_id, MAX(s.ref_title) AS title, s.class_code, c.class_name, MAX(s.subject_code) AS subject_code, "
        "MAX(cs.subject_name) AS subject_name FROM public.proctor_sessions s "
        "LEFT JOIN public.classes c ON c.org_code = s.org_code AND c.class_code = s.class_code "
        "LEFT JOIN public.class_subjects cs ON cs.org_code = s.org_code AND cs.class_code = s.class_code AND cs.subject_code = s.subject_code "
        "WHERE s.org_code = %s AND s.module = 'AI_CLASSROOM' AND %s = ANY(s.teacher_codes) "
        "AND (%s::text IS NULL OR s.ref_id = %s::text) "
        "AND (s.status IN ('PRECHECK', 'ACTIVE', 'INTERRUPTED') OR s.updated_at > NOW() - make_interval(hours => %s)) "
        "GROUP BY s.ref_id, s.class_code, c.class_name ORDER BY MAX(s.updated_at) DESC",
        (user.org_code, user.user_code, ref_id, ref_id, AI_CLASSROOM_RECENT_HOURS))


def _ongoing(module: str, e: dict) -> bool:
    if module == "ONLINE_TEST":
        return test_rules.window({**e, "is_assigned": True})["open"]
    if module == "VIRTUAL_LAB":
        return _lab_workable(e)
    return True


def teacher_exams(user: CurrentUser) -> list[dict]:
    """Exams this teacher is assigned to that are open now, or that still have open proctoring sessions."""
    open_refs = {(r["module"], r["ref_id"]) for r in db.fetch_all(
        "SELECT DISTINCT module, ref_id FROM public.proctor_sessions WHERE org_code = %s AND status IN ('PRECHECK', 'ACTIVE', 'INTERRUPTED')",
        (user.org_code,))}
    out = []
    for module, rows in (("ONLINE_TEST", _assigned_tests(user)), ("VIRTUAL_LAB", _assigned_labs(user)),
                         ("AI_CLASSROOM", _classroom_groups(user))):
        for e in rows:
            if module == "AI_CLASSROOM" or _ongoing(module, e) or (module, e["ref_id"]) in open_refs:
                out.append(_header(module, e))
    return out


def exam_for_teacher(user: CurrentUser, module: str, ref_id: str) -> dict:
    """The exam header if this teacher is assigned to it, else 404 (no hint that it exists)."""
    if module == "ONLINE_TEST":
        rows = _assigned_tests(user, _uuid(ref_id))
    elif module == "VIRTUAL_LAB":
        rows = _assigned_labs(user, _uuid(ref_id))
    else:
        rows = _classroom_groups(user, ref_id)
    if not rows:
        raise HTTPException(404, "Exam not found")
    head = _header(module, rows[0])
    head["class_codes"] = sorted({r["class_code"] for r in rows if r["class_code"]})
    return head


def _header(module: str, e: dict) -> dict:
    return {"module": module, "ref_id": e["ref_id"], "title": e["title"], "class_code": e["class_code"], "class_name": e["class_name"],
            "section": section_of(e["class_code"], e["class_name"]), "subject_code": e.get("subject_code"),
            "subject_name": e.get("subject_name"), "due_at": e.get("due_at"), "available_from": e.get("available_from"),
            "duration_minutes": e.get("duration_minutes")}


def can_monitor(user: CurrentUser, session: dict) -> bool:
    if user.user_code in (session.get("teacher_codes") or []):
        return True
    if session["module"] == "AI_CLASSROOM":
        return False
    try:
        exam_for_teacher(user, session["module"], session["ref_id"])
        return True
    except HTTPException:
        return False


def roster(org: str, class_codes: list[str]) -> list[dict]:
    return db.fetch_all(
        "SELECT u.user_code AS student_code, u.full_name, u.roll_number, u.class_code, c.class_name FROM public.app_users u "
        "JOIN public.classes c ON c.org_code = u.org_code AND c.class_code = u.class_code "
        "WHERE u.org_code = %s AND u.class_code = ANY(%s) AND u.user_role = 'student' AND u.is_active "
        "ORDER BY u.class_code, CASE WHEN u.roll_number ~ '^[0-9]+$' THEN lpad(u.roll_number, 12, '0') ELSE COALESCE(u.roll_number, '~') END, "
        "u.full_name", (org, class_codes))


def attempt_states(module: str, ref_id: str) -> dict[str, str]:
    """{student_code: IN_PROGRESS | SUBMITTED} from the module's own records (AI Classroom has none)."""
    if module == "ONLINE_TEST":
        rows = db.fetch_all("SELECT student_user_code AS code, processing_status AS st FROM public.evaluation_candidate_scripts "
                            "WHERE eval_test_id = %s AND student_user_code IS NOT NULL", (_uuid(ref_id),))
        return {r["code"]: "IN_PROGRESS" if r["st"] == "IN_PROGRESS" else "SUBMITTED" for r in rows}
    if module == "VIRTUAL_LAB":
        rows = db.fetch_all("SELECT student_code AS code, status AS st FROM public.virtual_lab_attempts WHERE assignment_id = %s",
                            (_uuid(ref_id),))
        return {r["code"]: "IN_PROGRESS" if r["st"] == "in_progress" else "SUBMITTED" for r in rows}
    return {}


# ---------------------------------------------------------------- side effects on the module's own records
def bump_flag_counter(session: dict, n: int) -> None:
    """Keeps the count-only proctor_flag_count columns (migrations 023 / 024) up to date for the existing screens."""
    if n <= 0:
        return
    if session["module"] == "ONLINE_TEST":
        db.execute("UPDATE public.evaluation_candidate_scripts SET proctor_flag_count = proctor_flag_count + %s "
                   "WHERE eval_test_id = %s AND student_user_code = %s AND processing_status = 'IN_PROGRESS'",
                   (n, session["ref_id"], session["student_code"]))
    elif session["module"] == "VIRTUAL_LAB":
        db.execute("UPDATE public.virtual_lab_attempts SET proctor_flag_count = proctor_flag_count + %s, updated_at = NOW() "
                   "WHERE assignment_id = %s AND student_code = %s AND status = 'in_progress'",
                   (n, session["ref_id"], session["student_code"]))


def end_attempt(session: dict) -> str | None:
    """A teacher ended the session: hand in what the student saved so far. Returns what happened, for the audit."""
    if session["module"] == "ONLINE_TEST":
        t = db.fetch_one("SELECT * FROM public.evaluation_tests WHERE eval_test_id = %s", (session["ref_id"],))
        row = db.fetch_one(
            "UPDATE public.evaluation_candidate_scripts SET processing_status = 'QUEUED', submitted_at = NOW(), "
            "is_late = is_late OR (%s::timestamptz IS NOT NULL AND NOW() > %s::timestamptz) "
            "WHERE eval_test_id = %s AND student_user_code = %s AND processing_status = 'IN_PROGRESS' RETURNING script_id",
            (t["due_at"], t["due_at"], session["ref_id"], session["student_code"])) if t else None
        if row:
            test_rules.queue_evaluation(session["ref_id"], [str(row["script_id"])])
            return "test_submitted"
        return None
    if session["module"] == "VIRTUAL_LAB":
        from ..virtual_labs import worksheet as wsx

        a = db.fetch_one("SELECT * FROM public.virtual_lab_assignments WHERE assignment_id = %s", (session["ref_id"],))
        x = db.fetch_one("SELECT * FROM public.virtual_lab_attempts WHERE assignment_id = %s AND student_code = %s AND status = 'in_progress'",
                         (session["ref_id"], session["student_code"]))
        if not a or not x:
            return None
        work = {"steps_done": x["steps_done"] or [], "observations": x["observations"] or [], "answers": x["answers"] or {},
                "conclusion": x["conclusion"]}
        result = wsx.evaluate(a["lab"], a["worksheet"], work)
        row = db.fetch_one(
            "UPDATE public.virtual_lab_attempts SET status = 'submitted', submitted_at = NOW(), is_late = %s, auto_score = %s, "
            "auto_max = %s, ai_feedback = %s, suggested_marks = %s, updated_at = NOW() WHERE attempt_id = %s AND status = 'in_progress' "
            "RETURNING attempt_id",
            (bool(a["due_at"] and a["due_at"] < now()), result["auto_score"], result["auto_max"], Jsonb(result["feedback"]),
             result["suggested_marks"], x["attempt_id"]))
        return "lab_submitted" if row else None
    return None
