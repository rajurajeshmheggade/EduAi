"""Text out of an uploaded reference document (Basic Setup → "Upload Related Content"): PDF, DOCX or TXT.
The extracted text grounds Course Outcome generation (and therefore the whole plan built on them)."""
from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree

MAX_BYTES = 10 * 1024 * 1024
MAX_CHARS = 60000


class UnsupportedFile(ValueError):
    pass


def extract_text(data: bytes, filename: str) -> str:
    name = (filename or "").lower()
    if data.startswith(b"%PDF") or name.endswith(".pdf"):
        import fitz  # PyMuPDF (already used for textbook indexing)

        with fitz.open(stream=data, filetype="pdf") as doc:
            text = "\n".join(page.get_text("text") for page in doc)
    elif data.startswith(b"PK") or name.endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                xml = z.read("word/document.xml")
        except (zipfile.BadZipFile, KeyError) as e:
            raise UnsupportedFile("This is not a readable .docx file") from e
        ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        root = ElementTree.fromstring(xml)
        paras = []
        for p in root.iter(f"{ns}p"):
            paras.append("".join(t.text or "" for t in p.iter(f"{ns}t")))
        text = "\n".join(paras)
    elif name.endswith(".txt") or name.endswith(".md") or not name:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("latin-1")
    else:
        raise UnsupportedFile("Only PDF, DOCX and TXT files are supported")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:MAX_CHARS]
