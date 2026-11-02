"""Admission form definitions: schema (sections, fields, document requirements, instructions), the default template,
and validation of an applicant's answers. Mirrored in the front end by `frontend/src/lib/admissionForm.ts`.

A definition is JSON:
    {"instructions": str, "declaration": str,
     "sections": [{"key", "title", "description", "kind": student|guardian|academic|custom,
                   "fields": [{"key", "label", "type", "required", "help", "placeholder", "options", "min", "max",
                               "max_length", "core"}]}],
     "documents": [{"key", "label", "required", "accept": [pdf|jpg|png], "max_mb", "max_files", "help"}]}

Answers are a flat object keyed by field key. "Core" fields feed the application record itself (name, date of birth and
class for the review queue and the public status lookup) and the admissions CRM (applicants / guardians).
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

KEY_RE = r"^[a-z][a-z0-9_]{1,39}$"
FieldType = Literal["text", "textarea", "email", "phone", "date", "number", "select", "checkbox", "grade"]
SectionKind = Literal["student", "guardian", "academic", "custom"]
DocKind = Literal["pdf", "jpg", "png"]
CoreKey = Literal["student_name", "date_of_birth", "grade_applying", "gender", "previous_school", "guardian_name",
                  "guardian_relationship", "guardian_phone", "guardian_email"]

# core key -> (allowed field types, must be required)
CORE: dict[str, tuple[tuple[str, ...], bool]] = {
    "student_name": (("text",), True),
    "date_of_birth": (("date",), True),
    "grade_applying": (("grade",), True),
    "gender": (("select",), False),
    "previous_school": (("text",), False),
    "guardian_name": (("text",), True),
    "guardian_relationship": (("select",), True),
    "guardian_phone": (("phone",), True),
    "guardian_email": (("email",), False),
}
REQUIRED_CORE = tuple(k for k, (_, req) in CORE.items() if req)
GRADES = list(range(-2, 13))
_GRADE_NAMES = {-2: "Nursery", -1: "LKG", 0: "UKG"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
PHONE_RE = re.compile(r"^\+?[0-9][0-9 \-()]{5,19}$")
MIN_AGE, MAX_AGE = 2, 25


def grade_label(g: int | None) -> str:
    if g is None:
        return ""
    return _GRADE_NAMES.get(g, f"Class {g}")


def age_on(dob: date, when: date | None = None) -> int:
    w = when or date.today()
    return w.year - dob.year - ((w.month, w.day) < (dob.month, dob.day))


class FieldDef(BaseModel):
    key: str = Field(pattern=KEY_RE)
    label: str = Field(min_length=1, max_length=150)
    type: FieldType
    required: bool = False
    help: str | None = Field(default=None, max_length=300)
    placeholder: str | None = Field(default=None, max_length=120)
    options: list[str] = Field(default_factory=list, max_length=50)
    min: float | None = None
    max: float | None = None
    max_length: int | None = Field(default=None, ge=1, le=4000)
    core: CoreKey | None = None

    @field_validator("label", "help", "placeholder")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def _shape(self) -> "FieldDef":
        if self.type == "select":
            opts = [o.strip() for o in self.options]
            if not opts or any(not o or len(o) > 100 for o in opts):
                raise ValueError(f"{self.key}: a choice list needs 1–50 options of up to 100 characters")
            if len({o.lower() for o in opts}) != len(opts):
                raise ValueError(f"{self.key}: options must be unique")
            self.options = opts
        elif self.options:
            self.options = []
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError(f"{self.key}: minimum is above maximum")
        if self.core:
            types, must = CORE[self.core]
            if self.type not in types:
                raise ValueError(f"{self.key}: the {self.core.replace('_', ' ')} field must be of type {types[0]}")
            if must:
                self.required = True
        return self


class SectionDef(BaseModel):
    key: str = Field(pattern=KEY_RE)
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    kind: SectionKind = "custom"
    fields: list[FieldDef] = Field(default_factory=list, max_length=40)


class DocumentDef(BaseModel):
    key: str = Field(pattern=KEY_RE)
    label: str = Field(min_length=1, max_length=150)
    required: bool = False
    accept: list[DocKind] = Field(default_factory=lambda: ["pdf", "jpg", "png"], min_length=1, max_length=3)
    max_mb: int = Field(default=5, ge=1, le=10)
    max_files: int = Field(default=1, ge=1, le=5)
    help: str | None = Field(default=None, max_length=300)

    @field_validator("accept")
    @classmethod
    def _accept(cls, v: list[str]) -> list[str]:
        return sorted(set(v), key=["pdf", "jpg", "png"].index)


class Definition(BaseModel):
    instructions: str = Field(default="", max_length=10_000)
    declaration: str = Field(default="", max_length=2000)
    sections: list[SectionDef] = Field(min_length=1, max_length=12)
    documents: list[DocumentDef] = Field(default_factory=list, max_length=15)

    @model_validator(mode="after")
    def _keys(self) -> "Definition":
        if len({s.key for s in self.sections}) != len(self.sections):
            raise ValueError("section keys must be unique")
        keys = [f.key for s in self.sections for f in s.fields]
        if len(keys) > 150:
            raise ValueError("a form can have at most 150 fields")
        if len(set(keys)) != len(keys):
            dup = sorted({k for k in keys if keys.count(k) > 1})
            raise ValueError(f"field keys must be unique across the form: {', '.join(dup)}")
        doc_keys = [d.key for d in self.documents]
        if len(set(doc_keys)) != len(doc_keys):
            raise ValueError("document keys must be unique")
        cores = [f.core for s in self.sections for f in s.fields if f.core]
        if len(set(cores)) != len(cores):
            raise ValueError("each core field may appear only once")
        return self

    def publish_problems(self) -> list[str]:
        """Checks that only apply at publication (a draft may be incomplete)."""
        problems = []
        cores = {f.core for s in self.sections for f in s.fields if f.core}
        missing = [k for k in REQUIRED_CORE if k not in cores]
        if missing:
            problems.append("Add the required fields: " + ", ".join(k.replace("_", " ") for k in missing))
        if not any(s.fields for s in self.sections):
            problems.append("Add at least one field")
        if not self.declaration.strip():
            problems.append("Add the declaration the applicant confirms before submitting")
        for s in self.sections:
            if not s.fields:
                problems.append(f"Section “{s.title}” has no fields")
        return problems


def fields_of(defn: dict) -> list[dict]:
    return [f for s in defn.get("sections", []) for f in s.get("fields", [])]


def core_field(defn: dict, core: str) -> dict | None:
    return next((f for f in fields_of(defn) if f.get("core") == core), None)


# ---------------------------------------------------------------- answers
DRAFT_MAX_CHARS = 5000


def clean_draft(defn: dict, answers: dict[str, Any]) -> dict[str, Any]:
    """Autosave: keep known fields with scalar values; formats and required fields are checked on submission."""
    known = {f["key"]: f for f in fields_of(defn)}
    out: dict[str, Any] = {}
    for k, v in answers.items():
        if k not in known or v is None:
            continue
        if isinstance(v, bool) or isinstance(v, (int, float)):
            out[k] = v
        elif isinstance(v, str):
            v = v.strip()
            if len(v) > DRAFT_MAX_CHARS:
                raise ValueError(f"{known[k]['label']}: too long")
            if v:
                out[k] = v
        else:
            raise ValueError(f"{known[k]['label']}: unsupported value")
    return out


def _parse_date(v: Any) -> date:
    if not isinstance(v, str):
        raise ValueError
    return date.fromisoformat(v)


def check_value(f: dict, v: Any, grades: list[int]) -> tuple[Any, str | None]:
    """(normalised value, error or None) for one non-empty value."""
    t = f["type"]
    if t in ("text", "textarea"):
        if not isinstance(v, str):
            return None, "Enter text"
        limit = f.get("max_length") or (200 if t == "text" else 2000)
        return (v, None) if len(v) <= limit else (None, f"Use at most {limit} characters")
    if t == "email":
        return (v.lower(), None) if isinstance(v, str) and EMAIL_RE.match(v) and len(v) <= 254 else (None, "Enter a valid email address")
    if t == "phone":
        return (v, None) if isinstance(v, str) and PHONE_RE.match(v) else (None, "Enter a valid phone number")
    if t == "date":
        try:
            d = _parse_date(v)
        except ValueError:
            return None, "Enter a valid date"
        if f.get("core") == "date_of_birth" and not MIN_AGE <= age_on(d) <= MAX_AGE:
            return None, f"The date of birth gives an age outside {MIN_AGE}–{MAX_AGE} years"
        return d.isoformat(), None
    if t == "number":
        try:
            n = float(v) if not isinstance(v, bool) else None
        except (TypeError, ValueError):
            n = None
        if n is None:
            return None, "Enter a number"
        if f.get("min") is not None and n < f["min"]:
            return None, f"Must be at least {f['min']:g}"
        if f.get("max") is not None and n > f["max"]:
            return None, f"Must be at most {f['max']:g}"
        return (int(n) if n.is_integer() else n), None
    if t == "select":
        return (v, None) if v in f.get("options", []) else (None, "Choose one of the options")
    if t == "checkbox":
        return (v, None) if isinstance(v, bool) else (None, "Tick or untick the box")
    if t == "grade":
        try:
            g = int(v)
        except (TypeError, ValueError):
            return None, "Choose a class"
        return (g, None) if g in grades else (None, "Choose one of the classes offered")
    return None, "Unsupported field"


def validate_answers(defn: dict, answers: dict[str, Any], grades: list[int]) -> tuple[dict[str, Any], list[dict]]:
    """Full check for submission: required fields, formats, options. Returns (clean answers, [{field, message}])."""
    clean: dict[str, Any] = {}
    errors: list[dict] = []
    for f in fields_of(defn):
        v = answers.get(f["key"])
        if isinstance(v, str):
            v = v.strip()
        empty = v is None or v == "" or (f["type"] == "checkbox" and v is False)
        if empty:
            if f.get("required"):
                errors.append({"field": f["key"], "label": f["label"], "message": "This field is required"})
            elif f["type"] == "checkbox" and v is False:
                clean[f["key"]] = False
            continue
        val, err = check_value(f, v, grades)
        if err:
            errors.append({"field": f["key"], "label": f["label"], "message": err})
        else:
            clean[f["key"]] = val
    return clean, errors


def core_values(defn: dict, answers: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for f in fields_of(defn):
        if f.get("core") and answers.get(f["key"]) not in (None, ""):
            out[f["core"]] = answers[f["key"]]
    return out


def document_problems(defn: dict, counts: dict[str, int]) -> list[dict]:
    out = []
    for d in defn.get("documents", []):
        n = counts.get(d["key"], 0)
        if d.get("required") and n == 0:
            out.append({"field": d["key"], "label": d["label"], "message": "Upload this document"})
        elif n > d.get("max_files", 1):
            out.append({"field": d["key"], "label": d["label"], "message": f"Upload at most {d.get('max_files', 1)} file(s)"})
    return out


# ---------------------------------------------------------------- default template
def _f(key: str, label: str, type_: str, required: bool = False, **kw: Any) -> dict:
    return {"key": key, "label": label, "type": type_, "required": required, **kw}


def default_definition() -> dict:
    return {
        "instructions": (
            "Please read before you begin:\n"
            "• Keep the student's birth certificate, a recent passport-size photograph and the latest report card ready "
            "as PDF, JPEG or PNG files (up to 5 MB each).\n"
            "• Your answers are saved automatically; you can sign out and continue later with the same credentials "
            "until they expire.\n"
            "• After you submit, these credentials stop working. Note the application reference number to track "
            "the status of your application."),
        "declaration": ("I confirm that the information in this application is true and complete, and that I am the "
                        "student's parent or legal guardian (or the student applying with their consent)."),
        "sections": [
            {"key": "student", "title": "Student information", "kind": "student", "description": None, "fields": [
                _f("student_name", "Student's full name", "text", True, core="student_name", max_length=200),
                _f("date_of_birth", "Date of birth", "date", True, core="date_of_birth"),
                _f("gender", "Gender", "select", False, core="gender", options=["Female", "Male", "Other", "Prefer not to say"]),
                _f("grade_applying", "Class applying for", "grade", True, core="grade_applying"),
                _f("nationality", "Nationality", "text", False, max_length=60),
                _f("home_address", "Home address", "textarea", True, max_length=500),
            ]},
            {"key": "guardian", "title": "Parent / guardian", "kind": "guardian", "description": None, "fields": [
                _f("guardian_name", "Parent / guardian name", "text", True, core="guardian_name", max_length=200),
                _f("guardian_relationship", "Relationship to the student", "select", True, core="guardian_relationship",
                   options=["Mother", "Father", "Guardian"]),
                _f("guardian_phone", "Mobile number", "phone", True, core="guardian_phone"),
                _f("guardian_email", "Email", "email", False, core="guardian_email"),
                _f("guardian_occupation", "Occupation", "text", False, max_length=120),
            ]},
            {"key": "academic", "title": "Academic details", "kind": "academic", "description": None, "fields": [
                _f("previous_school", "Current / previous school", "text", False, core="previous_school", max_length=200),
                _f("last_class_completed", "Last class completed", "text", False, max_length=40),
                _f("previous_board", "Board", "select", False, options=["CBSE", "ICSE", "State board", "IB", "IGCSE", "Other"]),
                _f("last_percentage", "Last annual result (%)", "number", False, min=0, max=100),
                _f("achievements", "Achievements and interests", "textarea", False, max_length=1000),
            ]},
        ],
        "documents": [
            {"key": "birth_certificate", "label": "Birth certificate", "required": True, "accept": ["pdf", "jpg", "png"],
             "max_mb": 5, "max_files": 1, "help": None},
            {"key": "photo", "label": "Passport-size photograph", "required": True, "accept": ["jpg", "png"], "max_mb": 2,
             "max_files": 1, "help": None},
            {"key": "report_card", "label": "Latest report card", "required": False, "accept": ["pdf", "jpg", "png"],
             "max_mb": 5, "max_files": 3, "help": "Up to three pages or files."},
        ],
    }
