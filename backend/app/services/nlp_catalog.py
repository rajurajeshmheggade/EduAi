"""Filesystem-backed content catalogue for Class -> Subject -> Chapter (backend/nlp/<class>/<subject>/
<chapter>/<chapter>.txt). This is a separate, curated source from the Digital Library's DIKSHA catalogue —
it is intentionally NOT used anywhere Digital Library reads from; it backs Lesson Plans and (chapter-grounded)
AI question generation for Online Tests instead.

Class folders are Roman numerals (III..XII) plus a non-numeric "JEE" bucket whose chapters sit one level deeper
(JEE/Physics/mechanics/<chapter>/). The listing is cached and rebuilt when the folder structure changes, so new
chapters dropped into the folder show up without a restart.
All three path segments (class/subject/chapter) are validated against the real enumerated listing before ever
touching the filesystem again, so a request can never read outside this tree.
"""
from __future__ import annotations

import re
import time
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "backend" / "nlp"

_ROMAN_TO_GRADE = {"III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}


def _label_sort_key(label: str) -> tuple[int, str]:
    grade = _ROMAN_TO_GRADE.get(label)
    return (grade, "") if grade else (99, label)  # numeric grades first in order, then JEE/others


def _fold(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def chapter_file(folder: Path) -> Path | None:
    """The chapter's text file, picked deterministically: the .txt named after its folder (a folder may hold a
    second copy, e.g. III/English/madhus wish has "madhu's wish.txt" and "madhus wish.txt"), else the largest."""
    txts = sorted(folder.glob("*.txt"))
    if not txts:
        return None
    exact = [p for p in txts if _fold(p.stem) == _fold(folder.name)]
    return (exact or sorted(txts, key=lambda p: (-p.stat().st_size, p.name)))[0]


def _subdirs(p: Path) -> list[Path]:
    return sorted((x for x in p.iterdir() if x.is_dir()), key=lambda x: x.name)


def _scan_subject(subj_dir: Path) -> dict[str, Path]:
    """{chapter name: folder}. A chapter is a folder holding a .txt. A folder without one may group chapters one
    level deeper (JEE/Physics/mechanics/<chapter>/<chapter>.txt): those chapters are listed by their own name
    (prefixed with the group's name only if that would clash). Loose .txt files beside the chapter folders (e.g.
    X/General Science) are copies of a folder's text and are not chapters."""
    out: dict[str, Path] = {}
    groups = []
    for p in _subdirs(subj_dir):
        if any(p.glob("*.txt")):
            out[p.name] = p
        else:
            groups.append(p)
    for g in groups:
        for q in _subdirs(g):
            if any(q.glob("*.txt")):
                out[q.name if q.name not in out else f"{g.name} / {q.name}"] = q
    return out


def _signature() -> tuple:
    """Directory mtimes down to chapter-group level: adding/removing a class, subject, chapter or group changes it."""
    sig = []
    if not ROOT.is_dir():
        return ()
    for c in _subdirs(ROOT):
        sig.append((c.name, c.stat().st_mtime_ns))
        for s in _subdirs(c):
            sig.append((s.name, s.stat().st_mtime_ns))
            for g in _subdirs(s):
                if not any(g.glob("*.txt")):
                    sig.append((g.name, g.stat().st_mtime_ns))
    return tuple(sig)


@lru_cache(maxsize=2)
def _build_tree(root: str, sig: tuple) -> dict[str, dict[str, dict[str, Path]]]:
    out: dict[str, dict[str, dict[str, Path]]] = {}
    for class_dir in sorted((p for p in Path(root).iterdir() if p.is_dir()), key=lambda p: _label_sort_key(p.name)):
        subjects: dict[str, dict[str, Path]] = {}
        for subj_dir in _subdirs(class_dir):
            chapters_ = _scan_subject(subj_dir)
            if chapters_:
                subjects[subj_dir.name] = dict(sorted(chapters_.items()))
        if subjects:
            out[class_dir.name] = subjects
    return out


_checked: dict[str, tuple[float, tuple]] = {}
RECHECK_S = 10.0


def _paths() -> dict[str, dict[str, dict[str, Path]]]:
    """{class_label: {subject: {chapter: folder}}}, rebuilt when the folder structure changes (checked at most every
    RECHECK_S seconds, so new chapters dropped into backend/nlp show up without a restart)."""
    if not ROOT.is_dir():
        return {}
    key = str(ROOT)
    now = time.monotonic()
    seen = _checked.get(key)
    if not seen or now - seen[0] > RECHECK_S:
        seen = (now, _signature())
        _checked[key] = seen
    return _build_tree(key, seen[1])


def _tree() -> dict[str, dict[str, list[str]]]:
    """{class_label: {subject_name: [chapter_name, ...]}}, sorted for stable UIs."""
    return {c: {s: list(chs) for s, chs in subs.items()} for c, subs in _paths().items()}


def classes() -> list[dict]:
    return [{"class_label": label, "grade": _ROMAN_TO_GRADE.get(label)} for label in _paths()]


def subjects(class_label: str) -> list[str]:
    return list(_paths().get(class_label, {}))


def chapters(class_label: str, subject: str) -> list[str]:
    return list(_paths().get(class_label, {}).get(subject, {}))


def chapter_path(class_label: str, subject: str, chapter: str) -> Path:
    """The chapter's text file. Raises FileNotFoundError unless the triple is in the enumerated catalogue (path
    segments from a request are never joined onto the filesystem directly)."""
    folder = _paths().get(class_label, {}).get(subject, {}).get(chapter)
    txt = chapter_file(folder) if folder else None
    if not txt:
        raise FileNotFoundError(f"No chapter '{chapter}' for {subject} in class {class_label}")
    return txt


def chapter_text(class_label: str, subject: str, chapter: str, max_chars: int = 20_000) -> str:
    """Raises FileNotFoundError if the triple isn't in the enumerated catalogue."""
    return chapter_path(class_label, subject, chapter).read_text(encoding="utf-8", errors="ignore")[:max_chars]


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


_CLASSROOM_RESCAN_S = 30  # PDFs dropped into chapter folders (scripts.import_nlp_pdfs) show up without a restart


@lru_cache(maxsize=1)
def _classroom_tree_at(_bucket: int) -> dict[str, dict[str, list[dict]]]:
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


def _classroom_tree() -> dict[str, dict[str, list[dict]]]:
    return _classroom_tree_at(int(time.monotonic() // _CLASSROOM_RESCAN_S))


_classroom_tree.cache_clear = _classroom_tree_at.cache_clear  # type: ignore[attr-defined]


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
def _pdf_page_texts(path_str: str, _mtime: float = 0.0) -> tuple[str, ...]:  # mtime: a replaced PDF is re-read
    import pymupdf as fitz

    with fitz.open(path_str) as doc:
        return tuple(page.get_text("text") for page in doc)


def classroom_chapter_pages(class_label: str, subject: str, chapter: str) -> tuple[str, ...]:
    """All pages' text of the chapter PDF, cached (the file doesn't change while the process is running).
    Raises FileNotFoundError if this chapter has no PDF."""
    path = classroom_chapter_pdf_path(class_label, subject, chapter)
    if not path:
        raise FileNotFoundError(f"No PDF for chapter '{chapter}' ({subject}, class {class_label})")
    return _pdf_page_texts(str(path), path.stat().st_mtime)
