"""Normalise DIKSHA (Sunbird) metadata into the LMS's library shape.

Every value comes from the source record; missing optional metadata stays missing (None / []), nothing is filled in.
Hierarchy order follows DIKSHA's `index` (falling back to the source's own child order).
"""
from __future__ import annotations

import re
from typing import Iterator
from urllib.parse import parse_qs, urlparse

from ...config import get_settings

COLLECTION_MIME = "application/vnd.ekstep.content-collection"
RESOURCE_TYPES = {
    "application/pdf": "pdf",
    "video/mp4": "video",
    "video/webm": "video",
    "video/x-youtube": "youtube",
    "audio/mp3": "audio",
    "audio/mpeg": "audio",
    "application/epub": "epub",
    "application/vnd.ekstep.ecml-archive": "interactive",
    "application/vnd.ekstep.html-archive": "interactive",
    "application/vnd.ekstep.h5p-archive": "interactive",
    COLLECTION_MIME: "collection",
}
_CLASS_RE = re.compile(r"\bclass\s*(\d{1,2})\b", re.I)
_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _list(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [v.strip()] if v.strip() else []
    if isinstance(v, (list, tuple)):
        return [str(x).strip() for x in v if x is not None and str(x).strip()]
    return []


def _first(*values):
    for v in values:
        if v not in (None, "", [], {}):
            return v
    return None


def classes_of(raw: dict) -> list[int]:
    out = set()
    for g in _list(raw.get("se_gradeLevels")) or _list(raw.get("gradeLevel")):
        m = _CLASS_RE.search(g)
        if m:
            out.add(int(m.group(1)))
    return sorted(out)


def safe_url(url, hosts: list[str] | None = None) -> str | None:
    """https URL, optionally restricted to an allow-list of hosts (exact or sub-domain match)."""
    if not isinstance(url, str) or not url.strip():
        return None
    u = urlparse(url.strip())
    if u.scheme != "https" or not u.hostname or u.username or u.password:
        return None
    if hosts is not None:
        host = u.hostname.lower()
        if not any(host == h or host.endswith("." + h) for h in hosts):
            return None
    return url.strip()


def youtube_id(url) -> str | None:
    """Video id from youtu.be/<id>, youtube.com/watch?v=<id>, /embed/<id> or /shorts/<id> links."""
    if not isinstance(url, str):
        return None
    u = urlparse(url.strip())
    host = (u.hostname or "").lower()
    vid = None
    if host == "youtu.be":
        vid = u.path.lstrip("/").split("/")[0]
    elif host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        if u.path == "/watch":
            vid = (parse_qs(u.query).get("v") or [None])[0]
        else:
            parts = [p for p in u.path.split("/") if p]
            if len(parts) >= 2 and parts[0] in ("embed", "shorts", "v", "live"):
                vid = parts[1]
    return vid if vid and _YT_ID.match(vid) else None


_CC = re.compile(r"^CC\s*BY(?:-(NC))?(?:-(ND|SA))?\s*(\d\.\d)$", re.I)


def license_of(raw: dict) -> dict:
    """Licence name + legal URL. URL from DIKSHA's licenseDetails when present, else the canonical CC legal code."""
    details = raw.get("licenseDetails") if isinstance(raw.get("licenseDetails"), dict) else {}
    name = _first(raw.get("license"), details.get("name"))
    name = re.sub(r"\s+", " ", name.strip()).replace("BY4.0", "BY 4.0") if isinstance(name, str) else None
    url = safe_url(details.get("url"))
    if not url and name:
        m = _CC.match(name)
        if m:
            parts = "by" + (f"-{m.group(1).lower()}" if m.group(1) else "") + (f"-{m.group(2).lower()}" if m.group(2) else "")
            url = f"https://creativecommons.org/licenses/{parts}/{m.group(3)}/legalcode"
        elif name.lower() == "standard youtube license":
            url = "https://www.youtube.com/t/terms"
    return {"name": name, "url": url}


def official_url(raw: dict) -> str:
    base = get_settings().diksha_api_base_url.rstrip("/")
    cid = raw.get("identifier")
    if raw.get("mimeType") == COLLECTION_MIME:
        suffix = "?contentType=TextBook" if raw.get("contentType") == "TextBook" else ""
        return f"{base}/play/collection/{cid}{suffix}"
    return f"{base}/play/content/{cid}"


def normalize_item(raw: dict) -> dict:
    s = get_settings()
    hosts = s.diksha_asset_host_list
    mime = raw.get("mimeType")
    rtype = RESOURCE_TYPES.get(mime, "other")
    is_textbook = mime == COLLECTION_MIME and (raw.get("primaryCategory") == "Digital Textbook" or raw.get("contentType") == "TextBook")
    org = raw.get("orgDetails") if isinstance(raw.get("orgDetails"), dict) else {}
    return {
        "source": "diksha",
        "source_id": raw.get("identifier"),
        "kind": "textbook" if is_textbook else ("collection" if mime == COLLECTION_MIME else "resource"),
        "name": (raw.get("name") or "").strip() or None,
        "description": (raw.get("description") or "").strip() or None,
        "cover_url": safe_url(_first(raw.get("appIcon"), raw.get("posterImage")), hosts),
        "primary_category": raw.get("primaryCategory"),
        "content_type": raw.get("contentType"),
        "mime_type": mime,
        "resource_type": rtype,
        "boards": _list(raw.get("se_boards")) or _list(raw.get("board")),
        "classes": classes_of(raw),
        "class_labels": _list(raw.get("se_gradeLevels")) or _list(raw.get("gradeLevel")),
        "subjects": _list(raw.get("se_subjects")) or _list(raw.get("subject")),
        "mediums": _list(raw.get("se_mediums")) or _list(raw.get("medium")),
        "license": license_of(raw),
        "author": (raw.get("author") or "").strip() or None,
        "creator": (raw.get("creator") or "").strip() or None,
        "attributions": _list(raw.get("attributions")),
        "copyright": (raw.get("copyright") or "").strip() or None,
        "copyright_year": raw.get("copyrightYear"),
        "organisation": _list(raw.get("organisation")) or _list(org.get("orgName")),
        "leaf_count": raw.get("leafNodesCount"),
        "size_bytes": raw.get("size"),
        "duration": raw.get("duration"),
        "version": raw.get("pkgVersion"),
        "published_on": raw.get("lastPublishedOn"),
        "status": raw.get("status"),
        "official_url": official_url(raw),
        # Source file references (used only by the access rules; files stay on DIKSHA)
        "artifact_url": raw.get("artifactUrl"),
        "preview_url": raw.get("previewUrl"),
        "streaming_url": raw.get("streamingUrl"),
    }


def _ordered(children) -> list[dict]:
    kids = [c for c in (children or []) if isinstance(c, dict) and c.get("identifier")]
    return [c for _, c in sorted(enumerate(kids), key=lambda t: (t[1].get("index") if isinstance(t[1].get("index"), int) else 10**6, t[0]))]


def _unit(node: dict, path: list[str]) -> dict:
    name = (node.get("name") or "").strip() or "Untitled unit"
    units, resources = [], []
    for c in _ordered(node.get("children")):
        if c.get("mimeType") == COLLECTION_MIME:
            units.append(_unit(c, path + [name]))
        else:
            resources.append({**normalize_item(c), "path": path + [name]})
    count = len(resources) + sum(u["resource_count"] for u in units)
    return {"id": node.get("identifier"), "name": name, "index": node.get("index"), "units": units, "resources": resources,
            "resource_count": count}


def normalize_tree(root: dict) -> dict:
    """{book, units[], resources[] (directly under the book), resource_count}. Units keep DIKSHA's order."""
    units, loose = [], []
    for c in _ordered(root.get("children")):
        if c.get("mimeType") == COLLECTION_MIME:
            units.append(_unit(c, []))
        else:
            loose.append({**normalize_item(c), "path": []})
    tree = {"book": normalize_item(root), "units": units, "resources": loose,
            "empty_units": sum(1 for u in _iter_units(units) if u["resource_count"] == 0)}
    # A resource can be linked under several units; the book total counts each resource once (like leafNodesCount).
    tree["resource_count"] = len({r["source_id"] for r in iter_resources(tree)})
    return tree


def _iter_units(units: list[dict]) -> Iterator[dict]:
    for u in units:
        yield u
        yield from _iter_units(u["units"])


def iter_resources(tree: dict) -> Iterator[dict]:
    yield from tree["resources"]
    for u in _iter_units(tree["units"]):
        yield from u["resources"]


def find_resource(tree: dict, source_id: str) -> dict | None:
    return next((r for r in iter_resources(tree) if r["source_id"] == source_id), None)


def facet_values(result: dict, name: str) -> list[dict]:
    for f in result.get("facets") or []:
        if f.get("name") == name:
            return [{"value": v.get("name"), "count": v.get("count", 0)} for v in f.get("values") or [] if v.get("name")]
    return []


def label(value: str) -> str:
    """DIKSHA facet values are lower-cased ('state (karnataka)'); show them in title case."""
    small = {"and", "of", "the", "in", "for", "to"}
    words = re.split(r"(\s+|/|\(|\))", value.strip())
    out = []
    for i, w in enumerate(words):
        if not w.strip() or w in "/()":
            out.append(w)
        elif w.lower() in small and i:
            out.append(w.lower())
        elif w.upper() in ("CBSE", "NCERT", "ICT", "EVS", "NIOS", "II", "III", "IV"):
            out.append(w.upper())
        elif w.lower() == "i":
            out.append("I")
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return "".join(out)
