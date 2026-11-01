"""Read-only Class -> Subject -> Chapter catalogue (backend/nlp/), used by Lesson Plans (#4 chapter content)
and Online Test AI question generation (#22) — NOT by the Digital Library, which has its own DIKSHA/board
catalogue and is intentionally left alone."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..security import CurrentUser, require_role
from ..services import nlp_catalog

router = APIRouter(prefix="/ICMELive/api/v1/nlp", tags=["nlp-catalog"])

staff = require_role("teacher", "orgadmin", "superadmin")


@router.get("/classes")
def list_classes(_: CurrentUser = Depends(staff)):
    return {"classes": nlp_catalog.classes()}


@router.get("/subjects")
def list_subjects(class_label: str, _: CurrentUser = Depends(staff)):
    return {"subjects": nlp_catalog.subjects(class_label)}


@router.get("/chapters")
def list_chapters(class_label: str, subject: str, _: CurrentUser = Depends(staff)):
    return {"chapters": nlp_catalog.chapters(class_label, subject)}


@router.get("/chapter-text")
def get_chapter_text(class_label: str, subject: str, chapter: str, _: CurrentUser = Depends(staff)):
    try:
        return {"text": nlp_catalog.chapter_text(class_label, subject, chapter)}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
