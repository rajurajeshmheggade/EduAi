"""Lesson Plan (unit plan) + Session Plan — ported from the Rapid / SARAS teacher console.

Lesson Plan:  /ICMELive/api/v1/lessonplan/*            7-step creator generators, repository CRUD, AI Bot assistant
Session Plan: /ICMELive/api/v1/lessonplan/sessions/*   sessions of a plan, generation + content agents, resource library

Bodies are read as loose JSON (the same request shapes the Rapid SPA sent), replies keep the Rapid response shapes.
Everything is teacher-only and scoped server-side: org_code + user_code come from the bearer token, never the body.
Generators first check that the teacher is assigned to the (class, subject) the request is for.
"""
from __future__ import annotations

import logging
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile, status

from ..security import CurrentUser, require_role
from ..services.lesson_plan import agents, assistant, generation, library, session as session_gen, store
from ..services.lesson_plan.text_extract import MAX_BYTES, UnsupportedFile, extract_text
from ..services.storage import build_key, get_storage

log = logging.getLogger("eduai.lessonplan")

router = APIRouter(prefix="/ICMELive/api/v1/lessonplan", tags=["lesson plan"])
sessions_router = APIRouter(prefix="/ICMELive/api/v1/lessonplan/sessions", tags=["session plan"])
teacher_only = require_role("teacher")
Json = dict[str, Any]
BOARDS = ["CBSE", "ICSE", "State Board"]
MAX_RESOURCE_MB = 50


# ════════════════════════════════════════════════════════════ helpers
def _s(b: Json, k: str) -> str:
    v = b.get(k)
    return v.strip() if isinstance(v, str) else ""


def _int(b: Json, k: str, default: int = 0) -> int:
    try:
        return int(b.get(k))
    except (TypeError, ValueError):
        return default


def _guard(user: CurrentUser, b: Json) -> tuple[str, str]:
    """The teacher must be assigned to the (class, subject) before any LLM call. Codes win; names are resolved."""
    cc, sc = _s(b, "class_code") or _s(b, "classCode"), _s(b, "subject_code") or _s(b, "subjectCode")
    if cc and sc:
        if store.in_scope(user.org_code, user.user_code, cc, sc):
            return cc, sc
    else:
        rc, rs = store.resolve_names(user.org_code, user.user_code, _s(b, "grade"), _s(b, "subject"))
        if rc and rs:
            return rc, rs
    label = " · ".join(x for x in (_s(b, "grade"), _s(b, "subject")) if x) or "that class and subject"
    raise HTTPException(status.HTTP_403_FORBIDDEN, f"You are not assigned to {label}, so a lesson plan cannot be "
                                                   "generated for it. Pick one of your own classes and subjects.")


def _run(fn: Callable[[Json], Any], b: Json) -> Any:
    try:
        return fn(b)
    except HTTPException:
        raise
    except RuntimeError as e:          # provider not configured (missing keys)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    except Exception as e:  # noqa: BLE001 — provider/network errors become a readable 502
        log.exception("lesson plan generation failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"The AI provider could not generate this: {e}")


def _gen(user: CurrentUser, b: Json, fn: Callable[[Json], Any]) -> Any:
    _guard(user, b)
    return _run(fn, b)


# ════════════════════════════════════════════════════════════ scope: classes / subjects / chapters
@router.get("/scope")
def scope(user: CurrentUser = Depends(teacher_only)):
    """The teacher's own classes and subjects (only these can be planned for) and the board options."""
    return {"classes": store.teacher_scope(user.org_code, user.user_code), "boards": BOARDS}


@router.get("/chapters")
def chapters(class_code: str = Query(..., max_length=64), subject_code: str = Query(..., max_length=64),
             user: CurrentUser = Depends(teacher_only)):
    """Chapters of the indexed textbooks for a class + subject (Textbooks & How to Teach)."""
    if not store.in_scope(user.org_code, user.user_code, class_code, subject_code):
        raise HTTPException(403, "You are not assigned to this class and subject")
    return {"chapters": store.chapters(user.org_code, class_code, subject_code)}


@router.post("/extract-text")
def extract(file: UploadFile = File(...), user: CurrentUser = Depends(teacher_only)):
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File exceeds 10 MB")
    try:
        text = extract_text(data, file.filename or "")
    except UnsupportedFile as e:
        raise HTTPException(415, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"Could not read the uploaded file: {e}")
    if not text.strip():
        raise HTTPException(422, "No readable text was found in the uploaded file")
    return {"text": text, "chars": len(text), "filename": file.filename}


# ════════════════════════════════════════════════════════════ 7-step creator generators
@router.post("/course-outcomes")
def course_outcomes(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    _guard(user, b)
    # No uploaded document → ground the plan on the indexed textbook chapter when one was picked.
    if not _s(b, "reference_text") and b.get("textbook_id"):
        text = store.chapter_text(user.org_code, b.get("textbook_id"), _int(b, "chapter_number") or None)
        if text:
            b = {**b, "reference_text": text}
    return _run(generation.course_outcomes, b)


@router.post("/regenerate-course-outcome")
def regenerate_course_outcome(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.regenerate_course_outcome)


@router.post("/skills-per-co")
def skills_per_co(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.skills_per_co)


@router.post("/competencies-per-co")
def competencies_per_co(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.competencies_per_co)


@router.post("/elos")
def elos(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.elos)


@router.post("/regenerate-elo")
def regenerate_elo(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.regenerate_elo)


@router.post("/pedagogical-approaches")
def pedagogical_approaches(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.pedagogical_approaches)


@router.post("/assessment-items")
@router.post("/regenerate-assessment-items")
def assessment_items(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.assessment_items)


@router.post("/learning-experience")
def learning_experience(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.learning_experience)


@router.post("/five-e-model")
def five_e_model(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.five_e_model)


@router.post("/five-e-resource")
def five_e_resource(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.five_e_resource)


@router.post("/assignments")
def assignments(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.assignments)


@router.post("/generate")
def quick_lesson_plan(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _gen(user, b, generation.quick_lesson_plan)


# ════════════════════════════════════════════════════════════ repository (persisted unit plans)
@router.post("/save-unit-plan")
def save_unit_plan(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    plan = b.get("plan") if isinstance(b.get("plan"), dict) else {}
    title = (_s(b, "unitPlanTitle") or _s(b, "title") or _s(b, "chapterName") or "Lesson Plan")[:300]
    cc, sc = _s(b, "classCode") or None, _s(b, "subjectCode") or None
    if (cc or sc) and not store.in_scope(user.org_code, user.user_code, cc, sc):
        raise HTTPException(403, "You are not assigned to this class and subject")
    source = "ai_bot" if _s(b, "source") == "ai_bot" or _int(b, "istype") == 1 else "manual"
    completed = b.get("isCompleted")
    if completed is None:
        completed = _int(b, "iscompleted", 1) == 1
    pid = store.save_plan(user.org_code, user.user_code, store.PlanInput(
        id=_s(b, "id") or None, class_code=cc, class_name=_s(b, "className")[:200], subject_code=sc,
        subject_name=_s(b, "subjectName")[:200], chapter_name=_s(b, "chapterName")[:300],
        textbook_id=_s(b, "textbookId") or None, chapter_number=_int(b, "chapterNumber") or None, title=title,
        board=(_s(b, "board") or None), duration_mins=max(0, _int(b, "durationMins", _int(plan, "duration", 0))),
        plan=plan, is_completed=bool(completed), source=source))
    if pid is None:
        raise HTTPException(404, "That lesson plan was not found")
    return {"id": pid, "status": "S001"}


@router.get("/plans")
def list_plans(user: CurrentUser = Depends(teacher_only)):
    return {"plans": store.list_plans(user.org_code, user.user_code)}


@router.get("/plans/{plan_id}")
def get_plan(plan_id: str, user: CurrentUser = Depends(teacher_only)):
    p = store.get_plan(plan_id, user.org_code, user.user_code)
    if not p:
        raise HTTPException(404, "That lesson plan was not found")
    return {"plan": p}


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: str, user: CurrentUser = Depends(teacher_only)):
    n = store.delete_plan(plan_id, user.org_code, user.user_code)
    if not n:
        raise HTTPException(404, "That lesson plan was not found")
    return {"id": plan_id, "deleted": n}


# ════════════════════════════════════════════════════════════ AI Bot assistant
@router.post("/assistant/chat")
def assistant_chat(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    msgs = [m for m in (b.get("messages") or []) if isinstance(m, dict)]
    ctx = b.get("context") if isinstance(b.get("context"), dict) else {}
    return {"response": _run(lambda _: assistant.chat(msgs, ctx), b)}


@router.post("/assistant/assessment-mix")
def assistant_mix(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    return _run(lambda _: assistant.assessment_mix(_s(b, "text")), b)


# ════════════════════════════════════════════════════════════ sessions of a lesson plan
def _plan_or_404(b: Json, user: CurrentUser) -> dict:
    pid = _s(b, "lessonPlanId") or _s(b, "unitPlanId")
    if not pid:
        raise HTTPException(400, "lessonPlanId is required.")
    plan = store.get_plan_row(pid, user.org_code, user.user_code)
    if not plan:
        raise HTTPException(404, "That lesson plan was not found.")
    return plan


def _plan_elos(plan: dict) -> list[dict]:
    return store.elos_from_plan(plan["plan_json"])


def _status(v: str) -> str:
    return "completed" if v.lower() == "completed" else "draft"


@sessions_router.post("/elos")
def session_elos(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    """The ELOs the parent lesson plan saved — the ONLY source Create Session uses. Empty is not an error."""
    plan = _plan_or_404(b, user)
    elos_ = _plan_elos(plan)
    return {"lessonPlanId": str(plan["lesson_plan_id"]), "chapterName": plan["chapter_name"],
            "className": plan["class_name"], "subjectName": plan["subject_name"], "elos": elos_, "count": len(elos_),
            "status": "S001" if elos_ else "S002",
            "message": None if elos_ else ("This lesson plan has no Expected Learning Outcomes saved yet. Finish the ELO "
                                           "step of the lesson plan and they will appear here.")}


@sessions_router.post("/list")
def session_list(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    plan = _plan_or_404(b, user)
    page = store.list_sessions(plan["lesson_plan_id"], user.org_code, user.user_code, _s(b, "search") or None,
                               _s(b, "status") or None, _int(b, "page", 1), _int(b, "pageSize", 20))
    return {"lessonPlanId": str(plan["lesson_plan_id"]), "planTitle": plan["title"], "className": plan["class_name"],
            "subjectName": plan["subject_name"], "chapterName": plan["chapter_name"], "sessions": page["items"],
            "total": page["total"], "page": page["page"], "pageSize": page["pageSize"], "status": "S001"}


@sessions_router.post("/get")
def session_get(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    if not _s(b, "id"):
        raise HTTPException(400, "id is required.")
    row = store.get_session(_s(b, "id"), user.org_code, user.user_code)
    if not row:
        raise HTTPException(404, "That session was not found.")
    return {"session": row, "status": "S001"}


def _persist(user: CurrentUser, plan: dict, b: Json, *, session_id: str | None, title: str, duration: int,
             instructions: str, elos_: list, content: dict, modified: dict, agent_status: dict, status_: str,
             stages: list[dict]) -> dict:
    existing = store.get_session(session_id, user.org_code, user.user_code) if session_id else None
    if session_id and not existing:
        raise HTTPException(404, "That session was not found.")
    if existing and existing["lessonPlanId"] != str(plan["lesson_plan_id"]):
        raise HTTPException(400, "A session cannot be moved to a different lesson plan.")
    session_no = _int(b, "sessionNo")
    if session_no <= 0:
        session_no = existing["sessionNo"] if existing else store.next_session_no(plan["lesson_plan_id"])
    result, sid, version = store.save_session(
        session_id=session_id, plan=plan, org=user.org_code, teacher=user.user_code, session_no=session_no,
        title=title, duration_mins=duration, instructions=instructions, elos=elos_, content=content, modified=modified,
        agents=agent_status, status=status_, row_version=_int(b, "rowVersion", 1), stages=stages)
    if result == store.SaveStatus.NOT_FOUND:
        raise HTTPException(404, "That session was not found.")
    if result == store.SaveStatus.CONFLICT:
        raise HTTPException(409, "This session was changed by someone else while you were editing. Reload it and "
                                 "apply your changes again.")
    if result == store.SaveStatus.DUPLICATE:
        raise HTTPException(409, f"Session {session_no} already exists for this lesson plan. Use a different session number.")
    return {"id": sid, "rowVersion": version, "sessionNo": session_no}


@sessions_router.post("/save")
def session_save(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    plan = _plan_or_404(b, user)
    title = _s(b, "title")[:300]
    if not title:
        raise HTTPException(400, "Session title is required.")
    out = _persist(user, plan, b, session_id=_s(b, "id") or None, title=title,
                   duration=max(0, min(100000, _int(b, "durationMins"))), instructions=_s(b, "instructions"),
                   elos_=b.get("elos") if isinstance(b.get("elos"), list) else [],
                   content=b.get("content") if isinstance(b.get("content"), dict) else {},
                   modified=b.get("modifiedContent") if isinstance(b.get("modifiedContent"), dict) else {},
                   agent_status=b.get("agents") if isinstance(b.get("agents"), dict) else {},
                   status_=_status(_s(b, "status")), stages=session_gen.read_stages(b.get("stages")))
    return {**out, "status": "S001"}


@sessions_router.post("/delete")
def session_delete(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    if not _s(b, "id"):
        raise HTTPException(400, "id is required.")
    n = store.delete_session(_s(b, "id"), user.org_code, user.user_code)
    if not n:
        raise HTTPException(404, "That session was not found.")
    return {"id": _s(b, "id"), "deleted": n, "status": "S001"}


@sessions_router.post("/generate")
def session_generate(b: Json = Body(...), user: CurrentUser = Depends(teacher_only)):
    """Generate the session on EduAI's AI provider around the picked resources, splice in the four live agent
    blocks, and (save: true) persist it in the same round trip."""
    plan = _plan_or_404(b, user)
    if plan["class_code"] and plan["subject_code"] and not store.in_scope(
            user.org_code, user.user_code, plan["class_code"], plan["subject_code"]):
        raise HTTPException(403, f"You are not assigned to {plan['class_name']} · {plan['subject_name']}.")
    title = _s(b, "title")[:300]
    duration = max(0, min(100000, _int(b, "durationMins")))
    instructions = _s(b, "instructions")
    stages = session_gen.read_stages(b.get("stages"))
    # Selected ELOs are INTERSECTED with the plan's own, so a stale body cannot smuggle in an outcome.
    wanted = {(e if isinstance(e, str) else str((e or {}).get("elo") or "")).strip().lower()
              for e in (b.get("elos") or [])} - {""}
    elos_ = [e for e in _plan_elos(plan) if not wanted or e["elo"].lower() in wanted]

    agent_content: dict = {}
    agent_status: dict = {}
    if b.get("includeAgents", True) is not False:
        topic = plan["chapter_name"] or title
        agent_content, agent_status = agents.run_all(plan["class_name"], plan["subject_name"], topic)
    generated = _run(lambda _: session_gen.generate_content(plan, title, duration, instructions, elos_, stages), b)
    content = {**generated, "additionalSections": agent_content}

    saved: dict = {"id": _s(b, "id") or None, "rowVersion": _int(b, "rowVersion", 1)}
    if b.get("save") is True:
        saved = _persist(user, plan, b, session_id=_s(b, "id") or None, title=title or "Untitled session",
                         duration=duration, instructions=instructions,
                         elos_=[{"elo": e["elo"], "eloId": e.get("eloId"), "bloomLevel": e.get("bloomLevel"),
                                 "coId": e.get("coId")} for e in elos_],
                         content=content, modified={}, agent_status=agent_status, status_="completed", stages=stages)
    return {"id": saved["id"], "rowVersion": saved["rowVersion"], "content": content, "agents": agent_status,
            "status": "S001"}


# ════════════════════════════════════════════════════════════ resource library
def _require_pair(user: CurrentUser, class_code: str, subject_code: str) -> None:
    if not class_code or not subject_code:
        raise HTTPException(400, "classCode and subjectCode are required.")
    if not store.in_scope(user.org_code, user.user_code, class_code, subject_code):
        raise HTTPException(403, "You are not assigned to this class and subject.")


@sessions_router.get("/resource-library")
def resource_library(classCode: str = Query(""), subjectCode: str = Query(""), chapter: str | None = Query(None),
                     assetType: str | None = Query(None), search: str | None = Query(None), limit: int = Query(200),
                     user: CurrentUser = Depends(teacher_only)):
    _require_pair(user, classCode, subjectCode)
    return {**library.library(user.org_code, user.user_code, classCode, subjectCode, chapter or None, assetType,
                              search, limit), "status": "S001"}


@sessions_router.get("/resource-content")
def resource_content(sourceKind: str = Query(""), resourceId: str = Query(""), user: CurrentUser = Depends(teacher_only)):
    classes = {c["class_code"] for c in store.teacher_scope(user.org_code, user.user_code)}
    return library.content(user.org_code, classes, sourceKind.strip().lower(), resourceId)


@sessions_router.post("/resources", status_code=201)
def add_resource(classCode: str = Form(...), subjectCode: str = Form(...), title: str = Form(..., min_length=1, max_length=300),
                 resourceType: str = Form("Link"), chapter: str | None = Form(None), url: str | None = Form(None),
                 description: str | None = Form(None), file: UploadFile | None = File(None),
                 user: CurrentUser = Depends(teacher_only)):
    """Add a link or a file to the Resource Library for a class + subject (+ chapter)."""
    _require_pair(user, classCode, subjectCode)
    if resourceType not in library.RESOURCE_TYPES:
        raise HTTPException(422, f"resourceType must be one of: {', '.join(library.RESOURCE_TYPES)}")
    link = (url or "").strip()
    if link and not link.lower().startswith(("http://", "https://")):
        raise HTTPException(422, "Links must start with http:// or https://")
    key = name = None
    size = None
    if file is not None and (file.filename or ""):
        data = file.file.read(MAX_RESOURCE_MB * 1024 * 1024 + 1)
        if len(data) > MAX_RESOURCE_MB * 1024 * 1024:
            raise HTTPException(413, f"File exceeds {MAX_RESOURCE_MB} MB")
        if not data:
            raise HTTPException(422, "The file is empty")
        name = (file.filename or "resource")[-200:]
        key = build_key(user["customer_code"], user.org_code, None, None, subjectCode,
                        f"LearningResources-{uuid4().hex[:8]}", name)
        get_storage().put(key, data, file.content_type or "application/octet-stream")
        size = len(data)
    if not link and not key:
        raise HTTPException(422, "Add a link or choose a file")
    return library.add_resource(user.org_code, user.user_code, classCode, subjectCode, (chapter or "").strip() or None,
                                title.strip(), resourceType, link or None, description, key, name, size)


@sessions_router.delete("/resources/{resource_id}")
def delete_resource(resource_id: str, user: CurrentUser = Depends(teacher_only)):
    if not library.delete_resource(user.org_code, user.user_code, resource_id):
        raise HTTPException(404, "That resource was not found (only the teacher who added it can remove it).")
    return {"id": resource_id, "deleted": True}
