"""Admission tests — teacher authoring (Teacher → Assessments → Admissions); org admins read only.

GET|POST /tests · GET|PUT /tests/{id} · POST /tests/{id}/publish|unpublish|archive
GET  /question-bank                       questions of the teacher's own Assignments / Online tests (keys included)
POST /tests/{id}/questions/import         snapshot copies of chosen questions
GET  /hq-bank · POST /tests/{id}/questions/from-hq-bank
POST /tests/{id}/questions/draft          AI draft (HQ section or academic gap filling) -> DRAFT items
GET|POST /tests/{id}/questions · PUT /tests/{id}/questions/order · PUT|DELETE /questions/{id}
GET|POST /candidates · PUT|DELETE /candidates/{id} · POST /candidates/import (CSV preview / commit)
"""
from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..security import ADMIN_ROLES, CurrentUser, require_role
from ..services.admission_test import config as cfg
from ..services.admission_test import guard
from ..services.admission_test import questions as qs
from ..services.admission_test.scoring import HQ_TYPES, snapshot
from ..services.storage import get_storage
from .admin import org_scope

router = APIRouter(prefix="/ICMELive/api/v1/admission", tags=["admission-tests"], dependencies=[Depends(guard.no_store)])
teachers = require_role("teacher")
readers = require_role("teacher", "orgadmin", "superadmin")

DEFAULT_SECTIONS = [{"key": "academic", "title": "Academic", "kind": "ACADEMIC"},
                    {"key": "hq", "title": "Human Quotient (HQ)", "kind": "HQ"}]
QUESTION_COLS = ("question_id", "test_id", "section", "qtype", "prompt", "options", "answer_key", "rubric", "model_answer",
                 "marks", "topic", "difficulty", "hq_dimension", "origin", "source_eval_test_id", "source_master_q_id",
                 "source_label", "hq_item_id", "status", "display_order")


# ---------------------------------------------------------------- scoping
def org_of(user: CurrentUser, org_code: str | None = None) -> str:
    return org_scope(user, org_code) if user.role in ADMIN_ROLES else user.org_code


def test_for(user: CurrentUser, test_id: UUID, *, write: bool = False, org_code: str | None = None) -> dict:
    """Teachers: only their own tests. Admins: any test of their org, read only."""
    t = db.fetch_one("SELECT * FROM public.admission_tests WHERE test_id = %s AND org_code = %s", (test_id, org_of(user, org_code)))
    if not t or (user.role == "teacher" and t["created_by"] != user.user_code):
        raise HTTPException(404, "Admission test not found")
    if write and user.role != "teacher":
        raise HTTPException(403, "Admission tests are changed by the teacher who owns them")
    return t


def _draft_only(t: dict) -> None:
    if t["status"] != "DRAFT":
        raise HTTPException(409, "A published test cannot be changed. Unpublish it first (possible while no candidate has started).")


def _questions(test_id) -> list[dict]:
    return db.fetch_all(f"SELECT {', '.join(QUESTION_COLS)} FROM public.admission_questions WHERE test_id = %s "
                        "ORDER BY display_order, created_at", (test_id,))


def _test_view(t: dict, *, with_questions: bool = False) -> dict:
    counts = db.fetch_one(
        "SELECT (SELECT COUNT(*) FROM public.admission_questions q WHERE q.test_id = %(t)s) AS question_count, "
        "(SELECT COUNT(*) FROM public.admission_questions q WHERE q.test_id = %(t)s AND q.status = 'DRAFT') AS drafts, "
        "(SELECT COALESCE(SUM(marks), 0) FROM public.admission_questions q WHERE q.test_id = %(t)s AND q.qtype NOT IN ('SJT','REFLECTIVE','IDEAS')) AS academic_marks, "
        "(SELECT COUNT(*) FROM public.admission_sessions s WHERE s.test_id = %(t)s) AS sessions, "
        "(SELECT COUNT(*) FROM public.admission_sessions s WHERE s.test_id = %(t)s AND s.status IN ('SUBMITTED','ENDED')) AS completed",
        {"t": t["test_id"]})
    owner = db.fetch_one("SELECT full_name FROM public.app_users WHERE user_code = %s", (t["created_by"],))
    out = {k: t[k] for k in ("test_id", "title", "grade_applying", "instructions", "duration_minutes", "sections", "shuffle",
                             "status", "created_by", "published_at", "created_at", "updated_at")}
    out.update({"proctoring_config": {**cfg.default_proctoring(), **(t["proctoring_config"] or {})},
                "scoring_config": {**cfg.default_scoring(), **(t["scoring_config"] or {})},
                "owner_name": owner and owner["full_name"], "age_band": qs.age_band_for_grade(t["grade_applying"]), **counts})
    if with_questions:
        out["questions"] = _questions(t["test_id"])
    return out


# ---------------------------------------------------------------- meta
@router.get("/test-meta")
def meta(user: CurrentUser = Depends(readers)):
    """Flag catalogue, presets and defaults for the teacher's proctoring / scoring settings."""
    return {"flags": [{"code": c, "label": f.label, "severity": f.severity, "points": f.points, "cap": f.cap, "warn": f.warn,
                       "pause": f.pause, "server": f.server} for c, f in cfg.FLAGS.items() if c not in cfg.NOT_FLAGS],
            "presets": cfg.PRESETS, "proctoring": cfg.default_proctoring(), "scoring": cfg.default_scoring(),
            "age_bands": AGE_BANDS, "tunables": {k: cfg.TUNABLES[k] for k in ("evidence_retention_days", "calibration_seconds",
                                                                              "max_answer_chars", "exam_token_ttl_minutes")}}


# ---------------------------------------------------------------- tests
class Section(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")
    title: str = Field(min_length=1, max_length=80)
    kind: Literal["ACADEMIC", "APTITUDE", "LANGUAGE", "HQ"]


class Proctoring(BaseModel):
    preset: Literal["strict", "standard", "lenient"] = "standard"
    require_camera: bool = True
    require_screen_share: bool = True
    rules: dict[str, bool] = Field(default_factory=dict)

    @field_validator("rules")
    @classmethod
    def _rules(cls, v: dict[str, bool]) -> dict[str, bool]:
        unknown = set(v) - set(cfg.FLAGS)
        if unknown:
            raise ValueError(f"unknown rules: {', '.join(sorted(unknown))}")
        return v


class Scoring(BaseModel):
    w_academic: float = Field(default=0.7, ge=0, le=1)
    w_hq: float = Field(default=0.3, ge=0, le=1)
    bands: dict[Literal["strong", "recommended", "borderline"], float] = Field(default_factory=lambda: dict(cfg.TUNABLES["bands"]))

    @field_validator("bands")
    @classmethod
    def _bands(cls, v: dict) -> dict:
        b = {**cfg.TUNABLES["bands"], **v}
        if not 0 <= b["borderline"] < b["recommended"] < b["strong"] <= 100:
            raise ValueError("cut-offs must rise: borderline < recommended < strongly recommended")
        return b


class TestIn(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    grade_applying: str = Field(min_length=1, max_length=64)
    instructions: str | None = Field(default=None, max_length=5000)
    duration_minutes: int = Field(default=60, ge=5, le=300)
    sections: list[Section] | None = Field(default=None, max_length=6)
    shuffle: dict[Literal["questions", "options"], bool] | None = None
    proctoring_config: Proctoring | None = None
    scoring_config: Scoring | None = None

    @field_validator("sections")
    @classmethod
    def _sections(cls, v: list[Section] | None) -> list[Section] | None:
        if v is None:
            return v
        if not v:
            raise ValueError("a test needs at least one section")
        if len({s.key for s in v}) != len(v):
            raise ValueError("section keys must be unique")
        if sum(1 for s in v if s.kind == "HQ") > 1:
            raise ValueError("only one HQ section")
        return v


@router.get("/tests")
def list_tests(org_code: str | None = None, user: CurrentUser = Depends(readers)):
    org = org_of(user, org_code)
    rows = db.fetch_all("SELECT * FROM public.admission_tests WHERE org_code = %s AND (%s::text IS NULL OR created_by = %s::text) "
                        "ORDER BY created_at DESC", (org, user.user_code if user.role == "teacher" else None,
                                                     user.user_code if user.role == "teacher" else None))
    return {"tests": [_test_view(t) for t in rows]}


@router.post("/tests", status_code=201)
def create_test(body: TestIn, user: CurrentUser = Depends(teachers)):
    sections = [s.model_dump() for s in body.sections] if body.sections else DEFAULT_SECTIONS
    row = db.fetch_one(
        "INSERT INTO public.admission_tests (org_code, title, grade_applying, instructions, duration_minutes, sections, shuffle, "
        "proctoring_config, scoring_config, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (user.org_code, body.title.strip(), body.grade_applying.strip(), body.instructions, body.duration_minutes, Jsonb(sections),
         Jsonb(body.shuffle or {"questions": True, "options": True}),
         Jsonb(body.proctoring_config.model_dump() if body.proctoring_config else cfg.default_proctoring()),
         Jsonb(body.scoring_config.model_dump() if body.scoring_config else cfg.default_scoring()), user.user_code))
    guard.audit(user.org_code, "test_created", actor=user.user_code, role=user.role, test_id=row["test_id"])
    return _test_view(row, with_questions=True)


@router.get("/tests/{test_id}")
def get_test(test_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(readers)):
    return _test_view(test_for(user, test_id, org_code=org_code), with_questions=True)


@router.put("/tests/{test_id}")
def update_test(test_id: UUID, body: TestIn, user: CurrentUser = Depends(teachers)):
    t = test_for(user, test_id, write=True)
    _draft_only(t)
    sections = [s.model_dump() for s in body.sections] if body.sections else t["sections"]
    used = {r["section"] for r in db.fetch_all("SELECT DISTINCT section FROM public.admission_questions WHERE test_id = %s", (test_id,))}
    missing = used - {s["key"] for s in sections}
    if missing:
        raise HTTPException(409, f"Move or delete the questions of section {', '.join(sorted(missing))} before removing it")
    row = db.fetch_one(
        "UPDATE public.admission_tests SET title = %s, grade_applying = %s, instructions = %s, duration_minutes = %s, sections = %s, "
        "shuffle = %s, proctoring_config = %s, scoring_config = %s, updated_at = NOW() WHERE test_id = %s RETURNING *",
        (body.title.strip(), body.grade_applying.strip(), body.instructions, body.duration_minutes, Jsonb(sections),
         Jsonb(body.shuffle or t["shuffle"]), Jsonb(body.proctoring_config.model_dump() if body.proctoring_config else t["proctoring_config"]),
         Jsonb(body.scoring_config.model_dump() if body.scoring_config else t["scoring_config"]), test_id))
    return _test_view(row, with_questions=True)


@router.post("/tests/{test_id}/publish")
def publish(test_id: UUID, user: CurrentUser = Depends(teachers)):
    t = test_for(user, test_id, write=True)
    _draft_only(t)
    questions = _questions(test_id)
    keys = {s["key"]: s for s in t["sections"]}
    drafts = [q for q in questions if q["status"] == "DRAFT"]
    if drafts:
        raise HTTPException(409, f"Approve or delete the {len(drafts)} drafted question(s) before publishing")
    if not any(q["qtype"] not in HQ_TYPES and float(q["marks"]) > 0 for q in questions):
        raise HTTPException(409, "Add at least one academic question with marks")
    if any(q["section"] not in keys for q in questions):
        raise HTTPException(409, "Some questions belong to a section that no longer exists")
    hq = next((s for s in t["sections"] if s["kind"] == "HQ"), None)
    if any(q["qtype"] in HQ_TYPES for q in questions) and not hq:
        raise HTTPException(409, "HQ items need an HQ section")
    row = db.fetch_one("UPDATE public.admission_tests SET status = 'PUBLISHED', published_at = NOW(), updated_at = NOW() "
                       "WHERE test_id = %s RETURNING *", (test_id,))
    guard.audit(user.org_code, "test_published", actor=user.user_code, role=user.role, test_id=test_id,
                details={"questions": len(questions)})
    return _test_view(row, with_questions=True)


@router.post("/tests/{test_id}/unpublish")
def unpublish(test_id: UUID, user: CurrentUser = Depends(teachers)):
    t = test_for(user, test_id, write=True)
    if t["status"] != "PUBLISHED":
        raise HTTPException(409, "The test is not published")
    if db.fetch_one("SELECT 1 FROM public.admission_sessions WHERE test_id = %s LIMIT 1", (test_id,)):
        raise HTTPException(409, "Candidates have already been launched on this test; create a copy to change it")
    row = db.fetch_one("UPDATE public.admission_tests SET status = 'DRAFT', updated_at = NOW() WHERE test_id = %s RETURNING *", (test_id,))
    return _test_view(row, with_questions=True)


@router.post("/tests/{test_id}/archive")
def archive(test_id: UUID, user: CurrentUser = Depends(teachers)):
    test_for(user, test_id, write=True)
    if db.fetch_one("SELECT 1 FROM public.admission_sessions WHERE test_id = %s AND status IN ('LAUNCHED','CONFIRMED','CHECKED','IN_PROGRESS') LIMIT 1",
                    (test_id,)):
        raise HTTPException(409, "End the open sessions of this test first")
    row = db.fetch_one("UPDATE public.admission_tests SET status = 'ARCHIVED', updated_at = NOW() WHERE test_id = %s RETURNING *", (test_id,))
    return _test_view(row)


# ---------------------------------------------------------------- question bank (teacher's own Assignments / Online tests)
def _can_teach(user: CurrentUser, class_code: str, subject_code: str, cache: dict) -> bool:
    key = (class_code, subject_code)
    if key not in cache:
        cache[key] = bool(db.call_scalar("usp_can_mark_attendance", user.org_code, user.user_code, class_code, subject_code))
    return cache[key]


BANK_SQL = (
    "SELECT q.master_q_id, q.eval_test_id, q.sl_no, q.display_order, q.question_type, q.question_text, q.mcq_options, "
    "q.correct_option, q.max_marks, q.model_answer_text, q.key_rubric_points, t.test_title, t.assessment_type, t.class_code, "
    "c.class_name, t.subject_code, cs.subject_name, t.chapter_number, t.chapter_title, t.created_by "
    "FROM public.evaluation_master_questions q "
    "JOIN public.evaluation_tests t ON t.eval_test_id = q.eval_test_id "
    "JOIN public.classes c ON c.org_code = t.org_code AND c.class_code = t.class_code "
    "JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code AND cs.subject_code = t.subject_code "
    "WHERE t.org_code = %s AND t.assessment_type IN ('ASSIGNMENT', 'ONLINE_TEST') ")


def _visible(user: CurrentUser, row: dict, cache: dict) -> bool:
    return row["created_by"] == user.user_code or _can_teach(user, row["class_code"], row["subject_code"], cache)


def source_label(r: dict) -> str:
    kind = "Online test" if r["assessment_type"] == "ONLINE_TEST" else "Assignment"
    chapter = f" · {r['chapter_title']}" if r.get("chapter_title") else ""
    return f"{r['subject_name']}{chapter} – {r['test_title']} ({kind}, {r['class_name']})"[:400]


@router.get("/question-bank")
def question_bank(class_code: str | None = Query(default=None, max_length=64), subject_code: str | None = Query(default=None, max_length=64),
                  assessment_type: Literal["ASSIGNMENT", "ONLINE_TEST"] | None = None,
                  qtype: Literal["MCQ", "SHORT_ANSWER", "DESCRIPTIVE", "NUMERICAL"] | None = None,
                  q: str | None = Query(default=None, max_length=100), chapter: str | None = Query(default=None, max_length=100),
                  min_marks: float | None = Query(default=None, ge=0), max_marks: float | None = Query(default=None, ge=0),
                  page: int = Query(default=1, ge=1), page_size: int = Query(default=50, ge=1, le=100),
                  user: CurrentUser = Depends(teachers)):
    """Questions from the Assignments and Online tests this teacher may see (evaluation-router scoping)."""
    sql, args = BANK_SQL, [user.org_code]
    for col, val in (("t.class_code", class_code), ("t.subject_code", subject_code), ("t.assessment_type", assessment_type),
                     ("q.question_type", qtype)):
        if val:
            sql += f"AND {col} = %s "
            args.append(val)
    if q and q.strip():
        sql += "AND q.question_text ILIKE %s "
        args.append(f"%{q.strip()}%")
    if chapter and chapter.strip():
        sql += "AND t.chapter_title ILIKE %s "
        args.append(f"%{chapter.strip()}%")
    if min_marks is not None:
        sql += "AND q.max_marks >= %s "
        args.append(min_marks)
    if max_marks is not None:
        sql += "AND q.max_marks <= %s "
        args.append(max_marks)
    rows = db.fetch_all(sql + "ORDER BY t.created_at DESC, q.display_order", args)
    cache: dict = {}
    rows = [r for r in rows if _visible(user, r, cache)]
    total = len(rows)
    rows = rows[(page - 1) * page_size: page * page_size]
    for r in rows:
        r["source_label"] = source_label(r)
        del r["created_by"]
    tests = {}
    for r in db.fetch_all(BANK_SQL.replace("SELECT q.master_q_id", "SELECT DISTINCT ON (t.eval_test_id) q.master_q_id") +
                          "ORDER BY t.eval_test_id", [user.org_code]):
        if _visible(user, r, cache):
            tests[r["eval_test_id"]] = {"eval_test_id": r["eval_test_id"], "test_title": r["test_title"], "assessment_type": r["assessment_type"],
                                        "class_code": r["class_code"], "class_name": r["class_name"], "subject_code": r["subject_code"],
                                        "subject_name": r["subject_name"]}
    return {"questions": rows, "total": total, "page": page, "page_size": page_size, "sources": list(tests.values())}


class ImportIn(BaseModel):
    master_q_ids: list[UUID] = Field(min_length=1, max_length=100)
    section: str = Field(min_length=1, max_length=32)


def _section(t: dict, key: str, *, hq: bool | None = None) -> dict:
    s = next((x for x in t["sections"] if x["key"] == key), None)
    if not s:
        raise HTTPException(422, "Unknown section")
    if hq is True and s["kind"] != "HQ":
        raise HTTPException(422, "HQ items go into the HQ section")
    if hq is False and s["kind"] == "HQ":
        raise HTTPException(422, "Academic questions cannot go into the HQ section")
    return s


def _next_order(test_id) -> int:
    return int(db.fetch_one("SELECT COALESCE(MAX(display_order), 0) AS m FROM public.admission_questions WHERE test_id = %s",
                            (test_id,))["m"])


def _insert(conn, test_id, q: dict) -> dict:
    cols = [c for c in QUESTION_COLS if c not in ("question_id", "test_id") and c in q]
    vals = [Jsonb(q[c]) if c in ("options", "answer_key", "rubric") and q[c] is not None else q[c] for c in cols]
    return conn.execute(f"INSERT INTO public.admission_questions (test_id, {', '.join(cols)}) VALUES (%s, {', '.join(['%s'] * len(cols))}) "
                        f"RETURNING {', '.join(QUESTION_COLS)}", [test_id, *vals]).fetchone()


@router.post("/tests/{test_id}/questions/import")
def import_questions(test_id: UUID, body: ImportIn, user: CurrentUser = Depends(teachers)):
    t = test_for(user, test_id, write=True)
    _draft_only(t)
    _section(t, body.section, hq=False)
    rows = {r["master_q_id"]: r for r in db.fetch_all(BANK_SQL + "AND q.master_q_id = ANY(%s)", [user.org_code, list(body.master_q_ids)])}
    cache: dict = {}
    if len(rows) != len(set(body.master_q_ids)) or not all(_visible(user, r, cache) for r in rows.values()):
        raise HTTPException(403, "You can import only from your own Assignments and Online tests")
    already = {r["source_master_q_id"] for r in db.fetch_all(
        "SELECT source_master_q_id FROM public.admission_questions WHERE test_id = %s AND source_master_q_id IS NOT NULL", (test_id,))}
    order = _next_order(test_id)
    created, skipped = [], 0
    with db.connection() as conn:
        for mid in body.master_q_ids:
            if mid in already:
                skipped += 1
                continue
            already.add(mid)
            order += 1
            created.append(_insert(conn, test_id, snapshot(rows[mid], body.section, source_label(rows[mid]), order)))
    return {"imported": created, "skipped": skipped,
            "needs_review": sum(1 for c in created if c["status"] == "DRAFT")}


# ---------------------------------------------------------------- HQ bank
_bank_ready = False


def ensure_hq_bank() -> None:
    """Upsert the built-in, read-only HQ bank (services/admission_test/hq_bank.py) into admission_hq_bank."""
    global _bank_ready
    if _bank_ready:
        return
    from ..services.admission_test import hq_bank

    with db.connection() as conn:
        for i in hq_bank.ITEMS:
            conn.execute(
                "INSERT INTO public.admission_hq_bank (item_id, age_band, qtype, prompt, options, answer_key, hq_dimension) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (item_id) DO UPDATE SET age_band = EXCLUDED.age_band, qtype = EXCLUDED.qtype, "
                "prompt = EXCLUDED.prompt, options = EXCLUDED.options, answer_key = EXCLUDED.answer_key, hq_dimension = EXCLUDED.hq_dimension",
                (i["item_id"], i["age_band"], i["qtype"], i["prompt"], Jsonb(i["options"]),
                 Jsonb(i["answer_key"]) if i["answer_key"] is not None else None, i["hq_dimension"]))
    _bank_ready = True


AGE_BANDS = ["6-8", "9-11", "12-14", "15-17"]


@router.get("/hq-bank")
def hq_bank_items(age_band: Literal["6-8", "9-11", "12-14", "15-17"] = "12-14", user: CurrentUser = Depends(teachers)):
    ensure_hq_bank()
    rows = db.fetch_all("SELECT * FROM public.admission_hq_bank WHERE age_band = %s ORDER BY qtype DESC, item_id", (age_band,))
    return {"age_band": age_band, "age_bands": AGE_BANDS, "items": rows}


def standard_set(items: list[dict]) -> list[dict]:
    """{{hq_sjt_items}} SJT spread over EQ / SQ / AQ, {{hq_reflective_items}} reflective, one ideas item."""
    sjt = [i for i in items if i["qtype"] == "SJT"]
    by_dim: dict[str, list] = {}
    for i in sjt:
        by_dim.setdefault(i["hq_dimension"], []).append(i)
    picked: list[dict] = []
    while len(picked) < cfg.TUNABLES["hq_sjt_items"] and any(by_dim.values()):
        for d in sorted(by_dim):
            if by_dim[d] and len(picked) < cfg.TUNABLES["hq_sjt_items"]:
                picked.append(by_dim[d].pop(0))
    picked += [i for i in items if i["qtype"] == "REFLECTIVE"][: cfg.TUNABLES["hq_reflective_items"]]
    picked += [i for i in items if i["qtype"] == "IDEAS"][:1]
    return picked


class FromBankIn(BaseModel):
    item_ids: list[str] = Field(default_factory=list, max_length=40)
    age_band: Literal["6-8", "9-11", "12-14", "15-17"] | None = None


@router.post("/tests/{test_id}/questions/from-hq-bank")
def add_from_bank(test_id: UUID, body: FromBankIn, user: CurrentUser = Depends(teachers)):
    """Add chosen bank items, or (only age_band given) the standard HQ set for that age band."""
    t = test_for(user, test_id, write=True)
    _draft_only(t)
    hq = next((s for s in t["sections"] if s["kind"] == "HQ"), None)
    if not hq:
        raise HTTPException(409, "Add an HQ section to the test first")
    ensure_hq_bank()
    if body.item_ids:
        items = db.fetch_all("SELECT * FROM public.admission_hq_bank WHERE item_id = ANY(%s) ORDER BY item_id", (body.item_ids,))
        if len(items) != len(set(body.item_ids)):
            raise HTTPException(404, "Unknown HQ bank item")
    else:
        band = body.age_band or qs.age_band_for_grade(t["grade_applying"])
        items = standard_set(db.fetch_all("SELECT * FROM public.admission_hq_bank WHERE age_band = %s ORDER BY item_id", (band,)))
    have = {r["hq_item_id"] for r in db.fetch_all("SELECT hq_item_id FROM public.admission_questions WHERE test_id = %s AND hq_item_id IS NOT NULL",
                                                  (test_id,))}
    order = _next_order(test_id)
    created = []
    with db.connection() as conn:
        for i in items:
            if i["item_id"] in have:
                continue
            order += 1
            created.append(_insert(conn, test_id, {
                "section": hq["key"], "qtype": i["qtype"], "prompt": i["prompt"], "options": i["options"], "answer_key": i["answer_key"],
                "rubric": [], "marks": 2 if i["qtype"] == "SJT" else 0, "hq_dimension": i["hq_dimension"], "origin": "HQ_BANK",
                "hq_item_id": i["item_id"], "status": "APPROVED", "display_order": order}))
    return {"added": created, "skipped": len(items) - len(created)}


class DraftIn(BaseModel):
    kind: Literal["HQ", "ACADEMIC"]
    section: str = Field(min_length=1, max_length=32)
    topic: str | None = Field(default=None, max_length=200)
    count: int = Field(default=4, ge=1, le=12)
    age_band: Literal["6-8", "9-11", "12-14", "15-17"] | None = None


@router.post("/tests/{test_id}/questions/draft")
def draft_questions(test_id: UUID, body: DraftIn, user: CurrentUser = Depends(teachers)):
    """AI drafts land as DRAFT; the teacher edits and approves each one before publishing."""
    t = test_for(user, test_id, write=True)
    _draft_only(t)
    _section(t, body.section, hq=body.kind == "HQ")
    if body.kind == "ACADEMIC" and not (body.topic or "").strip():
        raise HTTPException(422, "Name the topic to draft questions for")
    guard.limiter.hit(f"adm-draft:{user.user_code}", 10, 600, message="Too many AI drafts. Try again in a few minutes.")
    existing = [r["prompt"] for r in db.fetch_all("SELECT prompt FROM public.admission_questions WHERE test_id = %s", (test_id,))]
    items, source, rejected = qs.draft(body.kind, t, section=body.section, age_band=body.age_band or qs.age_band_for_grade(t["grade_applying"]),
                                       topic=body.topic, count=body.count, existing=existing)
    if not items:
        raise HTTPException(502, "The AI could not draft usable items just now. Try again, or add items from the HQ bank.")
    order = _next_order(test_id)
    created = []
    with db.connection() as conn:
        for q in items:
            order += 1
            created.append(_insert(conn, test_id, {**q, "origin": "AI_DRAFT", "status": "DRAFT", "display_order": order}))
    return {"drafted": created, "rejected": rejected, "engine": source}


# ---------------------------------------------------------------- questions
@router.get("/tests/{test_id}/questions")
def list_questions(test_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(readers)):
    test_for(user, test_id, org_code=org_code)
    return {"questions": _questions(test_id)}


def _validated(t: dict, body: qs.QuestionIn) -> dict:
    s = _section(t, body.section)
    if (s["kind"] == "HQ") != (body.qtype in HQ_TYPES):
        raise HTTPException(422, "HQ items (SJT, reflective, ideas) belong in the HQ section and only there")
    return {**body.model_dump(), "rubric": [r.model_dump() for r in body.rubric]}


@router.post("/tests/{test_id}/questions", status_code=201)
def add_question(test_id: UUID, body: qs.QuestionIn, user: CurrentUser = Depends(teachers)):
    t = test_for(user, test_id, write=True)
    _draft_only(t)
    q = _validated(t, body)
    with db.connection() as conn:
        return _insert(conn, test_id, {**q, "origin": "MANUAL", "display_order": _next_order(test_id) + 1})


def _question_for(user: CurrentUser, question_id: UUID) -> tuple[dict, dict]:
    q = db.fetch_one(f"SELECT {', '.join(QUESTION_COLS)} FROM public.admission_questions WHERE question_id = %s", (question_id,))
    if not q:
        raise HTTPException(404, "Question not found")
    t = test_for(user, q["test_id"], write=True)
    _draft_only(t)
    return q, t


@router.put("/questions/{question_id}")
def update_question(question_id: UUID, body: qs.QuestionIn, user: CurrentUser = Depends(teachers)):
    q, t = _question_for(user, question_id)
    v = _validated(t, body)
    return db.fetch_one(
        "UPDATE public.admission_questions SET section = %s, qtype = %s, prompt = %s, options = %s, answer_key = %s, rubric = %s, "
        "model_answer = %s, marks = %s, topic = %s, difficulty = %s, hq_dimension = %s, status = %s "
        f"WHERE question_id = %s RETURNING {', '.join(QUESTION_COLS)}",
        (v["section"], v["qtype"], v["prompt"], Jsonb(v["options"]), Jsonb(v["answer_key"]) if v["answer_key"] is not None else None,
         Jsonb(v["rubric"]), v["model_answer"], v["marks"], v["topic"], v["difficulty"], v["hq_dimension"], v["status"], question_id))


@router.delete("/questions/{question_id}", status_code=204)
def delete_question(question_id: UUID, user: CurrentUser = Depends(teachers)):
    _question_for(user, question_id)
    db.execute("DELETE FROM public.admission_questions WHERE question_id = %s", (question_id,))


class OrderIn(BaseModel):
    question_ids: list[UUID] = Field(min_length=1, max_length=300)


@router.put("/tests/{test_id}/questions/order")
def reorder(test_id: UUID, body: OrderIn, user: CurrentUser = Depends(teachers)):
    t = test_for(user, test_id, write=True)
    _draft_only(t)
    ids = {q["question_id"] for q in _questions(test_id)}
    if set(body.question_ids) != ids or len(body.question_ids) != len(ids):
        raise HTTPException(422, "Send every question of the test exactly once")
    with db.connection() as conn:
        for i, qid in enumerate(body.question_ids, 1):
            conn.execute("UPDATE public.admission_questions SET display_order = %s WHERE question_id = %s", (i, qid))
    return {"questions": _questions(test_id)}


# ---------------------------------------------------------------- candidates
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def age_on(dob: date, when: date | None = None) -> int:
    w = when or date.today()
    return w.year - dob.year - ((w.month, w.day) < (dob.month, dob.day))


class CandidateIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=32)
    dob: date
    grade_applying: str = Field(min_length=1, max_length=64)
    guardian_name: str | None = Field(default=None, max_length=200)
    guardian_email: str | None = Field(default=None, max_length=254)
    guardian_phone: str | None = Field(default=None, max_length=32)
    accommodations: dict = Field(default_factory=dict)

    @field_validator("email", "guardian_email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        v = (v or "").strip() or None
        if v and not _EMAIL.match(v):
            raise ValueError("not a valid email address")
        return v

    @field_validator("dob")
    @classmethod
    def _dob(cls, v: date) -> date:
        if not 3 <= age_on(v) <= 30:
            raise ValueError("date of birth gives an age outside 3–30 years")
        return v

    @field_validator("accommodations")
    @classmethod
    def _acc(cls, v: dict) -> dict:
        extra = v.get("extra_time_minutes", 0) or 0
        if not isinstance(extra, int) or not 0 <= extra <= 120:
            raise ValueError("extra time must be 0–120 minutes")
        return {"extra_time_minutes": extra, "disable_voice_flag": bool(v.get("disable_voice_flag"))}


def _candidate_view(r: dict) -> dict:
    return {**r, "age": age_on(r["dob"]), "minor": age_on(r["dob"]) < 18}


def candidate_for(user: CurrentUser, candidate_id: UUID, *, own: bool = True) -> dict:
    r = db.fetch_one("SELECT * FROM public.admission_candidates WHERE candidate_id = %s AND org_code = %s",
                     (candidate_id, org_of(user)))
    if not r or (own and user.role == "teacher" and r["created_by"] != user.user_code):
        raise HTTPException(404, "Candidate not found")
    return r


@router.get("/candidates")
def list_candidates(org_code: str | None = None, user: CurrentUser = Depends(readers)):
    org = org_of(user, org_code)
    rows = db.fetch_all(
        "SELECT c.*, (SELECT json_agg(json_build_object('session_id', s.session_id, 'test_id', s.test_id, 'status', s.status, "
        "  'submit_reason', s.submit_reason, 'launched_at', s.launched_at) ORDER BY s.launched_at DESC) "
        "  FROM public.admission_sessions s WHERE s.candidate_id = c.candidate_id) AS sessions "
        "FROM public.admission_candidates c WHERE c.org_code = %s AND (%s::text IS NULL OR c.created_by = %s::text) ORDER BY c.created_at DESC",
        (org, user.user_code if user.role == "teacher" else None, user.user_code if user.role == "teacher" else None))
    return {"candidates": [{**_candidate_view(r), "sessions": r["sessions"] or []} for r in rows]}


@router.post("/candidates", status_code=201)
def create_candidate(body: CandidateIn, user: CurrentUser = Depends(teachers)):
    row = db.fetch_one(
        "INSERT INTO public.admission_candidates (org_code, full_name, email, phone, dob, grade_applying, guardian_name, guardian_email, "
        "guardian_phone, accommodations, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (user.org_code, body.full_name.strip(), body.email, body.phone, body.dob, body.grade_applying.strip(), body.guardian_name,
         body.guardian_email, body.guardian_phone, Jsonb(body.accommodations), user.user_code))
    return _candidate_view(row)


@router.put("/candidates/{candidate_id}")
def update_candidate(candidate_id: UUID, body: CandidateIn, user: CurrentUser = Depends(teachers)):
    candidate_for(user, candidate_id)
    row = db.fetch_one(
        "UPDATE public.admission_candidates SET full_name = %s, email = %s, phone = %s, dob = %s, grade_applying = %s, guardian_name = %s, "
        "guardian_email = %s, guardian_phone = %s, accommodations = %s WHERE candidate_id = %s RETURNING *",
        (body.full_name.strip(), body.email, body.phone, body.dob, body.grade_applying.strip(), body.guardian_name, body.guardian_email,
         body.guardian_phone, Jsonb(body.accommodations), candidate_id))
    return _candidate_view(row)


def delete_files(keys: list[str | None]) -> int:
    n = 0
    storage = get_storage()
    for k in {k for k in keys if k}:
        try:
            storage.delete(k)
            n += 1
        except Exception:  # noqa: BLE001 — already gone
            pass
    return n


@router.delete("/candidates/{candidate_id}")
def delete_candidate(candidate_id: UUID, user: CurrentUser = Depends(readers)):
    """Delete the candidate and everything captured about them (sessions, answers, events, evidence, reports)."""
    if user.role == "orgadmin" or user.role == "superadmin":
        c = candidate_for(user, candidate_id, own=False)
    else:
        c = candidate_for(user, candidate_id)
    sessions = db.fetch_all("SELECT session_id, id_photo_key FROM public.admission_sessions WHERE candidate_id = %s", (candidate_id,))
    if any(db.fetch_one("SELECT 1 FROM public.admission_sessions WHERE session_id = %s AND status IN ('IN_PROGRESS') ", (s["session_id"],))
           for s in sessions):
        raise HTTPException(409, "End the candidate's test in progress first")
    keys = [s["id_photo_key"] for s in sessions]
    if sessions:
        keys += [r["evidence_key"] for r in db.fetch_all(
            "SELECT evidence_key FROM public.admission_proctor_events WHERE session_id = ANY(%s) AND evidence_key IS NOT NULL",
            ([s["session_id"] for s in sessions],))]
    files = delete_files(keys)
    with db.connection() as conn:
        conn.execute("DELETE FROM public.admission_candidates WHERE candidate_id = %s", (candidate_id,))
        guard.audit(c["org_code"], "candidate_deleted", actor=user.user_code, role=user.role,
                    details={"candidate_id": str(candidate_id), "sessions": len(sessions), "files": files}, conn=conn)
    return {"deleted": True, "sessions": len(sessions), "files": files}


CSV_COLUMNS = ["name", "email", "phone", "dob", "grade_applying", "guardian_name", "guardian_email", "guardian_phone"]


def _parse_dob(v: str) -> date:
    v = v.strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    raise ValueError("date of birth must look like 2014-05-21 or 21/05/2014")


@router.post("/candidates/import")
def import_candidates(commit: bool = False, file: UploadFile = File(...), user: CurrentUser = Depends(teachers)):
    """CSV (≤ 1 MB): name, email, phone, dob, grade_applying, guardian_name, guardian_email, guardian_phone.
    commit=false returns a validation preview; commit=true inserts the valid rows."""
    data = file.file.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise HTTPException(413, "The CSV file must be 1 MB or smaller")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "Save the CSV as UTF-8") from None
    reader = csv.DictReader(io.StringIO(text))
    header = [h.strip().lower() for h in (reader.fieldnames or [])]
    if "name" not in header or "dob" not in header or "grade_applying" not in header:
        raise HTTPException(422, "The CSV needs the columns name, dob and grade_applying (optional: " + ", ".join(CSV_COLUMNS[1:]) + ")")
    rows, valid = [], []
    for n, raw in enumerate(reader, start=2):
        if n > 2001:
            raise HTTPException(422, "At most 2,000 candidates per file")
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        try:
            c = CandidateIn(full_name=r.get("name", ""), email=r.get("email") or None, phone=r.get("phone") or None,
                            dob=_parse_dob(r.get("dob", "")), grade_applying=r.get("grade_applying", ""),
                            guardian_name=r.get("guardian_name") or None, guardian_email=r.get("guardian_email") or None,
                            guardian_phone=r.get("guardian_phone") or None)
            rows.append({"line": n, "name": c.full_name, "dob": c.dob, "grade_applying": c.grade_applying, "minor": age_on(c.dob) < 18,
                         "error": None})
            valid.append(c)
        except Exception as e:  # noqa: BLE001 — report per row
            msg = "; ".join(x.get("msg", "") for x in getattr(e, "errors", lambda: [])()) or str(e)
            rows.append({"line": n, "name": r.get("name"), "dob": r.get("dob"), "grade_applying": r.get("grade_applying"), "minor": None,
                         "error": msg.replace("Value error, ", "")})
    created = 0
    if commit and valid:
        with db.connection() as conn:
            for c in valid:
                conn.execute(
                    "INSERT INTO public.admission_candidates (org_code, full_name, email, phone, dob, grade_applying, guardian_name, "
                    "guardian_email, guardian_phone, accommodations, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (user.org_code, c.full_name.strip(), c.email, c.phone, c.dob, c.grade_applying.strip(), c.guardian_name,
                     c.guardian_email, c.guardian_phone, Jsonb(c.accommodations), user.user_code))
                created += 1
    return {"rows": rows, "valid": len(valid), "invalid": len(rows) - len(valid), "created": created}
