"""Digital Library rules: what a reader may do with a catalog record, URL safety, CSV import and link checks.

Permission to *view* a book (an official link) is distinct from permission to *embed* it in our reader or to let
students *download* it (FRD §7.1, §10). In-app reading requires every one of: verified catalog record, verified
licence, `in_app_reader_allowed`, and access mode `in_app_reader`. Anything less falls back to the official link.
"""
from __future__ import annotations

import csv
import io
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx

BOARDS = {"NCERT_CBSE": "NCERT / CBSE", "KARNATAKA_STATE": "Karnataka State Board"}
LANGUAGES = ["English", "Kannada", "Hindi"]
CLASSES = list(range(1, 13))
ACCESS_MODES = {"official_link": "Official source link", "in_app_reader": "In-app reader"}
LICENSE_STATUSES = {"verified": "Verified", "permission_required": "Permission required", "unknown": "Unknown"}
VERIFICATION_STATUSES = {"verified": "Verified", "pending": "Pending review", "rejected": "Rejected"}


def in_app_allowed(b: dict) -> bool:
    return (b["verification_status"] == "verified" and b["license_status"] == "verified"
            and bool(b["in_app_reader_allowed"]) and b["access_mode"] == "in_app_reader")


def access_info(b: dict) -> dict:
    """The access method the server permits for this record (never more than the licence allows)."""
    if not b["is_active"] or b["verification_status"] != "verified":
        mode = "unavailable"
    elif in_app_allowed(b):
        mode = "in_app_file" if b.get("file_key") else "in_app_embed"
    else:
        mode = "official_link"
    return {
        "mode": mode,
        "source_name": b["source_name"],
        "source_url": b["source_url"],
        "license_status": b["license_status"],
        "license_notice": b.get("license_notice"),
        "download_allowed": mode == "in_app_file" and bool(b["download_allowed"]),
        "link_status": b["link_status"],
        "chapters": b.get("chapters") or [],
    }


# ---------------------------------------------------------------- URL safety
def validate_source_url(url: str) -> str:
    url = (url or "").strip()
    p = urlparse(url)
    if p.scheme != "https" or not p.hostname:
        raise ValueError("Source URL must be a full https:// link to the official source")
    if p.username or p.password:
        raise ValueError("Source URL must not contain credentials")
    return url


def _public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def check_link(url: str, timeout: float = 8.0, max_redirects: int = 3) -> str:
    """'ok' or 'broken'. Only public https hosts are contacted; redirects are re-validated hop by hop."""
    for _ in range(max_redirects + 1):
        try:
            validate_source_url(url)
        except ValueError:
            return "broken"
        if not _public_host(urlparse(url).hostname or ""):
            return "broken"
        try:
            with httpx.Client(timeout=timeout, follow_redirects=False, headers={"User-Agent": "EduAI-LinkCheck/1.0"}) as c:
                r = c.head(url)
                if r.status_code in (405, 501):  # some servers reject HEAD
                    r = c.get(url, headers={"Range": "bytes=0-0"})
        except httpx.HTTPError:
            return "broken"
        if r.is_redirect and r.headers.get("location"):
            url = urljoin(url, r.headers["location"])
            continue
        return "ok" if r.status_code < 400 else "broken"
    return "broken"


# ---------------------------------------------------------------- CSV import
CSV_COLUMNS = ["board", "class_number", "subject_name", "language", "title", "academic_year", "publisher", "source_name",
               "source_url", "access_mode", "license_status", "license_notice", "in_app_reader_allowed", "download_allowed",
               "verification_status"]
_TRUE = {"1", "true", "yes", "y"}


_BOARD_ALIASES = {"ncert_cbse": "NCERT_CBSE", "ncert / cbse": "NCERT_CBSE", "ncert": "NCERT_CBSE", "cbse": "NCERT_CBSE",
                  "karnataka_state": "KARNATAKA_STATE", "karnataka state board": "KARNATAKA_STATE",
                  "karnataka state": "KARNATAKA_STATE", "karnataka": "KARNATAKA_STATE", "ksb": "KARNATAKA_STATE"}


def _board(v: str) -> str:
    code = _BOARD_ALIASES.get(v.strip().lower())
    if not code:
        raise ValueError(f"unknown board “{v.strip()}”")
    return code


def parse_csv(text: str) -> tuple[list[dict], list[str]]:
    """(rows, errors). Each row is validated; a row with any error is skipped and reported by line number."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    missing = {"board", "class_number", "subject_name", "language", "title", "source_name", "source_url"} - set(reader.fieldnames or [])
    if missing:
        return [], [f"Missing column(s): {', '.join(sorted(missing))}"]
    rows, errors = [], []
    for n, raw in enumerate(reader, start=2):
        r = {k: (raw.get(k) or "").strip() for k in CSV_COLUMNS}
        try:
            row = {
                "board": _board(r["board"]),
                "class_number": int(r["class_number"]),
                "subject_name": r["subject_name"],
                "language": next((l for l in LANGUAGES if l.lower() == r["language"].lower()), None),
                "title": r["title"],
                "academic_year": r["academic_year"] or None,
                "publisher": r["publisher"] or None,
                "source_name": r["source_name"],
                "source_url": validate_source_url(r["source_url"]),
                "access_mode": r["access_mode"] or "official_link",
                "license_status": r["license_status"] or "unknown",
                "license_notice": r["license_notice"] or None,
                "in_app_reader_allowed": r["in_app_reader_allowed"].lower() in _TRUE,
                "download_allowed": r["download_allowed"].lower() in _TRUE,
                "verification_status": r["verification_status"] or "pending",
            }
            if not 1 <= row["class_number"] <= 12:
                raise ValueError("class_number must be 1-12")
            if not row["language"]:
                raise ValueError(f"language must be one of {', '.join(LANGUAGES)}")
            if not row["subject_name"] or not row["title"] or not row["source_name"]:
                raise ValueError("subject_name, title and source_name are required")
            if row["access_mode"] not in ACCESS_MODES or row["license_status"] not in LICENSE_STATUSES \
                    or row["verification_status"] not in VERIFICATION_STATUSES:
                raise ValueError("invalid access_mode, license_status or verification_status")
            rows.append(row)
        except ValueError as e:
            errors.append(f"Line {n}: {e}")
    return rows, errors
