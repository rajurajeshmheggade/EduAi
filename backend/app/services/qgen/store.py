"""Persistence for question papers, their items, versions, the question bank, media and settings.

Every paper statement is scoped by org_code + teacher_code from the bearer token: a teacher only reads or writes
their own papers, and somebody else's paper looks exactly like a missing one (None → 404). Bank rows are visible
to their owner, plus ORG-shared rows to every teacher of the same institution.
"""
from __future__ import annotations

import hashlib
import io
import uuid
from typing import Any

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from ... import db
from ...providers import get_embedder
from ..storage import build_key, get_storage
from .schema import AR_CODES_DEFAULT, AR_INSTRUCTION_DEFAULT, answer_plain, question_plain, stem_plain
from .text import text_hash

BANK_DUPLICATE_COSINE = 0.95
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_SIDE = 4000
_IMAGE_TYPES = {b"\x89PNG\r\n\x1a\n": ("image/png", ".png"), b"\xff\xd8\xff": ("image/jpeg", ".jpg")}


def _iso(v: Any) -> Any:
    return v.isoformat() if v is not None and hasattr(v, "isoformat") else v


def _uuid(v: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(v))
    except (TypeError, ValueError):
        return None


# ════════════════════════════════════════════════════════════ settings
def settings(org: str) -> dict:
    row = db.fetch_one("SELECT ar_instruction, ar_codes FROM public.qgen_settings WHERE org_code = %s", (org,))
    codes = (row or {}).get("ar_codes")
    ok = isinstance(codes, list) and len(codes) == 4 and all(isinstance(c, str) and c.strip() for c in codes)
    return {"ar_instruction": ((row or {}).get("ar_instruction") or "").strip() or AR_INSTRUCTION_DEFAULT,
            "ar_codes": codes if ok else AR_CODES_DEFAULT, "customised": bool(row)}


def save_settings(org: str, by: str, instruction: str, codes: list[str]) -> dict:
    db.execute("INSERT INTO public.qgen_settings(org_code, ar_instruction, ar_codes, updated_by) VALUES (%s,%s,%s,%s) "
               "ON CONFLICT (org_code) DO UPDATE SET ar_instruction = EXCLUDED.ar_instruction, ar_codes = EXCLUDED.ar_codes, "
               "updated_by = EXCLUDED.updated_by, updated_at = NOW()", (org, instruction, Jsonb(codes), by))
    return settings(org)


def reset_settings(org: str) -> dict:
    db.execute("DELETE FROM public.qgen_settings WHERE org_code = %s", (org,))
    return settings(org)


def org_name(org: str) -> str:
    row = db.fetch_one("SELECT org_name FROM public.organizations WHERE org_code = %s", (org,))
    return (row or {}).get("org_name") or ""


# ════════════════════════════════════════════════════════════ media
def sniff_image(data: bytes) -> tuple[str, str] | None:
    for magic, kind in _IMAGE_TYPES.items():
        if data.startswith(magic):
            return kind
    return None


def save_media(org: str, owner: str, customer: str, data: bytes, filename: str) -> dict:
    """Validate by magic bytes, decode with Pillow (rejects corrupt / decompression-bomb images), re-encode (drops
    EXIF and anything appended to the file) and store."""
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Images must be 2 MB or smaller")
    kind = sniff_image(data)
    if not kind:
        raise HTTPException(415, "Upload a PNG or JPEG image")
    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
            if w > MAX_IMAGE_SIDE or h > MAX_IMAGE_SIDE or w < 4 or h < 4:
                raise HTTPException(422, f"Images must be between 4 and {MAX_IMAGE_SIDE} pixels on each side")
            out = io.BytesIO()
            if kind[0] == "image/png":
                im.save(out, "PNG", optimize=True)
            else:
                im.convert("RGB").save(out, "JPEG", quality=88)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — Pillow raises many types for broken files
        raise HTTPException(415, "The image could not be read")
    clean = out.getvalue()
    media_id = uuid.uuid4()
    key = build_key(customer, org, None, None, "question-generator", "media", f"{media_id.hex}{kind[1]}")
    get_storage().put(key, clean, kind[0])
    db.execute("INSERT INTO public.qgen_media(media_id, org_code, owner_code, storage_key, content_type, byte_size, "
               "width, height, sha256, original_name) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
               (media_id, org, owner, key, kind[0], len(clean), w, h, hashlib.sha256(clean).hexdigest(),
                (filename or "")[:255]))
    return {"media_id": str(media_id), "url": get_storage().signed_url(key), "width": w, "height": h,
            "content_type": kind[0]}


def media_row(org: str, media_id: Any) -> dict | None:
    mid = _uuid(media_id)
    if not mid:
        return None
    return db.fetch_one("SELECT * FROM public.qgen_media WHERE media_id = %s AND org_code = %s", (mid, org))


def media_bytes(org: str, media_id: Any) -> tuple[bytes, dict] | None:
    row = media_row(org, media_id)
    if not row:
        return None
    try:
        return get_storage().get(row["storage_key"]), row
    except (OSError, ValueError):
        return None


def media_urls(org: str, ids: set[str]) -> dict[str, dict]:
    good = [u for u in (_uuid(i) for i in ids) if u]
    if not good:
        return {}
    rows = db.fetch_all("SELECT media_id, storage_key, width, height FROM public.qgen_media "
                        "WHERE org_code = %s AND media_id = ANY(%s)", (org, good))
    st = get_storage()
    return {str(r["media_id"]): {"url": st.signed_url(r["storage_key"]), "width": r["width"], "height": r["height"]}
            for r in rows}


def media_ids_of(questions: list[dict], header: dict | None = None) -> set[str]:
    ids: set[str] = set()
    if header and header.get("logo_media_id"):
        ids.add(str(header["logo_media_id"]))

    def walk(q: dict) -> None:
        for m in q.get("media") or []:
            ids.add(str(m.get("media_id")))
        for s in (q.get("data") or {}).get("sub_questions") or []:
            walk(s)

    for q in questions:
        walk(q)
    return ids


def check_media_owned(org: str, ids: set[str]) -> None:
    """Every media id a paper / question references must be an upload of the same institution."""
    if not ids:
        return
    good = [u for u in (_uuid(i) for i in ids) if u]
    found = {str(r["media_id"]) for r in db.fetch_all(
        "SELECT media_id FROM public.qgen_media WHERE org_code = %s AND media_id = ANY(%s)", (org, good))}
    missing = ids - found
    if missing:
        raise HTTPException(422, "An image on this paper was not found — upload it again")


# ════════════════════════════════════════════════════════════ papers
_PAPER_COLS = ("paper_id, family_id, version, parent_paper_id, org_code, teacher_code, class_code, subject_code, "
               "nlp_class, nlp_subject, chapter, title, language, header, sections, status, revision, total_marks, "
               "question_count, published_at, published_by, eval_test_id, created_at, updated_at")


def paper_row(org: str, teacher: str, paper_id: Any, *, lock_conn=None) -> dict | None:
    pid = _uuid(paper_id)
    if not pid:
        return None
    sql = f"SELECT {_PAPER_COLS}, published_snapshot FROM public.qgen_papers WHERE paper_id = %s AND org_code = %s AND teacher_code = %s"
    if lock_conn is not None:
        return lock_conn.execute(sql + " FOR UPDATE", (pid, org, teacher)).fetchone()
    return db.fetch_one(sql, (pid, org, teacher))


def items_of(paper_id: Any, conn=None) -> list[dict]:
    sql = ("SELECT item_id, position, section_id, origin, bank_id, question FROM public.qgen_paper_items "
           "WHERE paper_id = %s ORDER BY position")
    rows = conn.execute(sql, (paper_id,)).fetchall() if conn is not None else db.fetch_all(sql, (paper_id,))
    return [{"item_id": str(r["item_id"]), "section_id": r["section_id"], "question": r["question"]} for r in rows]


def _names(org: str, class_code: str, subject_code: str) -> tuple[str, str]:
    r = db.fetch_one("SELECT c.class_name, cs.subject_name FROM public.classes c LEFT JOIN public.class_subjects cs "
                     "ON cs.org_code = c.org_code AND cs.class_code = c.class_code AND cs.subject_code = %s "
                     "WHERE c.org_code = %s AND c.class_code = %s", (subject_code, org, class_code)) or {}
    return r.get("class_name") or class_code, r.get("subject_name") or subject_code


def shape_paper(row: dict, items: list[dict] | None = None, *, with_items: bool = True) -> dict:
    class_name, subject_name = _names(row["org_code"], row["class_code"], row["subject_code"])
    out = {
        "paper_id": str(row["paper_id"]), "family_id": str(row["family_id"]), "version": row["version"],
        "parent_paper_id": str(row["parent_paper_id"]) if row.get("parent_paper_id") else None,
        "status": row["status"], "revision": row["revision"], "title": row["title"], "language": row["language"],
        "class_code": row["class_code"], "class_name": class_name, "subject_code": row["subject_code"],
        "subject_name": subject_name, "nlp_class": row["nlp_class"], "nlp_subject": row["nlp_subject"],
        "chapter": row["chapter"], "header": row["header"] or {}, "sections": row["sections"] or [],
        "total_marks": float(row["total_marks"] or 0), "question_count": row["question_count"],
        "published_at": _iso(row.get("published_at")), "eval_test_id": str(row["eval_test_id"]) if row.get("eval_test_id") else None,
        "created_at": _iso(row["created_at"]), "updated_at": _iso(row["updated_at"]),
        "institution_name": org_name(row["org_code"]),
    }
    if with_items:
        its = items if items is not None else items_of(row["paper_id"])
        out["items"] = its
        out["media"] = media_urls(row["org_code"], media_ids_of([i["question"] for i in its], out["header"]))
    return out


def list_papers(org: str, teacher: str) -> list[dict]:
    rows = db.fetch_all(f"SELECT {_PAPER_COLS} FROM public.qgen_papers WHERE org_code = %s AND teacher_code = %s "
                        "ORDER BY updated_at DESC", (org, teacher))
    return [shape_paper(r, with_items=False) for r in rows]


def create_paper(org: str, teacher: str, *, class_code: str, subject_code: str, nlp_class: str | None,
                 nlp_subject: str | None, chapter: str | None, title: str, language: str, header: dict,
                 sections: list[dict]) -> dict:
    pid = uuid.uuid4()
    db.execute("INSERT INTO public.qgen_papers(paper_id, family_id, org_code, teacher_code, class_code, subject_code, "
               "nlp_class, nlp_subject, chapter, title, language, header, sections) "
               "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
               (pid, pid, org, teacher, class_code, subject_code, nlp_class, nlp_subject, chapter, title, language,
                Jsonb(header), Jsonb(sections)))
    return shape_paper(paper_row(org, teacher, pid))


def _write_items(conn, paper_id: Any, items: list[dict]) -> tuple[float, int]:
    conn.execute("DELETE FROM public.qgen_paper_items WHERE paper_id = %s", (paper_id,))
    total = 0.0
    for pos, it in enumerate(items, start=1):
        q = it["question"]
        iid = _uuid(it.get("item_id")) or uuid.uuid4()
        conn.execute("INSERT INTO public.qgen_paper_items(item_id, paper_id, position, section_id, qtype, marks, "
                     "difficulty, bloom, origin, bank_id, question) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                     (iid, paper_id, pos, it.get("section_id"), q["type"], q["marks"], q["difficulty"], q["bloom"],
                      q.get("origin") or "MANUAL", _uuid(q.get("bank_id")), Jsonb(q)))
        it["item_id"] = str(iid)
        total += float(q["marks"])
    return round(total, 2), len(items)


def replace_paper(org: str, teacher: str, paper_id: Any, *, revision: int | None, fields: dict,
                  items: list[dict] | None) -> dict:
    """Save fields and/or the full ordered item list in one transaction; 409 on a stale revision or a published paper."""
    with db.connection() as conn:
        row = paper_row(org, teacher, paper_id, lock_conn=conn)
        if not row:
            raise HTTPException(404, "Question paper not found")
        if row["status"] == "PUBLISHED":
            raise HTTPException(409, "This paper is published and can no longer be changed — create a new version to edit it")
        if revision is not None and revision != row["revision"]:
            raise HTTPException(409, "This paper was changed in another window. Reload it to get the latest version.")
        sets, args = [], []
        for k in ("title", "language", "chapter"):
            if k in fields:
                sets.append(f"{k} = %s")
                args.append(fields[k])
        for k in ("header", "sections"):
            if k in fields:
                sets.append(f"{k} = %s")
                args.append(Jsonb(fields[k]))
        if items is not None:
            total, count = _write_items(conn, row["paper_id"], items)
            sets += ["total_marks = %s", "question_count = %s"]
            args += [total, count]
        conn.execute(f"UPDATE public.qgen_papers SET {', '.join(sets + ['revision = revision + 1', 'updated_at = NOW()'])} "
                     "WHERE paper_id = %s", (*args, row["paper_id"]))
    return shape_paper(paper_row(org, teacher, paper_id))


def delete_paper(org: str, teacher: str, paper_id: Any) -> None:
    row = paper_row(org, teacher, paper_id)
    if not row:
        raise HTTPException(404, "Question paper not found")
    with db.connection() as conn:
        # items of a published paper are protected by a trigger; deleting the whole paper is allowed
        conn.execute("UPDATE public.qgen_papers SET status = 'DRAFT' WHERE paper_id = %s", (row["paper_id"],))
        conn.execute("DELETE FROM public.qgen_papers WHERE paper_id = %s", (row["paper_id"],))


def publish(org: str, teacher: str, paper_id: Any, snapshot_fn) -> dict:
    with db.connection() as conn:
        row = paper_row(org, teacher, paper_id, lock_conn=conn)
        if not row:
            raise HTTPException(404, "Question paper not found")
        if row["status"] == "PUBLISHED":
            raise HTTPException(409, "This paper is already published")
        items = items_of(row["paper_id"], conn)
        if not items:
            raise HTTPException(422, "Add at least one question before publishing")
        snap = snapshot_fn(row, items)
        conn.execute("UPDATE public.qgen_papers SET status = 'PUBLISHED', published_at = NOW(), published_by = %s, "
                     "published_snapshot = %s, revision = revision + 1, updated_at = NOW() WHERE paper_id = %s",
                     (teacher, Jsonb(snap), row["paper_id"]))
    return shape_paper(paper_row(org, teacher, paper_id))


def new_version(org: str, teacher: str, paper_id: Any) -> dict:
    row = paper_row(org, teacher, paper_id)
    if not row:
        raise HTTPException(404, "Question paper not found")
    if row["status"] != "PUBLISHED":
        raise HTTPException(409, "Only a published paper needs a new version — keep editing this draft")
    nxt = (db.fetch_one("SELECT MAX(version) AS v FROM public.qgen_papers WHERE family_id = %s", (row["family_id"],))["v"] or 1) + 1
    pid = uuid.uuid4()
    items = items_of(row["paper_id"])
    with db.connection() as conn:
        conn.execute("INSERT INTO public.qgen_papers(paper_id, family_id, version, parent_paper_id, org_code, teacher_code, "
                     "class_code, subject_code, nlp_class, nlp_subject, chapter, title, language, header, sections) "
                     "SELECT %s, family_id, %s, paper_id, org_code, teacher_code, class_code, subject_code, nlp_class, "
                     "nlp_subject, chapter, title, language, header, sections FROM public.qgen_papers WHERE paper_id = %s",
                     (pid, nxt, row["paper_id"]))
        fresh = [{"section_id": i["section_id"], "question": i["question"]} for i in items]
        total, count = _write_items(conn, pid, fresh)
        conn.execute("UPDATE public.qgen_papers SET total_marks = %s, question_count = %s WHERE paper_id = %s",
                     (total, count, pid))
    return shape_paper(paper_row(org, teacher, pid))


def link_eval_test(paper_id: Any, eval_test_id: Any) -> None:
    db.execute("UPDATE public.qgen_papers SET eval_test_id = %s WHERE paper_id = %s", (eval_test_id, paper_id))


# ════════════════════════════════════════════════════════════ question bank
def _bank_shape(r: dict, user_code: str) -> dict:
    return {"bank_id": str(r["bank_id"]), "owner_code": r["owner_code"], "mine": r["owner_code"] == user_code,
            "visibility": r["visibility"], "class_code": r["class_code"], "subject_code": r["subject_code"],
            "nlp_class": r["nlp_class"], "nlp_subject": r["nlp_subject"], "chapter": r["chapter"], "topic": r["topic"],
            "qtype": r["qtype"], "difficulty": r["difficulty"], "bloom": r["bloom"], "marks": float(r["marks"]),
            "language": r["language"], "question": r["question"], "usage_count": r["usage_count"],
            "created_at": _iso(r["created_at"]), "owner_name": r.get("owner_name")}


def bank_save(org: str, owner: str, entries: list[dict], *, visibility: str, scope: dict) -> dict:
    """Save questions to the bank. A question is skipped as a duplicate when its normalised text hash already exists
    for this teacher or among the bank rows they can see, or when its embedding is ≥ 0.95 cosine-similar to one
    of those in the same subject."""
    if not entries:
        return {"saved": [], "duplicates": []}
    texts = [stem_plain(e["question"]) or question_plain(e["question"]) for e in entries]
    vectors = get_embedder().embed([question_plain(e["question"])[:4000] for e in entries])
    saved, dups = [], []
    for i, (e, txt, vec) in enumerate(zip(entries, texts, vectors)):
        q = e["question"]
        h = text_hash(txt)
        hit = db.fetch_one("SELECT bank_id FROM public.qgen_bank WHERE org_code = %s AND text_hash = %s "
                           "AND (owner_code = %s OR visibility = 'ORG') LIMIT 1", (org, h, owner))
        sim = 1.0
        if not hit:
            hit = db.fetch_one(
                "SELECT bank_id, 1 - (embedding <=> %s::vector) AS sim FROM public.qgen_bank WHERE org_code = %s "
                "AND (owner_code = %s OR visibility = 'ORG') AND qtype = %s AND embedding IS NOT NULL "
                "AND COALESCE(nlp_subject, '') = COALESCE(%s, '') ORDER BY embedding <=> %s::vector LIMIT 1",
                (db.vec_literal(vec), org, owner, q["type"], scope.get("nlp_subject"), db.vec_literal(vec)))
            if hit and float(hit["sim"]) < BANK_DUPLICATE_COSINE:
                hit = None
            sim = float(hit["sim"]) if hit else 0
        if hit:
            dups.append({"index": i, "bank_id": str(hit["bank_id"]), "similarity": round(sim, 3)})
            continue
        bank_q = {**q, "origin": "BANK" if q.get("origin") == "BANK" else q.get("origin", "MANUAL")}
        row = db.fetch_one(
            "INSERT INTO public.qgen_bank(org_code, owner_code, visibility, class_code, subject_code, nlp_class, "
            "nlp_subject, chapter, topic, qtype, difficulty, bloom, marks, language, question, plain_text, text_hash, "
            "embedding, source_paper_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::vector,%s) "
            "ON CONFLICT (org_code, owner_code, text_hash) DO NOTHING RETURNING bank_id",
            (org, owner, visibility, scope.get("class_code"), scope.get("subject_code"), scope.get("nlp_class"),
             scope.get("nlp_subject"), scope.get("chapter"), (q.get("topic") or e.get("topic") or "")[:300] or None,
             q["type"], q["difficulty"], q["bloom"], q["marks"], scope.get("language") or "en", Jsonb(bank_q),
             (question_plain(q) + "\n" + answer_plain(q))[:20000], h, db.vec_literal(vec), _uuid(scope.get("paper_id"))))
        if row:
            saved.append(str(row["bank_id"]))
        else:
            dups.append({"index": i, "bank_id": None, "similarity": 1.0})
    return {"saved": saved, "duplicates": dups}


def bank_search(org: str, user: str, *, q: str | None, qtype: str | None, difficulty: str | None, bloom: str | None,
                nlp_class: str | None, nlp_subject: str | None, chapter: str | None, scope: str, limit: int,
                offset: int) -> dict:
    where = ["b.org_code = %s"]
    args: list[Any] = [org]
    if scope == "mine":
        where.append("b.owner_code = %s")
        args.append(user)
    else:
        where.append("(b.owner_code = %s OR b.visibility = 'ORG')")
        args.append(user)
    for col, val in (("qtype", qtype), ("difficulty", difficulty), ("bloom", bloom), ("nlp_class", nlp_class),
                     ("nlp_subject", nlp_subject), ("chapter", chapter)):
        if val:
            where.append(f"b.{col} = %s")
            args.append(val)
    order = "b.created_at DESC"
    if q and q.strip():
        where.append("b.plain_text ILIKE %s")
        args.append("%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    total = db.fetch_one(f"SELECT COUNT(*) AS n FROM public.qgen_bank b WHERE {' AND '.join(where)}", args)["n"]
    rows = db.fetch_all(
        f"SELECT b.*, u.full_name AS owner_name FROM public.qgen_bank b LEFT JOIN public.app_users u "
        f"ON u.org_code = b.org_code AND u.user_code = b.owner_code WHERE {' AND '.join(where)} "
        f"ORDER BY {order} LIMIT %s OFFSET %s", (*args, limit, offset))
    return {"total": total, "items": [_bank_shape(r, user) for r in rows]}


def bank_get_many(org: str, user: str, ids: list[str]) -> list[dict]:
    good = [u for u in (_uuid(i) for i in ids) if u]
    if not good:
        return []
    rows = db.fetch_all("SELECT * FROM public.qgen_bank WHERE org_code = %s AND bank_id = ANY(%s) "
                        "AND (owner_code = %s OR visibility = 'ORG')", (org, good, user))
    by_id = {str(r["bank_id"]): r for r in rows}
    return [by_id[str(i)] for i in good if str(i) in by_id]


def bank_used(ids: list[str]) -> None:
    good = [u for u in (_uuid(i) for i in ids) if u]
    if good:
        db.execute("UPDATE public.qgen_bank SET usage_count = usage_count + 1 WHERE bank_id = ANY(%s)", (good,))


def bank_delete(org: str, user: str, bank_id: Any) -> None:
    bid = _uuid(bank_id)
    row = db.fetch_one("SELECT owner_code, visibility FROM public.qgen_bank WHERE bank_id = %s AND org_code = %s", (bid, org)) if bid else None
    if not row or (row["owner_code"] != user and row["visibility"] != "ORG"):
        raise HTTPException(404, "Question not found in the bank")
    if row["owner_code"] != user:
        raise HTTPException(403, "Only the teacher who saved this question can delete it")
    db.execute("DELETE FROM public.qgen_bank WHERE bank_id = %s", (bid,))

