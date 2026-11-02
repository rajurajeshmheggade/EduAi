"""Digital Library — DIKSHA source: on-demand search, textbook hierarchy, licence-aware access, publishing.

Catalog data is searched live (cached) through the verified public DIKSHA APIs; nothing is bulk-synchronised.
Teachers publish references (source ids + metadata) to a class subject; students open only what is published to
their own class for its current academic year (derived server-side). Files are never copied or proxied.

Everything opens inside the LMS: only items that can be shown in-app are listed (services.diksha.access.visible) —
search filters by in-app formats and permitted licences, so facets and counts match what users can open — and no
response links to the source platform. User-facing messages never name the source platform.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import db
from ..config import get_settings
from ..security import ADMIN_ROLES, CurrentUser, require_role
from ..services.diksha import access as acc
from ..services.diksha import normalize as nz
from ..services.diksha.client import DikshaError, get_client, validate_id
from .admin import org_scope
from .library import _event, _teacher_targets

router = APIRouter(prefix="/ICMELive/api/v1/library/diksha", tags=["library-diksha"])
anyone = require_role("teacher", "student", "orgadmin", "superadmin")
staff = require_role("teacher", "orgadmin", "superadmin")
teachers = require_role("teacher")
admins = require_role("orgadmin", "superadmin")

CLASSES = list(range(5, 13))  # scope of this integration: Classes 5-12
# Content types offered: textbooks (chapter lists) and the resource formats the LMS can show in-app. ECML / H5P
# packages, EPUBs and question sets need the source platform's own player (or a cross-origin download), so they are
# not offered. Courses need enrolment on the source platform, so they are not offered either.
TEXTBOOK = "Digital Textbook"
CONTENT_TYPES: dict[str, dict] = {
    "textbook": {"label": "Textbooks", "filters": {"primaryCategory": [TEXTBOOK]}},
    "video": {"label": "Videos", "filters": {"mimeType": ["video/mp4", "video/webm", "video/x-youtube"]}},
    "document": {"label": "Documents (PDF)", "filters": {"mimeType": ["application/pdf"]}},
    "interactive": {"label": "Interactive", "filters": {"mimeType": [acc.HTML_ARCHIVE]}},
    "audio": {"label": "Audio", "filters": {"mimeType": ["audio/mp3", "audio/mpeg"]}},
}
RESOURCE_MIMES = {m: t for t, c in CONTENT_TYPES.items() for m in c["filters"].get("mimeType", [])}
SEARCH_FIELDS = ["identifier", "name", "description", "appIcon", "posterImage", "mimeType", "primaryCategory", "contentType",
                 "se_boards", "se_gradeLevels", "se_subjects", "se_mediums", "board", "gradeLevel", "subject", "medium",
                 "license", "author", "creator", "attributions", "copyright", "copyrightYear", "organisation", "leafNodesCount",
                 "lastPublishedOn", "pkgVersion", "artifactUrl", "previewUrl", "streamingUrl", "size", "duration", "status"]
FACETS = ["se_boards", "se_gradeLevels", "se_subjects", "se_mediums"]
STATUS = {"disabled": 503, "invalid_id": 422, "timeout": 504, "rate_limited": 429, "not_found": 404, "bad_request": 400,
          "unavailable": 502, "invalid_response": 502}


def _fail(e: DikshaError) -> HTTPException:
    return HTTPException(STATUS.get(e.kind, 502), str(e))


def _client():
    try:
        return get_client()
    except DikshaError as e:
        raise _fail(e)


def _supported_boards() -> list[str]:
    return get_settings().diksha_board_list


def _match(value: str, allowed: list[str]) -> str | None:
    v = (value or "").strip().lower()
    return next((a for a in allowed if a.lower() == v), None)


def _board_label(b: str) -> str:
    return "Karnataka State Board" if b.lower() == "state (karnataka)" else nz.label(b)


def _content_type(value: str | None) -> str:
    """Content-type key (textbook | video | document | interactive | audio); textbooks when not given."""
    key = (value or "textbook").strip().lower()
    if key not in CONTENT_TYPES:
        raise HTTPException(422, "Content type not supported")
    return key


def _type_filters(ctype: str) -> dict:
    """Search filters for one content type: its formats + the licences whose items the LMS may show in-app."""
    f = dict(CONTENT_TYPES[ctype]["filters"])
    if ctype == "textbook":
        f["license"] = acc.known_licenses()          # textbooks: any recognised licence (resources are checked one by one)
    else:
        f["license"] = acc.embeddable_licenses(youtube=ctype == "video")
    return f


def _scope(board: str | None, class_number: int | None) -> dict:
    boards = _supported_boards()
    return {"status": ["Live"], "se_boards": [_match(board, boards)] if board and _match(board, boards) else boards,
            "se_gradeLevels": [f"Class {class_number}"] if class_number else [f"Class {c}" for c in CLASSES]}


def _facets(filters: dict, facets: list[str]) -> dict:
    req: dict = {"filters": filters, "limit": 0}
    if facets:
        req["facets"] = facets
    try:
        return _client().search(req)
    except DikshaError as e:
        raise _fail(e)


# ---------------------------------------------------------------- shared helpers
def _student_scope(user: CurrentUser) -> dict:
    me = db.call_row("usp_get_member", user.org_code, user.user_code)
    if not me or not me.get("class_code"):
        raise HTTPException(404, "You are not assigned to a class")
    return db.fetch_one("SELECT class_code, year_code FROM public.classes WHERE org_code = %s AND class_code = %s",
                        (user.org_code, me["class_code"]))


def _published_to_student(user: CurrentUser, source_id: str) -> dict | None:
    """Active publication of this source item for the student's own class + current academic year."""
    cls = _student_scope(user)
    return db.fetch_one(
        "SELECT s.item_id, s.kind, s.metadata, p.source_context FROM public.library_publications p "
        "JOIN public.library_source_items s ON s.item_id = p.source_item_id "
        "WHERE p.org_code = %s AND p.class_code = %s AND p.year_code = %s AND p.status = 'published' AND s.source_id = %s LIMIT 1",
        (user.org_code, cls["class_code"], cls["year_code"], source_id))


def _store(conn, item: dict) -> str:
    row = conn.execute(
        "INSERT INTO public.library_source_items (source, source_id, kind, name, metadata) VALUES ('diksha', %s, %s, %s, %s) "
        "ON CONFLICT (source, source_id) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, metadata = EXCLUDED.metadata, "
        "source_status = 'available', fetched_at = NOW() RETURNING item_id",
        (item["source_id"], "textbook" if item["kind"] == "textbook" else "resource", (item["name"] or item["source_id"])[:500],
         Jsonb(item))).fetchone()
    return row["item_id"]


def _mark_unavailable(source_id: str) -> None:
    db.execute("UPDATE public.library_source_items SET source_status = 'unavailable', fetched_at = NOW() "
               "WHERE source = 'diksha' AND source_id = %s", (source_id,))


def _read(source_id: str) -> dict:
    try:
        return nz.normalize_item(_client().read(validate_id(source_id)))
    except DikshaError as e:
        if e.kind == "not_found":
            _mark_unavailable(source_id)
        raise _fail(e)


def _tree(source_id: str) -> dict:
    try:
        return nz.normalize_tree(_client().hierarchy(validate_id(source_id)))
    except DikshaError as e:
        if e.kind == "not_found":
            _mark_unavailable(source_id)
        raise _fail(e)


def _present_tree(tree: dict) -> dict:
    """Textbook tree for display: only resources that can be shown in-app, each with its licence decision."""
    tree = acc.visible_tree(tree)

    def unit(u: dict) -> dict:
        return {**u, "units": [unit(x) for x in u["units"]], "resources": [acc.present(r) for r in u["resources"]]}
    book = tree["book"]
    return {"book": {**acc.present(book)}, "units": [unit(u) for u in tree["units"]],
            "resources": [acc.present(r) for r in tree["resources"]], "resource_count": tree["resource_count"],
            "empty_units": tree["empty_units"]}


def _shown(item: dict) -> dict:
    """An item that may appear in the LMS, presented; 404 for anything that cannot be shown in-app."""
    if not acc.visible(item):
        raise HTTPException(404, "This item is not available in the library")
    return acc.present(item)


# ---------------------------------------------------------------- catalog
@router.get("/meta")
def meta(user: CurrentUser = Depends(anyone)):
    s = get_settings()
    return {"enabled": s.diksha_enabled,
            "boards": [{"value": b, "label": _board_label(b)} for b in _supported_boards()], "classes": CLASSES,
            "content_types": [{"value": k, "label": v["label"]} for k, v in CONTENT_TYPES.items()],
            "embed_noncommercial": s.diksha_embed_noncommercial}


@router.get("/filters")
def filters(board: str | None = None, class_number: int | None = Query(default=None, ge=5, le=12),
            content_type: str | None = Query(default=None, max_length=60), subject: str | None = Query(default=None, max_length=120),
            user: CurrentUser = Depends(staff)):
    """Filter values with result counts, from the source's facets for the current selection — counting only what the
    LMS can show in-app. Dependent lists: content types (for board + class) -> subjects that have content of the chosen
    type -> languages (for the chosen type and subject)."""
    ctype = _content_type(content_type)
    scope = _scope(board, class_number)
    by_type = {**scope, **_type_filters(ctype)}
    requests = {
        "selected": (by_type, FACETS),
        # counts per resource format (one query) and the textbook count (licence rule differs for textbooks)
        "formats": ({**scope, "mimeType": list(RESOURCE_MIMES), "license": acc.embeddable_licenses()}, ["mimeType"]),
    }
    if ctype != "textbook":
        requests["textbooks"] = ({**scope, **_type_filters("textbook")}, [])
    if subject:
        requests["mediums"] = ({**by_type, "se_subjects": [subject]}, ["se_mediums"])
    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        futures = {k: pool.submit(_facets, f, fac) for k, (f, fac) in requests.items()}
        res = {k: fut.result() for k, fut in futures.items()}
    sel = res["selected"]
    grade_counts = {v["value"]: v["count"] for v in nz.facet_values(sel, "se_gradeLevels")}
    type_counts = {t: 0 for t in CONTENT_TYPES}
    for v in nz.facet_values(res["formats"], "mimeType"):
        t = RESOURCE_MIMES.get(v["value"]) or next((t for m, t in RESOURCE_MIMES.items() if m.lower() == v["value"].lower()), None)
        if t:
            type_counts[t] += v["count"]
    type_counts["textbook"] = (sel if ctype == "textbook" else res["textbooks"]).get("count") or 0
    mediums = nz.facet_values(res["mediums"] if subject else sel, "se_mediums")
    return {
        "total": sel.get("count", 0),
        "content_type": ctype,
        "boards": [{"value": b, "label": _board_label(b), "count": next((v["count"] for v in nz.facet_values(sel, "se_boards")
                                                                          if v["value"].lower() == b.lower()), 0)} for b in _supported_boards()],
        "classes": [{"value": c, "label": f"Class {c}", "count": grade_counts.get(f"class {c}", 0)} for c in CLASSES],
        # only subjects that have content of the chosen type (facet values with a zero count are never returned)
        "subjects": sorted([{"value": v["value"], "label": nz.label(v["value"]), "count": v["count"]}
                            for v in nz.facet_values(sel, "se_subjects") if v["count"] > 0], key=lambda x: x["label"]),
        "mediums": sorted([{"value": v["value"], "label": nz.label(v["value"]), "count": v["count"]}
                           for v in mediums if v["count"] > 0], key=lambda x: -x["count"]),
        "content_types": [{"value": k, "label": v["label"], "count": type_counts[k]} for k, v in CONTENT_TYPES.items()],
    }


@router.get("/search")
def search(board: str | None = None, class_number: int | None = Query(default=None, ge=5, le=12),
           subject: str | None = Query(default=None, max_length=120), medium: str | None = Query(default=None, max_length=60),
           content_type: str | None = Query(default=None, max_length=60), q: str | None = Query(default=None, max_length=100),
           page: int = Query(default=1, ge=1), page_size: int = Query(default=24, ge=1, le=50),
           user: CurrentUser = Depends(staff)):
    """On-demand catalog search (Classes 5-12, supported boards only). Results come from DIKSHA, never hard-coded,
    and include only what can be shown in-app: the chosen type's formats and permitted licences (NonCommercial ones
    only when DIKSHA_EMBED_NONCOMMERCIAL is enabled; unknown licences never)."""
    if board and not _match(board, _supported_boards()):
        raise HTTPException(422, "Board not supported in this library")
    ctype = _content_type(content_type)
    f: dict = {**_scope(board, class_number), **_type_filters(ctype)}
    if subject:
        f["se_subjects"] = [subject]
    if medium:
        f["se_mediums"] = [medium]
    req: dict = {"filters": f, "limit": page_size, "offset": (page - 1) * page_size, "fields": SEARCH_FIELDS}
    if q and q.strip():
        req["query"] = q.strip()      # relevance order for text search
    else:
        req["sort_by"] = {"name": "asc"}
    try:
        res = _client().search(req)
    except DikshaError as e:
        raise _fail(e)
    items = []
    for raw in res.get("content") or []:
        if not isinstance(raw, dict) or not raw.get("identifier"):
            continue  # skip incomplete records instead of failing the whole page
        it = nz.normalize_item(raw)
        if acc.visible(it):  # safety net: e.g. a YouTube-licensed MP4, or a video with only an HLS stream
            items.append(acc.present(it))
    if user.role == "teacher" and items:
        targets = {(t["class_code"], t["subject_code"]) for t in _teacher_targets(user)}
        pubs = db.fetch_all(
            "SELECT s.source_id, p.publication_id, p.class_code, p.subject_code, c.class_name FROM public.library_publications p "
            "JOIN public.library_source_items s ON s.item_id = p.source_item_id "
            "JOIN public.classes c ON c.org_code = p.org_code AND c.class_code = p.class_code "
            "WHERE p.org_code = %s AND p.status = 'published' AND p.year_code = c.year_code AND s.source_id = ANY(%s)",
            (user.org_code, [i["source_id"] for i in items]))
        by: dict = {}
        for p in pubs:
            if (p["class_code"], p["subject_code"]) in targets:
                by.setdefault(p["source_id"], []).append({k: p[k] for k in ("publication_id", "class_code", "class_name", "subject_code")})
        for i in items:
            i["published_to"] = by.get(i["source_id"], [])
    return {"items": items, "total": res.get("count"), "page": page, "page_size": page_size,
            "window_exceeded": bool(res.get("window_exceeded"))}


@router.get("/items/{source_id}")
def item(source_id: str, user: CurrentUser = Depends(anyone)):
    """Details of one catalogue item. Students only for items published to their class."""
    if user.role == "student" and not _published_to_student(user, source_id):
        raise HTTPException(404, "Not found in your library")
    return _shown(_read(source_id))


@router.get("/textbooks/{source_id}")
def textbook(source_id: str, user: CurrentUser = Depends(anyone)):
    """Textbook with its chapter/unit hierarchy and the resources linked to each unit (order preserved)."""
    if user.role == "student" and not _published_to_student(user, source_id):
        raise HTTPException(404, "Not found in your library")
    tree = _tree(source_id)
    if tree["book"]["kind"] not in ("textbook", "collection"):
        raise HTTPException(422, "This item is not a textbook")
    if not acc.visible(tree["book"]):
        raise HTTPException(404, "This item is not available in the library")
    return _present_tree(tree)


@router.get("/resources/{source_id}")
def resource(source_id: str, within: str | None = Query(default=None, max_length=100), user: CurrentUser = Depends(anyone)):
    """Access decision for one resource: in-app viewer (pdf / video / audio / youtube / html) + licence + attribution.
    Resources that cannot be shown in-app are not found (404) — nothing is sent to the source platform instead.

    Students: the resource must be published to their class, or belong to a textbook published to their class
    (`within`), verified against the textbook's hierarchy on the server.
    """
    validate_or_422(source_id)
    if user.role == "student":
        direct = _published_to_student(user, source_id)
        if not direct:
            if not within:
                raise HTTPException(404, "Not found in your library")
            validate_or_422(within)
            if not _published_to_student(user, within):
                raise HTTPException(404, "Not found in your library")
            found = nz.find_resource(_tree(within), source_id)
            if not found:
                raise HTTPException(404, "This resource is not part of that textbook")
            return _shown(found)
    if within:
        validate_or_422(within)
        found = nz.find_resource(_tree(within), source_id)
        if found:
            return _shown(found)
    return _shown(_read(source_id))


def validate_or_422(cid: str) -> None:
    try:
        validate_id(cid)
    except DikshaError as e:
        raise _fail(e)


# ---------------------------------------------------------------- teacher publishing
class PublishItem(BaseModel):
    source_id: str = Field(min_length=5, max_length=100)
    within: str | None = Field(default=None, max_length=100, description="Textbook the resource was chosen from")


class PublishIn(BaseModel):
    items: list[PublishItem] = Field(min_length=1, max_length=30)
    class_code: str = Field(min_length=1, max_length=64)
    subject_code: str = Field(min_length=1, max_length=64)


@router.post("/publications")
def publish(body: PublishIn, user: CurrentUser = Depends(teachers)):
    """Publish catalogue textbooks / resources (as references) to a class subject. Each item is re-validated live and
    must be showable in-app."""
    target = next((t for t in _teacher_targets(user) if t["class_code"] == body.class_code and t["subject_code"] == body.subject_code), None)
    if not target:
        raise HTTPException(403, "You can publish only to subjects you teach or to your own class")
    boards = [b.lower() for b in _supported_boards()]
    checked = []
    for it in {i.source_id: i for i in body.items}.values():
        validate_or_422(it.source_id)
        context = None
        if it.within:
            validate_or_422(it.within)
            tree = _tree(it.within)
            found = nz.find_resource(tree, it.source_id)
            if not found:
                raise HTTPException(422, "That resource is not part of the selected textbook")
            raw_item = _read(it.source_id)  # live metadata (status, licence) of the resource itself
            context = {"textbook_id": it.within, "textbook_name": tree["book"]["name"], "path": found.get("path", [])}
            src_item = {**raw_item, "boards": raw_item["boards"] or tree["book"]["boards"],
                        "classes": raw_item["classes"] or tree["book"]["classes"],
                        "subjects": raw_item["subjects"] or tree["book"]["subjects"], "mediums": raw_item["mediums"] or tree["book"]["mediums"]}
        else:
            src_item = _read(it.source_id)
        name = src_item["name"] or it.source_id
        if src_item.get("status") and src_item["status"] != "Live":
            raise HTTPException(422, f"“{name}” is no longer available in the catalogue")
        if src_item["kind"] == "collection":
            raise HTTPException(422, f"“{name}” is a collection type that cannot be published here")
        if not any(b.lower() in boards for b in src_item["boards"]):
            raise HTTPException(422, f"“{name}” is not from a supported board")
        if src_item["classes"] and not set(src_item["classes"]) & set(CLASSES):
            raise HTTPException(422, f"“{name}” is not for Classes 5–12")
        if target["grade_number"] and src_item["classes"] and target["grade_number"] not in src_item["classes"]:
            raise HTTPException(422, f"“{name}” is for Class {', '.join(map(str, src_item['classes']))}, "
                                     f"but {target['class_name']} is Class {target['grade_number']}")
        perms = acc.permissions(src_item)
        if not perms["eligible"]:
            raise HTTPException(422, f"“{name}” has no recognised licence and needs review before it can be published")
        if not acc.visible(src_item, perms):
            raise HTTPException(422, f"“{name}” cannot be shown inside the app (its licence or format does not allow it), "
                                     "so it cannot be published")
        checked.append((src_item, context))

    created, existing = [], []
    with db.connection() as conn:
        for src_item, context in checked:
            item_id = _store(conn, src_item)
            row = conn.execute(
                "INSERT INTO public.library_publications (org_code, source_item_id, teacher_code, class_code, subject_code, year_code, source_context) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (org_code, source_item_id, class_code, subject_code, year_code) "
                "WHERE status = 'published' AND source_item_id IS NOT NULL DO NOTHING RETURNING publication_id",
                (user.org_code, item_id, user.user_code, body.class_code, body.subject_code, target["year_code"],
                 Jsonb(context) if context else None)).fetchone()
            if not row:
                existing.append(src_item["name"])
                continue
            again = conn.execute(
                "SELECT 1 FROM public.library_publications WHERE org_code = %s AND source_item_id = %s AND class_code = %s "
                "AND subject_code = %s AND year_code = %s AND status = 'unpublished' LIMIT 1",
                (user.org_code, item_id, body.class_code, body.subject_code, target["year_code"])).fetchone()
            _event(conn, row["publication_id"], user.org_code, "republished" if again else "published", user,
                   {"class_code": body.class_code, "subject_code": body.subject_code, "year_code": target["year_code"],
                    "source": "diksha", "source_id": src_item["source_id"], "title": src_item["name"]})
            created.append(src_item["name"])
    return {"published": created, "already_published": existing, "class_code": body.class_code,
            "subject_code": body.subject_code, "year_code": target["year_code"], "student_count": target["student_count"]}


# ---------------------------------------------------------------- admin: metadata refresh
@router.post("/refresh")
def refresh(org_code: str | None = None, max_items: int = Query(default=50, ge=1, le=200), user: CurrentUser = Depends(admins)):
    """Re-read stored metadata of published DIKSHA items older than LIBRARY_METADATA_REFRESH_HOURS (throttled)."""
    org = org_scope(user, org_code)
    hours = get_settings().library_metadata_refresh_hours
    rows = db.fetch_all(
        "SELECT DISTINCT s.item_id, s.source_id, s.fetched_at FROM public.library_source_items s "
        "JOIN public.library_publications p ON p.source_item_id = s.item_id "
        "WHERE p.org_code = %s AND p.status = 'published' AND s.fetched_at < %s ORDER BY s.fetched_at LIMIT %s",
        (org, datetime.now(timezone.utc) - timedelta(hours=hours), max_items))
    updated, unavailable, failed = 0, 0, 0
    for r in rows:
        try:
            fresh = nz.normalize_item(_client().read(r["source_id"]))
        except DikshaError as e:
            if e.kind == "not_found":
                _mark_unavailable(r["source_id"]); unavailable += 1
            else:
                failed += 1
            continue
        with db.connection() as conn:
            prev = conn.execute("SELECT metadata FROM public.library_source_items WHERE item_id = %s", (r["item_id"],)).fetchone()
            keep = {k: v for k, v in (prev["metadata"] or {}).items() if k in ("boards", "classes", "subjects", "mediums") and v}
            merged = {**fresh, **{k: v for k, v in keep.items() if not fresh.get(k)}}
            _store(conn, merged)
        updated += 1
    return {"checked": len(rows), "updated": updated, "unavailable": unavailable, "failed": failed}
