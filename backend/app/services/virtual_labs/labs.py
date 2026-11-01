"""DIKSHA virtual-lab collection -> experiments.

In every collection on https://diksha.gov.in/virtuallabs.html a top-level unit is one experiment (or activity). Its
resources sit directly under it or in sub-units such as "Simulation", "Explanation Resources" and "Self-Evaluation":
OLabs HTML5 simulations, theory / procedure PDFs, animation videos and H5P self-checks. Each resource gets a role from
its name and type so the workspace can show the simulation first and the reading material beside it.
"""
from __future__ import annotations

import re

from ..diksha import access as acc

HTML = "application/vnd.ekstep.html-archive"
H5P = "application/vnd.ekstep.h5p-archive"

ROLES = ["simulation", "manual", "theory", "procedure", "video", "self_check", "reading", "other"]
ROLE_LABEL = {"simulation": "Simulation", "manual": "Lab manual", "theory": "Theory", "procedure": "Procedure",
              "video": "Animation / video", "self_check": "Self-evaluation", "reading": "Reading", "other": "Resource"}

_SELF_CHECK = re.compile(r"self\s*[-_]?\s*evaluation|assessment|\bquiz\b", re.I)
_THEORY = re.compile(r"^\W*theory\b", re.I)
_PROCEDURE = re.compile(r"^\W*procedure\b", re.I)
_MANUAL = re.compile(r"^\W*(experiment|activity|demonstration|project)\b|\bpdfs?\b", re.I)
_SPACE = re.compile(r"\s+")


def clean_name(name: str | None) -> str:
    return _SPACE.sub(" ", (name or "").replace("�", "-")).strip(" -_") or "Untitled experiment"


def role_of(r: dict) -> str:
    name = r.get("name") or ""
    group = (r.get("path") or [""])[-1]
    mime = r.get("mime_type")
    if mime == H5P or _SELF_CHECK.search(name):
        return "self_check"
    if mime == HTML:
        return "simulation"
    if _THEORY.search(name):
        return "theory"
    if _PROCEDURE.search(name):
        return "procedure"
    if r.get("resource_type") in ("video", "youtube"):
        return "video"
    if r.get("resource_type") == "pdf":
        return "manual" if _MANUAL.search(name) or _MANUAL.search(group) else "reading"
    return "other"


def _unit_resources(unit: dict) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []

    def walk(u: dict) -> None:
        for r in u["resources"]:
            if r["source_id"] not in seen:
                seen.add(r["source_id"])
                out.append({**r, "role": role_of(r)})
        for c in u["units"]:
            walk(c)

    walk(unit)
    return out


def _keywords(resources: list[dict]) -> list[str]:
    out: list[str] = []
    for r in resources:
        for k in r.get("keywords") or []:
            k = _SPACE.sub(" ", k).strip(" ,;")
            if k and k.lower() not in (x.lower() for x in out):
                out.append(k[:80])
    return out[:12]


def _summary(resources: list[dict]) -> str | None:
    by_role = sorted(resources, key=lambda r: ROLES.index(r["role"]))
    return next((r["description"] for r in by_role if r.get("description")), None)


def experiment(unit: dict, position: int) -> dict:
    """One experiment with its resources (normalised DIKSHA metadata + role), ordered simulation-first."""
    resources = sorted(_unit_resources(unit), key=lambda r: ROLES.index(r["role"]))
    roles = {k: sum(1 for r in resources if r["role"] == k) for k in ROLES}
    return {
        "lab_id": unit["id"],
        "name": clean_name(unit["name"]),
        "position": position,
        "summary": _summary(resources),
        "keywords": _keywords(resources),
        "roles": {k: v for k, v in roles.items() if v},
        "has_simulation": roles["simulation"] > 0,
        "authors": sorted({r["author"] for r in resources if r.get("author")}),
        "licenses": sorted({r["license"]["name"] for r in resources if r["license"].get("name")}),
        "resources": resources,
    }


def experiments(tree: dict) -> list[dict]:
    """Experiments of a collection in DIKSHA's order; units without any resource are left out."""
    out = []
    for u in tree["units"]:
        if u["resource_count"]:
            out.append(experiment(u, len(out) + 1))
    return out


def find(tree: dict, lab_id: str) -> dict | None:
    return next((e for e in experiments(tree) if e["lab_id"] == lab_id), None)


def summary(lab: dict) -> dict:
    """Experiment without its resource list (catalogue view)."""
    return {k: v for k, v in lab.items() if k != "resources"}


def collection_info(book: dict, entry: dict | None = None) -> dict:
    keys = ("source_id", "name", "description", "cover_url", "classes", "subjects", "mediums", "license", "author", "creator",
            "attributions", "copyright", "copyright_year", "organisation", "official_url")
    info = {k: book.get(k) for k in keys}
    if entry:
        info.update({"class_number": entry["class_number"], "medium": entry["medium"], "subject": entry["subject"],
                     "label": entry["label"]})
    return info


def present(lab: dict) -> dict:
    """Experiment for display: each resource with the licence decision and how it may be shown (html / pdf / video / official)."""
    return {**lab, "resources": [{**acc.present(r), "role": r["role"], "role_label": ROLE_LABEL[r["role"]]}
                                 for r in lab["resources"]]}


def snapshot(lab: dict, collection: dict) -> dict:
    """What an assignment stores: experiment metadata + DIKSHA file references (never the content itself).
    Resources whose licence is missing or unrecognised are left out (they cannot be shown to students)."""
    resources = [r for r in lab["resources"] if acc.permissions(r)["eligible"]]
    return {**lab, "resources": resources, "collection": collection}
