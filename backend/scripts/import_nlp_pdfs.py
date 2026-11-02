"""Put downloaded textbook chapter PDFs into the NLP chapter folders, next to each chapter's .txt.

    python -m scripts.import_nlp_pdfs <folder-or-zip> [--dry-run] [--force] [--min-score 0.6]

Each PDF is matched by content, not by file name: the chapter .txt files in backend/nlp were made from the same
books, so the chapter whose vocabulary the PDF contains most completely is the one it belongs to. NCERT file names
(e.g. jesc112.pdf = class X, science, book 1, chapter 12) only narrow the classes searched first. Prelims, answers,
appendices and anything without a confident match are reported and left alone; an existing PDF is only replaced
with --force. The .txt files are never touched. PDFs here stay local: .gitignore keeps them out of the repository.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "nlp"

# NCERT codes: first letter is the class (a = I … l = XII), second the medium; the tail is the chapter number or a
# part of the book that is not a chapter.
_NCERT = re.compile(r"^([a-l])[ehu][a-z]{2,3}\d(\d{2}|ps|an|a\d|gl|dd)$", re.I)
_CLASS_BY_LETTER = dict(zip("abcdefghijkl", ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]))
_NOT_A_CHAPTER = {"ps", "an", "gl", "dd"}
_WORD = re.compile(r"[a-z]{4,}")


@dataclass
class Chapter:
    class_label: str
    subject: str
    chapter: str
    folder: Path
    words: frozenset[str]
    digest: str  # identical chapters filed under two subjects share a digest and are placed together


@dataclass
class Placement:
    source: Path
    status: str  # placed | exists | skipped | unmatched
    chapters: list[Chapter]
    score: float = 0.0
    note: str = ""


def _words(text: str) -> frozenset[str]:
    return frozenset(_WORD.findall(text.lower()))


def load_chapters(root: Path = ROOT) -> list[Chapter]:
    out, seen = [], set()
    for txt in sorted(root.glob("*/*/**/*.txt")):
        folder = txt.parent
        rel = folder.relative_to(root).parts
        if len(rel) < 3 or folder in seen:  # loose subject-level files duplicate real chapter folders; one text per folder
            continue
        seen.add(folder)
        text = txt.read_text(encoding="utf-8", errors="replace")
        out.append(Chapter(rel[0], rel[1], folder.name, folder, _words(text), hashlib.sha1(" ".join(sorted(_words(text))).encode()).hexdigest()))
    return out


def pdf_words(path: Path) -> frozenset[str]:
    import pymupdf as fitz

    with fitz.open(path) as doc:
        return _words(" ".join(page.get_text() for page in doc))


def class_hint(path: Path) -> tuple[str | None, bool]:
    """(class label, is-not-a-chapter) from an NCERT-style file name; (None, False) for any other name."""
    m = _NCERT.match(path.stem)
    if not m:
        return None, False
    return _CLASS_BY_LETTER[m.group(1).lower()], m.group(2).lower() in _NOT_A_CHAPTER or m.group(2).lower().startswith("a")


def match(words: frozenset[str], chapters: list[Chapter], hint: str | None, min_score: float) -> tuple[list[Chapter], float, str]:
    """Best chapter(s) for a PDF's vocabulary: share of the chapter's words that appear in the PDF."""
    if len(words) < 20:  # a real chapter has thousands; this catches scanned, image-only PDFs
        return [], 0.0, "no readable text (scanned pages?)"
    pools = [[c for c in chapters if c.class_label == hint], chapters] if hint else [chapters]
    for pool in pools:
        scored = sorted(((len(c.words & words) / max(len(c.words), 1), c) for c in pool if c.words), key=lambda x: -x[0])
        if not scored:
            continue
        best_score, best = scored[0]
        rival = next((s for s, c in scored[1:] if c.digest != best.digest), 0.0)
        if best_score >= min_score and best_score - rival >= 0.08:
            return [c for s, c in scored if c.digest == best.digest], best_score, ""
    guesses = ", ".join(f"{c.class_label}/{c.subject}/{c.chapter} ({s:.2f})" for s, c in scored[:3]) if scored else "none"
    return [], scored[0][0] if scored else 0.0, f"not confident; closest: {guesses}"


def _pdfs(source: Path, scratch: Path) -> list[Path]:
    files = [source] if source.is_file() else sorted(p for p in source.rglob("*") if p.is_file())
    out = []
    for f in files:
        if f.suffix.lower() == ".pdf":
            out.append(f)
        elif f.suffix.lower() == ".zip":
            with zipfile.ZipFile(f) as z:
                for info in z.infolist():
                    name = Path(info.filename).name  # basename only: nothing can be written outside scratch
                    if name.lower().endswith(".pdf") and not info.is_dir():
                        dest = scratch / f.stem / name
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        with z.open(info) as src, open(dest, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                        out.append(dest)
    return out


def run(source: Path, root: Path = ROOT, dry_run: bool = False, force: bool = False, min_score: float = 0.6) -> list[Placement]:
    chapters = load_chapters(root)
    results: list[Placement] = []
    with tempfile.TemporaryDirectory() as scratch:
        for pdf in _pdfs(source, Path(scratch)):
            hint, not_chapter = class_hint(pdf)
            if not_chapter:
                results.append(Placement(pdf, "skipped", [], note="prelims / answers / appendix, not a chapter"))
                continue
            try:
                words = pdf_words(pdf)
            except Exception as e:  # damaged or not really a PDF: report it, keep going with the rest
                results.append(Placement(pdf, "unmatched", [], note=f"could not read the PDF ({type(e).__name__})"))
                continue
            found, score, note = match(words, chapters, hint, min_score)
            if not found:
                results.append(Placement(pdf, "unmatched", [], score, note))
                continue
            status = "placed"
            for c in found:
                existing = next(c.folder.glob("*.pdf"), None)
                if existing and not force:
                    status, note = "exists", f"already has {existing.name} (use --force to replace)"
                    continue
                if not dry_run:
                    if existing:
                        existing.unlink()
                    shutil.copy2(pdf, c.folder / f"{c.folder.name}.pdf")
            results.append(Placement(pdf, status, found, score, note))
    return results


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("source", type=Path, help="folder of downloaded PDFs / zips, or a single file")
    ap.add_argument("--dry-run", action="store_true", help="show what would be placed, copy nothing")
    ap.add_argument("--force", action="store_true", help="replace a chapter's existing PDF")
    ap.add_argument("--min-score", type=float, default=0.6, help="share of a chapter's words the PDF must contain")
    args = ap.parse_args()
    if not args.source.exists():
        sys.exit(f"Not found: {args.source}")
    res = run(args.source, dry_run=args.dry_run, force=args.force, min_score=args.min_score)
    for r in res:
        where = "; ".join(f"{c.class_label}/{c.subject}/{c.chapter}" for c in r.chapters)
        print(f"{r.status:9} {r.source.name:28} {where} {f'({r.score:.2f})' if r.score else ''} {r.note}".rstrip())
    counts = {s: sum(r.status == s for r in res) for s in ("placed", "exists", "skipped", "unmatched")}
    print(("Would place" if args.dry_run else "Placed"), counts["placed"], "| already there", counts["exists"],
          "| skipped", counts["skipped"], "| unmatched", counts["unmatched"])
