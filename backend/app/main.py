"""EduAI Platform API (ICMELive v2)."""
from __future__ import annotations

import logging
import mimetypes
from contextlib import asynccontextmanager

import jwt
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from psycopg import errors as pg_errors

from . import db
from .config import get_settings
from .routers import admin, assessments, auth, classroom, curriculum, dashboards, evaluation, lessonplan, public, rag
from .services.storage import LocalStorage, get_storage

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.get_pool()
    yield
    db.close_pool()


app = FastAPI(title="EduAI Platform API", version="2.0.0", lifespan=lifespan)
s = get_settings()
app.add_middleware(
    CORSMiddleware, allow_origins=s.cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

# Static/config routes are declared before any parameterised ones; every dynamic path is namespaced
# under its router prefix (fixes the baseline /ICMELive/{reg_number} route-shadowing bug).
app.include_router(auth.router)
app.include_router(curriculum.router)
app.include_router(rag.router)
app.include_router(rag.voice_router)
app.include_router(admin.router)
app.include_router(classroom.router)
app.include_router(evaluation.router)
app.include_router(evaluation.admin_router)
app.include_router(assessments.router)
app.include_router(public.router)
app.include_router(dashboards.router)
app.include_router(public.admin_router)
# Session routes are registered first: their prefix is nested under the lesson-plan prefix.
app.include_router(lessonplan.sessions_router)
app.include_router(lessonplan.router)


@app.exception_handler(pg_errors.UniqueViolation)
def _duplicate(_: Request, exc: pg_errors.UniqueViolation):
    what = (exc.diag.constraint_name or "").lower()
    field = "email" if "email" in what else "code" if ("code" in what or "pkey" in what) else "record"
    return JSONResponse({"detail": f"Already exists: a record with this {field} is already registered"}, status_code=409)


def _ai_configured() -> bool:
    if s.provider_mode == "azure":
        return bool(s.azure_openai_endpoint and s.azure_openai_api_key)
    if s.provider_mode == "openai":
        return bool(s.openai_api_key)
    return True


@app.get("/health", tags=["system"])
def health():
    row = db.fetch_one("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    return {"status": "ok", "provider_mode": s.provider_mode, "ai_keys_configured": _ai_configured(),
            "pgvector": row["extversion"] if row else None}


@app.get("/files/{token}", tags=["system"], include_in_schema=False)
def serve_file(token: str):
    """Local-storage equivalent of an Azure SAS URL: signed + expiring."""
    storage = get_storage()
    if not isinstance(storage, LocalStorage):
        raise HTTPException(404)
    try:
        key = storage.verify_token(token)
    except jwt.PyJWTError:
        raise HTTPException(403, "Link expired or invalid")
    path = storage.resolve_path(key)
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream")
