"""AI avatar tutor explains / reads the textbook aloud (student AI Classroom; teachers can preview).

GET  /textbooks/{id}/voice                                      teacher whose avatar + voice reads this book
GET  /textbooks/{id}/pages/{page}?mode=explain|read[&prefetch=]  spoken script of one page (+ the AI lesson)
GET  /textbooks/{id}/pages/{page}/segments/{i}/audio?mode=&v=   synthesised audio of one part (voice chosen server-side)
GET  /textbooks/{id}/pages/{page}/status?mode=                  cheap readiness of this page and the next ones
POST /textbooks/{id}/pages/{page}/prepare?mode=                 the reader opened this page: aim their pipeline here
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response

from .. import db
from ..config import get_settings
from ..providers.speech import SpeechUnavailable, get_speech
from ..security import CurrentUser, ensure_module, ensure_subject_access, require_role
from ..services import read_aloud
from ..services.read_aloud import Mode

router = APIRouter(prefix="/ICMELive/api/v1/read-aloud", tags=["read-aloud"])
log = logging.getLogger("eduai.read_aloud")

readers = require_role("student", "teacher")


def _textbook(textbook_id: UUID, user: CurrentUser) -> dict:
    tb = db.call_row("usp_get_textbook", textbook_id)
    if not tb or tb["org_code"] != user.org_code or (user.role == "student" and not tb["is_published_to_students"]):
        raise HTTPException(404, "Textbook not found")
    ensure_subject_access(user, tb["subject_code"])
    ensure_module(user, "ai_avatar_tutor")
    if tb["vector_status"] != "indexed":
        raise HTTPException(409, "This textbook is still being processed")
    return tb


def _engine() -> str:
    try:
        return get_speech().engine
    except SpeechUnavailable:
        return "Unavailable"


def _check_page(tb: dict, page: int) -> None:
    if page > tb["total_pages"] > 0:
        raise HTTPException(404, "No such page")


def _script(tb: dict, page: int, mode: Mode, version: str | None = None) -> dict:
    _check_page(tb, page)
    try:
        if version:
            script = read_aloud.script_version(tb, page, mode, version)
            if script is None:
                raise HTTPException(409, "This page's explanation has been updated. Open the page again.")
            return script
        return read_aloud.page_script(tb, page, mode)
    except LookupError:
        raise HTTPException(404, "No such page") from None


def _window(tb: dict, page: int, mode: Mode, voice: str) -> dict:
    last = min(tb["total_pages"] or page, page + max(0, get_settings().read_aloud_lookahead_pages))
    return {"page": page, "mode": mode, "pages": [read_aloud.page_status(tb, p, mode, voice) for p in range(page, max(page, last) + 1)]}


@router.get("/textbooks/{textbook_id}/voice")
def voice(textbook_id: UUID, user: CurrentUser = Depends(readers)):
    tb = _textbook(textbook_id, user)
    return {**read_aloud.avatar_teacher(user, tb), "engine": _engine()}


@router.get("/textbooks/{textbook_id}/pages/{page}")
def page(textbook_id: UUID, page: int = Path(ge=1, le=5000), mode: Mode = Query("explain"),
         prefetch: bool = Query(False, description="the reader is not on this page yet: don't move their pipeline"),
         user: CurrentUser = Depends(readers)):
    tb = _textbook(textbook_id, user)
    script = _script(tb, page, mode)
    if get_settings().read_aloud_prewarm and script["segments"] and not prefetch:
        read_aloud.prepare(tb, page, mode, read_aloud.avatar_teacher(user, tb)["voice"], user.user_code)
    return {"textbook_id": textbook_id, "page": page, "total_pages": tb["total_pages"], "mode": mode,
            "segments": [{"index": i, **s} for i, s in enumerate(script["segments"])],
            "lesson": script["lesson"], "engine": script["engine"], "version": script.get("version"),
            "fallback": bool(script.get("fallback"))}


@router.get("/textbooks/{textbook_id}/pages/{page}/status")
def page_status(textbook_id: UUID, page: int = Path(ge=1, le=5000), mode: Mode = Query("explain"),
                user: CurrentUser = Depends(readers)):
    """ready / preparing / queued / failed / idle for this page and the next READ_ALOUD_LOOKAHEAD_PAGES — cheap
    (no AI call, no PDF parsing), safe to poll."""
    tb = _textbook(textbook_id, user)
    _check_page(tb, page)
    return _window(tb, page, mode, read_aloud.avatar_teacher(user, tb)["voice"])


@router.post("/textbooks/{textbook_id}/pages/{page}/prepare")
def prepare(textbook_id: UUID, page: int = Path(ge=1, le=5000), mode: Mode = Query("explain"),
            user: CurrentUser = Depends(readers)):
    """The reader opened this page (playing or not): their background pipeline now prepares this page and the next
    ones; queued work for pages they left is cancelled. Returns the readiness like /status."""
    tb = _textbook(textbook_id, user)
    _check_page(tb, page)
    voice = read_aloud.avatar_teacher(user, tb)["voice"]
    if get_settings().read_aloud_prewarm:
        read_aloud.prepare(tb, page, mode, voice, user.user_code)
    return _window(tb, page, mode, voice)


@router.get("/textbooks/{textbook_id}/pages/{page}/segments/{index}/audio")
def segment_audio(textbook_id: UUID, page: int = Path(ge=1, le=5000), index: int = Path(ge=0, lt=read_aloud.MAX_SEGMENTS),
                  mode: Mode = Query("explain"),
                  v: str | None = Query(None, max_length=32, description="script version the reader is playing"),
                  user: CurrentUser = Depends(readers)):
    tb = _textbook(textbook_id, user)
    segments = _script(tb, page, mode, v)["segments"]
    if index >= len(segments):
        raise HTTPException(404, "No such segment")
    v = read_aloud.avatar_teacher(user, tb)["voice"]
    try:
        data, mime = read_aloud.segment_audio(segments[index]["text"], v)
    except SpeechUnavailable as e:
        log.warning("read-aloud voice failed (%s p%s #%s): %s", textbook_id, page, index, e)
        raise HTTPException(503, str(e)) from None
    return Response(content=data, media_type=mime, headers={"Cache-Control": "private, max-age=86400", "X-Voice": v})
