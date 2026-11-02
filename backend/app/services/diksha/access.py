"""Licence-aware access rules for catalogue (DIKSHA) resources (see docs/DIKSHA_LICENSE_AND_ATTRIBUTION.md).

DIKSHA's Content Policy allows exactly these licences: CC BY 4.0, CC BY-SA 4.0, CC BY-NC 4.0, CC BY-NC-SA 4.0,
CC BY-ND 4.0, CC BY-NC-ND 4.0 and the YouTube licence. Each resource carries its own licence, so permissions are
decided per resource. Everything the LMS shows opens inside the app; nothing links or redirects to DIKSHA:

  embed (in-app view)  CC BY, BY-SA, BY-ND: yes (unmodified, with attribution, streamed from DIKSHA's host)
                       CC *NC*: only when DIKSHA_EMBED_NONCOMMERCIAL is enabled after review; otherwise the resource
                       is not shown at all (no link-out). Enabling it does not remove the licence note.
                       YouTube licence: only through YouTube's own embedded player
                       unknown / missing licence: never — the resource is hidden ("needs review")
  HTML5 packages       (e.g. OLabs virtual-lab simulations) run unmodified from DIKSHA's own host in a sandboxed frame,
                       under the same embed rule; H5P / ECML packages and EPUBs need DIKSHA's own player or a
                       cross-origin download -> they cannot be shown in-app and are hidden
  visible              a resource appears in the LMS only when it can be shown in-app (viewer != "none");
                       a textbook appears when its licence is recognised (its chapter list is metadata, and every
                       resource inside is checked on its own)
  store a local copy   never (the LMS does not mirror DIKSHA content)
  redistribute         never by the LMS (it streams from the source)
  modify / derivatives not offered by the LMS; reported as what the licence would allow (no ND)
"""
from __future__ import annotations

import re

from ...config import get_settings
from .normalize import safe_url, youtube_id

_CC = re.compile(r"^CC BY(-NC)?(-ND|-SA)? (\d\.\d)$", re.I)
YOUTUBE = "standard youtube license"
YOUTUBE_LICENSE = "Standard YouTube License"
CC_FREE = ["CC BY 4.0", "CC BY-SA 4.0", "CC BY-ND 4.0"]
CC_NC = ["CC BY-NC 4.0", "CC BY-NC-SA 4.0", "CC BY-NC-ND 4.0"]
NONE = "none"            # viewer: cannot be shown in the app -> the resource is not listed
IN_APP = ("pdf", "video", "audio", "youtube", "html")


def parse_license(name: str | None) -> dict:
    n = re.sub(r"\s+", " ", (name or "").strip()).replace("BY4.0", "BY 4.0")
    m = _CC.match(n)
    if m:
        return {"name": n, "family": "cc", "nc": bool(m.group(1)), "nd": (m.group(2) or "").upper() == "-ND",
                "sa": (m.group(2) or "").upper() == "-SA", "known": True}
    if n.lower() == YOUTUBE:
        return {"name": n, "family": "youtube", "nc": False, "nd": True, "sa": False, "known": True}
    return {"name": n or None, "family": "unknown", "nc": False, "nd": True, "sa": False, "known": False}


def embeddable_licenses(*, youtube: bool = True) -> list[str]:
    """Licence names (as DIKSHA writes them) whose resources may be shown in-app with the current settings —
    used as a search filter so result counts and facets only include what the LMS can show."""
    names = CC_FREE + (CC_NC if get_settings().diksha_embed_noncommercial else [])
    return names + ([YOUTUBE_LICENSE] if youtube else [])


def known_licenses() -> list[str]:
    return CC_FREE + CC_NC + [YOUTUBE_LICENSE]


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
        if lic["nc"]:
            notes.append("NonCommercial licence: not shown until your institution approves in-app display." if not embed
                         else "NonCommercial licence — shown in-app because your institution has approved it.")
    else:
        embed = False
        notes.append("Licence missing or not recognised: needs review before it can be used.")
    if lic["nd"] and lic["family"] == "cc":
        notes.append("NoDerivatives: shown unmodified only.")
    return {
        "license": lic["name"],
        "discover": True,
        "embed": bool(embed),
        "store_copy": False,
        "redistribute": False,
        "modify": bool(lic["known"] and lic["family"] == "cc" and not lic["nd"]),
        "review_required": not lic["known"] or (lic["nc"] and not embed),
        "eligible": lic["known"],          # unknown licences cannot be published to students
        "notes": notes,
    }


HTML_ARCHIVE = "application/vnd.ekstep.html-archive"


def html_entry(item: dict, hosts: list[str]) -> str | None:
    """index.html of an extracted HTML5 package on DIKSHA's host (…/content/html/<id>-latest), as DIKSHA's player loads it."""
    base = safe_url(item.get("streaming_url"), hosts) or safe_url(item.get("preview_url"), hosts)
    if not base or "/content/html/" not in base or "?" in base or "#" in base:
        return None
    return base.rstrip("/") + "/index.html"


def viewer(item: dict, perms: dict | None = None) -> dict:
    """How the LMS presents a resource in-app: pdf | video | audio | youtube | html, or none (not shown at all)."""
    perms = perms or permissions(item)
    hosts = get_settings().diksha_asset_host_list
    rtype = item.get("resource_type")
    unavailable = {"viewer": NONE, "src": None}
    if item.get("kind") != "resource":
        return {**unavailable, "reason": "Textbooks open as a chapter list."}
    if not perms["embed"]:
        return {**unavailable, "reason": perms["notes"][0] if perms["notes"] else "Not permitted in the app."}
    if rtype == "youtube":
        vid = youtube_id(item.get("artifact_url"))
        if not vid:
            return {**unavailable, "reason": "The video link on this resource could not be verified."}
        return {"viewer": "youtube", "src": f"https://www.youtube-nocookie.com/embed/{vid}", "video_id": vid}
    if rtype in ("pdf", "video", "audio"):
        # Plain files on DIKSHA's own host (MP4 rather than the HLS stream, which browsers cannot play natively).
        src = safe_url(item.get("artifact_url"), hosts) or safe_url(item.get("preview_url"), hosts)
        if not src or (rtype == "video" and src.lower().endswith(".m3u8")):
            return {**unavailable, "reason": "No directly playable file."}
        return {"viewer": rtype, "src": src}
    if item.get("mime_type") == HTML_ARCHIVE:
        src = html_entry(item, hosts)
        if src:
            return {"viewer": "html", "src": src}
        return {**unavailable, "reason": "This interactive package is not available as a web page."}
    return {**unavailable, "reason": "This format cannot be shown inside the app."}


def visible(item: dict, perms: dict | None = None) -> bool:
    """May the item appear in the LMS at all? Resources: only when they can be shown in-app. Textbooks / collections:
    when their licence is recognised (their chapter list is metadata; each resource inside is checked on its own)."""
    if item.get("kind") != "resource":
        return parse_license((item.get("license") or {}).get("name"))["known"]
    return viewer(item, perms)["viewer"] in IN_APP


PRIVATE = ("artifact_url", "preview_url", "streaming_url", "official_url")


def public(item: dict) -> dict:
    """Metadata without raw file references or links to the source platform."""
    return {k: v for k, v in item.items() if k not in PRIVATE}


def present(item: dict) -> dict:
    """Public representation of a resource: metadata + permissions + in-app viewer. Raw file URLs are not exposed
    separately; only the viewer source the rules allow. No link to the source platform is included."""
    perms = permissions(item)
    out = public(item)
    out["permissions"] = perms
    out["access"] = viewer(item, perms)
    return out


def visible_tree(tree: dict) -> dict:
    """A normalised textbook tree with only the resources that can be shown in-app (counts recomputed)."""
    def unit(u: dict) -> dict:
        units = [unit(c) for c in u["units"]]
        res = [r for r in u["resources"] if visible(r)]
        return {**u, "units": units, "resources": res, "resource_count": len(res) + sum(c["resource_count"] for c in units)}

    units = [unit(u) for u in tree["units"]]
    out = {**tree, "units": units, "resources": [r for r in tree["resources"] if visible(r)]}

    def walk(us: list[dict]):
        for u in us:
            yield u
            yield from walk(u["units"])
    out["empty_units"] = sum(1 for u in walk(units) if u["resource_count"] == 0)
    ids = {r["source_id"] for r in out["resources"]} | {r["source_id"] for u in walk(units) for r in u["resources"]}
    out["resource_count"] = len(ids)
    return out
