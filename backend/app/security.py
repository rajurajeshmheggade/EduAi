"""Auth: bcrypt password hashing, JWT access/refresh tokens, RBAC dependencies."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings
from . import db

_bearer = HTTPBearer(auto_error=False)

ADMIN_ROLES = ("superadmin", "orgadmin")


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


def _encode(payload: dict[str, Any], delta: timedelta, kind: str) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    return jwt.encode({**payload, "typ": kind, "iat": now, "exp": now + delta}, s.jwt_secret, algorithm=s.jwt_algorithm)


def issue_tokens(user: dict) -> dict:
    s = get_settings()
    claims = {
        "sub": str(user["user_id"]),
        "user_id": str(user["user_id"]),
        "user_code": user["user_code"],
        "role": user["user_role"],
        "org_code": user["org_code"],
        "customer_code": user["customer_code"],
        "allowed_subjects": list(user["allowed_subjects"] or []),
    }
    return {
        "access_token": _encode(claims, timedelta(minutes=s.access_token_minutes), "access"),
        "refresh_token": _encode({"sub": claims["sub"]}, timedelta(days=s.refresh_token_days), "refresh"),
        "token_type": "bearer",
        "expires_in": s.access_token_minutes * 60,
    }


def decode_token(token: str, expected: str) -> dict:
    s = get_settings()
    try:
        data = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    if data.get("typ") != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    return data


class CurrentUser(dict):
    @property
    def role(self) -> str:
        return self["role"]

    @property
    def org_code(self) -> str:
        return self["org_code"]

    @property
    def user_code(self) -> str:
        return self["user_code"]

    def can_access_subject(self, subject_code: str) -> bool:
        if self.role in ADMIN_ROLES:
            return True
        return subject_code in self["allowed_subjects"]


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> CurrentUser:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    return CurrentUser(decode_token(creds.credentials, "access"))


def require_role(*roles: str):
    allowed = set(roles)

    def dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role: {', '.join(sorted(allowed))}")
        return user

    return dep


def ensure_subject_access(user: CurrentUser, subject_code: str) -> None:
    if not user.can_access_subject(subject_code):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"No access to subject {subject_code}")


def ensure_module(user: CurrentUser, module: str) -> None:
    """FR-SA-02: the platform owner enables AI modules per institution."""
    org = db.fetch_one("SELECT ai_modules FROM public.organizations WHERE org_code = %s", (user.org_code,))
    if org is not None and module not in (org["ai_modules"] or []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This AI module is not enabled for your institution")


def authenticate(email: str, password: str, org_code: str | None) -> dict | None:
    user = db.call_row("usp_get_user_by_email", email, org_code)
    if user and verify_password(password, user["password_hash"]):
        return user
    return None
