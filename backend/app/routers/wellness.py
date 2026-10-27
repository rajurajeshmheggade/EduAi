"""Student Wellness — the MindAlign companion inside EduAI (students), plus Wellbeing & Mindset (teachers).

Student  /ICMELive/api/v1/wellness/me/*        own profile, dashboard, journal + AI analysis, check-ins, Aura chat
                                               (guardrails → memory → AI), quiz, activity XP, voice transcription
Teacher  /ICMELive/api/v1/wellness/classes/*   aggregated trends + safety alerts for the teacher's own classes

Security model (fixes over the standalone app): identity comes only from the JWT (no client-sent username), chat
history and journal context are built server-side (the browser cannot inject "journal" text into the prompt), XP is
awarded server-side with daily caps, the quiz answer is checked server-side, per-user rate limits + body size limits
on every AI call, `Cache-Control: no-store` on all responses, and teachers never receive journal/chat text.

Personalisation: there is no exam picker. Every prompt and fallback is pitched at the student's own class, section,
subjects and knowledge level (from their graded EduAI assessments) plus their upcoming tests and homework — built
server-side per request by services/wellness/context.py, never taken from the browser.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, StringConstraints

from .. import db
from ..providers import get_llm
from ..security import CurrentUser, require_role
from ..services.wellness import context, engine, guardrails as gr, ratelimit, store, xp

log = logging.getLogger("eduai.wellness")


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"


router = APIRouter(prefix="/ICMELive/api/v1/wellness", tags=["wellness"], dependencies=[Depends(_no_store)])
student_only = require_role("student")
teacher_only = require_role("teacher")

AVATARS = ["🧘", "🧠", "🎯", "🚀", "📚", "🍀", "☀️", "🌈"]
MAX_TRANSCRIBE_BYTES = 4 * 1024 * 1024
AUDIO_TYPES = {"audio/wav", "audio/x-wav", "audio/wave", "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/flac"}


def _key(u: CurrentUser) -> str:
    return f"{u.org_code}:{u.user_code}"


def _profile_or_409(u: CurrentUser) -> dict:
    p = store.get_profile(u.org_code, u.user_code)
    if not p:
        raise HTTPException(409, "Set up your wellness profile first.")
    return p


def _profile_out(p: dict | None) -> dict | None:
    if not p:
        return None
    return {"examDate": p["exam_date"].isoformat() if p["exam_date"] else None, "avatar": p["avatar"],
            "breathCycles": p["breath_cycles"], **xp.xp_state(p)}


# ════════════════════════════════════════════════════════════ student: profile & dashboard
@router.get("/meta")
def meta(_: CurrentUser = Depends(require_role("student", "teacher"))):
    """Product vocabulary + verified helplines / coping groundtruth (MindAlign /api/guardrails/status)."""
    return {"avatars": AVATARS, "knowledgeLevels": [name for _, name, _ in context.LEVELS] + [context.UNASSESSED], "helplines": gr.GROUNDTRUTH_HELPLINES, "coping": gr.GROUNDTRUTH_STUDENT_COPING,
            "guardrailLayers": ["Tier 1: Crisis & Self-Harm Prevention", "Tier 2: Medical & Prescription Substance Boundary",
                                "Tier 3: Academic Catastrophizing Cognitive Reframing", "Tier 4: Jailbreak & Prompt Injection Protection"],
            "xpRules": {k: v[0] for k, v in xp.XP_RULES.items()}, "aiEnabled": engine.ai_enabled()}


def _ctx(u: CurrentUser, p: dict | None) -> context.StudentContext:
    return context.build(u.org_code, u.user_code, (p or {}).get("exam_date"))


@router.get("/me")
def me(u: CurrentUser = Depends(student_only)):
    p = store.get_profile(u.org_code, u.user_code)
    ctx = _ctx(u, p)
    return {"student": {"name": ctx.name, "code": u.user_code, "classCode": ctx.class_code},
            "context": ctx.to_api(), "profile": _profile_out(p),
            "stats": store.dashboard_stats(u.org_code, u.user_code) if p else None}


class ProfileBody(BaseModel):
    examDate: date | None = None          # optional: when the student's next school exams start (drives the countdown)
    avatar: str = "🧘"


@router.put("/me/profile")
def save_profile(body: ProfileBody, u: CurrentUser = Depends(student_only)):
    if body.avatar not in AVATARS:
        raise HTTPException(422, "Pick one of the offered avatars")
    if body.examDate and body.examDate.year < 2000:
        raise HTTPException(422, "Exam date looks wrong")
    return {"profile": _profile_out(store.upsert_profile(u.org_code, u.user_code, body.examDate, body.avatar))}


@router.post("/me/tips")
def tips(u: CurrentUser = Depends(student_only)):
    """AI daily focus / relaxation tip + affirmation, cached per day, latest journal and academic context (one AI call)."""
    p = _profile_or_409(u)
    ctx = _ctx(u, p)
    stress, triggers = store.latest_context(u.org_code, u.user_code)
    latest = store.list_journals(u.org_code, u.user_code, 1)
    academic = hashlib.sha1(json.dumps([ctx.level, ctx.subjects, ctx.upcoming[:1]], default=str).encode()).hexdigest()[:10]
    key = f"{date.today().isoformat()}:{latest[0]['id'] if latest else '-'}:{academic}"
    if p.get("tips_key") == key and p.get("tips_json"):
        return {**p["tips_json"], "cached": True}
    ratelimit.check(_key(u), "tips")
    result, source = engine.daily_tips(ctx, triggers, stress)
    store.cache_tips(u.org_code, u.user_code, key, {**result, "aiSource": source})
    return {**result, "aiSource": source, "cached": False}


# ════════════════════════════════════════════════════════════ student: Zen Brain quiz (answer checked server-side)
def _quiz_out(row: dict) -> dict:
    q = row["question"]
    out = {"question": q["question"], "options": q["options"], "answered": row["answer_idx"] is not None}
    if out["answered"]:
        out.update(answerIdx=row["answer_idx"], correct=row["is_correct"], correctIdx=q["correct_idx"], explanation=q["explanation"])
    return out


@router.get("/me/quiz")
def quiz(u: CurrentUser = Depends(student_only)):
    p = _profile_or_409(u)
    today = date.today()
    row = store.get_quiz(u.org_code, u.user_code, today)
    if not row:
        ratelimit.check(_key(u), "quiz")
        question, _ = engine.generate_quiz(_ctx(u, p), today)
        row = store.save_quiz(u.org_code, u.user_code, today, question)
    return _quiz_out(row)


class QuizAnswer(BaseModel):
    answerIdx: int = Field(ge=0, le=2)


@router.post("/me/quiz/answer")
def quiz_answer(body: QuizAnswer, u: CurrentUser = Depends(student_only)):
    _profile_or_409(u)
    today = date.today()
    row = store.get_quiz(u.org_code, u.user_code, today)
    if not row:
        raise HTTPException(404, "There is no quiz for today yet")
    correct = row["question"]["correct_idx"] == body.answerIdx
    if not store.answer_quiz(u.org_code, u.user_code, today, body.answerIdx, correct):
        raise HTTPException(409, "You have already answered today's quiz")
    award = xp.award(u.org_code, u.user_code, "quiz_correct" if correct else "quiz_participation", "Zen Brain Quiz")
    return {**_quiz_out(store.get_quiz(u.org_code, u.user_code, today)), "xpResult": award}


# ════════════════════════════════════════════════════════════ student: check-in, journal, coping
class CheckinBody(BaseModel):
    mood: int = Field(ge=1, le=5)


@router.post("/me/checkin")
def checkin(body: CheckinBody, u: CurrentUser = Depends(student_only)):
    p = _profile_or_409(u)
    text, stress, analysis = engine.checkin_entry(body.mood, _ctx(u, p))
    entry = store.add_journal(u.org_code, u.user_code, "checkin", text, stress, analysis, "checkin")
    return {"entry": entry, "xpResult": xp.award(u.org_code, u.user_code, "mood_checkin", f"Mood {body.mood}/5"),
            "stats": store.dashboard_stats(u.org_code, u.user_code)}


class JournalBody(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=5000)]
    currentStress: int = Field(50, ge=1, le=100)


@router.post("/me/journals")
def analyze_journal(body: JournalBody, u: CurrentUser = Depends(student_only)):
    """MindAlign /api/analyze-journal + save, in one call: AI analysis (schema-validated, local fallback) → stored."""
    p = _profile_or_409(u)
    ratelimit.check(_key(u), "journal")
    analysis, source = engine.analyze_journal(body.text, _ctx(u, p), body.currentStress)
    entry = store.add_journal(u.org_code, u.user_code, "journal", body.text, body.currentStress, analysis, source)
    # A journal that itself contains crisis language is logged for the class teacher too.
    crisis = gr.check_crisis_guardrail(body.text)
    if crisis:
        store.log_guardrail(u.org_code, u.user_code, crisis["guardrail_type"], crisis["severity"], body.text)
    return {"entry": entry, "aiSource": source, "helplines": gr.GROUNDTRUTH_HELPLINES if crisis else None,
            "xpResult": xp.award(u.org_code, u.user_code, "journal", "Expressive Journaling"),
            "stats": store.dashboard_stats(u.org_code, u.user_code)}


@router.get("/me/journals")
def list_journals(limit: int = Query(50, ge=1, le=200), u: CurrentUser = Depends(student_only)):
    return {"journals": store.list_journals(u.org_code, u.user_code, limit)}


@router.delete("/me/journals/{journal_id}")
def delete_journal(journal_id: str, u: CurrentUser = Depends(student_only)):
    if not store.delete_journal(u.org_code, u.user_code, journal_id):
        raise HTTPException(404, "Journal entry not found")
    return {"deleted": True, "stats": store.dashboard_stats(u.org_code, u.user_code)}


class CopingBody(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    done: bool = True


@router.post("/me/journals/{journal_id}/coping")
def coping(journal_id: str, body: CopingBody, u: CurrentUser = Depends(student_only)):
    res = store.mark_coping(u.org_code, u.user_code, journal_id, body.title, body.done)
    if res is None:
        raise HTTPException(404, "Coping task not found on this journal entry")
    done_list, newly = res
    award = xp.award(u.org_code, u.user_code, "coping_task", body.title) if newly else None
    return {"copingDone": done_list, "xpResult": award}


# ════════════════════════════════════════════════════════════ student: Aura chat (guardrails → memory → AI)
class ChatBody(BaseModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    focusJournalId: str | None = None
    channel: Literal["chat", "live"] = "chat"


@router.post("/me/chat")
def chat(body: ChatBody, u: CurrentUser = Depends(student_only)):
    p = _profile_or_409(u)
    ratelimit.check(_key(u), "chat")
    org, student, msg = u.org_code, u.user_code, body.message
    ctx = _ctx(u, p)

    # 1. Deterministic pre-execution safety guardrails (crisis → medical → jailbreak → catastrophizing)
    hit = gr.evaluate_input_guardrails(msg, ctx.exams_label)
    if hit:
        log.warning("Wellness guardrail %s triggered for %s", hit["guardrail_type"], student)
        store.log_guardrail(org, student, hit["guardrail_type"], hit["severity"], msg)
        store.save_chat(org, student, "user", msg, body.channel)
        store.save_chat(org, student, "model", hit["response"], body.channel, hit["guardrail_type"], "guardrail")
        return {"reply": hit["response"], "guardrailTriggered": True, "guardrailType": hit["guardrail_type"],
                "aiSource": "guardrail", "helplines": hit.get("helplines")}

    # 2. Long-term memory: extract new facts, then recall the latest 8
    for fact in gr.extract_student_memories(msg, ctx.grade_label):
        store.add_memory(org, student, fact["category"], fact["text"])
    memories = [f"- [{m['category']}]: {m['text']}" for m in store.list_memories(org, student)[:8]]

    # 3. Context built server-side: history from the DB, academic context from EduAI, journal references from their own entries
    history = [{"role": m["role"], "content": m["content"]} for m in store.chat_history(org, student, 16)]
    stress, triggers = store.latest_context(org, student)
    journals = store.journal_references(org, student)
    focus = body.focusJournalId if body.focusJournalId and any(j["id"] == body.focusJournalId for j in journals) else None
    reply, source = engine.aura_reply(message=msg, history=history, ctx=ctx, current_stress=stress, recent_triggers=triggers,
                                      memories=memories, journals=journals, focus_id=focus)
    store.save_chat(org, student, "user", msg, body.channel)
    store.save_chat(org, student, "model", reply, body.channel, None, source)
    return {"reply": reply, "guardrailTriggered": False, "aiSource": source}


@router.get("/me/chat")
def chat_history(limit: int = Query(60, ge=1, le=200), u: CurrentUser = Depends(student_only)):
    return {"messages": store.chat_history(u.org_code, u.user_code, limit)}


@router.delete("/me/chat")
def clear_chat(u: CurrentUser = Depends(student_only)):
    return {"deleted": store.clear_chat(u.org_code, u.user_code)}


@router.get("/me/memories")
def memories(u: CurrentUser = Depends(student_only)):
    return {"memories": store.list_memories(u.org_code, u.user_code)}


@router.delete("/me/memories/{memory_id}")
def delete_memory(memory_id: int, u: CurrentUser = Depends(student_only)):
    if not store.delete_memory(u.org_code, u.user_code, memory_id):
        raise HTTPException(404, "Memory not found")
    return {"deleted": True}


# ════════════════════════════════════════════════════════════ student: activity XP + voice
class ActivityBody(BaseModel):
    activity: Literal["breathing_cycle", "pomodoro", "balloon_pop", "stress_quest"]
    details: Annotated[str, StringConstraints(max_length=200)] | None = None


@router.post("/me/activity")
def activity(body: ActivityBody, u: CurrentUser = Depends(student_only)):
    _profile_or_409(u)
    ratelimit.check(_key(u), "activity")
    return {"xpResult": xp.award(u.org_code, u.user_code, body.activity, body.details)}


@router.post("/me/transcribe")
async def transcribe(request: Request, u: CurrentUser = Depends(student_only)):
    """Aura Live speech-to-text fallback when the browser's own speech service is unavailable."""
    mime = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if mime not in AUDIO_TYPES:
        raise HTTPException(415, f"Unsupported audio type '{mime or 'none'}'")
    length = int(request.headers.get("content-length") or 0)
    if length > MAX_TRANSCRIBE_BYTES:
        raise HTTPException(413, "Recording is too long, please keep each turn under a minute")
    audio = await request.body()
    if not audio:
        raise HTTPException(400, "No audio received")
    if len(audio) > MAX_TRANSCRIBE_BYTES:
        raise HTTPException(413, "Recording is too long, please keep each turn under a minute")
    ratelimit.check(_key(u), "transcribe")
    if not engine.ai_enabled():
        raise HTTPException(503, "Voice transcription needs an AI provider (PROVIDER_MODE=azure or openai)")
    ext = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
           "audio/flac": "flac"}.get(mime, "wav")
    try:
        text = engine._call(lambda: get_llm().transcribe(audio, f"turn.{ext}"))  # noqa: SLF001 — shared time budget
    except Exception as e:  # noqa: BLE001
        log.error("Wellness transcription failed: %s", e)
        raise HTTPException(502, "Transcription service failed, please try again")
    return {"text": " ".join((text or "").split())}


# ════════════════════════════════════════════════════════════ teacher: Wellbeing & Mindset
def _teacher_classes(u: CurrentUser) -> list[dict]:
    return db.call_rows("usp_teacher_classes", u.org_code, u.user_code)


def _require_class(u: CurrentUser, class_code: str) -> dict:
    c = next((c for c in _teacher_classes(u) if c["class_code"] == class_code), None)
    if not c:
        raise HTTPException(403, "You are not assigned to this class")
    return c


def _risk(r: dict) -> str:
    if (r["crisis"] or 0) > 0 or (r["avg_mood"] is not None and r["avg_mood"] < 35):
        return "high"
    if not r["entries"] and not r["checkins"]:
        return "inactive"
    if (r["alerts_open"] or 0) > 0 or (r["avg_stress"] or 0) >= 70 or (r["latest_mood"] is not None and r["latest_mood"] < 40):
        return "watch"
    return "ok"


@router.get("/classes")
def teacher_classes(u: CurrentUser = Depends(teacher_only)):
    return {"classes": [{"classCode": c["class_code"], "className": c["class_name"], "isClassTeacher": c["is_class_teacher"],
                         "students": c["student_count"]} for c in _teacher_classes(u)]}


@router.get("/classes/{class_code}/overview")
def class_overview(class_code: str, days: int = Query(30, ge=7, le=180), u: CurrentUser = Depends(teacher_only)):
    c = _require_class(u, class_code)
    ratelimit.check(_key(u), "teacher")
    rows = store.class_overview(u.org_code, class_code, days)
    knowledge = context.class_knowledge(u.org_code, class_code)
    unassessed = {"level": context.UNASSESSED, "avgPct": None, "assessments": 0}
    students = [{
        "code": r["user_code"], "name": r["full_name"], "rollNumber": r["roll_number"], "hasProfile": r["has_profile"],
        "knowledge": knowledge.get(r["user_code"], unassessed), "level": r["level"] or 1, "levelTitle": xp.level_title(r["level"] or 1), "totalXp": r["total_xp"] or 0,
        "breathCycles": r["breath_cycles"] or 0, "entries": r["entries"] or 0, "checkins": r["checkins"] or 0,
        "avgStress": r["avg_stress"], "avgMood": r["avg_mood"], "latestMood": r["latest_mood"], "moodTrend": r["mood_trend"] or [],
        "lastEntry": r["last_entry"].isoformat() if r["last_entry"] else None,
        "lastActivity": r["last_activity"].isoformat() if r["last_activity"] else None,
        "crisisEvents": r["crisis"] or 0, "openAlerts": r["alerts_open"] or 0, "risk": _risk(r),
    } for r in rows]
    active = [s for s in students if s["entries"] or s["checkins"]]
    stresses = [s["avgStress"] for s in active if s["avgStress"] is not None]
    return {
        "classCode": class_code, "className": c["class_name"], "days": days,
        "summary": {"students": len(students), "onboarded": sum(1 for s in students if s["hasProfile"]), "active": len(active),
                    "avgStress": round(sum(stresses) / len(stresses)) if stresses else None,
                    "high": sum(1 for s in students if s["risk"] == "high"), "watch": sum(1 for s in students if s["risk"] == "watch"),
                    "openAlerts": sum(s["openAlerts"] for s in students)},
        "triggers": store.class_triggers(u.org_code, class_code, days), "students": students,
    }


@router.get("/classes/{class_code}/students/{student_code}")
def student_detail(class_code: str, student_code: str, days: int = Query(60, ge=7, le=365), u: CurrentUser = Depends(teacher_only)):
    _require_class(u, class_code)
    s = db.fetch_one("SELECT user_code, full_name, roll_number FROM public.app_users WHERE org_code = %s AND user_code = %s "
                     "AND class_code = %s AND user_role = 'student'", (u.org_code, student_code, class_code))
    if not s:
        raise HTTPException(404, "Student not found in this class")
    p = store.get_profile(u.org_code, student_code)
    knowledge = context.build(u.org_code, student_code).to_api()["knowledge"]
    return {"student": {"code": s["user_code"], "name": s["full_name"], "rollNumber": s["roll_number"]},
            "profile": _profile_out(p), "knowledge": knowledge, **store.student_detail(u.org_code, student_code, days)}


@router.post("/alerts/{event_id}/acknowledge")
def acknowledge(event_id: int, u: CurrentUser = Depends(teacher_only)):
    classes = {c["class_code"] for c in _teacher_classes(u)}
    if not store.acknowledge_alert(u.org_code, event_id, u.user_code, classes):
        raise HTTPException(404, "Alert not found or already acknowledged")
    return {"acknowledged": True}
