"""Document helpers for the evaluation engine: text extraction (PDF / DOCX / MD / TXT) and page rendering.

DOCX is read straight from its XML (no python-docx dependency).
"""
from __future__ import annotations

import io
import re
import zipfile
from pathlib import PurePath
from xml.etree import ElementTree as ET

MASTER_EXTENSIONS = {".pdf", ".docx", ".md", ".txt"}
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class UnsupportedDocument(ValueError):
    pass


def extension(filename: str) -> str:
    return PurePath(filename or "").suffix.lower()


def is_pdf(data: bytes) -> bool:
    return data[:4] == b"%PDF"


def pdf_pages_text(data: bytes) -> list[str]:
    import pymupdf as fitz

    with fitz.open(stream=data, filetype="pdf") as doc:
        return [page.get_text("text") for page in doc]


def pdf_page_count(data: bytes) -> int:
    import pymupdf as fitz

    with fitz.open(stream=data, filetype="pdf") as doc:
        return doc.page_count


def render_pages(data: bytes, dpi: int, first: int = 0, last: int | None = None) -> list[bytes]:
    """Render pages [first, last) to JPEG (much smaller than PNG for vision requests at 300 DPI)."""
    import pymupdf as fitz

    out: list[bytes] = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        end = doc.page_count if last is None else min(last, doc.page_count)
        for i in range(first, end):
            pix = doc[i].get_pixmap(dpi=dpi)
            out.append(pix.tobytes("jpeg", jpg_quality=82))
    return out


def _docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            root = ET.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as e:
        raise UnsupportedDocument("Could not read the Word document") from e
    lines: list[str] = []
    for p in root.iter(f"{_W}p"):
        parts: list[str] = []
        for node in p.iter():
            if node.tag == f"{_W}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{_W}tab":
                parts.append("\t")
            elif node.tag in (f"{_W}br", f"{_W}cr"):
                parts.append("\n")
        lines.append("".join(parts))
    return "\n".join(lines)


def extract_text(data: bytes, filename: str) -> tuple[str, bool]:
    """Returns (text, needs_ocr). needs_ocr is True for PDFs with no usable text layer (scanned)."""
    ext = extension(filename)
    if is_pdf(data):
        pages = pdf_pages_text(data)
        text = "\n".join(pages)
        return text, len(re.sub(r"\s+", "", text)) < 20 * max(1, len(pages))
    if ext == ".docx" or data[:2] == b"PK":
        return _docx_text(data), False
    if ext in (".md", ".txt", ""):
        for enc in ("utf-8-sig", "cp1252"):
            try:
                return data.decode(enc), False
            except UnicodeDecodeError:
                continue
    raise UnsupportedDocument("Upload a PDF, Word (.docx), Markdown (.md) or text (.txt) file")
