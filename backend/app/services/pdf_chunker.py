"""Textbook PDF parsing + semantic chunking (FRD 4.2): 600-token chunks, 100-token overlap,
with chapter / page metadata. Pure functions — unit-testable without DB or Azure."""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from ..config import get_settings


class Tokenizer:
    """cl100k_base via tiktoken when available; otherwise a word-piece fallback (offline-safe)."""

    def __init__(self) -> None:
        self._enc = None
        try:
            import tiktoken

            self._enc = tiktoken.get_encoding("cl100k_base")
        except Exception:
            self._enc = None

    @property
    def exact(self) -> bool:
        return self._enc is not None

    def encode(self, text: str) -> list:
        if self._enc is not None:
            return self._enc.encode(text, disallowed_special=())
        return re.findall(r"\s*\S+", text)

    def decode(self, tokens: list) -> str:
        if self._enc is not None:
            return self._enc.decode(tokens)
        return "".join(tokens)


_tokenizer: Tokenizer | None = None


def get_tokenizer() -> Tokenizer:
    global _tokenizer
    if _tokenizer is None:
        _tokenizer = Tokenizer()
    return _tokenizer


@dataclass
class PageText:
    number: int  # 1-based
    text: str


@dataclass
class Chapter:
    number: int | None
    title: str
    start_page: int
    end_page: int = 0


@dataclass
class Chunk:
    chapter_number: int | None
    chapter_title: str | None
    page_number: int
    chunk_index: int
    text: str
    token_count: int
    metadata: dict = field(default_factory=dict)


@dataclass
class ParsedPdf:
    pages: list[PageText]
    toc: list[tuple[int, str, int]]
    scanned_pages: list[int]


def _clean(text: str) -> str:
    text = text.replace("\r", "")
    text = re.sub(r"-\n(?=[a-z])", "", text)  # de-hyphenate line wraps
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_pdf(data: bytes) -> ParsedPdf:
    import pymupdf as fitz  # PyMuPDF

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        pages, scanned = [], []
        for i, page in enumerate(doc, start=1):
            text = _clean(page.get_text("text"))
            if len(text) < 20 and page.get_images():
                scanned.append(i)  # candidate for Vision / Document Intelligence captioning
            pages.append(PageText(i, text))
        toc = [(lvl, title.strip(), pg) for lvl, title, pg in doc.get_toc() if pg >= 1]
        return ParsedPdf(pages, toc, scanned)
    finally:
        doc.close()


_CHAPTER_RE = re.compile(r"^\s*(?:chapter|unit|lesson|module)\s+(\d+|[ivxlc]+)\b[\s:.\-–—]*(.*)$", re.I)
_ROMAN = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100}


def _roman(s: str) -> int:
    total, prev = 0, 0
    for ch in reversed(s.lower()):
        v = _ROMAN[ch]
        total += -v if v < prev else v
        prev = max(prev, v)
    return total


def detect_chapters(parsed: ParsedPdf, fallback_title: str) -> list[Chapter]:
    n_pages = len(parsed.pages)
    chapters: list[Chapter] = []

    top = [(t, p) for lvl, t, p in parsed.toc if lvl == 1]
    if len(top) >= 2:
        seen: set[int] = set()
        for title, page in sorted(top, key=lambda x: x[1]):
            if page in seen or page > n_pages:
                continue
            seen.add(page)
            chapters.append(Chapter(len(chapters) + 1, title[:300], page))
    else:
        for pg in parsed.pages:
            for line in pg.text.splitlines()[:6]:
                m = _CHAPTER_RE.match(line.strip())
                if m:
                    num_raw = m.group(1)
                    num = int(num_raw) if num_raw.isdigit() else _roman(num_raw)
                    title = m.group(2).strip() or f"Chapter {num}"
                    chapters.append(Chapter(num, title[:300], pg.number))
                    break

    if not chapters:
        return [Chapter(1, fallback_title[:300], 1, n_pages)]

    for i, ch in enumerate(chapters):
        ch.end_page = (chapters[i + 1].start_page - 1) if i + 1 < len(chapters) else n_pages
        ch.end_page = max(ch.end_page, ch.start_page)
    return chapters


def chunk_chapter(
    pages: list[PageText],
    chapter: Chapter,
    start_index: int = 0,
    size: int | None = None,
    overlap: int | None = None,
) -> list[Chunk]:
    s = get_settings()
    size = size or s.chunk_tokens
    overlap = s.chunk_overlap if overlap is None else overlap
    if overlap >= size:
        raise ValueError("overlap must be smaller than chunk size")
    tk = get_tokenizer()

    tokens: list = []
    token_pages: list[int] = []
    for p in pages:
        if chapter.start_page <= p.number <= chapter.end_page and p.text:
            enc = tk.encode(p.text + "\n\n")
            tokens.extend(enc)
            token_pages.extend([p.number] * len(enc))
    if not tokens:
        return []

    step = size - overlap
    chunks: list[Chunk] = []
    start = 0
    idx = start_index
    while start < len(tokens):
        end = min(start + size, len(tokens))
        window = tokens[start:end]
        pgs = token_pages[start:end]
        text = tk.decode(window).strip()
        if text:
            counts = Counter(pgs)
            chunks.append(
                Chunk(
                    chapter_number=chapter.number,
                    chapter_title=chapter.title,
                    page_number=counts.most_common(1)[0][0],
                    chunk_index=idx,
                    text=text,
                    token_count=len(window),
                    metadata={"pages": sorted(set(pgs)), "section_heading": chapter.title},
                )
            )
            idx += 1
        if end >= len(tokens):
            break
        start += step
    return chunks


def chunk_document(parsed: ParsedPdf, fallback_title: str) -> tuple[list[Chapter], list[Chunk]]:
    chapters = detect_chapters(parsed, fallback_title)
    chunks: list[Chunk] = []

    # Front matter before the first detected chapter is indexed with chapter_number=None.
    first = chapters[0].start_page
    if first > 1:
        front = Chapter(None, "Front matter", 1, first - 1)
        chunks.extend(chunk_chapter(parsed.pages, front, len(chunks)))

    for ch in chapters:
        chunks.extend(chunk_chapter(parsed.pages, ch, len(chunks)))
    return chapters, chunks
