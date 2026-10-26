"""FR-EV-06: resolve an uploaded script filename ('Aarav_Sharma.pdf', '10A01_Aarav Sharma.pdf', 'REG2026001.pdf')
to a student of the selected class. Order: admission no. -> exact name -> roll prefix -> fuzzy name."""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from pathlib import PurePath

FUZZY_MIN = 0.82
FUZZY_MARGIN = 0.06


def _tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t]


def _name_tokens(filename: str) -> list[str]:
    toks = _tokens(PurePath(filename).stem)
    while toks and any(ch.isdigit() for ch in toks[0]):  # drop leading roll / serial prefixes
        toks = toks[1:]
    return [t for t in toks if not t.isdigit()]


def match_student(filename: str, roster: list[dict], taken: set[str] = frozenset()) -> tuple[str | None, str | None, float | None]:
    """Returns (student_user_code, method, score). `taken` = students already matched in this batch/test."""
    stem = PurePath(filename).stem
    all_tokens = _tokens(stem)
    candidates = [r for r in roster if r["user_code"] not in taken]

    for r in candidates:  # admission number anywhere in the filename
        if r["user_code"].lower() in all_tokens or stem.lower() == r["user_code"].lower():
            return r["user_code"], "code", 1.0

    name = " ".join(_name_tokens(filename))
    if name:
        exact = [r for r in candidates if " ".join(_tokens(r["full_name"])) == name
                 or sorted(_tokens(r["full_name"])) == sorted(name.split())]
        if len(exact) == 1:
            return exact[0]["user_code"], "name", 1.0

    lead = all_tokens[0] if all_tokens else ""
    if lead:
        by_roll = [r for r in candidates if r.get("roll_number") and (
            lead == str(r["roll_number"]).lower() or lead.lstrip("0") == str(r["roll_number"]).lstrip("0").lower())]
        if len(by_roll) == 1 and not name:
            return by_roll[0]["user_code"], "roll", 1.0

    if name:
        scored = sorted(((SequenceMatcher(None, name, " ".join(_tokens(r["full_name"]))).ratio(), r) for r in candidates),
                        key=lambda t: -t[0])
        if scored and scored[0][0] >= FUZZY_MIN and (len(scored) == 1 or scored[0][0] - scored[1][0] >= FUZZY_MARGIN):
            return scored[0][1]["user_code"], "fuzzy", round(scored[0][0], 3)
    return None, None, None
