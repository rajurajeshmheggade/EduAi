"""One-time applicant credentials and applicant sessions for the standalone admission app.

* Username: school prefix + 8 random characters (no look-alikes), e.g. DEMO-K7QX3P9M. Password: 12 random characters
  in three groups (~70 bits), bcrypt-hashed; the plain text is returned once to the issuing staff member and never
  stored or logged.
* Access token: a JWT with its own audience (`eduai-admission-applicant`), issuer, type and a signing key derived from
  JWT_SECRET for this purpose only. LMS endpoints refuse it (different key, unexpected audience, wrong type) and the
  applicant endpoints refuse LMS tokens. Every request re-checks the session row and the credential in the database,
  so removing a credential ends its sessions at once.
* Refresh token: 32 random bytes, SHA-256 at rest, rotated on every use, absolute session lifetime.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, status

from ...config import get_settings
from ...security import hash_password
from ..admission_test.guard import RateLimiter

AUDIENCE = "eduai-admission-applicant"
ISSUER = "eduai-admission"
TOKEN_TYPE = "applicant"
ACCESS_MINUTES = 15
SESSION_HOURS = 12
MAX_FAILED = 5                       # wrong passwords before the credential locks
LOCK_MINUTES = 15
_ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"                       # no I, O, 0, 1
_PW = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"   # no I, O, l, o, 0, 1
# A real bcrypt hash of a random throwaway secret: verifying against it when a username does not exist keeps the
# response time of "unknown user" and "wrong password" alike.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(24))

limiter = RateLimiter()


def now() -> datetime:
    return datetime.now(timezone.utc)


def _rand(alphabet: str, n: int) -> str:
    return "".join(secrets.choice(alphabet) for _ in range(n))


def new_username(org_code: str) -> str:
    prefix = "".join(ch for ch in org_code.upper() if ch.isalnum())[:4] or "APP"
    return f"{prefix}-{_rand(_ALNUM, 8)}"


def new_password() -> str:
    while True:
        pw = _rand(_PW, 12)
        if any(c.isupper() for c in pw) and any(c.islower() for c in pw) and any(c.isdigit() for c in pw):
            return f"{pw[:4]}-{pw[4:8]}-{pw[8:]}"


def new_reference() -> str:
    return f"APP-{_rand(_ALNUM, 4)}-{_rand(_ALNUM, 4)}"


def dummy_verify(password: str) -> None:
    from ...security import verify_password

    verify_password(password, _DUMMY_HASH)


def normalise_username(u: str) -> str:
    return u.strip().upper()


# ---------------------------------------------------------------- tokens
def _key() -> str:
    s = get_settings()
    return hashlib.sha256(f"{s.jwt_secret}:{AUDIENCE}".encode()).hexdigest()


def issue_access(*, session_id, application_id, credential_id, org_code: str, form_id) -> str:
    t = now()
    claims = {"sub": str(application_id), "sid": str(session_id), "cid": str(credential_id), "org": org_code,
              "form": str(form_id), "typ": TOKEN_TYPE, "aud": AUDIENCE, "iss": ISSUER, "iat": t,
              "exp": t + timedelta(minutes=ACCESS_MINUTES)}
    return jwt.encode(claims, _key(), algorithm="HS256")


def decode_access(token: str) -> dict:
    try:
        data = jwt.decode(token, _key(), algorithms=["HS256"], audience=AUDIENCE, issuer=ISSUER,
                          options={"require": ["exp", "iat", "aud", "iss", "sub", "sid"]})
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please sign in again.") from None
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in to the admission application.") from None
    if data.get("typ") != TOKEN_TYPE:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in to the admission application.")
    return data


def new_refresh() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- download links (staff)
DOC_AUDIENCE = "eduai-admission-document"


def _doc_key() -> str:
    s = get_settings()
    return hashlib.sha256(f"{s.jwt_secret}:{DOC_AUDIENCE}".encode()).hexdigest()


def sign_download(payload: dict, minutes: int = 5) -> str:
    t = now()
    return jwt.encode({**payload, "aud": DOC_AUDIENCE, "iat": t, "exp": t + timedelta(minutes=minutes)}, _doc_key(), algorithm="HS256")


def read_download(token: str) -> dict:
    try:
        return jwt.decode(token, _doc_key(), algorithms=["HS256"], audience=DOC_AUDIENCE, options={"require": ["exp", "aud"]})
    except jwt.PyJWTError:
        raise HTTPException(403, "This download link has expired or is not valid") from None
