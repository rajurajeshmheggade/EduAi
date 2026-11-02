"""Admission question payloads: validation shared by manual edits, imports, the HQ bank and AI drafts."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from . import ai, prompts
from .scoring import HQ_TYPES

QType = Literal["MCQ", "MULTI", "NUMERICAL", "SHORT", "DESCRIPTIVE", "SJT", "REFLECTIVE", "IDEAS"]
SECTION_KINDS = ("ACADEMIC", "APTITUDE", "LANGUAGE", "HQ")


class RubricItem(BaseModel):
    criterion: str = Field(min_length=1, max_length=300)
    marks: float = Field(ge=0, le=100)


class QuestionIn(BaseModel):
    section: str = Field(min_length=1, max_length=32)
    qtype: QType
    prompt: str = Field(min_length=3, max_length=5000)
    options: list[str] = Field(default_factory=list, max_length=8)
    answer_key: dict | None = None
    rubric: list[RubricItem] = Field(default_factory=list, max_length=12)
    model_answer: str | None = Field(default=None, max_length=5000)
    marks: float = Field(default=1, ge=0, le=100)
    topic: str | None = Field(default=None, max_length=200)
    difficulty: Literal["EASY", "MEDIUM", "HARD"] | None = None
    hq_dimension: Literal["IQ", "EQ", "SQ", "AQ", "CQ"] | None = None
    status: Literal["DRAFT", "APPROVED"] = "APPROVED"

    @field_validator("options")
    @classmethod
    def _options(cls, v: list[str]) -> list[str]:
        out = [str(o).strip()[:500] for o in v]
        if any(not o for o in out):
            raise ValueError("options cannot be empty")
        if len({o.lower() for o in out}) != len(out):
            raise ValueError("options must be different from each other")
        return out

    @model_validator(mode="after")
    def _shape(self):
        q, k, n = self.qtype, self.answer_key or {}, len(self.options)
        if q in ("MCQ", "MULTI", "SJT") and n < 2:
            raise ValueError("a choice question needs at least two options")
        if q not in ("MCQ", "MULTI", "SJT"):
            self.options = []
        if q == "MCQ":
            opt = k.get("option")
            if not isinstance(opt, int) or isinstance(opt, bool) or not 0 <= opt < n:
                raise ValueError("a single-answer MCQ needs exactly one correct option")
            self.answer_key = {"option": opt}
        elif q == "MULTI":
            opts = k.get("options")
            if not isinstance(opts, list) or not opts or any(not isinstance(x, int) or not 0 <= x < n for x in opts):
                raise ValueError("mark the correct options of a multiple-answer question")
            self.answer_key = {"options": sorted(set(opts))}
        elif q == "SJT":
            pts = k.get("points")
            if not isinstance(pts, list) or len(pts) != n or any(p not in (0, 1, 2) for p in pts) or pts.count(2) != 1:
                raise ValueError("an SJT item needs points 2 / 1 / 0 for every option with exactly one Best (2)")
            self.answer_key = {"points": [int(p) for p in pts]}
            self.marks = 2
        elif q == "NUMERICAL":
            if k.get("value") is not None:
                try:
                    self.answer_key = {"value": float(k["value"]), "tolerance": abs(float(k.get("tolerance") or 0.01))}
                except (TypeError, ValueError):
                    raise ValueError("the numerical answer must be a number") from None
            else:
                self.answer_key = None
        elif q == "SHORT":
            accept = [str(a).strip() for a in (k.get("accept") or []) if str(a).strip()][:10]
            regex = (k.get("regex") or "").strip() or None
            if regex:
                try:
                    re.compile(regex)
                except re.error:
                    raise ValueError("the accepted-answer pattern is not a valid regular expression") from None
            self.answer_key = {"accept": accept, "regex": regex} if accept or regex else None
        else:
            self.answer_key = None
        if q in HQ_TYPES:
            if not self.hq_dimension:
                raise ValueError("HQ items need a dimension (IQ, EQ, SQ, AQ or CQ)")
            if q != "SJT":
                self.marks = 0
        return self


def norm_prompt(s: str) -> str:
    return re.sub(r"\W+", " ", (s or "").lower()).strip()


def age_band_for_grade(grade_applying: str | None) -> str:
    """'Class 6' / 'Grade 6' / '6' -> the HQ age band of a typical candidate (age ≈ class + 5)."""
    m = re.search(r"\d{1,2}", grade_applying or "")
    if not m:
        return "12-14"
    age = int(m.group(0)) + 5
    return "6-8" if age <= 8 else "9-11" if age <= 11 else "12-14" if age <= 14 else "15-17"


def draft(kind: Literal["HQ", "ACADEMIC"], test: dict, *, section: str, age_band: str, topic: str | None, count: int,
          existing: list[str]) -> tuple[list[dict], str, int]:
    """AI-drafted items (status DRAFT). Returns (items, source, rejected). Invalid items and duplicates are dropped."""
    system = prompts.DRAFT.format(grade_applying=test["grade_applying"], age_band=age_band)
    if kind == "HQ":
        user = prompts.DRAFT_HQ_USER.format(sjt=count, reflective=2)
    else:
        user = prompts.DRAFT_ACADEMIC_USER.format(count=count, topic=topic or test["title"], section=section)

    seen = {norm_prompt(p) for p in existing}
    rejected = 0

    def validate(d: dict) -> list[dict]:
        nonlocal rejected
        out = []
        for raw in (d.get("items") or [])[:30]:
            try:
                q = QuestionIn(section=section, status="DRAFT", **{k: v for k, v in raw.items() if k in QuestionIn.model_fields
                                                                    and k not in ("section", "status")})
            except Exception:  # noqa: BLE001 — drop a malformed item, keep the rest
                rejected += 1
                continue
            if kind == "HQ" and q.qtype not in HQ_TYPES or kind == "ACADEMIC" and q.qtype in HQ_TYPES:
                rejected += 1
                continue
            key = norm_prompt(q.prompt)
            if key in seen:
                rejected += 1
                continue
            seen.add(key)
            out.append({**q.model_dump(), "rubric": [r.model_dump() for r in q.rubric]})
        if not out:
            raise ValueError("no usable items")
        return out

    items, source = ai.run("draft", system, user, validate, temperature=0.4)
    return items or [], source, rejected
