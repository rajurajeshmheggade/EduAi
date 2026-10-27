"""Admin: syllabus per class subject (chapters -> sub-topics), plus a read-only view for the subject's teachers."""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..security import CurrentUser, require_role
from ..services.syllabus import parse_outline
from .admin import org_scope

router = APIRouter(prefix="/ICMELive/api/v1/admin/classes", tags=["syllabus"])
teacher_router = APIRouter(prefix="/ICMELive/api/v1/classroom", tags=["syllabus"])
admins = require_role("orgadmin", "superadmin")
teachers = require_role("teacher")

MAX_CHAPTERS = 200
MAX_TOPICS = 100
Title = Field(min_length=1, max_length=300)


class ChapterIn(BaseModel):
    title: str = Title
    description: str | None = Field(default=None, max_length=2000)
    topics: list[str] = Field(default_factory=list, max_length=MAX_TOPICS)


class ChapterPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=2000)


class TopicsIn(BaseModel):
    titles: list[str] = Field(min_length=1, max_length=MAX_TOPICS)


class TopicPatch(BaseModel):
    title: str = Title


class Move(BaseModel):
    direction: Literal["up", "down"]


class ImportIn(BaseModel):
    text: str = Field(min_length=1, max_length=50_000)
    mode: Literal["append", "replace"] = "append"


class CopyIn(BaseModel):
    from_class_code: str = Field(min_length=1, max_length=64)
    mode: Literal["append", "replace"] = "replace"


# ---------------------------------------------------------------- helpers
def _subject_or_404(org: str, class_code: str, subject_code: str) -> dict:
    row = db.fetch_one(
        "SELECT subject_code, subject_name FROM public.class_subjects WHERE org_code = %s AND class_code = %s AND subject_code = %s",
        (org, class_code, subject_code))
    if not row:
        raise HTTPException(404, "Subject not found in this class")
    return row


def _syllabus(org: str, class_code: str, subject_code: str) -> dict:
    chapters = db.fetch_all(
        "SELECT chapter_id, position, title, description FROM public.syllabus_chapters "
        "WHERE org_code = %s AND class_code = %s AND subject_code = %s ORDER BY position, created_at",
        (org, class_code, subject_code))
    topics = db.fetch_all(
        "SELECT t.topic_id, t.chapter_id, t.position, t.title FROM public.syllabus_topics t "
        "JOIN public.syllabus_chapters c ON c.chapter_id = t.chapter_id "
        "WHERE c.org_code = %s AND c.class_code = %s AND c.subject_code = %s ORDER BY t.position, t.created_at",
        (org, class_code, subject_code))
    by_ch: dict = {}
    for t in topics:
        by_ch.setdefault(t["chapter_id"], []).append({"topic_id": t["topic_id"], "title": t["title"]})
    out = [{"chapter_id": c["chapter_id"], "number": i, "title": c["title"], "description": c["description"],
            "topics": by_ch.get(c["chapter_id"], [])} for i, c in enumerate(chapters, 1)]
    return {"class_code": class_code, "subject_code": subject_code, "chapters": out,
            "chapter_count": len(out), "topic_count": len(topics)}


def _chapter_or_404(org: str, class_code: str, subject_code: str, chapter_id: UUID) -> dict:
    row = db.fetch_one(
        "SELECT chapter_id, position FROM public.syllabus_chapters "
        "WHERE chapter_id = %s AND org_code = %s AND class_code = %s AND subject_code = %s",
        (chapter_id, org, class_code, subject_code))
    if not row:
        raise HTTPException(404, "Chapter not found")
    return row


def _topic_or_404(org: str, class_code: str, subject_code: str, topic_id: UUID) -> dict:
    row = db.fetch_one(
        "SELECT t.topic_id, t.chapter_id, t.position FROM public.syllabus_topics t "
        "JOIN public.syllabus_chapters c ON c.chapter_id = t.chapter_id "
        "WHERE t.topic_id = %s AND c.org_code = %s AND c.class_code = %s AND c.subject_code = %s",
        (topic_id, org, class_code, subject_code))
    if not row:
        raise HTTPException(404, "Sub-topic not found")
    return row


def _insert_chapters(conn, org: str, class_code: str, subject_code: str, chapters: list[dict], replace: bool) -> None:
    if replace:
        conn.execute("DELETE FROM public.syllabus_chapters WHERE org_code = %s AND class_code = %s AND subject_code = %s",
                     (org, class_code, subject_code))
    cur = conn.execute(
        "SELECT COALESCE(MAX(position), 0) AS p, COUNT(*) AS n FROM public.syllabus_chapters "
        "WHERE org_code = %s AND class_code = %s AND subject_code = %s", (org, class_code, subject_code)).fetchone()
    pos, count = cur["p"], cur["n"]
    if count + len(chapters) > MAX_CHAPTERS:
        raise HTTPException(422, f"A subject can have at most {MAX_CHAPTERS} chapters")
    for ch in chapters:
        if len(ch.get("topics", [])) > MAX_TOPICS:
            raise HTTPException(422, f"A chapter can have at most {MAX_TOPICS} sub-topics")
        pos += 1
        row = conn.execute(
            "INSERT INTO public.syllabus_chapters (org_code, class_code, subject_code, position, title, description) "
            "VALUES (%s,%s,%s,%s,%s,%s) RETURNING chapter_id",
            (org, class_code, subject_code, pos, ch["title"].strip(), (ch.get("description") or None))).fetchone()
        cid = row["chapter_id"]
        for i, t in enumerate(x.strip() for x in ch.get("topics", []) if x.strip()):
            conn.execute("INSERT INTO public.syllabus_topics (chapter_id, position, title) VALUES (%s,%s,%s)", (cid, i + 1, t))


def _swap(table: str, key: str, row_id: UUID, scope_sql: str, scope_args: tuple, position: int, direction: str) -> None:
    """Swap positions with the neighbour above/below within the same list (table/key/scope are code constants)."""
    op, order = ("<", "DESC") if direction == "up" else (">", "ASC")
    other = db.fetch_one(
        f"SELECT {key}, position FROM public.{table} WHERE {scope_sql} AND position {op} %s ORDER BY position {order} LIMIT 1",
        (*scope_args, position))
    if not other:
        return
    with db.connection() as conn:
        conn.execute(f"UPDATE public.{table} SET position = %s WHERE {key} = %s", (other["position"], row_id))
        conn.execute(f"UPDATE public.{table} SET position = %s WHERE {key} = %s", (position, other[key]))


# ---------------------------------------------------------------- admin endpoints
@router.get("/{class_code}/syllabus-summary")
def syllabus_summary(class_code: str, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Chapter / sub-topic counts per subject of a class (for the subjects table)."""
    org = org_scope(user, org_code)
    rows = db.fetch_all(
        "SELECT c.subject_code, COUNT(DISTINCT c.chapter_id) AS chapters, COUNT(t.topic_id) AS topics "
        "FROM public.syllabus_chapters c LEFT JOIN public.syllabus_topics t ON t.chapter_id = c.chapter_id "
        "WHERE c.org_code = %s AND c.class_code = %s GROUP BY c.subject_code", (org, class_code))
    return {"subjects": {r["subject_code"]: {"chapters": r["chapters"], "topics": r["topics"]} for r in rows}}


@router.get("/{class_code}/subjects/{subject_code}/syllabus")
def get_syllabus(class_code: str, subject_code: str, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _subject_or_404(org, class_code, subject_code)
    return _syllabus(org, class_code, subject_code)


@router.post("/{class_code}/subjects/{subject_code}/syllabus/chapters", status_code=201)
def add_chapter(class_code: str, subject_code: str, body: ChapterIn, org_code: str | None = None,
                user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _subject_or_404(org, class_code, subject_code)
    with db.connection() as conn:
        _insert_chapters(conn, org, class_code, subject_code, [body.model_dump()], replace=False)
    return _syllabus(org, class_code, subject_code)


@router.post("/{class_code}/subjects/{subject_code}/syllabus/import")
def import_syllabus(class_code: str, subject_code: str, body: ImportIn, org_code: str | None = None,
                    user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _subject_or_404(org, class_code, subject_code)
    try:
        chapters = parse_outline(body.text)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not chapters:
        raise HTTPException(422, "Nothing to import — add one chapter per line")
    with db.connection() as conn:
        _insert_chapters(conn, org, class_code, subject_code, chapters, replace=body.mode == "replace")
    return _syllabus(org, class_code, subject_code)


@router.post("/{class_code}/subjects/{subject_code}/syllabus/copy")
def copy_syllabus(class_code: str, subject_code: str, body: CopyIn, org_code: str | None = None,
                  user: CurrentUser = Depends(admins)):
    """Copy chapters + sub-topics of the same subject from another class (e.g. Section A -> Section B)."""
    org = org_scope(user, org_code)
    _subject_or_404(org, class_code, subject_code)
    if body.from_class_code == class_code:
        raise HTTPException(422, "Choose a different class to copy from")
    _subject_or_404(org, body.from_class_code, subject_code)
    src = _syllabus(org, body.from_class_code, subject_code)["chapters"]
    if not src:
        raise HTTPException(422, f"{body.from_class_code} has no syllabus for {subject_code} yet")
    chapters = [{"title": c["title"], "description": c["description"], "topics": [t["title"] for t in c["topics"]]} for c in src]
    with db.connection() as conn:
        _insert_chapters(conn, org, class_code, subject_code, chapters, replace=body.mode == "replace")
    return _syllabus(org, class_code, subject_code)


@router.patch("/{class_code}/subjects/{subject_code}/syllabus/chapters/{chapter_id}")
def update_chapter(class_code: str, subject_code: str, chapter_id: UUID, body: ChapterPatch, org_code: str | None = None,
                   user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _chapter_or_404(org, class_code, subject_code, chapter_id)
    fields = body.model_dump(exclude_unset=True)
    if "title" in fields:
        fields["title"] = fields["title"].strip()
    if fields:
        sets = ", ".join(f"{k} = %s" for k in fields)
        db.execute(f"UPDATE public.syllabus_chapters SET {sets}, updated_at = NOW() WHERE chapter_id = %s",
                   (*fields.values(), chapter_id))
    return _syllabus(org, class_code, subject_code)


@router.delete("/{class_code}/subjects/{subject_code}/syllabus/chapters/{chapter_id}")
def delete_chapter(class_code: str, subject_code: str, chapter_id: UUID, org_code: str | None = None,
                   user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _chapter_or_404(org, class_code, subject_code, chapter_id)
    db.execute("DELETE FROM public.syllabus_chapters WHERE chapter_id = %s", (chapter_id,))
    return _syllabus(org, class_code, subject_code)


@router.post("/{class_code}/subjects/{subject_code}/syllabus/chapters/{chapter_id}/move")
def move_chapter(class_code: str, subject_code: str, chapter_id: UUID, body: Move, org_code: str | None = None,
                 user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    ch = _chapter_or_404(org, class_code, subject_code, chapter_id)
    _swap("syllabus_chapters", "chapter_id", chapter_id, "org_code = %s AND class_code = %s AND subject_code = %s",
          (org, class_code, subject_code), ch["position"], body.direction)
    return _syllabus(org, class_code, subject_code)


@router.post("/{class_code}/subjects/{subject_code}/syllabus/chapters/{chapter_id}/topics", status_code=201)
def add_topics(class_code: str, subject_code: str, chapter_id: UUID, body: TopicsIn, org_code: str | None = None,
               user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _chapter_or_404(org, class_code, subject_code, chapter_id)
    titles = [t.strip() for t in body.titles if t.strip()]
    if not titles or any(len(t) > 300 for t in titles):
        raise HTTPException(422, "Each sub-topic needs a title of 1–300 characters")
    with db.connection() as conn:
        row = conn.execute("SELECT COALESCE(MAX(position), 0) AS p, COUNT(*) AS n FROM public.syllabus_topics "
                           "WHERE chapter_id = %s", (chapter_id,)).fetchone()
        pos, count = row["p"], row["n"]
        if count + len(titles) > MAX_TOPICS:
            raise HTTPException(422, f"A chapter can have at most {MAX_TOPICS} sub-topics")
        for i, t in enumerate(titles, 1):
            conn.execute("INSERT INTO public.syllabus_topics (chapter_id, position, title) VALUES (%s,%s,%s)", (chapter_id, pos + i, t))
    return _syllabus(org, class_code, subject_code)


@router.patch("/{class_code}/subjects/{subject_code}/syllabus/topics/{topic_id}")
def update_topic(class_code: str, subject_code: str, topic_id: UUID, body: TopicPatch, org_code: str | None = None,
                 user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _topic_or_404(org, class_code, subject_code, topic_id)
    db.execute("UPDATE public.syllabus_topics SET title = %s WHERE topic_id = %s", (body.title.strip(), topic_id))
    return _syllabus(org, class_code, subject_code)


@router.delete("/{class_code}/subjects/{subject_code}/syllabus/topics/{topic_id}")
def delete_topic(class_code: str, subject_code: str, topic_id: UUID, org_code: str | None = None,
                 user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _topic_or_404(org, class_code, subject_code, topic_id)
    db.execute("DELETE FROM public.syllabus_topics WHERE topic_id = %s", (topic_id,))
    return _syllabus(org, class_code, subject_code)


@router.post("/{class_code}/subjects/{subject_code}/syllabus/topics/{topic_id}/move")
def move_topic(class_code: str, subject_code: str, topic_id: UUID, body: Move, org_code: str | None = None,
               user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    t = _topic_or_404(org, class_code, subject_code, topic_id)
    _swap("syllabus_topics", "topic_id", topic_id, "chapter_id = %s", (t["chapter_id"],), t["position"], body.direction)
    return _syllabus(org, class_code, subject_code)


# ---------------------------------------------------------------- teachers: read-only
@teacher_router.get("/syllabus")
def teacher_syllabus(class_code: str, subject_code: str, user: CurrentUser = Depends(teachers)):
    """The syllabus of a subject the teacher teaches (or of their own class)."""
    if not db.call_scalar("usp_can_mark_attendance", user.org_code, user.user_code, class_code, subject_code):
        raise HTTPException(403, "You can view the syllabus only for subjects you teach or for your own class")
    _subject_or_404(user.org_code, class_code, subject_code)
    return _syllabus(user.org_code, class_code, subject_code)
