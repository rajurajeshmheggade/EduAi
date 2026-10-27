"""Licence-aware access rules for DIKSHA resources (see docs/DIKSHA_LICENSE_AND_ATTRIBUTION.md).

DIKSHA's Content Policy allows exactly these licences: CC BY 4.0, CC BY-SA 4.0, CC BY-NC 4.0, CC BY-NC-SA 4.0,
CC BY-ND 4.0, CC BY-NC-ND 4.0 and the YouTube licence. Each resource carries its own licence, so permissions are
decided per resource:

  discover / link      always (public metadata + official DIKSHA link)
  embed (in-app view)  CC BY, BY-SA, BY-ND: yes (unmodified, with attribution, streamed from DIKSHA's host)
                       CC *NC*: only when DIKSHA_EMBED_NONCOMMERCIAL is enabled after review; otherwise official link
                       YouTube licence: only through YouTube's own embedded player
                       unknown / missing licence: never — official link + "needs review"
  download             documents (PDF/EPUB) only, from DIKSHA's own host, when in-app display is allowed
  store a local copy   never (the LMS does not mirror DIKSHA content)
  redistribute         never by the LMS (it links to / streams from the source)
  modify / derivatives not offered by the LMS; reported as what the licence would allow (no ND)
"""
from __future__ import annotations

import re

from ...config import get_settings
from .normalize import safe_url, youtube_id

_CC = re.compile(r"^CC BY(-NC)?(-ND|-SA)? (\d\.\d)$", re.I)
YOUTUBE = "standard youtube license"


def parse_license(name: str | None) -> dict:
    n = re.sub(r"\s+", " ", (name or "").strip()).replace("BY4.0", "BY 4.0")
    m = _CC.match(n)
    if m:
        return {"name": n, "family": "cc", "nc": bool(m.group(1)), "nd": (m.group(2) or "").upper() == "-ND",
                "sa": (m.group(2) or "").upper() == "-SA", "known": True}
    if n.lower() == YOUTUBE:
        return {"name": n, "family": "youtube", "nc": False, "nd": True, "sa": False, "known": True}
    return {"name": n or None, "family": "unknown", "nc": False, "nd": True, "sa": False, "known": False}


def permissions(item: dict) -> dict:
    s = get_settings()
    lic = parse_license((item.get("license") or {}).get("name"))
    rtype = item.get("resource_type")
    notes: list[str] = []
    if lic["family"] == "youtube":
        embed = rtype == "youtube"
        notes.append("YouTube licence: shown only through YouTube's own embedded player.")
    elif lic["family"] == "cc":
        embed = (not lic["nc"]) or s.diksha_embed_noncommercial
        if lic["nc"] and not embed:
            notes.append("NonCommercial licence: opens on DIKSHA until your institution approves in-app display.")
    else:
        embed = False
        notes.append("Licence missing or not recognised: official DIKSHA link only, needs review.")
    if lic["nd"] and lic["family"] == "cc":
        notes.append("NoDerivatives: shown unmodified only.")
    return {
        "license": lic["name"],
        "discover": True,
        "link": True,
        "embed": bool(embed),
        "download": bool(embed and rtype in ("pdf", "epub") and lic["family"] == "cc"),
        "store_copy": False,
        "redistribute": False,
        "modify": bool(lic["known"] and lic["family"] == "cc" and not lic["nd"]),
        "review_required": not lic["known"] or (lic["nc"] and not embed),
        "eligible": lic["known"],          # unknown licences cannot be published to students
        "notes": notes,
    }


def viewer(item: dict, perms: dict | None = None) -> dict:
    """How the LMS may present a resource: pdf | video | audio | youtube | official (DIKSHA player link)."""
    perms = perms or permissions(item)
    hosts = get_settings().diksha_asset_host_list
    official = {"viewer": "official", "src": None, "official_url": item.get("official_url")}
    rtype = item.get("resource_type")
    if item.get("kind") != "resource":
        return {**official, "reason": "Collections open as a chapter list or on DIKSHA."}
    if not perms["embed"]:
        return {**official, "reason": perms["notes"][0] if perms["notes"] else "Not permitted in-app."}
    if rtype == "youtube":
        vid = youtube_id(item.get("artifact_url"))
        if not vid:
            return {**official, "reason": "The YouTube link on this resource could not be verified."}
        return {"viewer": "youtube", "src": f"https://www.youtube-nocookie.com/embed/{vid}", "official_url": item.get("official_url")}
    if rtype in ("pdf", "video", "audio"):
        # Plain files on DIKSHA's own host (MP4 rather than the HLS stream, which browsers cannot play natively).
        src = safe_url(item.get("artifact_url"), hosts) or safe_url(item.get("preview_url"), hosts)
        if not src or (rtype == "video" and src.lower().endswith(".m3u8")):
            return {**official, "reason": "No directly playable file from DIKSHA's host."}
        return {"viewer": rtype, "src": src, "official_url": item.get("official_url")}
    return {**official, "reason": "Interactive or packaged content runs only in DIKSHA's official player."}


def present(item: dict) -> dict:
    """Public representation of a resource: metadata + permissions + viewer. Raw file URLs are not exposed
    separately; only the viewer source the rules allow."""
    perms = permissions(item)
    out = {k: v for k, v in item.items() if k not in ("artifact_url", "preview_url", "streaming_url")}
    out["permissions"] = perms
    out["access"] = viewer(item, perms)
    return out
