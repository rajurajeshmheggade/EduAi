"""Virtual Labs (Classes 6-12): DIKSHA virtual-lab experiments assigned by teachers and performed by students.

Teacher                                              Student
GET    /catalog                                      GET  /my
GET    /collections/{cid}                            GET  /my/{id}
GET    /collections/{cid}/labs/{lab}                 POST /my/{id}/start
POST   /collections/{cid}/labs/{lab}/worksheet       POST /my/{id}/activity    time in the lab (server-capped)
GET    /assignments          POST /assignments       PUT  /my/{id}/work        autosave of the lab record
GET    /assignments/{id}     PATCH / DELETE          POST /my/{id}/submit      MCQs marked + AI feedback
GET    /assignments/{id}/attempts/{student}          POST /my/{id}/ask         AI lab assistant
POST   /assignments/{id}/attempts/{student}/review   POST /my/{id}/video-progress  parts of a lab video really played

Experiments are read live from DIKSHA (cached); an assignment stores a metadata snapshot of the experiment. Everything
runs inside the LMS (simulations, PDFs and videos streamed from the source host); resources that cannot be shown in-app
(e.g. a NonCommercial licence the institution has not approved) are not listed at all. A lab with video(s) can be
submitted only after every video was watched to the end (services.virtual_labs.video), enforced here on submit.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..config import get_settings
from ..security import CurrentUser, require_role
from ..services.diksha import access as acc
from ..services.virtual_labs import catalog, labs
from ..services.virtual_labs import video as vid
from ..services.virtual_labs import worksheet as wsx
from ..services.virtual_labs.worksheet import Worksheet
from .diksha import _tree, validate_or_422
from .library import _teacher_targets

router = APIRouter(prefix="/ICMELive/api/v1/virtual-labs", tags=["virtual-labs"])
staff = require_role("teacher", "orgadmin", "superadmin")
teachers = require_role("teacher")
students = require_role("student")

MAX_BEAT_SECONDS = 60   # one activity report never adds more than this, nor more than the wall-clock time since the last


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt


# ---------------------------------------------------------------- catalogue helpers
def _entries(collection_id: str) -> list[catalog.Collection]:
    validate_or_422(collection_id)
    rows = catalog.entries(collection_id)
    if not rows:
        raise HTTPException(404, "Not a virtual-lab collection")
    return rows


def _entry(rows: list[catalog.Collection], medium: str | None = None, grade: int | None = None) -> catalog.Collection:
    return next((r for r in rows if (not medium or r["medium"].lower() == medium.lower()) and (not grade or r["class_number"] == grade)),
                rows[0])


def _lab(collection_id: str, lab_id: str, medium: str | None = None) -> tuple[dict, dict, dict]:
    """(experiment, collection info, tree) of a catalogued collection, read live from DIKSHA."""
    rows = _entries(collection_id)
    validate_or_422(lab_id)
    tree = _tree(collection_id)
    lab = labs.find(tree, lab_id)
    if not lab:
        if any(u["id"] == lab_id for u in tree["units"]):
            raise HTTPException(404, "None of this experiment's resources can be shown in the app")
        raise HTTPException(404, "This experiment is not part of that lab collection")
    return lab, labs.collection_info(tree["book"], _entry(rows, medium)), tree


def _targets(user: CurrentUser) -> list[dict]:
    return _teacher_targets(user) if user.role == "teacher" else []


# ---------------------------------------------------------------- windows & views
def _window(a: dict) -> dict:
    now = _now()
    if a["status"] == "closed":
        state = "closed"
    elif a["available_from"] and a["available_from"] > now:
        state = "scheduled"
    elif a["due_at"] and a["due_at"] < now:
        state = "late" if a["allow_late"] else "overdue"
    else:
        state = "open"
    return {"state": state, "can_work": state in ("open", "late")}


ASSIGNMENT_FIELDS = ("assignment_id", "class_code", "class_name", "subject_code", "subject_name", "teacher_code", "teacher_name",
                     "collection_id", "lab_id", "title", "instructions", "max_marks", "min_minutes", "available_from", "due_at",
                     "allow_late", "status", "created_at")


def _assignment_view(a: dict) -> dict:
    lab = labs.shown(a["lab"])
    return {**{k: a.get(k) for k in ASSIGNMENT_FIELDS}, "window": _window(a), "lab_name": lab["name"],
            "lab_class": (lab.get("collection") or {}).get("class_number"), "has_simulation": lab.get("has_simulation", False),
            "lab_roles": lab.get("roles") or {}, "videos_required": len(labs.videos(a["lab"]))}


def _video_rows(attempt_id) -> dict[str, dict]:
    rows = db.fetch_all("SELECT * FROM public.virtual_lab_video_progress WHERE attempt_id = %s", (attempt_id,))
    return {r["resource_id"]: r for r in rows}


def _videos_of(a: dict, t: dict | None) -> list[dict]:
    """The lab's required videos with this attempt's progress (None when not started)."""
    rows = _video_rows(t["attempt_id"]) if t else {}
    return [{"resource_id": r["source_id"], "name": r.get("name"), "progress": vid.view(rows.get(r["source_id"]))}
            for r in labs.videos(a["lab"])]


def _attempt_view(t: dict | None, *, reveal: bool, a: dict | None = None) -> dict | None:
    if not t:
        return None
    done = t["status"] in ("submitted", "reviewed")
    out = {k: t[k] for k in ("status", "started_at", "active_seconds", "launches", "steps_done", "observations", "answers",
                             "conclusion", "submitted_at", "is_late", "returned_count", "updated_at", "proctor_flag_count")}
    out["teacher_feedback"] = t["teacher_feedback"] if t["status"] == "reviewed" or t["returned_count"] else None
    out["result"] = {"auto_score": t["auto_score"], "auto_max": t["auto_max"], "feedback": t["ai_feedback"],
                     "suggested_marks": t["suggested_marks"], "marks": t["marks"] if t["status"] == "reviewed" else None,
                     "reviewed_at": t["reviewed_at"]} if done and reveal else None
    if a is not None:
        out["videos"] = _videos_of(a, t)
    return out


ASSIGNMENT_SELECT = (
    "SELECT a.*, c.class_name, c.grade_number, cs.subject_name, t.full_name AS teacher_name "
    "FROM public.virtual_lab_assignments a "
    "JOIN public.classes c ON c.org_code = a.org_code AND c.class_code = a.class_code "
    "JOIN public.class_subjects cs ON cs.org_code = a.org_code AND cs.class_code = a.class_code AND cs.subject_code = a.subject_code "
    "LEFT JOIN public.app_users t ON t.org_code = a.org_code AND t.user_code = a.teacher_code ")


# ---------------------------------------------------------------- catalogue (teachers, admins)
@router.get("/catalog")
def catalog_index(user: CurrentUser = Depends(staff)):
    s = get_settings()
    return {"enabled": s.diksha_enabled, "classes": catalog.CLASSES, "mediums": catalog.MEDIUMS, "collections": catalog.COLLECTIONS,
            "embed_noncommercial": s.diksha_embed_noncommercial,
            "targets": [{k: t[k] for k in ("class_code", "class_name", "grade_number", "subject_code", "subject_name", "student_count")}
                        for t in _targets(user)]}


@router.get("/collections/{collection_id}")
def collection(collection_id: str, medium: str | None = Query(default=None, max_length=20), user: CurrentUser = Depends(staff)):
    """Experiments of one virtual-lab collection, in DIKSHA's order (resource counts by role, no file details). Only
    experiments with at least one resource that can be shown in-app are listed."""
    rows = _entries(collection_id)
    tree = _tree(collection_id)
    return {"collection": labs.collection_info(tree["book"], _entry(rows, medium)),
            "labs": [labs.summary(x) for x in labs.experiments(tree)],
            "intro": [acc.present(r) for r in tree["resources"] if acc.visible(r)]}


@router.get("/collections/{collection_id}/labs/{lab_id}")
def lab_detail(collection_id: str, lab_id: str, medium: str | None = Query(default=None, max_length=20),
               user: CurrentUser = Depends(staff)):
    """One experiment with every in-app resource and how it is shown (simulation, PDF, video …)."""
    lab, info, _ = _lab(collection_id, lab_id, medium)
    assigned = []
    if user.role == "teacher":
        keys = [f"{t['class_code']}|{t['subject_code']}" for t in _targets(user)]
        assigned = db.fetch_all(
            "SELECT a.assignment_id, a.class_code, c.class_name, a.subject_code, a.title, a.due_at, a.status "
            "FROM public.virtual_lab_assignments a JOIN public.classes c ON c.org_code = a.org_code AND c.class_code = a.class_code "
            "WHERE a.org_code = %s AND a.lab_id = %s AND (a.teacher_code = %s OR (a.class_code || '|' || a.subject_code) = ANY(%s)) "
            "ORDER BY a.created_at DESC", (user.org_code, lab_id, user.user_code, keys))
    return {"collection": info, "lab": labs.present(lab), "assigned": assigned}


@router.post("/collections/{collection_id}/labs/{lab_id}/worksheet")
def draft_worksheet(collection_id: str, lab_id: str, medium: str | None = Query(default=None, max_length=20),
                    user: CurrentUser = Depends(teachers)):
    """AI draft of the lab worksheet (aim, steps, observation table, viva questions) for the teacher to edit."""
    lab, info, _ = _lab(collection_id, lab_id, medium)
    ws, engine = wsx.draft({**lab, "collection": info})
    return {"worksheet": ws, "engine": engine, "max_marks": wsx.max_marks(ws)}


# ---------------------------------------------------------------- teacher: assignments
class AssignIn(BaseModel):
    collection_id: str = Field(min_length=5, max_length=100)
    lab_id: str = Field(min_length=5, max_length=100)
    medium: str | None = Field(default=None, max_length=20)
    class_code: str = Field(min_length=1, max_length=64)
    subject_code: str = Field(min_length=1, max_length=64)
    title: str | None = Field(default=None, max_length=300)
    instructions: str | None = Field(default=None, max_length=4000)
    worksheet: Worksheet
    min_minutes: int = Field(default=10, ge=0, le=180)
    available_from: datetime | None = None
    due_at: datetime | None = None
    allow_late: bool = True


def _check_times(available_from: datetime | None, due_at: datetime | None, *, new: bool) -> None:
    if due_at and new and due_at <= _now():
        raise HTTPException(422, "The due date must be in the future")
    if due_at and available_from and available_from >= due_at:
        raise HTTPException(422, "The lab must open before it is due")


@router.post("/assignments", status_code=201)
def assign(body: AssignIn, user: CurrentUser = Depends(teachers)):
    target = next((t for t in _targets(user) if t["class_code"] == body.class_code and t["subject_code"] == body.subject_code), None)
    if not target:
        raise HTTPException(403, "You can assign labs only to subjects you teach or to your own class")
    available_from, due_at = _aware(body.available_from), _aware(body.due_at)
    _check_times(available_from, due_at, new=True)
    rows = _entries(body.collection_id)
    lab, _, tree = _lab(body.collection_id, body.lab_id)
    lab_classes = catalog.classes_of(body.collection_id) | set(tree["book"]["classes"])
    grade = target["grade_number"]
    if grade and lab_classes and grade not in lab_classes:
        raise HTTPException(422, f"This lab is for Class {', '.join(map(str, sorted(lab_classes)))}, "
                                 f"but {target['class_name']} is Class {grade}")
    info = labs.collection_info(tree["book"], _entry(rows, body.medium, grade))
    snap = labs.snapshot(lab, info)
    if not snap["resources"]:
        raise HTTPException(422, "None of this experiment's resources can be shown in the app, so it cannot be assigned")
    ws = body.worksheet.model_dump()
    row = db.fetch_one(
        "INSERT INTO public.virtual_lab_assignments (org_code, class_code, subject_code, year_code, teacher_code, collection_id, lab_id, "
        "lab, title, instructions, worksheet, max_marks, min_minutes, available_from, due_at, allow_late) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING assignment_id",
        (user.org_code, body.class_code, body.subject_code, target["year_code"], user.user_code, body.collection_id, body.lab_id,
         Jsonb(snap), (body.title or "").strip() or lab["name"][:300], (body.instructions or "").strip() or None, Jsonb(ws),
         wsx.max_marks(ws), body.min_minutes, available_from, due_at, body.allow_late))
    return {"assignment_id": row["assignment_id"], "title": (body.title or "").strip() or lab["name"], "class_name": target["class_name"],
            "student_count": target["student_count"], "max_marks": wsx.max_marks(ws)}


@router.get("/assignments")
def assignments(class_code: str | None = Query(default=None, max_length=64), subject_code: str | None = Query(default=None, max_length=64),
                user: CurrentUser = Depends(teachers)):
    keys = [f"{t['class_code']}|{t['subject_code']}" for t in _targets(user)]
    rows = db.fetch_all(
        ASSIGNMENT_SELECT.replace("SELECT a.*,", "SELECT a.*, "
        "(SELECT COUNT(*) FROM public.app_users u WHERE u.org_code = a.org_code AND u.class_code = a.class_code "
        "   AND u.user_role = 'student' AND u.is_active) AS students, "
        "(SELECT COUNT(*) FROM public.virtual_lab_attempts x WHERE x.assignment_id = a.assignment_id) AS started, "
        "(SELECT COUNT(*) FROM public.virtual_lab_attempts x WHERE x.assignment_id = a.assignment_id "
        "   AND x.status IN ('submitted', 'reviewed')) AS submitted, "
        "(SELECT COUNT(*) FROM public.virtual_lab_attempts x WHERE x.assignment_id = a.assignment_id AND x.status = 'reviewed') AS reviewed, "
        "(SELECT ROUND(AVG(x.marks * 100 / NULLIF(a.max_marks, 0)), 1) FROM public.virtual_lab_attempts x "
        "   WHERE x.assignment_id = a.assignment_id AND x.status = 'reviewed') AS average_pct, "
        "(SELECT COALESCE(SUM(x.proctor_flag_count), 0) FROM public.virtual_lab_attempts x WHERE x.assignment_id = a.assignment_id) AS proctor_flags,")
        + "WHERE a.org_code = %s AND (a.teacher_code = %s OR (a.class_code || '|' || a.subject_code) = ANY(%s)) "
          "AND (%s::text IS NULL OR a.class_code = %s::text) AND (%s::text IS NULL OR a.subject_code = %s::text) "
          "ORDER BY a.created_at DESC",
        (user.org_code, user.user_code, keys, class_code, class_code, subject_code, subject_code))
    return {"assignments": [{**_assignment_view(r), **{k: r[k] for k in ("students", "started", "submitted", "reviewed", "average_pct", "proctor_flags")}}
                            for r in rows]}


def _manageable(user: CurrentUser, assignment_id: UUID) -> dict:
    a = db.fetch_one(ASSIGNMENT_SELECT + "WHERE a.assignment_id = %s AND a.org_code = %s", (assignment_id, user.org_code))
    if not a:
        raise HTTPException(404, "Lab assignment not found")
    if a["teacher_code"] != user.user_code and (a["class_code"], a["subject_code"]) not in {
            (t["class_code"], t["subject_code"]) for t in _targets(user)}:
        raise HTTPException(404, "Lab assignment not found")
    return a


@router.get("/assignments/{assignment_id}")
def assignment(assignment_id: UUID, user: CurrentUser = Depends(teachers)):
    """Assignment with the class roster: who has started, time in the lab, submissions and marks."""
    a = _manageable(user, assignment_id)
    video_ids = [r["source_id"] for r in labs.videos(a["lab"])]
    roster = db.fetch_all(
        "SELECT u.user_code AS student_code, u.full_name, u.roll_number, x.status, x.started_at, x.active_seconds, x.launches, "
        "x.submitted_at, x.is_late, x.auto_score, x.auto_max, x.suggested_marks, x.marks, x.returned_count, x.proctor_flag_count, "
        "(SELECT COUNT(*) FROM public.virtual_lab_video_progress v WHERE v.attempt_id = x.attempt_id AND v.completed_at IS NOT NULL "
        "   AND v.resource_id = ANY(%s)) AS videos_watched "
        "FROM public.app_users u LEFT JOIN public.virtual_lab_attempts x ON x.assignment_id = %s AND x.student_code = u.user_code "
        "WHERE u.org_code = %s AND u.class_code = %s AND u.user_role = 'student' AND u.is_active "
        "ORDER BY CASE WHEN u.roll_number ~ '^[0-9]+$' THEN lpad(u.roll_number, 12, '0') ELSE COALESCE(u.roll_number, '~') END, u.full_name",
        (video_ids, assignment_id, user.org_code, a["class_code"]))
    for r in roster:
        r["status"] = r["status"] or "not_started"
        r["videos_required"] = len(video_ids)
    done = [r for r in roster if r["status"] in ("submitted", "reviewed")]
    reviewed = [r for r in roster if r["status"] == "reviewed" and r["marks"] is not None]
    stats = {"students": len(roster), "started": sum(1 for r in roster if r["status"] != "not_started"), "submitted": len(done),
             "reviewed": len(reviewed), "late": sum(1 for r in done if r["is_late"]),
             "average_minutes": round(sum(r["active_seconds"] or 0 for r in done) / len(done) / 60, 1) if done else None,
             "average_pct": round(sum(float(r["marks"]) for r in reviewed) * 100 / len(reviewed) / float(a["max_marks"]), 1)
             if reviewed and a["max_marks"] else None}
    return {**_assignment_view(a), "lab": labs.present(a["lab"]), "worksheet": a["worksheet"], "roster": roster, "stats": stats}


class AssignmentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=300)
    instructions: str | None = Field(default=None, max_length=4000)
    due_at: datetime | None = None
    clear_due: bool = False
    allow_late: bool | None = None
    min_minutes: int | None = Field(default=None, ge=0, le=180)
    status: Literal["active", "closed"] | None = None


@router.patch("/assignments/{assignment_id}")
def update_assignment(assignment_id: UUID, body: AssignmentPatch, user: CurrentUser = Depends(teachers)):
    a = _manageable(user, assignment_id)
    due = None if body.clear_due else (_aware(body.due_at) or a["due_at"])
    if body.due_at:
        _check_times(a["available_from"], due, new=True)
    db.execute(
        "UPDATE public.virtual_lab_assignments SET title = COALESCE(%s, title), instructions = COALESCE(%s, instructions), "
        "due_at = %s, allow_late = COALESCE(%s, allow_late), min_minutes = COALESCE(%s, min_minutes), status = COALESCE(%s, status), "
        "updated_at = NOW() WHERE assignment_id = %s",
        (body.title.strip() if body.title else None, body.instructions, due, body.allow_late, body.min_minutes, body.status, a["assignment_id"]))
    return _assignment_view(_manageable(user, assignment_id))


@router.delete("/assignments/{assignment_id}", status_code=204)
def delete_assignment(assignment_id: UUID, user: CurrentUser = Depends(teachers)):
    a = _manageable(user, assignment_id)
    db.execute("DELETE FROM public.virtual_lab_assignments WHERE assignment_id = %s", (a["assignment_id"],))


def _attempt_of(a: dict, student_code: str) -> dict:
    t = db.fetch_one(
        "SELECT x.*, u.full_name, u.roll_number FROM public.virtual_lab_attempts x "
        "JOIN public.app_users u ON u.org_code = x.org_code AND u.user_code = x.student_code "
        "WHERE x.assignment_id = %s AND x.student_code = %s", (a["assignment_id"], student_code))
    if not t:
        raise HTTPException(404, "This student has not started the lab")
    return t


@router.get("/assignments/{assignment_id}/attempts/{student_code}")
def attempt(assignment_id: UUID, student_code: str, user: CurrentUser = Depends(teachers)):
    a = _manageable(user, assignment_id)
    t = _attempt_of(a, student_code)
    return {"student": {"student_code": student_code, "full_name": t["full_name"], "roll_number": t["roll_number"]},
            "attempt": {**_attempt_view(t, reveal=True, a=a), "result": {
                "auto_score": t["auto_score"], "auto_max": t["auto_max"], "feedback": t["ai_feedback"],
                "suggested_marks": t["suggested_marks"], "marks": t["marks"], "reviewed_at": t["reviewed_at"]},
                "teacher_feedback": t["teacher_feedback"]},
            "worksheet": a["worksheet"], "max_marks": a["max_marks"], "min_minutes": a["min_minutes"], "title": a["title"]}


class ReviewIn(BaseModel):
    marks: float | None = Field(default=None, ge=0)
    feedback: str | None = Field(default=None, max_length=4000)
    return_for_redo: bool = False


@router.post("/assignments/{assignment_id}/attempts/{student_code}/review")
def review(assignment_id: UUID, student_code: str, body: ReviewIn, user: CurrentUser = Depends(teachers)):
    """Final marks + feedback, or send the lab back to the student to redo (with feedback)."""
    a = _manageable(user, assignment_id)
    t = _attempt_of(a, student_code)
    if t["status"] not in ("submitted", "reviewed"):
        raise HTTPException(409, "The student has not submitted this lab yet")
    feedback = (body.feedback or "").strip() or None
    if body.return_for_redo:
        if not feedback:
            raise HTTPException(422, "Tell the student what to redo")
        db.execute("UPDATE public.virtual_lab_attempts SET status = 'in_progress', teacher_feedback = %s, marks = NULL, "
                   "submitted_at = NULL, is_late = FALSE, returned_count = returned_count + 1, reviewed_at = NULL, reviewed_by = %s, "
                   "updated_at = NOW() WHERE attempt_id = %s", (feedback, user.user_code, t["attempt_id"]))
        return {"status": "in_progress", "returned": True}
    if body.marks is None:
        raise HTTPException(422, "Enter the marks")
    if body.marks > float(a["max_marks"]):
        raise HTTPException(422, f"Marks cannot be more than {a['max_marks']}")
    db.execute("UPDATE public.virtual_lab_attempts SET status = 'reviewed', marks = %s, teacher_feedback = %s, reviewed_at = NOW(), "
               "reviewed_by = %s, updated_at = NOW() WHERE attempt_id = %s", (round(body.marks, 2), feedback, user.user_code, t["attempt_id"]))
    return {"status": "reviewed", "marks": round(body.marks, 2)}


# ---------------------------------------------------------------- student
def _my_class(user: CurrentUser) -> dict:
    row = db.fetch_one("SELECT c.class_code, c.year_code FROM public.app_users u "
                       "JOIN public.classes c ON c.org_code = u.org_code AND c.class_code = u.class_code "
                       "WHERE u.org_code = %s AND u.user_code = %s", (user.org_code, user.user_code))
    if not row:
        raise HTTPException(404, "You are not assigned to a class")
    return row


def _my_assignment(user: CurrentUser, assignment_id: UUID) -> dict:
    cls = _my_class(user)
    a = db.fetch_one(ASSIGNMENT_SELECT + "WHERE a.assignment_id = %s AND a.org_code = %s AND a.class_code = %s "
                     "AND a.year_code IS NOT DISTINCT FROM %s", (assignment_id, user.org_code, cls["class_code"], cls["year_code"]))
    if not a:
        raise HTTPException(404, "Lab not found")
    return a


def _mine(a: dict, user: CurrentUser) -> dict | None:
    return db.fetch_one("SELECT * FROM public.virtual_lab_attempts WHERE assignment_id = %s AND student_code = %s",
                        (a["assignment_id"], user.user_code))


def _student_view(a: dict, t: dict | None) -> dict:
    reveal = bool(t and t["status"] in ("submitted", "reviewed"))
    return {"assignment": _assignment_view(a), "lab": labs.present(a["lab"]),
            "worksheet": wsx.for_student(a["worksheet"], reveal), "attempt": _attempt_view(t, reveal=True, a=a)}


@router.get("/my")
def my_labs(user: CurrentUser = Depends(students)):
    cls = _my_class(user)
    rows = db.fetch_all(
        ASSIGNMENT_SELECT.replace("SELECT a.*,", "SELECT a.*, x.status AS my_status, x.active_seconds, x.submitted_at, x.is_late AS my_late, "
                                  "x.marks AS my_marks, x.auto_score, x.auto_max, x.returned_count,")
        + "LEFT JOIN public.virtual_lab_attempts x ON x.assignment_id = a.assignment_id AND x.student_code = %s "
          "WHERE a.org_code = %s AND a.class_code = %s AND a.year_code IS NOT DISTINCT FROM %s "
          "ORDER BY (x.status IS NULL OR x.status = 'in_progress') DESC, a.due_at NULLS LAST, a.created_at DESC",
        (user.user_code, user.org_code, cls["class_code"], cls["year_code"]))
    out = []
    for r in rows:
        status = r["my_status"] or "not_started"
        out.append({**_assignment_view(r), "my": {
            "status": status, "active_seconds": r["active_seconds"] or 0, "submitted_at": r["submitted_at"], "is_late": bool(r["my_late"]),
            "marks": r["my_marks"] if status == "reviewed" else None, "auto_score": r["auto_score"], "auto_max": r["auto_max"],
            "returned": bool(r["returned_count"]) and status == "in_progress"}})
    todo = [x for x in out if x["my"]["status"] in ("not_started", "in_progress") and x["window"]["can_work"]]
    return {"labs": out, "counts": {"to_do": len(todo), "submitted": sum(1 for x in out if x["my"]["status"] == "submitted"),
                                    "reviewed": sum(1 for x in out if x["my"]["status"] == "reviewed")}}


@router.get("/my/{assignment_id}")
def my_lab(assignment_id: UUID, user: CurrentUser = Depends(students)):
    a = _my_assignment(user, assignment_id)
    return _student_view(a, _mine(a, user))


def _workable(a: dict) -> None:
    w = _window(a)
    if not w["can_work"]:
        raise HTTPException(409, {"scheduled": "This lab has not opened yet", "closed": "Your teacher has closed this lab",
                                  "overdue": "The due date has passed and late work is not accepted"}[w["state"]])


@router.post("/my/{assignment_id}/start")
def start(assignment_id: UUID, user: CurrentUser = Depends(students)):
    a = _my_assignment(user, assignment_id)
    if not _mine(a, user):
        _workable(a)
        db.execute("INSERT INTO public.virtual_lab_attempts (assignment_id, org_code, student_code, last_active_at) "
                   "VALUES (%s,%s,%s,NOW()) ON CONFLICT (assignment_id, student_code) DO NOTHING",
                   (a["assignment_id"], user.org_code, user.user_code))
    return _student_view(a, _mine(a, user))


def _open_attempt(a: dict, user: CurrentUser) -> dict:
    t = _mine(a, user)
    if not t:
        raise HTTPException(409, "Start the lab first")
    if t["status"] != "in_progress":
        raise HTTPException(409, "You have already submitted this lab")
    return t


class ActivityIn(BaseModel):
    seconds: int = Field(ge=0, le=120)
    launched: bool = False


@router.post("/my/{assignment_id}/activity")
def activity(assignment_id: UUID, body: ActivityIn, user: CurrentUser = Depends(students)):
    """Time spent in the lab. Each report is capped by the time since the previous one (server clock), so the
    total can never run ahead of real time however often or whatever the client reports."""
    a = _my_assignment(user, assignment_id)
    t = _open_attempt(a, user)
    row = db.fetch_one(
        "UPDATE public.virtual_lab_attempts SET active_seconds = active_seconds + LEAST(%s, %s, "
        "  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(last_active_at, started_at))))::int + 2)), "
        "last_active_at = NOW(), launches = launches + %s, updated_at = NOW() "
        "WHERE attempt_id = %s AND status = 'in_progress' RETURNING active_seconds, launches",
        (body.seconds, MAX_BEAT_SECONDS, 1 if body.launched else 0, t["attempt_id"]))
    if not row:
        raise HTTPException(409, "You have already submitted this lab")
    return {"active_seconds": row["active_seconds"], "launches": row["launches"], "min_seconds": a["min_minutes"] * 60}


@router.post("/my/{assignment_id}/proctor-flag")
def proctor_flag(assignment_id: UUID, user: CurrentUser = Depends(students)):
    """A light camera/mic check flagged something during the lab (see VivaProctor on the frontend: multiple people,
    no one in frame, a phone/laptop/TV in shot, or background noise). Only a running count is kept — no video,
    audio or flag detail — so the teacher can see something was flagged without this becoming a surveillance log."""
    a = _my_assignment(user, assignment_id)
    t = _open_attempt(a, user)
    row = db.fetch_one(
        "UPDATE public.virtual_lab_attempts SET proctor_flag_count = proctor_flag_count + 1, updated_at = NOW() "
        "WHERE attempt_id = %s AND status = 'in_progress' RETURNING proctor_flag_count", (t["attempt_id"],))
    if not row:
        raise HTTPException(409, "You have already submitted this lab")
    return {"flag_count": row["proctor_flag_count"]}


class VideoProgressIn(BaseModel):
    resource_id: str = Field(min_length=5, max_length=100)
    duration: float = Field(gt=0, le=vid.MAX_DURATION, description="Length of the video in seconds, as the player reports it")
    segments: list[tuple[float, float]] = Field(default_factory=list, max_length=400,
                                                description="[start, end] parts actually played (seconds)")
    position: float = Field(default=0, ge=0, le=vid.MAX_DURATION)
    ended: bool = False


@router.post("/my/{assignment_id}/video-progress")
def video_progress(assignment_id: UUID, body: VideoProgressIn, user: CurrentUser = Depends(students)):
    """Record how much of one of the lab's videos the student has really watched (own attempt only). Watched time is
    credited no faster than real time at the top playback speed, so progress cannot be claimed in bulk; the video is
    complete once the end was reached and at least 90% was played. Completion of every video unlocks Submit."""
    a = _my_assignment(user, assignment_id)
    t = _open_attempt(a, user)
    video = next((r for r in labs.videos(a["lab"]) if r["source_id"] == body.resource_id), None)
    if not video:
        raise HTTPException(404, "This video is not part of the lab")
    now = _now()
    with db.connection() as conn:
        row = conn.execute("SELECT * FROM public.virtual_lab_video_progress WHERE attempt_id = %s AND resource_id = %s FOR UPDATE",
                           (t["attempt_id"], body.resource_id)).fetchone()
        if row:
            duration = float(row["duration_seconds"])
            if not vid.duration_matches(duration, body.duration):
                raise HTTPException(422, "The reported video length does not match this video")
        else:
            duration = max(body.duration, vid.catalogue_duration(video) or 0)
        segments = vid.merge(list(row["segments"] if row else []) + [list(x) for x in body.segments], duration)
        watched = vid.credit(previous=float(row["watched_seconds"]) if row else 0.0, coverage=vid.covered(segments),
                             last_update=_aware(row["updated_at"]) if row else None, now=now)
        reached_end = bool(row and row["reached_end"]) or (body.ended and body.position >= duration - max(3.0, 0.02 * duration))
        complete = (row and row["completed_at"] is not None) or vid.is_complete(watched=watched, duration=duration, reached_end=reached_end)
        out = conn.execute(
            "INSERT INTO public.virtual_lab_video_progress (attempt_id, resource_id, duration_seconds, segments, watched_seconds, "
            "last_position, reached_end, completed_at, reports, created_at, updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1,%s,%s) "
            "ON CONFLICT (attempt_id, resource_id) DO UPDATE SET segments = EXCLUDED.segments, watched_seconds = EXCLUDED.watched_seconds, "
            "last_position = EXCLUDED.last_position, reached_end = EXCLUDED.reached_end, "
            "completed_at = COALESCE(public.virtual_lab_video_progress.completed_at, EXCLUDED.completed_at), "
            "reports = public.virtual_lab_video_progress.reports + 1, updated_at = EXCLUDED.updated_at RETURNING *",
            (t["attempt_id"], body.resource_id, duration, Jsonb(segments), watched, min(body.position, duration), reached_end,
             now if complete else None, now, now)).fetchone()
    progress = vid.view(out)
    videos = _videos_of(a, t)
    return {**progress, "videos_done": sum(1 for v in videos if v["progress"] and v["progress"]["completed"]), "videos_required": len(videos)}


def _videos_left(a: dict, t: dict) -> list[dict]:
    return [v for v in _videos_of(a, t) if not (v["progress"] and v["progress"]["completed"])]


class WorkIn(BaseModel):
    steps_done: list[int] = Field(default_factory=list, max_length=20)
    observations: list[list[str]] = Field(default_factory=list, max_length=wsx.MAX_ROWS)
    answers: dict[str, int | str] = Field(default_factory=dict)
    conclusion: str | None = Field(default=None, max_length=4000)

    @field_validator("observations")
    @classmethod
    def _cells(cls, v: list[list[str]]) -> list[list[str]]:
        if any(len(r) > 8 or any(len(c) > 200 for c in r) for r in v):
            raise ValueError("observation rows have at most 8 cells of 200 characters")
        return v


def _clean_work(ws: dict, body: WorkIn) -> dict:
    qs = {q["id"]: q for q in ws.get("questions") or []}
    answers: dict = {}
    for k, v in body.answers.items():
        q = qs.get(k)
        if not q:
            raise HTTPException(422, f"Unknown question {k}")
        if q["type"] == "mcq":
            if not isinstance(v, int) or not 0 <= v < len(q["options"]):
                raise HTTPException(422, f"Choose one of the options for {k}")
        elif not isinstance(v, str) or len(v) > 3000:
            raise HTTPException(422, f"Answer {k} must be text of at most 3000 characters")
        answers[k] = v
    n_steps = len(ws.get("steps") or [])
    cols = len(ws.get("observation_columns") or [])
    return {"steps_done": sorted({i for i in body.steps_done if 0 <= i < n_steps}),
            "observations": [[c.strip() for c in r[:cols]] for r in body.observations[: max(ws.get("observation_rows") or 0, 0) + 5]] if cols else [],
            "answers": answers, "conclusion": (body.conclusion or "").strip() or None}


def _save(t: dict, work: dict) -> dict:
    return db.fetch_one(
        "UPDATE public.virtual_lab_attempts SET steps_done = %s, observations = %s, answers = %s, conclusion = %s, updated_at = NOW() "
        "WHERE attempt_id = %s AND status = 'in_progress' RETURNING updated_at",
        (Jsonb(work["steps_done"]), Jsonb(work["observations"]), Jsonb(work["answers"]), work["conclusion"], t["attempt_id"]))


@router.put("/my/{assignment_id}/work")
def save_work(assignment_id: UUID, body: WorkIn, user: CurrentUser = Depends(students)):
    a = _my_assignment(user, assignment_id)
    _workable(a)
    t = _open_attempt(a, user)
    row = _save(t, _clean_work(a["worksheet"], body))
    if not row:
        raise HTTPException(409, "You have already submitted this lab")
    return {"saved_at": row["updated_at"]}


@router.post("/my/{assignment_id}/submit")
def submit(assignment_id: UUID, body: WorkIn, user: CurrentUser = Depends(students)):
    """Final save, video-completion and minimum-time checks, MCQs marked, AI feedback on short answers and the record."""
    a = _my_assignment(user, assignment_id)
    _workable(a)
    t = _open_attempt(a, user)
    left = _videos_left(a, t)
    if left:
        total = len(labs.videos(a["lab"]))
        raise HTTPException(409, "Watch the full video to unlock Submit" if total == 1
                            else f"Watch all {total} videos to the end to unlock Submit ({len(left)} still to finish)")
    need = a["min_minutes"] * 60
    if t["active_seconds"] < need:
        left = max(1, -(-(need - t["active_seconds"]) // 60))
        plural = lambda n: f"{n} minute{'s' if n != 1 else ''}"  # noqa: E731
        raise HTTPException(409, f"Spend at least {plural(a['min_minutes'])} in the lab before submitting ({plural(left)} more to go)")
    work = _clean_work(a["worksheet"], body)
    _save(t, work)
    result = wsx.evaluate(a["lab"], a["worksheet"], work)
    late = bool(a["due_at"] and a["due_at"] < _now())
    row = db.fetch_one(
        "UPDATE public.virtual_lab_attempts SET status = 'submitted', submitted_at = NOW(), is_late = %s, auto_score = %s, auto_max = %s, "
        "ai_feedback = %s, suggested_marks = %s, updated_at = NOW() WHERE attempt_id = %s AND status = 'in_progress' RETURNING attempt_id",
        (late, result["auto_score"], result["auto_max"], Jsonb(result["feedback"]), result["suggested_marks"], t["attempt_id"]))
    if not row:
        raise HTTPException(409, "You have already submitted this lab")
    return _student_view(a, _mine(a, user))


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    history: list[Message] = Field(default_factory=list, max_length=12)


@router.post("/my/{assignment_id}/ask")
def ask(assignment_id: UUID, body: AskIn, user: CurrentUser = Depends(students)):
    """AI lab assistant: hints and explanations for this experiment, without giving away the worksheet answers."""
    a = _my_assignment(user, assignment_id)
    if not _mine(a, user):
        raise HTTPException(409, "Start the lab first")
    answer, engine = wsx.assist(a["lab"], a["worksheet"], body.question.strip(), [m.model_dump() for m in body.history])
    return {"answer": answer, "engine": engine}
