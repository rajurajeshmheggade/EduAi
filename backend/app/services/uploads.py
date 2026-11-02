"""Reusable upload validation: type by magic bytes (never the client's Content-Type or file name), size limit read
from the stream itself, images re-encoded (EXIF / trailing payloads dropped), PDFs parsed and refused when they are
encrypted or carry active content, a SHA-256 of the stored bytes, and a safe display file name.

    up = validate_upload(file, allowed=("pdf", "jpg", "png"), max_bytes=5 * 1024 * 1024)
    get_storage().put(key, up.data, up.mime)
"""
from __future__ import annotations

import hashlib
import io
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable

from fastapi import HTTPException, UploadFile

# kind -> (magic prefix, MIME type, extension)
KINDS: dict[str, tuple[bytes, str, str]] = {
    "pdf": (b"%PDF-", "application/pdf", ".pdf"),
    "png": (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    "jpg": (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
}
LABELS = {"pdf": "PDF", "png": "PNG", "jpg": "JPEG"}
MAX_IMAGE_PIXELS = 40_000_000          # decompression-bomb guard (e.g. 8000 x 5000)
MAX_IMAGE_SIDE = 3000                  # keeps scanned documents legible, drops oversized camera images
_PDF_ACTIVE = re.compile(rb"/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA)(?![A-Za-z0-9])")


@dataclass(frozen=True)
class ValidatedUpload:
    data: bytes
    kind: str
    mime: str
    ext: str
    sha256: str
    filename: str

    @property
    def size(self) -> int:
        return len(self.data)


def read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    """Reads at most max_bytes + 1 so an oversized body is refused without buffering all of it."""
    data = upload.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, f"The file is larger than {_mb(max_bytes)}")
    if not data:
        raise HTTPException(422, "The file is empty")
    return data


def sniff(data: bytes) -> str | None:
    for kind, (magic, _, _) in KINDS.items():
        if data.startswith(magic):
            return kind
    return None


def safe_filename(name: str | None, ext: str, fallback: str = "document") -> str:
    """Display name only (storage keys are random): no path, no control or shell characters, the real extension."""
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    base = unicodedata.normalize("NFKC", base)
    stem = base.rsplit(".", 1)[0] if "." in base else base
    stem = re.sub(r"[^A-Za-z0-9 ._\-()]", "_", stem).strip(" ._") or fallback
    return f"{stem[:100]}{ext}"


def reencode_image(data: bytes, kind: str, max_side: int = MAX_IMAGE_SIDE) -> bytes:
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        img = Image.open(io.BytesIO(data))
        if (img.format or "").upper() not in ("JPEG", "PNG"):
            raise ValueError("unexpected image format")
        img.load()
        img = ImageOps.exif_transpose(img)   # keep the orientation, then drop every metadata block
    except Exception:  # noqa: BLE001 — truncated, corrupt, bomb or disguised file
        raise HTTPException(415, "The image could not be read") from None
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    if kind == "png":
        if img.mode not in ("RGB", "RGBA", "L", "LA"):
            img = img.convert("RGBA")
        img.save(out, "PNG", optimize=True)
    else:
        img.convert("RGB").save(out, "JPEG", quality=85, optimize=True)
    return out.getvalue()


def check_pdf(data: bytes) -> None:
    if _PDF_ACTIVE.search(data):
        raise HTTPException(415, "PDFs with scripts, attachments or interactive forms are not accepted. Print it to PDF first.")
    try:
        import pymupdf

        with pymupdf.open(stream=data, filetype="pdf") as doc:
            if doc.needs_pass or doc.is_encrypted:
                raise HTTPException(415, "Password-protected PDFs are not accepted")
            if doc.page_count < 1:
                raise ValueError("no pages")
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        raise HTTPException(415, "The PDF could not be read") from None


def validate_upload(upload: UploadFile, *, allowed: Iterable[str], max_bytes: int, reencode_images: bool = True,
                    max_image_side: int = MAX_IMAGE_SIDE) -> ValidatedUpload:
    allowed = tuple(allowed)
    unknown = set(allowed) - set(KINDS)
    if unknown:
        raise ValueError(f"unknown upload kinds: {sorted(unknown)}")
    data = read_limited(upload, max_bytes)
    kind = sniff(data)
    if kind not in allowed:
        raise HTTPException(415, "Only " + " / ".join(LABELS[k] for k in allowed) + " files are accepted")
    if kind == "pdf":
        check_pdf(data)
    elif reencode_images:
        data = reencode_image(data, kind, max_image_side)
        if len(data) > max_bytes:
            raise HTTPException(413, f"The file is larger than {_mb(max_bytes)}")
    _, mime, ext = KINDS[kind]
    return ValidatedUpload(data=data, kind=kind, mime=mime, ext=ext, sha256=hashlib.sha256(data).hexdigest(),
                           filename=safe_filename(upload.filename, ext))


def content_disposition(filename: str, inline: bool = False) -> str:
    """RFC 6266 header with an ASCII fallback and the UTF-8 name."""
    from urllib.parse import quote

    ascii_name = re.sub(r"[^A-Za-z0-9 ._\-()]", "_", filename)[:150] or "download"
    return f"{'inline' if inline else 'attachment'}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename[:150])}"


def _mb(n: int) -> str:
    return f"{n / (1024 * 1024):.0f} MB" if n >= 1024 * 1024 else f"{n // 1024} KB"
