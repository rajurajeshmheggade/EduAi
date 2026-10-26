"""k=3 RAG chatbot + Whisper voice input."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import db
from ..providers import get_llm
from ..security import CurrentUser, ensure_module, ensure_subject_access, require_role
from ..services import rag

router = APIRouter(prefix="/ICMELive/api/v1/rag", tags=["rag"])
voice_router = APIRouter(prefix="/ICMELive", tags=["rag"])

chat_users = require_role("student", "teacher")


class RagQuery(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    subject_code: str = Field(min_length=1, max_length=64)
    textbook_id: UUID | None = None
    current_page: int | None = Field(default=None, ge=1)
    session_id: UUID | None = None
    stream: bool = True


@router.post("/query")
def query(body: RagQuery, user: CurrentUser = Depends(chat_users)):
    ensure_subject_access(user, body.subject_code)
    ensure_module(user, "rag_chatbot")
    session_id, cites, tokens = rag.answer(
        query=body.query.strip(),
        subject_code=body.subject_code,
        org_code=user.org_code,
        student_code=user.user_code,
        textbook_id=body.textbook_id,
        current_page=body.current_page,
        session_id=body.session_id,
        published_only=user.role == "student",  # teachers can preview unpublished books
    )
    if body.stream:
        return StreamingResponse(
            rag.sse_stream(session_id, cites, tokens),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    answer_text = "".join(tokens)
    return {"session_id": session_id, "answer": answer_text, "citations": cites, "k": len(cites)}


@router.get("/history/{session_id}")
def history(session_id: UUID, user: CurrentUser = Depends(chat_users)):
    rows = db.fetch_all(
        "SELECT message_id, student_query, ai_response_markdown, retrieved_pages, created_at "
        "FROM public.rag_chat_messages WHERE session_id = %s AND student_user_code = %s ORDER BY created_at",
        (session_id, user.user_code),
    )
    return {"session_id": session_id, "messages": rows}


@router.get("/top-doubts/{subject_code}")
def top_doubts(subject_code: str, user: CurrentUser = Depends(require_role("teacher", "orgadmin", "superadmin"))):
    ensure_subject_access(user, subject_code)
    return {"subject_code": subject_code, "doubts": db.call_rows("usp_top_doubts", user.org_code, subject_code, 10)}


@voice_router.post("/transcribe-audio")
def transcribe_audio(audio: UploadFile = File(...), user: CurrentUser = Depends(chat_users)):
    data = audio.file.read(25 * 1024 * 1024 + 1)
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "Audio exceeds 25 MB")
    try:
        text = get_llm().transcribe(data, audio.filename or "audio.webm")
    except NotImplementedError as e:
        raise HTTPException(501, str(e))
    return {"text": text}
