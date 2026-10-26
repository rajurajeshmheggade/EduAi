"""FR-AUTH: unified login, JWT issuance, refresh, current user."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import db, security
from ..security import CurrentUser, current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255, description="Email or user code (admission / employee no.)")
    password: str = Field(min_length=1, max_length=200)
    org_code: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePassword(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=128)


def _profile(u: dict) -> dict:
    org = db.fetch_one("SELECT * FROM public.organizations WHERE org_code = %s", (u["org_code"],)) or {}
    role = u["user_role"]
    return {
        "user_id": str(u["user_id"]),
        "user_code": u["user_code"],
        "full_name": u["full_name"],
        "email": u["email"],
        "role": role,
        "org_code": u["org_code"],
        "org_name": org.get("org_name"),
        "institution_level": org.get("institution_level", "school"),
        "standalone_mode": bool(org.get("standalone_mode", False)),
        "year_code": u["year_code"],
        "cycle_code": u["cycle_code"],
        "class_code": u["class_code"],
        "roll_number": u.get("roll_number"),
        "qualification": u.get("qualification"),
        # FR-SA-01: bootstrap / temporary passwords must be rotated
        "must_change_password": bool(u.get("must_change_password")),
        "ai_modules": list(org.get("ai_modules") or []),
        "allowed_subjects": list(u["allowed_subjects"] or []),
        # FR-AUTH-03 post-login routing target
        "home_route": {"superadmin": "/admin-dashboard", "orgadmin": "/admin-dashboard",
                       "teacher": "/teacher/dashboard", "student": "/student/dashboard"}[role],
    }


@router.post("/login")
def login(body: LoginRequest):
    user = security.authenticate(body.email, body.password, body.org_code)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return {**security.issue_tokens(user), "user": _profile(user)}


@router.post("/refresh")
def refresh(body: RefreshRequest):
    data = security.decode_token(body.refresh_token, "refresh")
    user = db.call_row("usp_get_user_by_id", UUID(data["sub"]))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer active")
    return {**security.issue_tokens(user), "user": _profile(user)}


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)):
    u = db.call_row("usp_get_user_by_id", UUID(user["user_id"]))
    if not u:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer active")
    return _profile(u)


@router.post("/change-password")
def change_password(body: ChangePassword, user: CurrentUser = Depends(current_user)):
    u = db.call_row("usp_get_user_by_id", UUID(user["user_id"]))
    if not u or not security.verify_password(body.current_password, u["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be different")
    db.execute("UPDATE public.app_users SET password_hash = %s, must_change_password = FALSE WHERE user_id = %s",
               (security.hash_password(body.new_password), u["user_id"]))
    return {"ok": True}
