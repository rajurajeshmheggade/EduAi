"""Admin Copilot (#13): aggregated, anonymised institution Q&A for staff. See services/copilot.py for the
privacy contract and snapshot assembly."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..security import CurrentUser, require_role
from ..services import copilot

router = APIRouter(prefix="/ICMELive/api/v1/copilot", tags=["copilot"])

# Mirrors the frontend's COPILOT_ROLES (components/AppShell.tsx) — the roles that see the Copilot drawer at all.
# Students get a strictly narrower, own-data-only snapshot — see services/copilot.py build_student_snapshot().
copilot_users = require_role("superadmin", "orgadmin", "teacher", "counsellor", "reviewer", "student")


class CopilotQuery(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    org_code: str | None = None
    stream: bool = True


@router.post("/query")
def query(body: CopilotQuery, user: CurrentUser = Depends(copilot_users)):
    # Only a superadmin may pick a different institution; everyone else is always scoped to their own.
    org = body.org_code if user.role == "superadmin" and body.org_code else user.org_code
    tokens = copilot.answer(body.query.strip(), org, user)
    if body.stream:
        return StreamingResponse(
            copilot.sse_stream(tokens),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    return {"answer": "".join(tokens)}
