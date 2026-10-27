"""Digital Library: verified book catalog, teacher publishing to class/subject, Student Library and authorised access.

Catalog visibility: platform records (org_code NULL) + the caller's institution's own records. Teachers and students
only ever see records with verification_status = 'verified' and is_active. Access methods are decided server-side
(services.library.access_info) and a student may open a book only through an active publication for their class.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..security import ADMIN_ROLES, CurrentUser, require_role
from ..services import library as lib
from ..services.storage import get_storage
from .admin import org_scope

router = APIRouter(prefix="/ICMELive/api/v1/library", tags=["library"])
anyone = require_role("teacher", "student", "orgadmin", "superadmin")
teachers = require_role("teacher")
students = require_role("student")
admins = require_role("orgadmin", "superadmin")

MAX_PDF_MB = 60
Board = Literal["NCERT_CBSE", "KARNATAKA_STATE"]
Language = Literal["English", "Kannada", "Hindi"]


# ---------------------------------------------------------------- models
class Chapter(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    page: int | None = Field(default=None, ge=1, le=5000)


class BookIn(BaseModel):
    board: Board
    class_number: int = Field(ge=1, le=12)
    subject_name: str = Field(min_length=1, max_length=120)
    language: Language
    title: str = Field(min_length=1, max_length=300)
    academic_year: str | None = Field(default=None, max_length=32)
    publisher: str | None = Field(default=None, max_length=200)
    source_name: str = Field(min_length=1, max_length=200)
    source_url: str = Field(min_length=8, max_length=2000)
    access_mode: Literal["official_link", "in_app_reader"] = "official_link"
    license_status: Literal["verified", "permission_required", "unknown"] = "unknown"
    license_notice: str | None = Field(default=None, max_length=2000)
    in_app_reader_allowed: bool = False
    download_allowed: bool = False
    verification_status: Literal["verified", "pending", "rejected"] = "pending"
    chapters: list[Chapter] = Field(default_factory=list, max_length=200)
    is_active: bool = True
    scope: Literal["institution", "platform"] = "institution"

    @field_validator("source_url")
    @classmethod
    def _url(cls, v: str) -> str:
        return lib.validate_source_url(v)


class BookPatch(BaseModel):
    board: Board | None = None
    class_number: int | None = Field(default=None, ge=1, le=12)
    subject_name: str | None = Field(default=None, min_length=1, max_length=120)
    language: Language | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)
    academic_year: str | None = Field(default=None, max_length=32)
    publisher: str | None = Field(default=None, max_length=200)
    source_name: str | None = Field(default=None, min_length=1, max_length=200)
    source_url: str | None = Field(default=None, min_length=8, max_length=2000)
    access_mode: Literal["official_link", "in_app_reader"] | None = None
    license_status: Literal["verified", "permission_required", "unknown"] | None = None
    license_notice: str | None = Field(default=None, max_length=2000)
    in_app_reader_allowed: bool | None = None
    download_allowed: bool | None = None
    verification_status: Literal["verified", "pending", "rejected"] | None = None
    chapters: list[Chapter] | None = Field(default=None, max_length=200)
    is_active: bool | None = None

    @field_validator("source_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return lib.validate_source_url(v) if v is not None else v


class ImportIn(BaseModel):
    csv_text: str = Field(min_length=1, max_length=2_000_000)
    scope: Literal["institution", "platform"] = "institution"


class PublishIn(BaseModel):
    book_ids: list[UUID] = Field(min_length=1, max_length=50)
    class_code: str = Field(min_length=1, max_length=64)
    subject_code: str = Field(min_length=1, max_length=64)


# ---------------------------------------------------------------- helpers
BOOK_COLS = ("b.book_id, b.org_code, b.board, b.class_number, b.subject_name, b.language, b.title, b.academic_year, "
             "b.publisher, b.source_name, b.source_url, b.access_mode, b.license_status, b.license_notice, "
             "b.in_app_reader_allowed, b.download_allowed, b.verification_status, b.link_status, b.last_verified_at, "
             "b.file_key, b.file_bytes, b.chapters, b.is_active, b.created_at, b.updated_at")


def _public(b: dict, admin: bool = False) -> dict:
    out = {k: v for k, v in b.items() if k not in ("file_key",)}
    out["board_label"] = lib.BOARDS[b["board"]]
    out["scope"] = "platform" if b["org_code"] is None else "institution"
    out["has_file"] = bool(b.get("file_key"))
    out["access"] = lib.access_info(b)["mode"]
    if not admin:
        for k in ("file_bytes", "org_code"):
            out.pop(k, None)
    return out


def _book(book_id: UUID, org: str) -> dict:
    b = db.fetch_one(f"SELECT {BOOK_COLS} FROM public.library_books b WHERE b.book_id = %s AND (b.org_code IS NULL OR b.org_code = %s)",
                     (book_id, org))
    if not b:
        raise HTTPException(404, "Book not found")
    return b


def _editable(user: CurrentUser, b: dict) -> None:
    if b["org_code"] is None and user.role != "superadmin":
        raise HTTPException(403, "Platform catalog records can only be changed by the platform administrator")


def _target_scope(user: CurrentUser, org: str, scope: str) -> str | None:
    if scope == "platform":
        if user.role != "superadmin":
            raise HTTPException(403, "Only the platform administrator can add platform-wide catalog records")
        return None
    return org


def _filters(board: str | None, class_number: int | None, subject: str | None, language: str | None, q: str | None) -> tuple[str, list]:
    where, args = [], []
    if board:
        where.append("b.board = %s"); args.append(board)
    if class_number:
        where.append("b.class_number = %s"); args.append(class_number)
    if subject and subject.lower() != "all":
        where.append("LOWER(b.subject_name) = LOWER(%s)"); args.append(subject)
    if language:
        where.append("b.language = %s"); args.append(language)
    if q:
        where.append("(b.title ILIKE %s OR b.subject_name ILIKE %s OR b.publisher ILIKE %s)"); args += [f"%{q}%"] * 3
    return (" AND " + " AND ".join(where)) if where else "", args


def _teacher_targets(user: CurrentUser) -> list[dict]:
    """Class subjects this teacher may publish to: subjects they teach + every subject of their own class."""
    return db.fetch_all(
        "SELECT c.class_code, c.class_name, c.grade_number, c.year_code, cs.subject_code, cs.subject_name, "
        "  (c.class_teacher_code = %s) AS is_class_teacher, "
        "  (SELECT COUNT(*) FROM public.app_users s WHERE s.org_code = c.org_code AND s.class_code = c.class_code "
        "     AND s.user_role = 'student' AND s.is_active) AS student_count "
        "FROM public.class_subjects cs JOIN public.classes c ON c.org_code = cs.org_code AND c.class_code = cs.class_code "
        "WHERE c.org_code = %s AND c.is_active AND (cs.teacher_code = %s OR c.class_teacher_code = %s) "
        "ORDER BY c.class_code, cs.subject_code",
        (user.user_code, user.org_code, user.user_code, user.user_code))


def _event(conn, pub_id, org: str, action: str, user: CurrentUser, details: dict) -> None:
    conn.execute("INSERT INTO public.library_publication_events (publication_id, org_code, action, actor_code, actor_role, details) "
                 "VALUES (%s,%s,%s,%s,%s,%s)", (pub_id, org, action, user.user_code, user.role, Jsonb(details)))


# Publications target a school catalog book or a DIKSHA source item (metadata reference); both list the same way.
PUB_SELECT = (
    "SELECT p.publication_id, p.book_id, p.class_code, c.class_name, p.subject_code, cs.subject_name AS class_subject_name, "
    "  p.year_code, p.status, p.published_at, p.unpublished_at, p.teacher_code, t.full_name AS teacher_name, "
    "  p.unpublished_by, COALESCE(b.title, s.name) AS title, COALESCE(b.board, s.metadata->'boards'->>0) AS board, "
    "  COALESCE(b.class_number, (s.metadata->'classes'->>0)::int) AS class_number, "
    "  COALESCE(b.language, s.metadata->'mediums'->>0) AS language, COALESCE(b.subject_name, s.metadata->'subjects'->>0) AS subject_name, "
    "  COALESCE(b.source_name, 'DIKSHA') AS source_name, CASE WHEN p.source_item_id IS NULL THEN 'school' ELSE s.source END AS source, "
    "  s.source_id, s.kind AS source_kind, s.source_status, p.source_context "
    "FROM public.library_publications p "
    "LEFT JOIN public.library_books b ON b.book_id = p.book_id "
    "LEFT JOIN public.library_source_items s ON s.item_id = p.source_item_id "
    "JOIN public.classes c ON c.org_code = p.org_code AND c.class_code = p.class_code "
    "LEFT JOIN public.class_subjects cs ON cs.org_code = p.org_code AND cs.class_code = p.class_code AND cs.subject_code = p.subject_code "
    "LEFT JOIN public.app_users t ON t.org_code = p.org_code AND t.user_code = p.teacher_code ")


# ---------------------------------------------------------------- shared
@router.get("/meta")
def meta(user: CurrentUser = Depends(anyone)):
    """Supported boards, classes, languages and permission vocabularies (FR-002..004)."""
    return {
        "boards": [{"code": k, "label": v} for k, v in lib.BOARDS.items()],
        "classes": lib.CLASSES,
        "languages": lib.LANGUAGES,
        "access_modes": lib.ACCESS_MODES,
        "license_statuses": lib.LICENSE_STATUSES,
        "verification_statuses": lib.VERIFICATION_STATUSES,
    }


@router.get("/subjects")
def subjects(board: str | None = None, class_number: int | None = Query(default=None, ge=1, le=12),
             org_code: str | None = None, user: CurrentUser = Depends(anyone)):
    """Subject filter options: subjects in the visible catalog + the institution's own class subjects.

    Teachers get the subjects they teach; admins every class subject. With a class number, class subjects are limited
    to classes set to that grade (all classes when none has a grade yet).
    """
    is_admin = user.role in ADMIN_ROLES
    org = org_scope(user, org_code) if is_admin else user.org_code
    where, args = _filters(board, class_number, None, None, None)
    status = "" if is_admin else " AND b.is_active AND b.verification_status = 'verified'"
    names = [r["subject_name"] for r in db.fetch_all(
        f"SELECT DISTINCT b.subject_name FROM public.library_books b WHERE (b.org_code IS NULL OR b.org_code = %s){status}{where}",
        (org, *args))]

    if user.role == "teacher":
        own = _teacher_targets(user)
        rows = [t for t in own if t["grade_number"] == class_number] if class_number else own
        if class_number and not rows:
            rows = [t for t in own if t["grade_number"] is None]
    else:
        rows = db.fetch_all(
            "SELECT cs.subject_name, c.grade_number FROM public.class_subjects cs JOIN public.classes c "
            "ON c.org_code = cs.org_code AND c.class_code = cs.class_code WHERE cs.org_code = %s AND c.is_active", (org,))
        if class_number:
            graded = [r for r in rows if r["grade_number"] == class_number]
            rows = graded or [r for r in rows if r["grade_number"] is None]
    names += [r["subject_name"] for r in rows]

    seen: dict[str, str] = {}
    for n in names:  # de-duplicate case-insensitively, keep the first spelling
        seen.setdefault(n.strip().lower(), n.strip())
    return {"subjects": sorted(seen.values(), key=str.lower)}


@router.get("/books")
def list_books(
    board: str | None = None, class_number: int | None = Query(default=None, ge=1, le=12),
    subject: str | None = Query(default=None, max_length=120), language: str | None = None,
    q: str | None = Query(default=None, max_length=100),
    verification_status: str | None = None, scope: Literal["all", "platform", "institution"] = "all",
    page: int = Query(default=1, ge=1), page_size: int = Query(default=24, ge=1, le=100),
    org_code: str | None = None, user: CurrentUser = Depends(require_role("teacher", "orgadmin", "superadmin")),
):
    """Catalog search (FR-005/006). Teachers get verified, active records only, with their publication status."""
    is_admin = user.role in ADMIN_ROLES
    org = org_scope(user, org_code) if is_admin else user.org_code
    where, args = _filters(board, class_number, subject, language, q)
    if is_admin:
        if verification_status:
            where += " AND b.verification_status = %s"; args.append(verification_status)
        if scope == "platform":
            where += " AND b.org_code IS NULL"
        elif scope == "institution":
            where += " AND b.org_code IS NOT NULL"
    else:
        where += " AND b.is_active AND b.verification_status = 'verified'"
    base = f"FROM public.library_books b WHERE (b.org_code IS NULL OR b.org_code = %s){where}"
    total = db.fetch_one(f"SELECT COUNT(*) AS n {base}", (org, *args))["n"]
    rows = db.fetch_all(f"SELECT {BOOK_COLS} {base} ORDER BY b.class_number, b.subject_name, b.title LIMIT %s OFFSET %s",
                        (org, *args, page_size, (page - 1) * page_size))
    books = [_public(b, admin=is_admin) for b in rows]
    if not is_admin and books:
        targets = {(t["class_code"], t["subject_code"]) for t in _teacher_targets(user)}
        pubs = db.fetch_all(
            "SELECT p.publication_id, p.book_id, p.class_code, p.subject_code, c.class_name FROM public.library_publications p "
            "JOIN public.classes c ON c.org_code = p.org_code AND c.class_code = p.class_code "
            "WHERE p.org_code = %s AND p.status = 'published' AND p.year_code = c.year_code AND p.book_id = ANY(%s)",
            (org, [b["book_id"] for b in books]))
        by_book: dict = {}
        for p in pubs:
            if (p["class_code"], p["subject_code"]) in targets:
                by_book.setdefault(p["book_id"], []).append({k: p[k] for k in ("publication_id", "class_code", "class_name", "subject_code")})
        for b in books:
            b["published_to"] = by_book.get(b["book_id"], [])
    if is_admin and books:
        counts = {r["book_id"]: r["n"] for r in db.fetch_all(
            "SELECT book_id, COUNT(*) AS n FROM public.library_publications WHERE org_code = %s AND status = 'published' "
            "AND book_id = ANY(%s) GROUP BY book_id", (org, [b["book_id"] for b in books]))}
        for b in books:
            b["active_publications"] = counts.get(b["book_id"], 0)
    return {"books": books, "total": total, "page": page, "page_size": page_size}


@router.get("/books/{book_id}")
def get_book(book_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(anyone)):
    org = org_scope(user, org_code) if user.role in ADMIN_ROLES else user.org_code
    b = _book(book_id, org)
    _ensure_can_open(user, b, org)
    return _public(b, admin=user.role in ADMIN_ROLES)


def _ensure_can_open(user: CurrentUser, b: dict, org: str) -> None:
    if user.role in ADMIN_ROLES:
        return
    if not b["is_active"] or b["verification_status"] != "verified":
        raise HTTPException(404, "Book not found")
    if user.role == "student":
        me = db.call_row("usp_get_member", user.org_code, user.user_code)
        ok = me and me.get("class_code") and db.fetch_one(
            "SELECT 1 FROM public.library_publications p JOIN public.classes c ON c.org_code = p.org_code AND c.class_code = p.class_code "
            "WHERE p.org_code = %s AND p.book_id = %s AND p.class_code = %s AND p.status = 'published' AND p.year_code = c.year_code",
            (org, b["book_id"], me["class_code"]))
        if not ok:  # FR-011: only books published to the student's own class and year
            raise HTTPException(404, "Book not found")


@router.get("/books/{book_id}/access")
def book_access(book_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(anyone)):
    """FR-012/013/018: the permitted access method. A signed, short-lived file URL only when hosting is licensed."""
    org = org_scope(user, org_code) if user.role in ADMIN_ROLES else user.org_code
    b = _book(book_id, org)
    _ensure_can_open(user, b, org)
    info = lib.access_info(b)
    if user.role in ADMIN_ROLES and info["mode"] == "unavailable" and b.get("file_key"):
        info["mode"] = "in_app_file"  # admins may preview an uploaded copy while reviewing
    if info["mode"] == "in_app_file":
        info["file_url"] = get_storage().signed_url(b["file_key"])
    return {"book_id": b["book_id"], "title": b["title"], "subject_name": b["subject_name"], "class_number": b["class_number"],
            "board_label": lib.BOARDS[b["board"]], "language": b["language"], "publisher": b["publisher"],
            "academic_year": b["academic_year"], **info}


# ---------------------------------------------------------------- admin: catalog management
@router.post("/books", status_code=201)
def create_book(body: BookIn, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    target = _target_scope(user, org, body.scope)
    data = body.model_dump(exclude={"scope", "chapters"})
    try:
        row = db.fetch_one(
            "INSERT INTO public.library_books (org_code, board, class_number, subject_name, language, title, academic_year, publisher, "
            "source_name, source_url, access_mode, license_status, license_notice, in_app_reader_allowed, download_allowed, "
            "verification_status, is_active, chapters, created_by, last_verified_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING book_id",
            (target, data["board"], data["class_number"], data["subject_name"].strip(), data["language"], data["title"].strip(),
             data["academic_year"], data["publisher"], data["source_name"].strip(), data["source_url"], data["access_mode"],
             data["license_status"], data["license_notice"], data["in_app_reader_allowed"], data["download_allowed"],
             data["verification_status"], data["is_active"], Jsonb([c.model_dump() for c in body.chapters]), user.user_code,
             datetime.now(timezone.utc) if data["verification_status"] == "verified" else None))
    except Exception as e:  # unique (org, board, class, language, title)
        if "library_books_unique" in str(e):
            raise HTTPException(409, "This book is already in the catalog for that board, class and language")
        raise
    return _public(_book(row["book_id"], org), admin=True)


@router.patch("/books/{book_id}")
def update_book(book_id: UUID, body: BookPatch, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    b = _book(book_id, org)
    _editable(user, b)
    fields = body.model_dump(exclude_unset=True)
    if "chapters" in fields:
        fields["chapters"] = Jsonb(fields["chapters"] or [])
    if fields.get("verification_status") == "verified" and b["verification_status"] != "verified":
        fields["last_verified_at"] = datetime.now(timezone.utc)
    if fields:
        sets = ", ".join(f"{k} = %s" for k in fields)
        try:
            db.execute(f"UPDATE public.library_books SET {sets}, updated_at = NOW() WHERE book_id = %s", (*fields.values(), book_id))
        except Exception as e:
            if "library_books_unique" in str(e):
                raise HTTPException(409, "Another catalog record already has that board, class, language and title")
            raise
    return _public(_book(book_id, org), admin=True)


@router.delete("/books/{book_id}")
def delete_book(book_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Remove a mistaken record. Books that were ever published are kept for the audit trail — deactivate those instead."""
    org = org_scope(user, org_code)
    _editable(user, _book(book_id, org))
    if db.fetch_one("SELECT 1 FROM public.library_publications WHERE book_id = %s LIMIT 1", (book_id,)):
        raise HTTPException(409, "This book has publishing history, so it cannot be deleted. Mark it inactive instead.")
    db.execute("DELETE FROM public.library_books WHERE book_id = %s", (book_id,))
    return {"deleted": True}


@router.post("/books/import")
def import_books(body: ImportIn, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Bulk add verified metadata from CSV. Existing records (same board/class/language/title) are skipped."""
    org = org_scope(user, org_code)
    target = _target_scope(user, org, body.scope)
    rows, errors = lib.parse_csv(body.csv_text)
    created = skipped = 0
    with db.connection() as conn:
        for r in rows:
            cur = conn.execute(
                "INSERT INTO public.library_books (org_code, board, class_number, subject_name, language, title, academic_year, publisher, "
                "source_name, source_url, access_mode, license_status, license_notice, in_app_reader_allowed, download_allowed, "
                "verification_status, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT ON CONSTRAINT library_books_unique DO NOTHING",
                (target, r["board"], r["class_number"], r["subject_name"], r["language"], r["title"], r["academic_year"], r["publisher"],
                 r["source_name"], r["source_url"], r["access_mode"], r["license_status"], r["license_notice"],
                 r["in_app_reader_allowed"], r["download_allowed"], r["verification_status"], user.user_code))
            if cur.rowcount:
                created += 1
            else:
                skipped += 1
    return {"created": created, "skipped_existing": skipped, "errors": errors}


@router.post("/books/{book_id}/file")
async def upload_book_file(book_id: UUID, file: UploadFile = File(...), org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Host an authorised PDF copy. Only allowed when the licence is verified and in-app reading is permitted (§10)."""
    org = org_scope(user, org_code)
    b = _book(book_id, org)
    _editable(user, b)
    if b["license_status"] != "verified" or not b["in_app_reader_allowed"]:
        raise HTTPException(422, "Hosting a copy needs a verified licence with in-app reading allowed. Otherwise use the official link.")
    data = await file.read(MAX_PDF_MB * 1024 * 1024 + 1)
    if len(data) > MAX_PDF_MB * 1024 * 1024:
        raise HTTPException(413, f"PDF is larger than {MAX_PDF_MB} MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "Only PDF files can be uploaded")
    key = f"library/{b['org_code'] or 'platform'}/{book_id}/{uuid4().hex}.pdf"
    get_storage().put(key, data, "application/pdf")
    db.execute("UPDATE public.library_books SET file_key = %s, file_bytes = %s, updated_at = NOW() WHERE book_id = %s",
               (key, len(data), book_id))
    return _public(_book(book_id, org), admin=True)


@router.delete("/books/{book_id}/file")
def remove_book_file(book_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    org = org_scope(user, org_code)
    _editable(user, _book(book_id, org))
    db.execute("UPDATE public.library_books SET file_key = NULL, file_bytes = NULL, updated_at = NOW() WHERE book_id = %s", (book_id,))
    return _public(_book(book_id, org), admin=True)


@router.post("/books/{book_id}/check-link")
def check_book_link(book_id: UUID, org_code: str | None = None, user: CurrentUser = Depends(admins)):
    """Re-validate that the official source is reachable (§10.10)."""
    org = org_scope(user, org_code)
    b = _book(book_id, org)
    _editable(user, b)
    status = lib.check_link(b["source_url"])
    db.execute("UPDATE public.library_books SET link_status = %s, last_verified_at = NOW() WHERE book_id = %s", (status, book_id))
    return _public(_book(book_id, org), admin=True)


@router.get("/publications")
def all_publications(org_code: str | None = None, status: str | None = None, user: CurrentUser = Depends(admins)):
    """Admin view of publishing records with their audit trail (FR-017)."""
    org = org_scope(user, org_code)
    rows = db.fetch_all(PUB_SELECT + "WHERE p.org_code = %s AND (%s::text IS NULL OR p.status = %s::text) "
                        "ORDER BY p.updated_at DESC LIMIT 500", (org, status, status))
    events = db.fetch_all(
        "SELECT e.publication_id, e.action, e.actor_code, e.actor_role, e.created_at, u.full_name AS actor_name "
        "FROM public.library_publication_events e LEFT JOIN public.app_users u ON u.org_code = e.org_code AND u.user_code = e.actor_code "
        "WHERE e.org_code = %s ORDER BY e.created_at", (org,))
    by_pub: dict = {}
    for e in events:
        by_pub.setdefault(e["publication_id"], []).append(e)
    return {"publications": [{**r, "events": by_pub.get(r["publication_id"], [])} for r in rows]}


# ---------------------------------------------------------------- teacher: publishing
@router.get("/targets")
def publish_targets(user: CurrentUser = Depends(teachers)):
    """Classes and subjects this teacher may publish to (with grade, academic year and student count)."""
    return {"targets": _teacher_targets(user)}


@router.post("/publications")
def publish(body: PublishIn, user: CurrentUser = Depends(teachers)):
    """FR-008/015: publish books to a class subject for its current academic year. Idempotent per target group."""
    target = next((t for t in _teacher_targets(user) if t["class_code"] == body.class_code and t["subject_code"] == body.subject_code), None)
    if not target:
        raise HTTPException(403, "You can publish only to subjects you teach or to your own class")
    books = []
    for bid in dict.fromkeys(body.book_ids):
        b = _book(bid, user.org_code)
        if not b["is_active"] or b["verification_status"] != "verified":
            raise HTTPException(422, f"“{b['title']}” is not a verified, active catalog record")
        if target["grade_number"] and b["class_number"] != target["grade_number"]:
            raise HTTPException(422, f"“{b['title']}” is for Class {b['class_number']}, but {target['class_name']} is Class {target['grade_number']}")
        books.append(b)
    created, existing = [], []
    with db.connection() as conn:
        for b in books:
            row = conn.execute(
                "INSERT INTO public.library_publications (org_code, book_id, teacher_code, class_code, subject_code, year_code) "
                "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (org_code, book_id, class_code, subject_code, year_code) "
                "WHERE status = 'published' DO NOTHING RETURNING publication_id",
                (user.org_code, b["book_id"], user.user_code, body.class_code, body.subject_code, target["year_code"])).fetchone()
            if not row:
                existing.append(b["title"])
                continue
            again = conn.execute(
                "SELECT 1 FROM public.library_publications WHERE org_code = %s AND book_id = %s AND class_code = %s AND subject_code = %s "
                "AND year_code = %s AND status = 'unpublished' LIMIT 1",
                (user.org_code, b["book_id"], body.class_code, body.subject_code, target["year_code"])).fetchone()
            _event(conn, row["publication_id"], user.org_code, "republished" if again else "published", user,
                   {"class_code": body.class_code, "subject_code": body.subject_code, "year_code": target["year_code"], "title": b["title"]})
            created.append(b["title"])
    return {"published": created, "already_published": existing, "class_code": body.class_code, "subject_code": body.subject_code,
            "year_code": target["year_code"], "student_count": target["student_count"]}


@router.get("/publications/mine")
def my_publications(status: str | None = None, user: CurrentUser = Depends(teachers)):
    """Publications by this teacher plus any active ones in the class subjects they teach."""
    targets = [f"{t['class_code']}|{t['subject_code']}" for t in _teacher_targets(user)]
    rows = db.fetch_all(
        PUB_SELECT + "WHERE p.org_code = %s AND (p.teacher_code = %s OR (p.class_code || '|' || p.subject_code) = ANY(%s)) "
        "AND (%s::text IS NULL OR p.status = %s::text) ORDER BY p.status, p.published_at DESC LIMIT 500",
        (user.org_code, user.user_code, targets, status, status))
    tset = set(targets)
    return {"publications": [{**r, "can_unpublish": r["status"] == "published" and f"{r['class_code']}|{r['subject_code']}" in tset}
                             for r in rows]}


@router.post("/publications/{publication_id}/unpublish")
def unpublish(publication_id: UUID, user: CurrentUser = Depends(teachers)):
    """Removes the book from the Student Library; the catalog record is untouched (FR-014)."""
    p = db.fetch_one("SELECT * FROM public.library_publications WHERE publication_id = %s AND org_code = %s", (publication_id, user.org_code))
    if not p:
        raise HTTPException(404, "Publication not found")
    if not any(t["class_code"] == p["class_code"] and t["subject_code"] == p["subject_code"] for t in _teacher_targets(user)):
        raise HTTPException(403, "You can unpublish only books in subjects you teach or in your own class")
    if p["status"] == "unpublished":
        return {"status": "unpublished", "publication_id": publication_id}
    with db.connection() as conn:
        conn.execute("UPDATE public.library_publications SET status = 'unpublished', unpublished_at = NOW(), unpublished_by = %s, "
                     "updated_at = NOW() WHERE publication_id = %s", (user.user_code, publication_id))
        _event(conn, publication_id, user.org_code, "unpublished", user,
               {"class_code": p["class_code"], "subject_code": p["subject_code"], "year_code": p["year_code"]})
    return {"status": "unpublished", "publication_id": publication_id}


# ---------------------------------------------------------------- student: My Library
@router.get("/student/books")
def student_books(subject: str | None = Query(default=None, max_length=64), language: str | None = None,
                  q: str | None = Query(default=None, max_length=100), user: CurrentUser = Depends(students)):
    """FR-010/011: books published to the logged-in student's class for its current academic year (server-derived)."""
    me = db.call_row("usp_get_member", user.org_code, user.user_code)
    if not me or not me.get("class_code"):
        return {"class_code": None, "class_name": None, "year_code": None, "books": [], "external": [], "subjects": [], "languages": []}
    cls = db.fetch_one("SELECT class_code, class_name, year_code, grade_number FROM public.classes WHERE org_code = %s AND class_code = %s",
                       (user.org_code, me["class_code"]))
    rows = db.fetch_all(
        f"SELECT {BOOK_COLS}, p.subject_code, cs.subject_name AS class_subject_name, p.published_at, t.full_name AS teacher_name "
        "FROM public.library_publications p JOIN public.library_books b ON b.book_id = p.book_id "
        "LEFT JOIN public.class_subjects cs ON cs.org_code = p.org_code AND cs.class_code = p.class_code AND cs.subject_code = p.subject_code "
        "LEFT JOIN public.app_users t ON t.org_code = p.org_code AND t.user_code = p.teacher_code "
        "WHERE p.org_code = %s AND p.class_code = %s AND p.year_code = %s AND p.status = 'published' "
        "AND b.is_active AND b.verification_status = 'verified' ORDER BY cs.subject_name, b.title",
        (user.org_code, cls["class_code"], cls["year_code"]))
    books: dict = {}
    for r in rows:
        bk = books.get(r["book_id"])
        if not bk:
            bk = books[r["book_id"]] = {**_public({k: r[k] for k in r if k not in ("subject_code", "class_subject_name", "published_at", "teacher_name")}),
                                        "subjects": [], "published_at": r["published_at"]}
        bk["subjects"].append({"subject_code": r["subject_code"], "subject_name": r["class_subject_name"] or r["subject_code"], "teacher_name": r["teacher_name"]})
        bk["published_at"] = max(bk["published_at"], r["published_at"])
    all_books = list(books.values())
    subjects = sorted({(s["subject_code"], s["subject_name"]) for b in all_books for s in b["subjects"]}, key=lambda x: x[1])
    out = [b for b in all_books
           if (not subject or any(s["subject_code"] == subject for s in b["subjects"]))
           and (not language or b["language"] == language)
           and (not q or q.lower() in f"{b['title']} {b['subject_name']} {b.get('publisher') or ''}".lower())]
    external = _student_source_items(user.org_code, cls)
    subjects = sorted({(sc, sn) for sc, sn in subjects} | {(x["subject_code"], x["subject_name"]) for e in external for x in e["subjects"]},
                      key=lambda x: x[1])
    ext_out = [e for e in external
               if (not subject or any(x["subject_code"] == subject for x in e["subjects"]))
               and (not language or language in e["metadata"].get("mediums", []))
               and (not q or q.lower() in f"{e['name']} {' '.join(e['metadata'].get('subjects', []))}".lower())]
    languages = {b["language"] for b in all_books} | {m for e in external for m in e["metadata"].get("mediums", [])}
    return {"class_code": cls["class_code"], "class_name": cls["class_name"], "year_code": cls["year_code"],
            "books": out, "external": ext_out, "subjects": [{"subject_code": c, "subject_name": n} for c, n in subjects],
            "languages": sorted(languages)}


def _student_source_items(org: str, cls: dict) -> list[dict]:
    """DIKSHA items (metadata references) published to the student's class for its current academic year."""
    rows = db.fetch_all(
        "SELECT s.source, s.source_id, s.kind, s.name, s.metadata, s.source_status, p.subject_code, "
        "  cs.subject_name AS class_subject_name, p.published_at, t.full_name AS teacher_name, p.source_context "
        "FROM public.library_publications p JOIN public.library_source_items s ON s.item_id = p.source_item_id "
        "LEFT JOIN public.class_subjects cs ON cs.org_code = p.org_code AND cs.class_code = p.class_code AND cs.subject_code = p.subject_code "
        "LEFT JOIN public.app_users t ON t.org_code = p.org_code AND t.user_code = p.teacher_code "
        "WHERE p.org_code = %s AND p.class_code = %s AND p.year_code = %s AND p.status = 'published' "
        "ORDER BY cs.subject_name, s.name", (org, cls["class_code"], cls["year_code"]))
    items: dict = {}
    for r in rows:
        it = items.get(r["source_id"])
        if not it:
            meta = {k: v for k, v in (r["metadata"] or {}).items() if k not in ("artifact_url", "preview_url", "streaming_url")}
            it = items[r["source_id"]] = {"source": r["source"], "source_id": r["source_id"], "kind": r["kind"], "name": r["name"],
                                          "metadata": meta, "source_status": r["source_status"], "subjects": [],
                                          "published_at": r["published_at"], "context": r["source_context"]}
        it["subjects"].append({"subject_code": r["subject_code"], "subject_name": r["class_subject_name"] or r["subject_code"],
                               "teacher_name": r["teacher_name"]})
        it["published_at"] = max(it["published_at"], r["published_at"])
    return list(items.values())
