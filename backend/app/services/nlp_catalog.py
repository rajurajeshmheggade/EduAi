"""Filesystem-backed content catalogue for Class -> Subject -> Chapter (backend/nlp/<class>/<subject>/
<chapter>/<chapter>.txt). This is a separate, curated source from the Digital Library's DIKSHA catalogue —
it is intentionally NOT used anywhere Digital Library reads from; it backs Lesson Plans and (chapter-grounded)
AI question generation for Online Tests instead.

Class folders are Roman numerals (III..XII) plus a non-numeric "JEE" bucket; everything is read fresh off disk
(cheap: a few hundred directory entries) so new chapters dropped into the folder show up without a restart.
All three path segments (class/subject/chapter) are validated against the real enumerated listing before ever
touching the filesystem again, so a request can never read outside this tree.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "backend" / "nlp"

_ROMAN_TO_GRADE = {"III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}


def _label_sort_key(label: str) -> tuple[int, str]:
    grade = _ROMAN_TO_GRADE.get(label)
    return (grade, "") if grade else (99, label)  # numeric grades first in order, then JEE/others


@lru_cache(maxsize=1)
def _tree() -> dict[str, dict[str, list[str]]]:
    """{class_label: {subject_name: [chapter_name, ...]}} — read once per process, sorted for stable UIs."""
    out: dict[str, dict[str, list[str]]] = {}
    if not ROOT.is_dir():
        return out
    for class_dir in sorted((p for p in ROOT.iterdir() if p.is_dir()), key=lambda p: _label_sort_key(p.name)):
        subjects: dict[str, list[str]] = {}
        for subj_dir in sorted((p for p in class_dir.iterdir() if p.is_dir()), key=lambda p: p.name):
            chapters = sorted(p.name for p in subj_dir.iterdir() if p.is_dir() and any(p.glob("*.txt")))
            if chapters:
                subjects[subj_dir.name] = chapters
        if subjects:
            out[class_dir.name] = subjects
    return out


def classes() -> list[dict]:
    return [{"class_label": label, "grade": _ROMAN_TO_GRADE.get(label)} for label in _tree()]


def subjects(class_label: str) -> list[str]:
    return list(_tree().get(class_label, {}))


def chapters(class_label: str, subject: str) -> list[str]:
    return list(_tree().get(class_label, {}).get(subject, []))


def chapter_text(class_label: str, subject: str, chapter: str, max_chars: int = 20_000) -> str:
    """Raises FileNotFoundError if the triple isn't in the enumerated catalogue (never trusts the path
    segments directly — they're checked against `_tree()` first)."""
    if chapter not in chapters(class_label, subject):
        raise FileNotFoundError(f"No chapter '{chapter}' for {subject} in class {class_label}")
    folder = ROOT / class_label / subject / chapter
    txt = next(folder.glob("*.txt"))
    return txt.read_text(encoding="utf-8", errors="ignore")[:max_chars]


# ---------------------------------------------------------------- AI Classroom (PDF chapters, students)
# A second, separate listing used only by AI Classroom: unlike chapters() above (which backs Lesson Plans and
# Online Test AI generation and only ever lists .txt chapters, read by staff), this one also surfaces chapters
# that have a .pdf dropped in instead of/alongside a .txt, since teachers add PDFs here for students to read.
# Kept apart from _tree()/chapters() so widening what counts as "a chapter" here can never change what staff
# tools already rely on.
def _scan_classroom_chapters(subj_dir: Path) -> list[dict]:
    out = []
    for p in sorted((x for x in subj_dir.iterdir() if x.is_dir()), key=lambda x: x.name):
        has_text, has_pdf = any(p.glob("*.txt")), any(p.glob("*.pdf"))
        if has_text or has_pdf:
            out.append({"chapter": p.name, "has_text": has_text, "has_pdf": has_pdf})
    return out


@lru_cache(maxsize=1)
def _classroom_tree() -> dict[str, dict[str, list[dict]]]:
    out: dict[str, dict[str, list[dict]]] = {}
    if not ROOT.is_dir():
        return out
    for class_dir in sorted((p for p in ROOT.iterdir() if p.is_dir()), key=lambda p: _label_sort_key(p.name)):
        subjects_out: dict[str, list[dict]] = {}
        for subj_dir in sorted((p for p in class_dir.iterdir() if p.is_dir()), key=lambda p: p.name):
            chs = _scan_classroom_chapters(subj_dir)
            if chs:
                subjects_out[subj_dir.name] = chs
        if subjects_out:
            out[class_dir.name] = subjects_out
    return out


def classroom_classes() -> list[dict]:
    return [{"class_label": label, "grade": _ROMAN_TO_GRADE.get(label)} for label in _classroom_tree()]


def classroom_subjects(class_label: str) -> list[str]:
    return list(_classroom_tree().get(class_label, {}))


def classroom_chapters(class_label: str, subject: str) -> list[dict]:
    """[{chapter, has_text, has_pdf}, ...] for one class/subject."""
    return list(_classroom_tree().get(class_label, {}).get(subject, []))


def classroom_chapter_pdf_path(class_label: str, subject: str, chapter: str) -> Path | None:
    meta = next((c for c in classroom_chapters(class_label, subject) if c["chapter"] == chapter), None)
    if not meta or not meta["has_pdf"]:
        return None
    folder = ROOT / class_label / subject / chapter
    return next(folder.glob("*.pdf"), None)


@lru_cache(maxsize=64)
def _pdf_page_texts(path_str: str) -> tuple[str, ...]:
    import pymupdf as fitz

    with fitz.open(path_str) as doc:
        return tuple(page.get_text("text") for page in doc)


def classroom_chapter_pages(class_label: str, subject: str, chapter: str) -> tuple[str, ...]:
    """All pages' text of the chapter PDF, cached (the file doesn't change while the process is running).
    Raises FileNotFoundError if this chapter has no PDF."""
    path = classroom_chapter_pdf_path(class_label, subject, chapter)
    if not path:
        raise FileNotFoundError(f"No PDF for chapter '{chapter}' ({subject}, class {class_label})")
    return _pdf_page_texts(str(path))
