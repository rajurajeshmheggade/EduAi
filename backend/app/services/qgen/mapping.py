"""Teacher's DB classes / subjects ↔ NLP repository class / subject folders.

* **Class** — classes.grade_number when the admin set it, else the grade read from the class name or code
  ("Grade 10 — Section A", "10-A", "Class X"); grade n ↔ the Roman-numeral folder (10 ↔ X).
* **Subject** — class_subjects.subject_name (then the subject code) normalised and matched against the subject
  folders of that class: exact match first, then the alias table below in order (e.g. Physics in Class X →
  "General Science", because the NCERT Class X book is one science book; Physics in Class XII → "Physics").
* **Override** — an admin-set row in qgen_subject_map wins over the automatic match (and is the only way to map a
  subject the rules cannot place, e.g. a school-specific name).
"""
from __future__ import annotations

import re

from ... import db
from .. import nlp_catalog
from ..lesson_plan import store as lp_store

_GRADE_TO_ROMAN = {v: k for k, v in nlp_catalog._ROMAN_TO_GRADE.items()}
_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}

# normalised subject name → NLP subject folders to try, in order (the first one that exists in the class wins)
SUBJECT_ALIASES: dict[str, list[str]] = {
    "physics": ["Physics", "Science", "General Science"],
    "chemistry": ["Chemistry", "Science", "General Science"],
    "biology": ["Biology", "Science", "General Science"],
    "botany": ["Biology", "Science", "General Science"],
    "zoology": ["Biology", "Science", "General Science"],
    "science": ["Science", "General Science", "Environmental Science"],
    "general science": ["General Science", "Science"],
    "evs": ["Environmental Science", "Science"],
    "environmental studies": ["Environmental Science", "Science"],
    "environmental science": ["Environmental Science", "Science"],
    "maths": ["Mathematics"],
    "math": ["Mathematics"],
    "mathematics": ["Mathematics"],
    "applied maths": ["Applied Mathematics", "Mathematics"],
    "applied mathematics": ["Applied Mathematics", "Mathematics"],
    "english": ["English"],
    "english language": ["English"],
    "english literature": ["English"],
    "english language and literature": ["English"],
    "social science": ["Social Science"],
    "social studies": ["Social Science"],
    "sst": ["Social Science"],
    "history": ["Social Science"],
    "geography": ["Social Science"],
    "civics": ["Social Science"],
    "political science": ["Social Science"],
    "economics": ["Economics", "Social Science"],
    "computer science": ["Computer Science"],
    "computer": ["Computer Science"],
    "computers": ["Computer Science"],
    "computer applications": ["Computer Science"],
    "computer studies": ["Computer Science"],
    "ict": ["Computer Science"],
    "informatics practices": ["Computer Science"],
    "ai": ["Artificial Intelligence"],
    "artificial intelligence": ["Artificial Intelligence"],
    "accounts": ["Accountancy"],
    "accountancy": ["Accountancy"],
    "accounting": ["Accountancy"],
    "business studies": ["Business Studies"],
    "business": ["Business Studies"],
    "psychology": ["Psychology"],
    "physical education": ["Health and Physical Education"],
    "pe": ["Health and Physical Education"],
    "health and physical education": ["Health and Physical Education"],
}
# subject-code prefixes (letters only, lower-case) → a key of SUBJECT_ALIASES
CODE_PREFIXES = {"phy": "physics", "chem": "chemistry", "che": "chemistry", "bio": "biology", "math": "maths",
                 "mat": "maths", "eng": "english", "sci": "science", "sst": "social science", "soc": "social science",
                 "his": "history", "geo": "geography", "eco": "economics", "cs": "computer science",
                 "comp": "computer science", "evs": "evs", "acc": "accountancy", "bst": "business studies",
                 "psy": "psychology", "pe": "physical education", "ai": "ai"}


def _norm(s: str | None) -> str:
    s = re.sub(r"[^a-z ]+", " ", (s or "").lower().replace("&", " and "))
    return re.sub(r"\s+", " ", s).strip()


def grade_of(class_row: dict) -> int | None:
    """grade_number, else a grade read from the class name / code."""
    g = class_row.get("grade_number")
    if isinstance(g, int) and 1 <= g <= 12:
        return g
    for text in (class_row.get("class_name") or "", class_row.get("class_code") or ""):
        m = re.search(r"(?:grade|class|std|standard|gr)\s*[-_.]?\s*(\d{1,2})\b", text, re.I) or re.match(r"\s*(\d{1,2})\b", text)
        if m and 1 <= int(m.group(1)) <= 12:
            return int(m.group(1))
        m = re.search(r"(?:grade|class|std|standard)\s*[-_.]?\s*(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b", text, re.I)
        if m:
            return _ROMAN[m.group(1).upper()]
    return None


def auto_subject(nlp_class: str, subject_name: str | None, subject_code: str | None) -> str | None:
    available = nlp_catalog.subjects(nlp_class)
    by_norm = {_norm(s): s for s in available}
    name = _norm(subject_name)
    if name in by_norm:
        return by_norm[name]
    keys = [name] if name else []
    letters = re.sub(r"[^a-z]", "", (subject_code or "").lower())
    for prefix in sorted(CODE_PREFIXES, key=len, reverse=True):
        if letters.startswith(prefix):
            keys.append(CODE_PREFIXES[prefix])
            break
    for k in keys:
        for candidate in SUBJECT_ALIASES.get(k, []):
            if candidate in available:
                return candidate
    return None


def _overrides(org: str) -> dict[tuple[str, str], dict]:
    rows = db.fetch_all("SELECT class_code, subject_code, nlp_class, nlp_subject FROM public.qgen_subject_map "
                        "WHERE org_code = %s", (org,))
    return {(r["class_code"], r["subject_code"]): r for r in rows}


def _classes(org: str) -> dict[str, dict]:
    rows = db.fetch_all("SELECT class_code, class_name, grade_number FROM public.classes WHERE org_code = %s", (org,))
    return {r["class_code"]: r for r in rows}


def resolve(class_row: dict, subject_code: str, subject_name: str, override: dict | None) -> dict:
    grade = grade_of(class_row)
    nlp_class = _GRADE_TO_ROMAN.get(grade) if grade else None
    if override and override["nlp_subject"] in nlp_catalog.subjects(override["nlp_class"]):
        return {"grade": grade, "nlp_class": override["nlp_class"], "nlp_subject": override["nlp_subject"],
                "mapping": "override", "note": None}
    if not nlp_class or not nlp_catalog.subjects(nlp_class):
        why = (f"Class {grade} has no folder in the content repository" if grade
               else "The class's grade is not set and could not be read from its name")
        return {"grade": grade, "nlp_class": None, "nlp_subject": None, "mapping": "none", "note": why}
    subj = auto_subject(nlp_class, subject_name, subject_code)
    if not subj:
        return {"grade": grade, "nlp_class": nlp_class, "nlp_subject": None, "mapping": "none",
                "note": f"No subject folder in Class {nlp_class} matches “{subject_name}” — ask an admin to map it"}
    return {"grade": grade, "nlp_class": nlp_class, "nlp_subject": subj, "mapping": "auto", "note": None}


def teacher_classes(org: str, teacher: str) -> list[dict]:
    """The teacher's own classes and subjects (lesson-plan teacher scope) with their NLP mapping."""
    classes, overrides = _classes(org), _overrides(org)
    out = []
    for c in lp_store.teacher_scope(org, teacher):
        crow = classes.get(c["class_code"], {"class_code": c["class_code"], "class_name": c["class_name"]})
        subjects = []
        for s in c["subjects"]:
            m = resolve(crow, s["subject_code"], s["subject_name"], overrides.get((c["class_code"], s["subject_code"])))
            subjects.append({"subject_code": s["subject_code"], "subject_name": s["subject_name"], **m})
        grade = grade_of(crow)
        out.append({"class_code": c["class_code"], "class_name": c["class_name"], "grade": grade,
                    "nlp_class": _GRADE_TO_ROMAN.get(grade) if grade else None, "subjects": subjects})
    return out


def resolve_for_teacher(org: str, teacher: str, class_code: str, subject_code: str) -> dict | None:
    """The mapping of one of the teacher's own class subjects, or None when it is not theirs."""
    for c in teacher_classes(org, teacher):
        if c["class_code"] != class_code:
            continue
        for s in c["subjects"]:
            if s["subject_code"] == subject_code:
                return {"class_code": class_code, "class_name": c["class_name"], **s}
    return None


def org_mappings(org: str) -> list[dict]:
    """Every class subject of the institution with its mapping (admin view)."""
    classes, overrides = _classes(org), _overrides(org)
    rows = db.fetch_all("SELECT cs.class_code, cs.subject_code, cs.subject_name FROM public.class_subjects cs "
                        "WHERE cs.org_code = %s ORDER BY cs.class_code, cs.subject_code", (org,))
    out = []
    for r in rows:
        crow = classes.get(r["class_code"], {"class_code": r["class_code"]})
        m = resolve(crow, r["subject_code"], r["subject_name"], overrides.get((r["class_code"], r["subject_code"])))
        out.append({"class_code": r["class_code"], "class_name": crow.get("class_name"), **r, **m})
    return out


# ════════════════════════════════════════════════════════════ one discipline inside a combined science book
# Up to Class X, NCERT has one Science book: a school's "Physics" subject maps to the Science / General Science
# folder, which also holds chemistry and biology chapters. Those chapters are classified (chapter name first, then
# the chapter text) so the discipline's own chapters are listed first and the rest after them.
COMBINED = {"Science", "General Science", "Environmental Science"}
DISCIPLINE_TERMS: dict[str, tuple[str, ...]] = {
    "physics": ("electric", "electricity", "current", "light", "reflection", "refraction", "magnet", "magnetic",
                "motion", "force", "gravitation", "work", "energy", "power", "sound", "wave", "heat", "temperature",
                "pressure", "lens", "mirror", "eye", "colourful", "optic", "circuit", "friction", "measurement",
                "speed", "time", "shadow", "stars", "solar", "universe", "electromagnetic", "physical"),
    "chemistry": ("acid", "acids", "base", "bases", "salt", "salts", "carbon", "compound", "compounds", "chemical",
                  "reaction", "reactions", "equation", "metal", "metals", "non-metal", "atom", "atoms", "molecule",
                  "molecules", "matter", "element", "elements", "periodic", "mixture", "pure", "combustion", "fibre",
                  "fibres", "materials", "synthetic", "coal", "petroleum", "substances"),
    "biology": ("life", "living", "cell", "cells", "tissue", "tissues", "organism", "organisms", "reproduce",
                "reproduction", "heredity", "evolution", "control", "coordination", "environment", "nutrition",
                "respiration", "plant", "plants", "animal", "animals", "food", "health", "disease", "diseases",
                "adolescence", "microorganisms", "biodiversity", "ecosystem", "body", "resources", "crop", "forests",
                "conservation", "germination", "digestion"),
}
_DISCIPLINE_OF = {"physics": "physics", "chemistry": "chemistry", "biology": "biology", "botany": "biology",
                  "zoology": "biology", "life science": "biology", "life sciences": "biology"}


def discipline(subject_name: str | None, subject_code: str | None, nlp_subject: str | None) -> str | None:
    """'physics' | 'chemistry' | 'biology' when a single-discipline subject maps onto a combined science folder."""
    if nlp_subject not in COMBINED:
        return None
    d = _DISCIPLINE_OF.get(_norm(subject_name))
    if d:
        return d
    letters = re.sub(r"[^a-z]", "", (subject_code or "").lower())
    for prefix, key in (("phy", "physics"), ("chem", "chemistry"), ("che", "chemistry"), ("bio", "biology")):
        if letters.startswith(prefix):
            return key
    return None


def chapter_discipline(nlp_class: str, nlp_subject: str, chapter: str) -> str | None:
    words = set(re.findall(r"[a-z\-]+", chapter.lower()))
    scores = {d: len(words & set(terms)) for d, terms in DISCIPLINE_TERMS.items()}
    best = max(scores, key=scores.get)
    if scores[best] and list(scores.values()).count(scores[best]) == 1:
        return best
    try:   # the name is not decisive: count the disciplines' terms in the chapter text
        text = nlp_catalog.chapter_text(nlp_class, nlp_subject, chapter, max_chars=40_000).lower()
    except FileNotFoundError:
        return None
    tokens = re.findall(r"[a-z\-]+", text)
    scores = {d: sum(1 for t in tokens if t in set(terms)) for d, terms in DISCIPLINE_TERMS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else None


def ranked_chapters(m: dict) -> tuple[list[str], list[str], str | None]:
    """(the subject's own chapters, the other chapters of the folder, discipline) for a mapped class subject."""
    chapters = nlp_catalog.chapters(m["nlp_class"], m["nlp_subject"])
    d = discipline(m.get("subject_name"), m.get("subject_code"), m["nlp_subject"])
    if not d:
        return chapters, [], None
    own = [c for c in chapters if chapter_discipline(m["nlp_class"], m["nlp_subject"], c) == d]
    return own, [c for c in chapters if c not in own], d
