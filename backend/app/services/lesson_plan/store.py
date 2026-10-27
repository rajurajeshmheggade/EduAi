"""Persistence for lesson plans and session plans (port of Rapid's LessonPlanStore / SessionPlanStore).

Every statement is scoped by org_code + teacher_code taken from the bearer token, so a teacher only ever reads
or writes their own plans and sessions. A missing row and somebody else's row look identical (None / 404).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb

from ... import db
from ..storage import get_storage


def _uuid(v: Any) -> UUID | None:
    try:
        return UUID(str(v))
    except (TypeError, ValueError):
        return None


def _iso(v: Any) -> str | None:
    return v.isoformat() if v is not None and hasattr(v, "isoformat") else v


# ════════════════════════════════════════════════════════════ teacher scope (classes / subjects / chapters)
def teacher_scope(org: str, teacher: str) -> list[dict]:
    """Classes this teacher works with and the subjects they teach in each (class teacher → every subject)."""
    out = []
    for c in db.call_rows("usp_teacher_classes", org, teacher):
        subjects = [{"subject_code": s["subject_code"], "subject_name": s["subject_name"]}
                    for s in (c["subjects"] or []) if c["is_class_teacher"] or s.get("is_mine")]
        if subjects:
            out.append({"class_code": c["class_code"], "class_name": c["class_name"], "subjects": subjects})
    return out


def in_scope(org: str, teacher: str, class_code: str | None, subject_code: str | None) -> bool:
    for c in teacher_scope(org, teacher):
        if class_code and c["class_code"] != class_code:
            continue
        if not subject_code or any(s["subject_code"] == subject_code for s in c["subjects"]):
            return True
    return False


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())).strip()


def resolve_names(org: str, teacher: str, grade: str, subject: str) -> tuple[str | None, str | None]:
    """Map the wizard's class / subject NAMES back onto codes the teacher is assigned to (None when not)."""
    g, s = _norm(grade), _norm(subject)
    for c in teacher_scope(org, teacher):
        if g and g not in (_norm(c["class_name"]), _norm(c["class_code"])):
            continue
        for sub in c["subjects"]:
            if not s or s in (_norm(sub["subject_name"]), _norm(sub["subject_code"])):
                return c["class_code"], sub["subject_code"]
    return None, None


def chapters(org: str, class_code: str | None, subject_code: str) -> list[dict]:
    """Chapters of the indexed textbooks for this subject (class-specific or subject-wide), de-duplicated by title."""
    books = db.fetch_all(
        "SELECT textbook_id, title FROM public.subject_textbooks WHERE org_code = %s AND subject_code = %s "
        "AND vector_status = 'indexed' AND (class_code IS NULL OR %s::varchar IS NULL OR class_code = %s) "
        "ORDER BY created_at DESC", (org, subject_code, class_code, class_code))
    seen: set[str] = set()
    out = []
    for b in books:
        for ch in db.call_rows("usp_list_chapters", b["textbook_id"]):
            name = (ch["chapter_title"] or f"Chapter {ch['chapter_number']}").strip()
            if _norm(name) in seen:
                continue
            seen.add(_norm(name))
            out.append({"id": f"{b['textbook_id']}:{ch['chapter_number']}", "name": name,
                        "textbook_id": str(b["textbook_id"]), "chapter_number": ch["chapter_number"],
                        "textbook_title": b["title"]})
    return out


def chapter_text(org: str, textbook_id: str | None, chapter_number: int | None, limit: int = 12000) -> str:
    """The indexed chapter's own text — grounds Course Outcome generation when no file was uploaded."""
    tb = _uuid(textbook_id)
    if not tb or not chapter_number:
        return ""
    book = db.fetch_one("SELECT org_code FROM public.subject_textbooks WHERE textbook_id = %s", (tb,))
    if not book or book["org_code"] != org:
        return ""
    rows = db.call_rows("usp_get_chapter_text", tb, int(chapter_number))
    return "\n\n".join(r["content_text"] for r in rows)[:limit]


# ════════════════════════════════════════════════════════════ lesson plans
_PLAN_COLS = ("lesson_plan_id, class_code, class_name, subject_code, subject_name, chapter_name, textbook_id, "
              "chapter_number, title, board, duration_mins, plan_json, is_completed, source, created_at, updated_at")


def _shape_plan(r: dict, session_count: int = 0, with_plan: bool = True) -> dict:
    out = {
        "id": str(r["lesson_plan_id"]), "title": r["title"], "classCode": r["class_code"], "className": r["class_name"],
        "subjectCode": r["subject_code"], "subjectName": r["subject_name"], "chapterName": r["chapter_name"],
        "textbookId": str(r["textbook_id"]) if r["textbook_id"] else None, "chapterNumber": r["chapter_number"],
        "board": r["board"], "durationMins": r["duration_mins"], "isCompleted": bool(r["is_completed"]),
        "source": r["source"], "createdAt": _iso(r["created_at"]), "updatedAt": _iso(r["updated_at"]),
        "sessionCount": session_count,
    }
    if with_plan:
        out["plan"] = r["plan_json"] or {}
    return out


def list_plans(org: str, teacher: str) -> list[dict]:
    rows = db.fetch_all(
        f"SELECT {_PLAN_COLS}, (SELECT COUNT(*) FROM public.session_plans s WHERE s.lesson_plan_id = p.lesson_plan_id "
        "AND NOT s.is_deleted)::int AS session_count FROM public.lesson_plans p "
        "WHERE org_code = %s AND teacher_code = %s AND NOT is_deleted ORDER BY created_at DESC", (org, teacher))
    return [_shape_plan(r, r["session_count"]) for r in rows]


def get_plan_row(plan_id: Any, org: str, teacher: str) -> dict | None:
    pid = _uuid(plan_id)
    if not pid:
        return None
    return db.fetch_one(f"SELECT {_PLAN_COLS} FROM public.lesson_plans WHERE lesson_plan_id = %s AND org_code = %s "
                        "AND teacher_code = %s AND NOT is_deleted", (pid, org, teacher))


def get_plan(plan_id: Any, org: str, teacher: str) -> dict | None:
    r = get_plan_row(plan_id, org, teacher)
    if not r:
        return None
    n = db.fetch_one("SELECT COUNT(*)::int AS n FROM public.session_plans WHERE lesson_plan_id = %s AND NOT is_deleted",
                     (r["lesson_plan_id"],))
    return _shape_plan(r, n["n"] if n else 0)


@dataclass
class PlanInput:
    id: str | None
    class_code: str | None
    class_name: str
    subject_code: str | None
    subject_name: str
    chapter_name: str
    textbook_id: str | None
    chapter_number: int | None
    title: str
    board: str | None
    duration_mins: int
    plan: dict
    is_completed: bool
    source: str


def save_plan(org: str, teacher: str, p: PlanInput) -> str | None:
    """Insert, or update in place when `id` is the caller's own plan. Returns the id (None = not found)."""
    tb = _uuid(p.textbook_id)
    vals = (p.class_code, p.class_name, p.subject_code, p.subject_name, p.chapter_name, tb, p.chapter_number,
            p.title, p.board, p.duration_mins, Jsonb(p.plan), p.is_completed, p.source)
    if p.id:
        pid = _uuid(p.id)
        if not pid:
            return None
        row = db.fetch_one(
            "UPDATE public.lesson_plans SET class_code=%s, class_name=%s, subject_code=%s, subject_name=%s, "
            "chapter_name=%s, textbook_id=%s, chapter_number=%s, title=%s, board=%s, duration_mins=%s, plan_json=%s, "
            "is_completed=%s, source=%s, updated_at=NOW() WHERE lesson_plan_id=%s AND org_code=%s AND teacher_code=%s "
            "AND NOT is_deleted RETURNING lesson_plan_id", (*vals, pid, org, teacher))
        return str(row["lesson_plan_id"]) if row else None
    row = db.fetch_one(
        "INSERT INTO public.lesson_plans (org_code, teacher_code, class_code, class_name, subject_code, subject_name, "
        "chapter_name, textbook_id, chapter_number, title, board, duration_mins, plan_json, is_completed, source, "
        "ai_plan_json) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING lesson_plan_id",
        (org, teacher, *vals, Jsonb(p.plan)))
    return str(row["lesson_plan_id"])


def delete_plan(plan_id: Any, org: str, teacher: str) -> int:
    pid = _uuid(plan_id)
    if not pid:
        return 0
    with db.connection() as conn:
        cur = conn.execute("UPDATE public.lesson_plans SET is_deleted = TRUE, updated_at = NOW() WHERE lesson_plan_id = %s "
                           "AND org_code = %s AND teacher_code = %s AND NOT is_deleted", (pid, org, teacher))
        n = cur.rowcount
        if n:
            conn.execute("UPDATE public.session_plans SET is_deleted = TRUE, updated_at = NOW() WHERE lesson_plan_id = %s",
                         (pid,))
        return n


def elos_from_plan(plan: Any) -> list[dict]:
    """The ELO list out of a saved plan JSON. `elos` is a list of strings or {id,text|elo} objects; the
    assessment blocks carry the Bloom level; older drafts only have per-CO `elos`. Order kept, duplicates dropped."""
    if isinstance(plan, str):
        try:
            plan = json.loads(plan)
        except ValueError:
            return []
    out: list[dict] = []
    seen: set[str] = set()
    bloom_by_text: dict[str, str] = {}
    if isinstance(plan, dict):
        for a in plan.get("assessment") or []:
            if isinstance(a, dict) and a.get("fullText"):
                bloom_by_text[str(a["fullText"]).strip().lower()] = str(a.get("bloomLevel") or "")

    def add(e: Any) -> None:
        if isinstance(e, str):
            text, eid, bloom, co = e, "", "", ""
        elif isinstance(e, dict):
            text = str(e.get("elo") or e.get("text") or e.get("statement") or "")
            eid = str(e.get("id") or e.get("Elo_id") or "")
            bloom = str(e.get("bloom_level") or e.get("bloomLevel") or e.get("bloom") or "")
            co = str(e.get("co_id") or e.get("coId") or "")
        else:
            return
        text = text.strip()
        if not text or text.lower() in seen:
            return
        seen.add(text.lower())
        out.append({"elo": text, "eloId": eid or None, "bloomLevel": bloom or bloom_by_text.get(text.lower()) or None,
                    "coId": co or None})

    if isinstance(plan, dict):
        for e in plan.get("elos") or []:
            add(e)
        if not out:
            for a in plan.get("assessment") or []:
                if isinstance(a, dict):
                    add({"elo": a.get("fullText"), "id": a.get("id"), "bloomLevel": a.get("bloomLevel")})
    if not out:
        cos = plan if isinstance(plan, list) else (plan.get("coreObjectives") if isinstance(plan, dict) else None)
        for co in cos or []:
            if isinstance(co, dict):
                for e in co.get("elos") or []:
                    add(e)
    return out


# ════════════════════════════════════════════════════════════ sessions
_SESSION_COLS = ("session_id, lesson_plan_id, session_no, title, duration_mins, instructions, elos_json, content_json, "
                 "modified_json, agent_status_json, status, row_version, class_code, class_name, subject_code, "
                 "subject_name, chapter_name, created_at, updated_at")


def _stages_for(session_ids: list[UUID]) -> dict[UUID, list[dict]]:
    if not session_ids:
        return {}
    stages = db.fetch_all(
        "SELECT stage_id, session_id, stage, sort_order, class_setting, duration_mins, description "
        "FROM public.session_stages WHERE session_id = ANY(%s) ORDER BY sort_order, stage", (session_ids,))
    res = db.fetch_all(
        "SELECT r.session_resource_id, r.stage_id, r.resource_id, r.source_kind, r.title, r.resource_type, r.url, "
        "r.chapter_name, r.meta, r.sort_order, lr.file_key, tb.blob_pdf_url "
        "FROM public.session_resources r "
        "LEFT JOIN public.learning_resources lr ON r.source_kind = 'resource' AND lr.resource_id::text = r.resource_id "
        "LEFT JOIN public.subject_textbooks tb ON r.source_kind = 'textbook' AND tb.textbook_id::text = r.resource_id "
        "WHERE r.session_id = ANY(%s) ORDER BY r.sort_order", (session_ids,))
    storage = get_storage()
    by_stage: dict[UUID, list[dict]] = {}
    for x in res:
        # Uploaded files and textbooks are served through short-lived signed URLs: re-sign on every read.
        url = x["url"] or ""
        key = x["file_key"] or x["blob_pdf_url"]
        if key:
            try:
                url = storage.signed_url(key)
            except Exception:  # noqa: BLE001 — a storage outage must not hide the session
                pass
        by_stage.setdefault(x["stage_id"], []).append({
            "id": str(x["session_resource_id"]), "resourceId": x["resource_id"], "sourceKind": x["source_kind"],
            "title": x["title"], "resourceType": x["resource_type"], "url": url, "chapterName": x["chapter_name"],
            "meta": x["meta"], "sortOrder": x["sort_order"]})
    out: dict[UUID, list[dict]] = {}
    for s in stages:
        out.setdefault(s["session_id"], []).append({
            "id": str(s["stage_id"]), "stage": s["stage"], "sortOrder": s["sort_order"], "classSetting": s["class_setting"],
            "durationMins": s["duration_mins"], "description": s["description"],
            "resources": by_stage.get(s["stage_id"], [])})
    return out


def _strip_html(h: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", h or "").replace("&nbsp;", " ")).strip()


def _shape_session(r: dict, stages: list[dict]) -> dict:
    content = r["modified_json"] if r["modified_json"] else r["content_json"]
    return {
        "id": str(r["session_id"]), "lessonPlanId": str(r["lesson_plan_id"]), "sessionNo": r["session_no"],
        "title": r["title"], "durationMins": r["duration_mins"], "instructions": r["instructions"],
        "elos": r["elos_json"] or [], "content": content or {}, "agents": r["agent_status_json"] or {},
        "status": r["status"], "rowVersion": r["row_version"],
        "classCode": r["class_code"], "className": r["class_name"], "subjectCode": r["subject_code"],
        "subjectName": r["subject_name"], "chapterName": r["chapter_name"],
        "createdAt": _iso(r["created_at"]), "updatedAt": _iso(r["updated_at"]),
        "resourceCount": sum(len(s["resources"]) for s in stages),
        "stageCount": sum(1 for s in stages if s["resources"] or _strip_html(s["description"])),
        "stages": stages,
    }


def list_sessions(plan_id: UUID, org: str, teacher: str, search: str | None, status: str | None,
                  page: int, page_size: int) -> dict:
    page = max(1, page)
    page_size = max(1, min(200, page_size or 20))
    where = "lesson_plan_id = %s AND org_code = %s AND teacher_code = %s AND NOT is_deleted"
    params: list[Any] = [plan_id, org, teacher]
    if search and search.strip():
        where += " AND title ILIKE %s"
        params.append(f"%{search.strip()}%")
    if status in ("draft", "completed"):
        where += " AND status = %s"
        params.append(status)
    total = db.fetch_one(f"SELECT COUNT(*)::int AS n FROM public.session_plans WHERE {where}", params)["n"]
    rows = db.fetch_all(f"SELECT {_SESSION_COLS} FROM public.session_plans WHERE {where} "
                        "ORDER BY session_no DESC LIMIT %s OFFSET %s", [*params, page_size, (page - 1) * page_size])
    stages = _stages_for([r["session_id"] for r in rows])
    return {"items": [_shape_session(r, stages.get(r["session_id"], [])) for r in rows],
            "total": total, "page": page, "pageSize": page_size}


def get_session(session_id: Any, org: str, teacher: str) -> dict | None:
    sid = _uuid(session_id)
    if not sid:
        return None
    r = db.fetch_one(f"SELECT {_SESSION_COLS} FROM public.session_plans WHERE session_id = %s AND org_code = %s "
                     "AND teacher_code = %s AND NOT is_deleted", (sid, org, teacher))
    if not r:
        return None
    return _shape_session(r, _stages_for([sid]).get(sid, []))


def next_session_no(plan_id: UUID) -> int:
    r = db.fetch_one("SELECT COALESCE(MAX(session_no), 0) + 1 AS n FROM public.session_plans "
                     "WHERE lesson_plan_id = %s AND NOT is_deleted", (plan_id,))
    return int(r["n"]) if r else 1


class SaveStatus:
    SAVED, NOT_FOUND, CONFLICT, DUPLICATE = "saved", "not_found", "conflict", "duplicate"


def save_session(*, session_id: str | None, plan: dict, org: str, teacher: str, session_no: int, title: str,
                 duration_mins: int, instructions: str, elos: list, content: dict, modified: dict, agents: dict,
                 status: str, row_version: int, stages: list[dict]) -> tuple[str, str | None, int]:
    """Insert or update ONE session and REPLACE its stages + resources, in one transaction.
    Returns (status, id, row_version)."""
    try:
        with db.connection() as conn:
            if session_id:
                sid = _uuid(session_id)
                cur = conn.execute(
                    "UPDATE public.session_plans SET session_no=%s, title=%s, duration_mins=%s, instructions=%s, "
                    "elos_json=%s, content_json=%s, modified_json=%s, agent_status_json=%s, status=%s, "
                    "row_version = row_version + 1, updated_at = NOW() WHERE session_id = %s AND org_code = %s "
                    "AND teacher_code = %s AND NOT is_deleted AND row_version = %s RETURNING row_version",
                    (session_no, title, duration_mins, instructions, Jsonb(elos), Jsonb(content), Jsonb(modified),
                     Jsonb(agents), status, sid, org, teacher, row_version))
                hit = cur.fetchone()
                if not hit:
                    exists = conn.execute("SELECT 1 FROM public.session_plans WHERE session_id = %s AND org_code = %s "
                                          "AND teacher_code = %s AND NOT is_deleted", (sid, org, teacher)).fetchone()
                    return (SaveStatus.CONFLICT if exists else SaveStatus.NOT_FOUND), None, 0
                new_version = hit["row_version"]
                conn.execute("DELETE FROM public.session_stages WHERE session_id = %s", (sid,))
            else:
                hit = conn.execute(
                    "INSERT INTO public.session_plans (lesson_plan_id, org_code, teacher_code, class_code, class_name, "
                    "subject_code, subject_name, chapter_name, session_no, title, duration_mins, instructions, elos_json, "
                    "content_json, modified_json, agent_status_json, status) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING session_id, row_version",
                    (plan["lesson_plan_id"], org, teacher, plan["class_code"], plan["class_name"], plan["subject_code"],
                     plan["subject_name"], plan["chapter_name"], session_no, title, duration_mins, instructions,
                     Jsonb(elos), Jsonb(content), Jsonb(modified), Jsonb(agents), status)).fetchone()
                sid, new_version = hit["session_id"], hit["row_version"]
            for i, st in enumerate(stages):
                stage_row = conn.execute(
                    "INSERT INTO public.session_stages (session_id, stage, sort_order, class_setting, duration_mins, "
                    "description) VALUES (%s,%s,%s,%s,%s,%s) RETURNING stage_id",
                    (sid, st["stage"], st.get("sortOrder", i), st.get("classSetting") or None,
                     st.get("durationMins") or 0, st.get("description") or None)).fetchone()
                seen: set[tuple[str, str]] = set()
                for j, x in enumerate(st.get("resources") or []):
                    rid = x.get("resourceId") or None
                    if rid is not None:
                        k = (x.get("sourceKind") or "resource", str(rid))
                        if k in seen:          # a resource cannot be picked twice into one stage
                            continue
                        seen.add(k)
                    conn.execute(
                        "INSERT INTO public.session_resources (session_id, stage_id, resource_id, source_kind, title, "
                        "resource_type, url, chapter_name, meta, sort_order) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (sid, stage_row["stage_id"], str(rid) if rid is not None else None,
                         x.get("sourceKind") or "resource", x["title"][:300], (x.get("resourceType") or "")[:40] or None,
                         x.get("url") or None, (x.get("chapterName") or "")[:300] or None,
                         (x.get("meta") or "")[:200] or None, x.get("sortOrder", j)))
            return SaveStatus.SAVED, str(sid), int(new_version)
    except pg_errors.UniqueViolation as e:
        if "ux_session_plans_plan_no" in (e.diag.constraint_name or ""):
            return SaveStatus.DUPLICATE, None, 0
        raise


def delete_session(session_id: Any, org: str, teacher: str) -> int:
    sid = _uuid(session_id)
    if not sid:
        return 0
    with db.connection() as conn:
        return conn.execute("UPDATE public.session_plans SET is_deleted = TRUE, updated_at = NOW() WHERE session_id = %s "
                            "AND org_code = %s AND teacher_code = %s AND NOT is_deleted", (sid, org, teacher)).rowcount
