"""Curriculum & Vectorization: textbook upload, vector status, publish toggle, How-to-Teach guides."""
from __future__ import annotations

from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import db
from ..config import get_settings
from ..security import CurrentUser, current_user, ensure_subject_access, require_role
from ..services import teaching_guide
from ..services.guide_pdf import guide_to_pdf
from ..services.storage import build_key, get_storage
from ..workers.tasks import enqueue

router = APIRouter(prefix="/ICMELive/api/v1/curriculum", tags=["curriculum"])

teacher_only = require_role("teacher")
teacher_or_admin = require_role("teacher", "orgadmin", "superadmin")


def _load_textbook(textbook_id: UUID, user: CurrentUser) -> dict:
    tb = db.call_row("usp_get_textbook", textbook_id)
    if not tb or (user.role != "superadmin" and tb["org_code"] != user.org_code):
        raise HTTPException(404, "Textbook not found")
    return tb


def _present(tb: dict, with_chapters: bool = True) -> dict:
    out = {k: v for k, v in tb.items() if k != "blob_pdf_url"}
    out["pdf_url"] = get_storage().signed_url(tb["blob_pdf_url"])  # time-bound SAS-style URL
    if with_chapters and tb["vector_status"] == "indexed":
        out["chapters"] = db.call_rows("usp_list_chapters", tb["textbook_id"])
    else:
        out["chapters"] = []
    return out


@router.post("/upload-textbook", status_code=status.HTTP_202_ACCEPTED)
def upload_textbook(
    file: UploadFile = File(...),
    title: str = Form(..., min_length=2, max_length=300),
    subject_code: str = Form(..., min_length=1, max_length=64),
    year_code: str | None = Form(None),
    cycle_code: str | None = Form(None),
    class_code: str | None = Form(None),
    user: CurrentUser = Depends(teacher_only),
):
    ensure_subject_access(user, subject_code)
    s = get_settings()
    data = file.file.read(s.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {s.max_upload_mb} MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "Only PDF files are supported")

    key = build_key(user["customer_code"], user.org_code, year_code, cycle_code, subject_code,
                    f"Textbooks-{uuid4().hex[:8]}", "textbook.pdf")
    get_storage().put(key, data, "application/pdf")
    tb_id = db.call_scalar("usp_create_textbook", user.org_code, year_code, cycle_code, class_code,
                           subject_code, title, key, user.user_code)
    job_id = db.call_scalar("usp_create_job", "textbook_vectorize", str(tb_id))
    enqueue("vectorize_textbook", textbook_id=str(tb_id), job_id=str(job_id))
    return {"textbook_id": tb_id, "job_id": job_id, "vector_status": "pending"}


@router.get("/textbooks/{subject_code}")
def list_textbooks(subject_code: str, user: CurrentUser = Depends(current_user)):
    ensure_subject_access(user, subject_code)
    published_only = user.role == "student"
    rows = db.call_rows("usp_list_textbooks", user.org_code, subject_code, published_only)
    return {"subject_code": subject_code, "textbooks": [_present(r) for r in rows]}


class PublishRequest(BaseModel):
    published: bool


@router.post("/textbooks/{textbook_id}/publish")
def publish(textbook_id: UUID, body: PublishRequest, user: CurrentUser = Depends(teacher_only)):
    tb = _load_textbook(textbook_id, user)
    ensure_subject_access(user, tb["subject_code"])
    if body.published and tb["vector_status"] != "indexed":
        raise HTTPException(409, "Textbook must be fully indexed before publishing")
    db.call_scalar("usp_set_textbook_published", textbook_id, user.org_code, body.published)
    return {"textbook_id": textbook_id, "is_published_to_students": body.published}


@router.get("/jobs/{job_id}")
def job_status(job_id: UUID, user: CurrentUser = Depends(teacher_or_admin)):
    job = db.call_row("usp_get_job", job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


class GuideRequest(BaseModel):
    textbook_id: UUID
    chapter_number: int = Field(ge=1)
    duration_minutes: Literal[30, 45, 60, 90] = 45
    institution_level: Literal["school", "college", "coaching"] | None = None


@router.post("/generate-teaching-guide")
def generate_guide(body: GuideRequest, user: CurrentUser = Depends(teacher_only)):
    tb = _load_textbook(body.textbook_id, user)
    ensure_subject_access(user, tb["subject_code"])
    if tb["vector_status"] != "indexed":
        raise HTTPException(409, "Textbook is not indexed yet")
    level = body.institution_level
    if not level:
        org = db.fetch_one("SELECT institution_level FROM public.organizations WHERE org_code = %s", (user.org_code,))
        level = (org or {}).get("institution_level", "school")
    try:
        return teaching_guide.generate_guide(tb["textbook_id"], tb["subject_code"], body.chapter_number, level, body.duration_minutes)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.get("/guides/{textbook_id}")
def list_guides(textbook_id: UUID, user: CurrentUser = Depends(teacher_or_admin)):
    tb = _load_textbook(textbook_id, user)
    return {"textbook_id": textbook_id, "guides": db.call_rows("usp_list_teaching_guides", tb["textbook_id"])}


class GuideUpdate(BaseModel):
    lesson_plan_markdown: str | None = None
    analogies_and_hooks: dict | None = None
    board_work_blueprint: list | None = None
    common_misconceptions: list | None = None
    formative_questions: list | None = None


def _guide_for(guide_id: UUID, user: CurrentUser) -> dict:
    g = db.call_row("usp_get_teaching_guide", guide_id)
    if not g:
        raise HTTPException(404, "Guide not found")
    _load_textbook(g["textbook_id"], user)
    return g


@router.put("/guides/{guide_id}")
def update_guide(guide_id: UUID, body: GuideUpdate, user: CurrentUser = Depends(teacher_only)):
    g = _guide_for(guide_id, user)
    ensure_subject_access(user, g["subject_code"])
    j = lambda v: Jsonb(v) if v is not None else None  # noqa: E731
    db.call_scalar("usp_update_teaching_guide", guide_id, body.lesson_plan_markdown, j(body.analogies_and_hooks),
                   j(body.board_work_blueprint), j(body.common_misconceptions), j(body.formative_questions),
                   casts=[None, None, "jsonb", "jsonb", "jsonb", "jsonb"])
    return db.call_row("usp_get_teaching_guide", guide_id)


@router.get("/guides/{guide_id}/export.pdf")
def export_guide(guide_id: UUID, user: CurrentUser = Depends(teacher_only)):
    g = _guide_for(guide_id, user)
    return Response(guide_to_pdf(g), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="teaching-guide-ch{g["chapter_number"]}.pdf"'})
