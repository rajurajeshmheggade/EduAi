"""Shared helpers for creating institution members (teachers by admins, students by class teachers)."""
from __future__ import annotations

import re
import secrets
import string
from typing import Annotated

from fastapi import HTTPException
from pydantic import StringConstraints

from .. import db
from ..security import hash_password

CODE_RE = r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$"
Code = Annotated[str, StringConstraints(strip_whitespace=True, pattern=CODE_RE)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=255,
                                         pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_ALPHABET = string.ascii_letters + string.digits
_PROFILE_SQL = "UPDATE public.app_users SET qualification = %s, must_change_password = %s WHERE user_id = %s"


def temp_password() -> str:
    """Readable one-time password, e.g. 'Edu-k3P9xQ2m'. Returned once to the creator, never stored in plain text."""
    return "Edu-" + "".join(secrets.choice(_ALPHABET) for _ in range(8))


def normalise_email(email: str | None, user_code: str, org_code: str) -> str:
    if email and email.strip():
        e = email.strip().lower()
        if not _EMAIL.match(e) or len(e) > 255:
            raise HTTPException(422, f"Invalid email: {email}")
        return e
    # Younger students often have no email: they sign in with their admission number instead.
    return f"{user_code.lower()}@{org_code.lower()}.noemail.local"


def new_student_code(org_code: str) -> str:
    return f"{org_code[:12].upper()}-S{secrets.randbelow(10**6):06d}"


def create_member(
    *, org_code: str, customer_code: str, role: str, full_name: str, user_code: str, email: str | None,
    password: str | None, created_by: str, year_code: str | None = None, cycle_code: str | None = None,
    class_code: str | None = None, subjects: list[str] | None = None, phone: str | None = None,
    roll_number: str | None = None, guardian_name: str | None = None, guardian_phone: str | None = None,
    qualification: str | None = None, conn=None,
) -> dict:
    """Creates the user (strict: duplicate code/email -> 409 via the app's UniqueViolation handler)."""
    pw = password or temp_password()
    args = (
        user_code, org_code, customer_code, full_name, normalise_email(email, user_code, org_code),
        hash_password(pw), role, year_code, cycle_code, class_code, subjects or [], phone or None,
        roll_number or None, guardian_name or None, guardian_phone or None, created_by,
    )
    sql = "SELECT public.usp_create_member(" + ",".join(["%s"] * 10) + ",%s::text[]," + ",".join(["%s"] * 5) + ") AS v"
    # A server-generated password is temporary: the user is asked to change it after first sign-in (FR-SA-01).

    def run(c) -> object:
        uid = c.execute(sql, args).fetchone()["v"]
        c.execute(_PROFILE_SQL, (qualification or None, password is None, uid))
        return uid

    if conn is not None:
        user_id = run(conn)
    else:
        with db.connection() as c:
            user_id = run(c)
    return {
        "user_id": str(user_id),
        "user_code": user_code,
        "full_name": full_name,
        "email": args[4],
        "role": role,
        "class_code": class_code,
        # Only returned when the server generated it — show it once, ask the user to change it.
        "temporary_password": None if password else pw,
    }
