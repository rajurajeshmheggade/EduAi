"""AI Classroom's chapter-library reader (students): browse Class -> Subject -> Chapter PDFs dropped into
backend/nlp/ (see services/nlp_catalog.py's classroom_* functions), read them, and ask an AI assistant about
the page currently open. Separate from the existing textbook-upload classroom (/student/classroom/textbook,
backed by curriculum.py + rag.py + read_aloud.py) — this one needs no teacher upload or vectorisation step,
since it reads straight off the same curated filesystem catalogue Lesson Plans already use."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .. import db
from ..security import CurrentUser, require_role
from ..services import ai_classroom, nlp_catalog

router = APIRouter(prefix="/ICMELive/api/v1/ai-classroom/nlp", tags=["ai-classroom"])
students = require_role("student")


def _ensure_enabled(user: CurrentUser) -> None:
    """Either AI module gates this, same OR as the "AI Classroom" nav item itself."""
    org = db.fetch_one("SELECT ai_modules FROM public.organizations WHERE org_code = %s", (user.org_code,))
    mods = org and org["ai_modules"]
    if mods is not None and not any(m in mods for m in ("rag_chatbot", "ai_avatar_tutor")):
        raise HTTPException(403, "This AI module is not enabled for your institution")


def _grade(class_label: str) -> int | None:
    return next((c["grade"] for c in nlp_catalog.classroom_classes() if c["class_label"] == class_label), None)


def _page_text(class_label: str, subject: str, chapter: str, page: int) -> str:
    try:
        pages = nlp_catalog.classroom_chapter_pages(class_label, subject, chapter)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    if not 1 <= page <= len(pages):
        raise HTTPException(404, f"This chapter has {len(pages)} page(s)")
    return pages[page - 1]


@router.get("/classes")
def list_classes(user: CurrentUser = Depends(students)):
    _ensure_enabled(user)
    return {"classes": nlp_catalog.classroom_classes()}


@router.get("/subjects")
def list_subjects(class_label: str, user: CurrentUser = Depends(students)):
    _ensure_enabled(user)
    return {"subjects": nlp_catalog.classroom_subjects(class_label)}


@router.get("/chapters")
def list_chapters(class_label: str, subject: str, user: CurrentUser = Depends(students)):
    _ensure_enabled(user)
    return {"chapters": nlp_catalog.classroom_chapters(class_label, subject)}


@router.get("/chapter-pdf")
def chapter_pdf(class_label: str, subject: str, chapter: str, user: CurrentUser = Depends(students)):
    _ensure_enabled(user)
    path = nlp_catalog.classroom_chapter_pdf_path(class_label, subject, chapter)
    if not path:
        raise HTTPException(404, f"No PDF for chapter '{chapter}' ({subject}, class {class_label})")
    return Response(path.read_bytes(), media_type="application/pdf")


class AskIn(BaseModel):
    class_label: str = Field(min_length=1, max_length=20)
    subject: str = Field(min_length=1, max_length=120)
    chapter: str = Field(min_length=1, max_length=200)
    page: int = Field(ge=1, le=5000)
    question: str = Field(min_length=2, max_length=1000)
    history: list[dict] = Field(default_factory=list, max_length=12)


@router.post("/ask")
def ask(body: AskIn, user: CurrentUser = Depends(students)):
    _ensure_enabled(user)
    text = _page_text(body.class_label, body.subject, body.chapter, body.page)
    history = [{"role": m.get("role"), "content": str(m.get("content") or "")} for m in body.history if m.get("role") in ("user", "assistant")]
    answer, engine = ai_classroom.ask(class_label=body.class_label, subject=body.subject, chapter=body.chapter,
                                      grade=_grade(body.class_label), page=body.page, page_text=text,
                                      question=body.question.strip(), history=history)
    return {"answer": answer, "engine": engine}


class ExplainIn(BaseModel):
    class_label: str = Field(min_length=1, max_length=20)
    subject: str = Field(min_length=1, max_length=120)
    chapter: str = Field(min_length=1, max_length=200)
    page: int = Field(ge=1, le=5000)


@router.post("/explain")
def explain(body: ExplainIn, user: CurrentUser = Depends(students)):
    _ensure_enabled(user)
    text = _page_text(body.class_label, body.subject, body.chapter, body.page)
    explanation, engine = ai_classroom.explain(class_label=body.class_label, subject=body.subject, chapter=body.chapter,
                                               grade=_grade(body.class_label), page=body.page, page_text=text)
    return {"explanation": explanation, "engine": engine}
