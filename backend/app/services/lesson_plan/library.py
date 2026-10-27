"""Resource Library for the Session Resources picker — live rows from EduAI's own catalogues.

Rapid read syllabus."tblChapterResource" (Learning Resources), the Test Repository and the question bank.
EduAI equivalents, all scoped to the class + subject the teacher is assigned to:

  Resources        learning_resources (teacher-added links / files) + the subject's indexed textbooks
  Video Catalogue  learning_resources of type Video / Audio
  Activities       learning_resources of type Activity + the class's homework for the subject
  Tests            evaluation_tests (online tests, assignments, offline exams)
  Questions        evaluation_master_questions of those tests

`content()` returns the exact wire payload the session Launch window renders for a test / question / activity.
"""
from __future__ import annotations

import html
import re
from uuid import UUID

from ... import db
from ..storage import get_storage

ASSET_TYPES = ("Resources", "Tests", "Questions", "Activities", "Video Catalogue")
RESOURCE_TYPES = ("Video", "Audio", "PDF", "Document", "Presentation", "Image", "Activity", "Link")
TYPE_LABEL = {"ONLINE_TEST": "Online test", "ASSIGNMENT": "Assignment", "OFFLINE_EXAM": "Offline exam"}


def ui_kind(resource_type: str | None) -> str:
    """ResourceType → one of the seven card kinds the picker draws (same mapping as Rapid)."""
    t = (resource_type or "").strip().lower()
    if t in ("video", "audio", "story and concept animation"):
        return "video"
    if t in ("presentation", "image"):
        return "slides"
    if t in ("document", "work book", "workbook"):
        return "worksheet"
    if t in ("activity", "interactivity"):
        return "activity"
    return "reference"


def _kinds(asset_type: str) -> set[str]:
    if asset_type == "Video Catalogue":
        return {"video"}
    if asset_type == "Activities":
        return {"activity"}
    return {"video", "worksheet", "slides", "reference"}


def _matches(text: str | None, q: str | None) -> bool:
    return not q or not q.strip() or q.strip().lower() in (text or "").lower()


def _size(n: int | None) -> str:
    if not n:
        return ""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return ""


def _signed(key: str | None) -> str:
    if not key:
        return ""
    try:
        return get_storage().signed_url(key)
    except Exception:  # noqa: BLE001
        return ""


def _learning_resources(org: str, class_code: str, subject_code: str, chapter: str | None, search: str | None,
                        user_code: str) -> list[dict]:
    rows = db.fetch_all(
        "SELECT resource_id, chapter_name, title, resource_type, url, file_key, file_name, file_size, created_by "
        "FROM public.learning_resources WHERE org_code = %s AND class_code = %s AND subject_code = %s AND NOT is_deleted "
        "AND (%s::varchar IS NULL OR chapter_name IS NULL OR lower(chapter_name) = lower(%s)) "
        "ORDER BY created_at DESC", (org, class_code, subject_code, chapter or None, chapter or None))
    out = []
    for r in rows:
        if not _matches(r["title"], search):
            continue
        meta = " · ".join(x for x in [r["resource_type"], _size(r["file_size"]) or ("Link" if r["url"] else "")] if x)
        out.append({"resourceId": str(r["resource_id"]), "sourceKind": "resource", "title": r["title"],
                    "kind": ui_kind(r["resource_type"]), "resourceType": r["resource_type"],
                    "chapter": r["chapter_name"] or "", "url": r["url"] or _signed(r["file_key"]),
                    "meta": meta or "Resource", "origin": "my" if r["created_by"] == user_code else "shared",
                    "canDelete": r["created_by"] == user_code})
    return out


def _textbooks(org: str, class_code: str, subject_code: str, search: str | None) -> list[dict]:
    rows = db.fetch_all(
        "SELECT textbook_id, title, total_pages, blob_pdf_url FROM public.subject_textbooks WHERE org_code = %s "
        "AND subject_code = %s AND vector_status = 'indexed' AND (class_code IS NULL OR class_code = %s) "
        "ORDER BY created_at DESC", (org, subject_code, class_code))
    return [{"resourceId": str(r["textbook_id"]), "sourceKind": "textbook", "title": r["title"], "kind": "reference",
             "resourceType": "PDF", "chapter": "Textbooks", "url": _signed(r["blob_pdf_url"]),
             "meta": f"Textbook · {r['total_pages']} pages", "origin": "recommended"}
            for r in rows if _matches(r["title"], search)]


def _homework(org: str, class_code: str, subject_code: str, search: str | None) -> list[dict]:
    rows = db.fetch_all(
        "SELECT homework_id, title, instructions, attachment_name, due_date FROM public.homeworks "
        "WHERE org_code = %s AND class_code = %s AND subject_code = %s ORDER BY due_date DESC LIMIT 200",
        (org, class_code, subject_code))
    return [{"resourceId": str(r["homework_id"]), "sourceKind": "activity", "title": r["title"], "kind": "activity",
             "resourceType": "Activity", "chapter": "Homework", "url": "",
             "meta": " · ".join(x for x in ["Homework", f"Due {r['due_date']:%d %b}" if r["due_date"] else "",
                                            "1 file" if r["attachment_name"] else ""] if x), "origin": "my"}
            for r in rows if _matches(r["title"], search) or _matches(r["instructions"], search)]


def _tests(org: str, class_code: str, subject_code: str, search: str | None, limit: int) -> list[dict]:
    rows = db.fetch_all(
        "SELECT eval_test_id, test_title, assessment_type, chapter_title, total_questions, duration_minutes, "
        "total_max_marks FROM public.evaluation_tests WHERE org_code = %s AND class_code = %s AND subject_code = %s "
        "ORDER BY created_at DESC LIMIT %s", (org, class_code, subject_code, limit))
    out = []
    for r in rows:
        if not _matches(r["test_title"], search):
            continue
        n = r["total_questions"] or 0
        meta = " · ".join(x for x in [f"{n} item{'' if n == 1 else 's'}",
                                      f"{r['duration_minutes']} min" if r["duration_minutes"] else "",
                                      f"{float(r['total_max_marks']):g} marks" if r["total_max_marks"] else ""] if x)
        out.append({"resourceId": str(r["eval_test_id"]), "sourceKind": "test", "title": r["test_title"],
                    "kind": "test", "resourceType": TYPE_LABEL.get(r["assessment_type"], "Test"),
                    "chapter": r["chapter_title"] or "", "url": "", "meta": meta, "origin": "my"})
    return out


def _questions(org: str, class_code: str, subject_code: str, chapter: str | None, search: str | None,
               limit: int) -> list[dict]:
    rows = db.fetch_all(
        "SELECT q.master_q_id, q.sl_no, q.question_text, q.max_marks, q.question_type, t.test_title, t.chapter_title "
        "FROM public.evaluation_master_questions q JOIN public.evaluation_tests t ON t.eval_test_id = q.eval_test_id "
        "WHERE t.org_code = %s AND t.class_code = %s AND t.subject_code = %s "
        "AND (%s::varchar IS NULL OR t.chapter_title IS NULL OR lower(t.chapter_title) = lower(%s)) "
        "ORDER BY t.created_at DESC, q.display_order LIMIT %s",
        (org, class_code, subject_code, chapter or None, chapter or None, limit))
    out = []
    for r in rows:
        text = re.sub(r"\s+", " ", r["question_text"] or "").strip()
        if not text or not _matches(text, search):
            continue
        meta = " · ".join(x for x in [(r["question_type"] or "").replace("_", " ").title(),
                                      f"{float(r['max_marks']):g} marks" if r["max_marks"] else "", r["test_title"]] if x)
        out.append({"resourceId": str(r["master_q_id"]), "sourceKind": "question",
                    "title": text if len(text) <= 160 else text[:157] + "…", "kind": "question",
                    "resourceType": "Question", "chapter": r["chapter_title"] or "", "url": "", "meta": meta,
                    "origin": "recommended"})
    return out


def library(org: str, user_code: str, class_code: str, subject_code: str, chapter: str | None, asset_type: str | None,
            search: str | None, limit: int) -> dict:
    limit = limit if 0 < limit <= 500 else 200
    atype = asset_type if asset_type in ASSET_TYPES else "Resources"
    resources = _learning_resources(org, class_code, subject_code, chapter, search, user_code)
    books = _textbooks(org, class_code, subject_code, search)
    homework = _homework(org, class_code, subject_code, search)
    if atype == "Tests":
        items = _tests(org, class_code, subject_code, search, limit)
    elif atype == "Questions":
        items = _questions(org, class_code, subject_code, chapter, search, limit)
    else:
        kinds = _kinds(atype)
        items = [x for x in resources if x["kind"] in kinds]
        if atype == "Resources":
            items += books
        if atype == "Activities":
            items += homework
        items = items[:limit]
    counts = {
        "Resources": sum(1 for x in resources if x["kind"] in _kinds("Resources")) + len(books),
        "Video Catalogue": sum(1 for x in resources if x["kind"] == "video"),
        "Activities": sum(1 for x in resources if x["kind"] == "activity") + len(homework),
    }
    if atype in ("Tests", "Questions"):
        counts[atype] = len(items)
    groups: dict[str, list[dict]] = {}
    for x in items:
        groups.setdefault(x["chapter"] or "Unassigned", []).append(x)
    return {"assetType": atype, "total": len(items), "counts": counts,
            "groups": [{"chapter": k, "items": v} for k, v in groups.items()]}


# ─────────────────────────────────────────────────────────────── launch-window content
def _esc(s: str | None) -> str:
    return html.escape(s or "").replace("\n", "<br>")


_OPT = re.compile(r"^\s*\(?([a-hA-H])[).]\s*")


def _wire_question(q: dict, n: int) -> dict:
    opts = q.get("mcq_options") or []
    correct = (q.get("correct_option") or "").strip().lower()
    options = []
    for i, o in enumerate(opts if isinstance(opts, list) else []):
        text = str(o)
        m = _OPT.match(text)
        letter = (m.group(1) if m else chr(97 + i)).lower()
        options.append({"html": _esc(_OPT.sub("", text) if m else text), "correct": bool(correct) and letter == correct})
    qtype = (q.get("question_type") or "DESCRIPTIVE").replace("_", " ").title()
    return {"n": n, "type": "MCQ" if q.get("question_type") == "MCQ" else qtype, "section": "",
            "marks": float(q.get("max_marks") or 0), "html": _esc(q.get("question_text")), "options": options,
            "statements": [], "pairs": [], "ar": [], "blanks": [], "answer": q.get("model_answer_text") or "", "hint": ""}


def content(org: str, class_codes: set[str], source_kind: str, resource_id: str) -> dict:
    """{ mode: 'test'|'question'|'activity'|'error', … } — ALWAYS a payload, never an exception."""
    try:
        rid = UUID(str(resource_id))
    except (TypeError, ValueError):
        return {"mode": "error", "message": "This resource was saved without a library link, so its content cannot be looked up."}
    if source_kind == "test":
        t = db.fetch_one("SELECT eval_test_id, class_code, test_title, assessment_type, duration_minutes, chapter_title "
                         "FROM public.evaluation_tests WHERE eval_test_id = %s AND org_code = %s", (rid, org))
        if not t or t["class_code"] not in class_codes:
            return {"mode": "error", "message": "This is no longer in the repository, so it cannot be shown."}
        qs = db.fetch_all("SELECT question_text, max_marks, question_type, mcq_options, correct_option, model_answer_text "
                          "FROM public.evaluation_master_questions WHERE eval_test_id = %s ORDER BY display_order", (rid,))
        meta = " · ".join(x for x in [TYPE_LABEL.get(t["assessment_type"], "Test"),
                                      f"{len(qs)} question{'' if len(qs) == 1 else 's'}",
                                      f"{t['duration_minutes']} min" if t["duration_minutes"] else "",
                                      t["chapter_title"] or ""] if x)
        return {"mode": "test", "title": t["test_title"], "meta": meta,
                "paper": [_wire_question(q, i + 1) for i, q in enumerate(qs)],
                "arOptions": [], "arInstruction": "", "key": False}
    if source_kind == "question":
        q = db.fetch_one(
            "SELECT q.question_text, q.max_marks, q.question_type, q.mcq_options, q.correct_option, q.model_answer_text, "
            "t.class_code, t.test_title FROM public.evaluation_master_questions q JOIN public.evaluation_tests t "
            "ON t.eval_test_id = q.eval_test_id WHERE q.master_q_id = %s AND t.org_code = %s", (rid, org))
        if not q or q["class_code"] not in class_codes:
            return {"mode": "error", "message": "This is no longer in the repository, so it cannot be shown."}
        wire = _wire_question(q, 1)
        return {"mode": "question", "title": (q["question_text"] or "")[:120], "meta": q["test_title"],
                "html": wire["html"], "q": wire, "arOptions": [], "arInstruction": "", "key": False}
    if source_kind == "activity":
        h = db.fetch_one("SELECT class_code, title, instructions, attachment_key, attachment_name, due_date "
                         "FROM public.homeworks WHERE homework_id = %s AND org_code = %s", (rid, org))
        if h and h["class_code"] in class_codes:
            files = [{"title": h["attachment_name"] or "Attachment", "type": "Document", "url": _signed(h["attachment_key"])}] \
                if h["attachment_key"] else []
            return {"mode": "activity", "title": h["title"], "meta": f"Homework · Due {h['due_date']:%d %b %Y}",
                    "desc": _esc(h["instructions"]), "files": files}
        r = db.fetch_one("SELECT class_code, title, description, url, file_key, resource_type FROM public.learning_resources "
                         "WHERE resource_id = %s AND org_code = %s AND NOT is_deleted", (rid, org))
        if r and r["class_code"] in class_codes:
            return {"mode": "activity", "title": r["title"], "meta": r["resource_type"], "desc": _esc(r["description"]),
                    "files": [{"title": r["title"], "type": r["resource_type"], "url": r["url"] or _signed(r["file_key"])}]}
        return {"mode": "error", "message": "This activity is no longer available, so it cannot be shown."}
    return {"mode": "error", "message": "sourceKind must be 'test', 'question' or 'activity'."}


def add_resource(org: str, user_code: str, class_code: str, subject_code: str, chapter: str | None, title: str,
                 resource_type: str, url: str | None, description: str | None, file_key: str | None,
                 file_name: str | None, file_size: int | None) -> dict:
    row = db.fetch_one(
        "INSERT INTO public.learning_resources (org_code, class_code, subject_code, chapter_name, title, resource_type, "
        "url, file_key, file_name, file_size, description, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        "RETURNING resource_id", (org, class_code, subject_code, chapter or None, title, resource_type, url or None,
                                  file_key, file_name, file_size, description or None, user_code))
    return {"resourceId": str(row["resource_id"])}


def delete_resource(org: str, user_code: str, resource_id: str) -> int:
    try:
        rid = UUID(str(resource_id))
    except (TypeError, ValueError):
        return 0
    with db.connection() as conn:
        return conn.execute("UPDATE public.learning_resources SET is_deleted = TRUE WHERE resource_id = %s "
                            "AND org_code = %s AND created_by = %s AND NOT is_deleted", (rid, org, user_code)).rowcount
