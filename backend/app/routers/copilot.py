"""Admin Copilot (#13): aggregated, anonymised institution Q&A for staff. See services/copilot.py for the
privacy contract and snapshot assembly."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..providers import get_copilot_llm
from ..security import CurrentUser, require_role
from ..services import copilot
from ..services.admission_test.guard import RateLimiter

router = APIRouter(prefix="/ICMELive/api/v1/copilot", tags=["copilot"])
log = logging.getLogger(__name__)

# Mirrors the frontend's COPILOT_ROLES (components/AppShell.tsx) — the roles that see the Copilot panel at all.
# Students get a strictly narrower, own-data-only snapshot — see services/copilot.py build_student_snapshot().
copilot_users = require_role("superadmin", "orgadmin", "teacher", "counsellor", "reviewer", "student")

# Voice messages (MediaRecorder fallback when the browser has no speech recognition of its own).
MAX_AUDIO_BYTES = 4 * 1024 * 1024  # ~4 min of Opus; the panel stops recording after 60 s
AUDIO_TYPES = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac",
               "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/flac": "flac"}
VOICE_LIMIT = (20, 600)  # voice messages per user per 10 minutes
voice_limiter = RateLimiter()


class CopilotQuery(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    org_code: str | None = None
    stream: bool = True


@router.get("/status")
def status(user: CurrentUser = Depends(copilot_users)):
    """Is Copilot answering with a live AI provider or offline demo answers? Mode and booleans only."""
    return copilot.status()


@router.post("/query")
def query(body: CopilotQuery, user: CurrentUser = Depends(copilot_users)):
    # Only a superadmin may pick a different institution; everyone else is always scoped to their own.
    org = body.org_code if user.role == "superadmin" and body.org_code else user.org_code
    turn = copilot.prepare(body.query.strip(), org, user)
    if body.stream:
        return StreamingResponse(
            copilot.sse_stream(turn),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    answer = "".join(turn.tokens())
    return {"answer": answer, "suggestions": turn.suggestions(answer)}


@router.post("/transcribe")
async def transcribe(request: Request, user: CurrentUser = Depends(copilot_users)):
    """Speech-to-text for a Copilot voice message: the raw recording is the request body (Content-Type audio/*).
    The text goes back to the input box for the user to review — nothing is stored."""
    mime = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if mime not in AUDIO_TYPES:
        raise HTTPException(415, f"Unsupported audio type '{mime or 'none'}'")
    if int(request.headers.get("content-length") or 0) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "That voice message is too long — please keep it under a minute")
    voice_limiter.hit(f"copilot-voice:{user.org_code}:{user.user_code}", *VOICE_LIMIT,
                      message="Too many voice messages — please wait a moment and try again")
    audio = await request.body()
    if not audio:
        raise HTTPException(400, "No audio received")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "That voice message is too long — please keep it under a minute")
    if not copilot.ai_ready():
        raise HTTPException(501, "Voice messages need the AI key (offline demo mode) — please type your question")
    try:
        text = await run_in_threadpool(get_copilot_llm().transcribe, audio, f"voice.{AUDIO_TYPES[mime]}")
    except NotImplementedError:
        raise HTTPException(501, "Voice messages need the AI key (offline demo mode) — please type your question")
    except Exception as exc:  # noqa: BLE001
        log.error("Copilot transcription failed: %s", exc)
        raise HTTPException(502, "Couldn't transcribe that voice message — please try again")
    return {"text": " ".join((text or "").split())[:2000]}
