"""AI Question Generator (Teacher → Assessments → AI Question Generator).

Class → Subject → Chapter → Topic → NLP learning content (the teacher's own classes mapped onto backend/nlp), AI
generation of 17 question types grounded only in the selected content, a question-paper editor (draft → published,
versioned), the question bank, PDF export (paper + answer key) and conversion of a published paper into an Online
Test / Assignment. Teachers only, behind the per-institution AI module `question_generator`; admins manage the
class-subject → content mapping and the Assertion–Reason codes.
"""
from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field, ValidationError, field_validator

from .. import db
from ..security import CurrentUser, ensure_module, require_role
from ..services import nlp_catalog
from ..services.admission_test.guard import RateLimiter
from ..services.qgen import content, generator, mapping, paper as paper_rules, pdf, publish as publisher, store
from ..services.qgen.schema import (BLOOMS, DIFFICULTIES, LANGUAGES, LIMITS, TYPE_CATALOGUE, TYPES, Bloom, Difficulty,
                                    Language, QType, error_text, new_id, stem_plain, validate_question)
from .admin import org_scope

MODULE = "question_generator"
router = APIRouter(prefix="/ICMELive/api/v1/qgen", tags=["question-generator"])
admin_router = APIRouter(prefix="/ICMELive/api/v1/qgen/admin", tags=["question-generator"])

limiter = RateLimiter()
GENERATE_LIMIT, GENERATE_WINDOW_S = 12, 600
UPLOAD_LIMIT, UPLOAD_WINDOW_S = 40, 600
_teacher = require_role("teacher")
_admins = require_role("orgadmin", "superadmin")


def teacher(user: CurrentUser = Depends(_teacher)) -> CurrentUser:
    ensure_module(user, MODULE)
    return user


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


# ════════════════════════════════════════════════════════════ meta + content repository
@router.get("/meta")
def meta(user: CurrentUser = Depends(teacher)):
    """Every list the UI shows (question types and their inputs, difficulty, Bloom levels, languages, A/R codes)."""
    return {"types": TYPE_CATALOGUE, "difficulties": DIFFICULTIES, "blooms": BLOOMS, "languages": LANGUAGES,
            "limits": LIMITS, "settings": store.settings(user.org_code),
            "rate_limit": {"generations": GENERATE_LIMIT, "window_seconds": GENERATE_WINDOW_S}}


def _mapped(user: CurrentUser, class_code: str, subject_code: str) -> dict:
    m = mapping.resolve_for_teacher(user.org_code, user.user_code, class_code, subject_code)
    if not m:
        raise HTTPException(403, "You can generate questions only for classes and subjects you teach")
    if not m["nlp_class"] or not m["nlp_subject"]:
        raise HTTPException(409, m.get("note") or "This subject is not linked to the content repository yet — ask an admin")
    return m


def _syllabus(org: str, class_code: str, subject_code: str) -> list[dict]:
    rows = db.fetch_all("SELECT c.chapter_id, c.title AS chapter_title, t.topic_id, t.title FROM public.syllabus_chapters c "
                        "LEFT JOIN public.syllabus_topics t ON t.chapter_id = c.chapter_id WHERE c.org_code = %s AND "
                        "c.class_code = %s AND c.subject_code = %s ORDER BY c.position, t.position",
                        (org, class_code, subject_code))
    out: dict[Any, dict] = {}
    for r in rows:
        ch = out.setdefault(r["chapter_id"], {"chapter_title": r["chapter_title"], "topics": []})
        if r["topic_id"]:
            ch["topics"].append({"topic_id": str(r["topic_id"]), "title": r["title"]})
    return list(out.values())


def _structure(m: dict, chapter: str) -> dict:
    try:
        return content.chapter_structure(m["nlp_class"], m["nlp_subject"], chapter)
    except FileNotFoundError:
        raise HTTPException(404, f"Chapter “{chapter}” is not in the content repository for {m['nlp_subject']}")


def _topics(user: CurrentUser, m: dict, chapter: str) -> tuple[dict, str, list[dict]]:
    st = _structure(m, chapter)
    source, topics = content.resolve_topics(st, _syllabus(user.org_code, m["class_code"], m["subject_code"]))
    return st, source, topics


def _topic(topics: list[dict], topic_id: str) -> dict:
    t = next((t for t in topics if t["id"] == topic_id), None)
    if not t:
        raise HTTPException(404, "Topic not found in this chapter")
    return t


@router.get("/catalog/classes", dependencies=[Depends(_no_store)])
def catalog_classes(user: CurrentUser = Depends(teacher)):
    """The teacher's own classes and subjects, each with the content-repository class / subject it maps to."""
    return {"classes": mapping.teacher_classes(user.org_code, user.user_code)}


@router.get("/catalog/chapters")
def catalog_chapters(class_code: str, subject_code: str, user: CurrentUser = Depends(teacher)):
    """The mapped folder's chapters. When a single-discipline subject (e.g. Physics) maps onto a combined science
    book, its own chapters come first (`primary`) and the folder's other chapters after them."""
    m = _mapped(user, class_code, subject_code)
    own, other, disc = mapping.ranked_chapters(m)
    return {"nlp_class": m["nlp_class"], "nlp_subject": m["nlp_subject"], "discipline": disc,
            "chapters": own + other, "primary": own}


@router.get("/catalog/topics")
def catalog_topics(class_code: str, subject_code: str, chapter: str, user: CurrentUser = Depends(teacher)):
    m = _mapped(user, class_code, subject_code)
    st, source, topics = _topics(user, m, chapter)
    return {"topic_source": source, "source_file": st["source_file"],
            "topics": [content.topic_view(st, t) for t in topics]}


@router.get("/catalog/content")
def catalog_content(class_code: str, subject_code: str, chapter: str, topic_id: str, user: CurrentUser = Depends(teacher)):
    m = _mapped(user, class_code, subject_code)
    st, _, topics = _topics(user, m, chapter)
    t = _topic(topics, topic_id)
    return {"topic": content.topic_view(st, t),
            "segments": [content.segment_view(st["segments"][s]) for s in t["segment_ids"] if s in st["segments"]]}


@router.get("/catalog/preview")
def catalog_preview(class_code: str, subject_code: str, chapter: str, topic_id: str,
                    segment_ids: list[str] = Query(default_factory=list), user: CurrentUser = Depends(teacher)):
    """The full cleaned text of the selected learning content (the exact text generation is grounded on)."""
    m = _mapped(user, class_code, subject_code)
    st, _, topics = _topics(user, m, chapter)
    t = _topic(topics, topic_id)
    try:
        segs = content.selected_segments(st, t, segment_ids or None)
    except KeyError:
        raise HTTPException(404, "That learning content is not part of the selected topic")
    text, parts = 0, []
    for s in segs:
        if text >= content.MAX_PREVIEW_CHARS:
            break
        parts.append({"id": s["id"], "title": s["title"], "text": s["text"][: content.MAX_PREVIEW_CHARS - text]})
        text += len(s["text"])
    return {"topic": content.topic_view(st, t), "segments": parts, "word_count": sum(s["word_count"] for s in segs),
            "truncated": text > content.MAX_PREVIEW_CHARS,
            "source": {"class": m["nlp_class"], "subject": m["nlp_subject"], "chapter": chapter, "file": st["source_file"]}}


# ════════════════════════════════════════════════════════════ generation
class BlueprintRow(BaseModel):
    type: QType
    count: int = Field(default=5, ge=1, le=20)
    difficulty: Difficulty = "MEDIUM"
    bloom: Bloom = "UNDERSTAND"
    marks: float | None = Field(default=None, gt=0, le=100)
    options: dict[str, Any] = Field(default_factory=dict)

    @field_validator("options")
    @classmethod
    def _opts(cls, v: dict, info):
        qtype = info.data.get("type")
        spec = TYPES.get(qtype, {}).get("options", {}) if qtype else {}
        out: dict[str, Any] = {}
        for key, val in (v or {}).items():
            s = spec.get(key)
            if not s:
                continue  # unknown inputs are ignored, never passed to the AI
            if s["kind"] == "int":
                try:
                    n = int(val)
                except (TypeError, ValueError):
                    raise ValueError(f"{s['label']} must be a whole number")
                if not s["min"] <= n <= s["max"]:
                    raise ValueError(f"{s['label']} must be between {s['min']} and {s['max']}")
                out[key] = n
            elif s["kind"] == "bool":
                out[key] = bool(val)
            elif s["kind"] == "choice":
                if val not in [c[0] for c in s["choices"]]:
                    raise ValueError(f"{s['label']}: choose one of the listed options")
                out[key] = val
        return out


class GenerateBody(BaseModel):
    class_code: str = Field(min_length=1, max_length=64)
    subject_code: str = Field(min_length=1, max_length=64)
    chapter: str = Field(min_length=1, max_length=300)
    topic_id: str = Field(min_length=1, max_length=40)
    segment_ids: list[str] = Field(default_factory=list, max_length=60)
    language: Language = "en"
    instructions: str = Field(default="", max_length=1000)
    blueprint: list[BlueprintRow] = Field(min_length=1, max_length=len(TYPE_CATALOGUE))
    paper_id: UUID | None = None

    @field_validator("instructions")
    @classmethod
    def _instr(cls, v: str) -> str:
        return re.sub(r"\s+", " ", v or "").strip()


@router.post("/generate")
def generate(body: GenerateBody, user: CurrentUser = Depends(teacher)):
    """Draft questions for review — nothing is saved until the teacher adds them to a paper."""
    total = sum(r.count for r in body.blueprint)
    if total > 50:
        raise HTTPException(422, "At most 50 questions per generation — split the blueprint into two runs")
    m = _mapped(user, body.class_code, body.subject_code)
    st, _, topics = _topics(user, m, body.chapter)
    t = _topic(topics, body.topic_id)
    try:
        segs = content.selected_segments(st, t, body.segment_ids or None)
    except KeyError:
        raise HTTPException(404, "That learning content is not part of the selected topic")
    existing: list[str] = []
    if body.paper_id:
        row = store.paper_row(user.org_code, user.user_code, body.paper_id)
        if not row:
            raise HTTPException(404, "Question paper not found")
        existing = [stem_plain(i["question"]) for i in store.items_of(row["paper_id"])]
    limiter.hit(f"qgen:{user.org_code}:{user.user_code}", GENERATE_LIMIT, GENERATE_WINDOW_S,
                message=f"You can generate {GENERATE_LIMIT} times in {GENERATE_WINDOW_S // 60} minutes. Please wait a little.")
    rows = [generator.Row(r.type, r.count, r.difficulty, r.bloom, r.marks, r.options) for r in body.blueprint]
    ar = store.settings(user.org_code)
    res = generator.generate(
        segs, rows, existing=existing, ar_codes=ar["ar_codes"],
        seed=f"{user.user_code}|{body.topic_id}|{len(existing)}",
        meta={"klass": f"Class {m['nlp_class']}", "subject": m["nlp_subject"], "chapter": body.chapter,
              "topic": t["title"], "language": body.language, "instructions": body.instructions})
    return {"items": res.items, "warnings": res.warnings, "engine": res.engine, "rows": res.rows,
            "source": {"class": m["nlp_class"], "subject": m["nlp_subject"], "chapter": body.chapter,
                       "topic": t["title"], "segment_ids": [s["id"] for s in segs]}}


@router.post("/validate")
def validate(body: dict, _: CurrentUser = Depends(teacher)):
    """Validate one question (the editor uses it before saving a manually written question)."""
    try:
        return {"question": validate_question(body)}
    except ValidationError as e:
        raise HTTPException(422, error_text(e))


# ════════════════════════════════════════════════════════════ papers
class Section(BaseModel):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_\-]+$")
    title: str = Field(default="", max_length=120)
    instructions: str = Field(default="", max_length=500)


class Header(BaseModel):
    institution_name: str = Field(default="", max_length=200)
    logo_media_id: UUID | None = None
    exam_title: str = Field(default="", max_length=200)
    academic_year: str = Field(default="", max_length=20)
    exam_date: str = Field(default="", max_length=40)
    duration_minutes: int | None = Field(default=None, ge=5, le=600)
    general_instructions: list[str] = Field(default_factory=list, max_length=15)
    show_marks: bool = True
    show_roll_no: bool = True

    @field_validator("general_instructions")
    @classmethod
    def _gi(cls, v: list[str]) -> list[str]:
        out = [re.sub(r"\s+", " ", x).strip() for x in v if x and x.strip()]
        if any(len(x) > 300 for x in out):
            raise ValueError("Each instruction can be at most 300 characters")
        return out


class ItemIn(BaseModel):
    item_id: UUID | None = None
    section_id: str | None = Field(default=None, max_length=40)
    question: dict


class PaperCreate(BaseModel):
    class_code: str = Field(min_length=1, max_length=64)
    subject_code: str = Field(min_length=1, max_length=64)
    chapter: str | None = Field(default=None, max_length=300)
    title: str = Field(min_length=2, max_length=300)
    language: Language = "en"


class PaperSave(BaseModel):
    revision: int
    title: str = Field(min_length=2, max_length=300)
    language: Language = "en"
    chapter: str | None = Field(default=None, max_length=300)
    header: Header
    sections: list[Section] = Field(min_length=1, max_length=10)
    items: list[ItemIn] = Field(default_factory=list, max_length=200)


DEFAULT_INSTRUCTIONS = ["All questions are compulsory.", "Marks for each question are shown against it.",
                        "Write neatly and draw diagrams wherever necessary."]


def _valid_items(user: CurrentUser, items: list[ItemIn], section_ids: list[str]) -> list[dict]:
    out = []
    for n, it in enumerate(items, start=1):
        try:
            q = validate_question(it.question)
        except ValidationError as e:
            raise HTTPException(422, f"Question {n}: {error_text(e)}")
        out.append({"item_id": str(it.item_id) if it.item_id else None,
                    "section_id": it.section_id if it.section_id in section_ids else section_ids[0], "question": q})
    store.check_media_owned(user.org_code, store.media_ids_of([i["question"] for i in out]))
    return out


def _paper(user: CurrentUser, paper_id: UUID) -> dict:
    row = store.paper_row(user.org_code, user.user_code, paper_id)
    if not row:
        raise HTTPException(404, "Question paper not found")
    return row


@router.get("/papers", dependencies=[Depends(_no_store)])
def list_papers(user: CurrentUser = Depends(teacher)):
    return {"papers": store.list_papers(user.org_code, user.user_code)}


@router.post("/papers", status_code=status.HTTP_201_CREATED)
def create_paper(body: PaperCreate, user: CurrentUser = Depends(teacher)):
    m = mapping.resolve_for_teacher(user.org_code, user.user_code, body.class_code, body.subject_code)
    if not m:
        raise HTTPException(403, "You can create papers only for classes and subjects you teach")
    if body.chapter and (not m["nlp_class"] or body.chapter not in nlp_catalog.chapters(m["nlp_class"], m["nlp_subject"] or "")):
        raise HTTPException(404, "Chapter not found for this subject")
    year = db.fetch_one("SELECT year_code FROM public.classes WHERE org_code = %s AND class_code = %s",
                        (user.org_code, body.class_code)) or {}
    header = Header(exam_title=body.title.strip(), academic_year=(year.get("year_code") or "")[:20],
                    duration_minutes=60, general_instructions=DEFAULT_INSTRUCTIONS).model_dump(mode="json")
    return store.create_paper(user.org_code, user.user_code, class_code=body.class_code, subject_code=body.subject_code,
                              nlp_class=m["nlp_class"], nlp_subject=m["nlp_subject"], chapter=body.chapter,
                              title=body.title.strip(), language=body.language, header=header,
                              sections=[{"id": "A", "title": "Section A", "instructions": ""}])


@router.get("/papers/{paper_id}", dependencies=[Depends(_no_store)])
def get_paper(paper_id: UUID, user: CurrentUser = Depends(teacher)):
    return store.shape_paper(_paper(user, paper_id))


@router.put("/papers/{paper_id}")
def save_paper(paper_id: UUID, body: PaperSave, user: CurrentUser = Depends(teacher)):
    """Save as draft: header, sections and the full ordered item list in one go (409 on a stale revision)."""
    row = _paper(user, paper_id)
    if body.chapter and body.chapter != row["chapter"] and body.chapter not in nlp_catalog.chapters(row["nlp_class"] or "", row["nlp_subject"] or ""):
        raise HTTPException(404, "Chapter not found for this subject")
    sections = [s.model_dump() for s in body.sections]
    ids = [s["id"] for s in sections]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Section ids must be unique")
    header = body.header.model_dump(mode="json")
    if header.get("logo_media_id"):
        store.check_media_owned(user.org_code, {header["logo_media_id"]})
    items = _valid_items(user, body.items, ids)
    return store.replace_paper(user.org_code, user.user_code, paper_id, revision=body.revision, items=items,
                               fields={"title": body.title.strip(), "language": body.language, "chapter": body.chapter,
                                       "header": header, "sections": sections})


@router.delete("/papers/{paper_id}")
def delete_paper(paper_id: UUID, user: CurrentUser = Depends(teacher)):
    store.delete_paper(user.org_code, user.user_code, paper_id)
    return {"deleted": str(paper_id)}


class ItemsAppend(BaseModel):
    items: list[ItemIn] = Field(min_length=1, max_length=100)
    revision: int | None = None


def _current_items(row: dict) -> list[dict]:
    return store.items_of(row["paper_id"])


def _section_ids(row: dict) -> list[str]:
    return [s["id"] for s in row["sections"] or []] or ["A"]


@router.post("/papers/{paper_id}/items")
def add_items(paper_id: UUID, body: ItemsAppend, user: CurrentUser = Depends(teacher)):
    """Append questions (generated drafts or manual ones); duplicates of questions already on the paper are skipped."""
    row = _paper(user, paper_id)
    new = _valid_items(user, body.items, _section_ids(row))
    cur = _current_items(row)
    dedupe = generator.Dedupe([stem_plain(i["question"]) for i in cur])
    added = [it for it in new if dedupe.add(it["question"])]
    out = store.replace_paper(user.org_code, user.user_code, paper_id, revision=body.revision, fields={},
                              items=cur + added)
    return {**out, "added": len(added), "skipped_duplicates": len(new) - len(added)}


@router.put("/papers/{paper_id}/items/{item_id}")
def update_item(paper_id: UUID, item_id: UUID, body: ItemIn, user: CurrentUser = Depends(teacher)):
    row = _paper(user, paper_id)
    cur = _current_items(row)
    idx = next((i for i, it in enumerate(cur) if it["item_id"] == str(item_id)), None)
    if idx is None:
        raise HTTPException(404, "Question not found on this paper")
    fixed = _valid_items(user, [ItemIn(item_id=item_id, section_id=body.section_id or cur[idx]["section_id"],
                                       question=body.question)], _section_ids(row))[0]
    cur[idx] = fixed
    return store.replace_paper(user.org_code, user.user_code, paper_id, revision=None, fields={}, items=cur)


@router.delete("/papers/{paper_id}/items/{item_id}")
def delete_item(paper_id: UUID, item_id: UUID, user: CurrentUser = Depends(teacher)):
    row = _paper(user, paper_id)
    cur = _current_items(row)
    left = [it for it in cur if it["item_id"] != str(item_id)]
    if len(left) == len(cur):
        raise HTTPException(404, "Question not found on this paper")
    return store.replace_paper(user.org_code, user.user_code, paper_id, revision=None, fields={}, items=left)


@router.post("/papers/{paper_id}/items/{item_id}/duplicate")
def duplicate_item(paper_id: UUID, item_id: UUID, user: CurrentUser = Depends(teacher)):
    """A copy right after the original (new ids; marked MANUAL since the teacher will edit it)."""
    row = _paper(user, paper_id)
    cur = _current_items(row)
    idx = next((i for i, it in enumerate(cur) if it["item_id"] == str(item_id)), None)
    if idx is None:
        raise HTTPException(404, "Question not found on this paper")
    q = {**cur[idx]["question"], "id": new_id("q"), "origin": "MANUAL", "bank_id": None}
    if q.get("data", {}).get("sub_questions"):
        q["data"] = {**q["data"], "sub_questions": [{**s, "id": new_id("q")} for s in q["data"]["sub_questions"]]}
    cur.insert(idx + 1, {"item_id": None, "section_id": cur[idx]["section_id"], "question": q})
    return store.replace_paper(user.org_code, user.user_code, paper_id, revision=None, fields={}, items=cur)


class ReorderBody(BaseModel):
    order: list[UUID] = Field(min_length=1, max_length=200)
    sections: dict[str, str] = Field(default_factory=dict, description="optional item_id → section_id moves")


@router.post("/papers/{paper_id}/reorder")
def reorder(paper_id: UUID, body: ReorderBody, user: CurrentUser = Depends(teacher)):
    row = _paper(user, paper_id)
    cur = {it["item_id"]: it for it in _current_items(row)}
    order = [str(i) for i in body.order]
    if sorted(order) != sorted(cur) or len(set(order)) != len(order):
        raise HTTPException(422, "The new order must list every question on the paper exactly once")
    sids = _section_ids(row)
    items = []
    for i in order:
        it = dict(cur[i])
        sec = body.sections.get(i)
        if sec is not None:
            if sec not in sids:
                raise HTTPException(422, f"Unknown section {sec}")
            it["section_id"] = sec
        items.append(it)
    return store.replace_paper(user.org_code, user.user_code, paper_id, revision=None, fields={}, items=items)


def _full(user: CurrentUser, paper_id: UUID) -> dict:
    row = _paper(user, paper_id)
    p = store.shape_paper(row)
    p["org_code"] = row["org_code"]
    if row["status"] == "PUBLISHED" and row.get("published_snapshot"):
        snap = row["published_snapshot"]   # exports of a published paper always print what was published
        p.update({k: snap[k] for k in ("title", "language", "header", "sections", "items") if k in snap})
    return p


@router.post("/papers/{paper_id}/publish")
def publish_paper(paper_id: UUID, user: CurrentUser = Depends(teacher)):
    """Make the paper final: it can no longer be edited (a new version can be created from it)."""
    def snap(row, items):
        for n, it in enumerate(items, start=1):
            try:
                validate_question(it["question"])
            except ValidationError as e:
                raise HTTPException(422, f"Question {n}: {error_text(e)}")
        p = store.shape_paper(row, items)
        return paper_rules.snapshot(p)
    return store.publish(user.org_code, user.user_code, paper_id, snap)


@router.post("/papers/{paper_id}/new-version", status_code=status.HTTP_201_CREATED)
def new_version(paper_id: UUID, user: CurrentUser = Depends(teacher)):
    return store.new_version(user.org_code, user.user_code, paper_id)


class AssessmentBody(BaseModel):
    assessment_type: Literal["ONLINE_TEST", "ASSIGNMENT"]
    duration_minutes: int | None = Field(default=None, ge=1, le=600)


@router.post("/papers/{paper_id}/assessment", status_code=status.HTTP_201_CREATED)
def create_assessment(paper_id: UUID, body: AssessmentBody, user: CurrentUser = Depends(teacher)):
    """A published paper → a draft Online Test / Assignment (questions saved, READY) in Tests & AI evaluation."""
    ensure_module(user, "ocr_evaluation")
    row = _paper(user, paper_id)
    if row["status"] != "PUBLISHED":
        raise HTTPException(409, "Publish the paper first")
    if not db.call_scalar("usp_can_mark_attendance", user.org_code, user.user_code, row["class_code"], row["subject_code"]):
        raise HTTPException(403, "You can create tests only for subjects you teach")
    p = _full(user, paper_id)
    duration = body.duration_minutes or (p["header"].get("duration_minutes") if body.assessment_type == "ONLINE_TEST" else None)
    if body.assessment_type == "ONLINE_TEST" and not duration:
        raise HTTPException(422, "Online tests need a duration in minutes")
    out = publisher.create_assessment(p, user=user, assessment_type=body.assessment_type, duration_minutes=duration,
                                      ar_codes=store.settings(user.org_code)["ar_codes"])
    store.link_eval_test(row["paper_id"], out["eval_test_id"])
    return out


def _filename(p: dict, suffix: str) -> str:
    base = re.sub(r"[^A-Za-z0-9 _\-]+", "", (p["header"].get("exam_title") or p["title"]))[:80].strip() or "question-paper"
    return f"{base}{suffix}.pdf"


@router.get("/papers/{paper_id}/export.pdf")
def export_pdf(paper_id: UUID, answer_key: bool = False, user: CurrentUser = Depends(teacher)):
    p = _full(user, paper_id)
    data = pdf.render(p, store.settings(user.org_code), answer_key_mode=answer_key)
    name = _filename(p, " - Answer Key" if answer_key else "")
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


# ════════════════════════════════════════════════════════════ question bank
class BankSaveFromPaper(BaseModel):
    item_ids: list[UUID] = Field(default_factory=list, max_length=200)
    visibility: Literal["PRIVATE", "ORG"] = "PRIVATE"


@router.post("/papers/{paper_id}/bank")
def save_to_bank(paper_id: UUID, body: BankSaveFromPaper, user: CurrentUser = Depends(teacher)):
    row = _paper(user, paper_id)
    items = _current_items(row)
    if body.item_ids:
        wanted = {str(i) for i in body.item_ids}
        items = [i for i in items if i["item_id"] in wanted]
    if not items:
        raise HTTPException(422, "No questions to save")
    scope = {"class_code": row["class_code"], "subject_code": row["subject_code"], "nlp_class": row["nlp_class"],
             "nlp_subject": row["nlp_subject"], "chapter": row["chapter"], "language": row["language"],
             "paper_id": row["paper_id"]}
    return store.bank_save(user.org_code, user.user_code, [{"question": i["question"]} for i in items],
                           visibility=body.visibility, scope=scope)


class BankSave(BaseModel):
    class_code: str = Field(min_length=1, max_length=64)
    subject_code: str = Field(min_length=1, max_length=64)
    chapter: str | None = Field(default=None, max_length=300)
    language: Language = "en"
    visibility: Literal["PRIVATE", "ORG"] = "PRIVATE"
    questions: list[dict] = Field(min_length=1, max_length=100)


@router.post("/bank")
def bank_save(body: BankSave, user: CurrentUser = Depends(teacher)):
    m = mapping.resolve_for_teacher(user.org_code, user.user_code, body.class_code, body.subject_code)
    if not m:
        raise HTTPException(403, "You can save questions only for classes and subjects you teach")
    entries = []
    for n, raw in enumerate(body.questions, start=1):
        try:
            entries.append({"question": validate_question(raw)})
        except ValidationError as e:
            raise HTTPException(422, f"Question {n}: {error_text(e)}")
    store.check_media_owned(user.org_code, store.media_ids_of([e["question"] for e in entries]))
    return store.bank_save(user.org_code, user.user_code, entries, visibility=body.visibility,
                           scope={"class_code": body.class_code, "subject_code": body.subject_code,
                                  "nlp_class": m["nlp_class"], "nlp_subject": m["nlp_subject"],
                                  "chapter": body.chapter, "language": body.language})


@router.get("/bank", dependencies=[Depends(_no_store)])
def bank_search(q: str | None = Query(default=None, max_length=200), qtype: QType | None = None,
                difficulty: Difficulty | None = None, bloom: Bloom | None = None, nlp_class: str | None = None,
                nlp_subject: str | None = None, chapter: str | None = None,
                scope: Literal["mine", "org"] = "org", limit: int = Query(default=30, ge=1, le=100),
                offset: int = Query(default=0, ge=0), user: CurrentUser = Depends(teacher)):
    out = store.bank_search(user.org_code, user.user_code, q=q, qtype=qtype, difficulty=difficulty, bloom=bloom,
                            nlp_class=nlp_class, nlp_subject=nlp_subject, chapter=chapter, scope=scope, limit=limit,
                            offset=offset)
    ids = store.media_ids_of([i["question"] for i in out["items"]])
    return {**out, "media": store.media_urls(user.org_code, ids)}


@router.delete("/bank/{bank_id}")
def bank_delete(bank_id: UUID, user: CurrentUser = Depends(teacher)):
    store.bank_delete(user.org_code, user.user_code, bank_id)
    return {"deleted": str(bank_id)}


class FromBank(BaseModel):
    bank_ids: list[UUID] = Field(min_length=1, max_length=100)
    section_id: str | None = Field(default=None, max_length=40)


@router.post("/papers/{paper_id}/items/from-bank")
def add_from_bank(paper_id: UUID, body: FromBank, user: CurrentUser = Depends(teacher)):
    row = _paper(user, paper_id)
    rows = store.bank_get_many(user.org_code, user.user_code, [str(i) for i in body.bank_ids])
    if not rows:
        raise HTTPException(404, "None of those questions are in your question bank")
    items = [ItemIn(section_id=body.section_id, question={**r["question"], "id": new_id("q"), "origin": "BANK",
                                                          "bank_id": str(r["bank_id"])}) for r in rows]
    new = _valid_items(user, items, _section_ids(row))
    cur = _current_items(row)
    dedupe = generator.Dedupe([stem_plain(i["question"]) for i in cur])
    added = [it for it in new if dedupe.add(it["question"])]
    out = store.replace_paper(user.org_code, user.user_code, paper_id, revision=None, fields={}, items=cur + added)
    store.bank_used([str(it["question"]["bank_id"]) for it in added])
    return {**out, "added": len(added), "skipped_duplicates": len(new) - len(added)}


# ════════════════════════════════════════════════════════════ media
@router.post("/media", status_code=status.HTTP_201_CREATED)
def upload_media(file: UploadFile = File(...), user: CurrentUser = Depends(teacher)):
    """PNG / JPEG ≤ 2 MB for question diagrams and the school logo (validated by magic bytes, re-encoded)."""
    limiter.hit(f"qgen-media:{user.org_code}:{user.user_code}", UPLOAD_LIMIT, UPLOAD_WINDOW_S)
    data = file.file.read(store.MAX_IMAGE_BYTES + 1)
    return store.save_media(user.org_code, user.user_code, user["customer_code"], data, file.filename or "")


@router.get("/media/{media_id}")
def media_url(media_id: UUID, user: CurrentUser = Depends(teacher)):
    row = store.media_row(user.org_code, media_id)
    if not row:
        raise HTTPException(404, "Image not found")
    return store.media_urls(user.org_code, {str(media_id)})[str(media_id)]


# ════════════════════════════════════════════════════════════ admin: content mapping + settings
def _admin_org(user: CurrentUser, org_code: str | None) -> str:
    return org_scope(user, org_code)


@admin_router.get("/mappings")
def admin_mappings(org_code: str | None = None, user: CurrentUser = Depends(_admins)):
    org = _admin_org(user, org_code)
    return {"mappings": mapping.org_mappings(org),
            "repository": [{"class_label": c["class_label"], "grade": c["grade"],
                            "subjects": nlp_catalog.subjects(c["class_label"])} for c in nlp_catalog.classes()]}


class MappingBody(BaseModel):
    nlp_class: str = Field(min_length=1, max_length=32)
    nlp_subject: str = Field(min_length=1, max_length=120)


@admin_router.put("/mappings/{class_code}/{subject_code}")
def admin_set_mapping(class_code: str, subject_code: str, body: MappingBody, org_code: str | None = None,
                      user: CurrentUser = Depends(_admins)):
    org = _admin_org(user, org_code)
    if not db.fetch_one("SELECT 1 FROM public.class_subjects WHERE org_code = %s AND class_code = %s AND subject_code = %s",
                        (org, class_code, subject_code)):
        raise HTTPException(404, "Class subject not found")
    if body.nlp_subject not in nlp_catalog.subjects(body.nlp_class):
        raise HTTPException(422, "Choose a class and subject that exist in the content repository")
    db.execute("INSERT INTO public.qgen_subject_map(org_code, class_code, subject_code, nlp_class, nlp_subject, updated_by) "
               "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (org_code, class_code, subject_code) DO UPDATE SET "
               "nlp_class = EXCLUDED.nlp_class, nlp_subject = EXCLUDED.nlp_subject, updated_by = EXCLUDED.updated_by, "
               "updated_at = NOW()", (org, class_code, subject_code, body.nlp_class, body.nlp_subject, user.user_code))
    return {"mappings": mapping.org_mappings(org)}


@admin_router.delete("/mappings/{class_code}/{subject_code}")
def admin_clear_mapping(class_code: str, subject_code: str, org_code: str | None = None,
                        user: CurrentUser = Depends(_admins)):
    org = _admin_org(user, org_code)
    db.execute("DELETE FROM public.qgen_subject_map WHERE org_code = %s AND class_code = %s AND subject_code = %s",
               (org, class_code, subject_code))
    return {"mappings": mapping.org_mappings(org)}


class SettingsBody(BaseModel):
    ar_instruction: str = Field(min_length=10, max_length=600)
    ar_codes: list[str] = Field(min_length=4, max_length=4)

    @field_validator("ar_codes")
    @classmethod
    def _codes(cls, v: list[str]) -> list[str]:
        out = [re.sub(r"\s+", " ", c).strip() for c in v]
        if any(not c or len(c) > 300 for c in out):
            raise ValueError("Each code needs a text of at most 300 characters")
        return out


@admin_router.get("/settings")
def admin_settings(org_code: str | None = None, user: CurrentUser = Depends(_admins)):
    return store.settings(_admin_org(user, org_code))


@admin_router.put("/settings")
def admin_save_settings(body: SettingsBody, org_code: str | None = None, user: CurrentUser = Depends(_admins)):
    return store.save_settings(_admin_org(user, org_code), user.user_code, body.ar_instruction.strip(), body.ar_codes)


@admin_router.delete("/settings")
def admin_reset_settings(org_code: str | None = None, user: CurrentUser = Depends(_admins)):
    return store.reset_settings(_admin_org(user, org_code))

