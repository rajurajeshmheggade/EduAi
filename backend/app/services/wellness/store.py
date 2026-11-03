"""Wellness persistence (port of MindAlign `api/database.py` onto EduAI PostgreSQL).

Every statement is scoped by (org_code, student_code) from the bearer token. Teacher queries return aggregates and
alert metadata only — they never select journal text, chat content or guardrail messages.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb

from ... import db


def _iso(v: Any) -> str | None:
    return v.isoformat() if isinstance(v, (date, datetime)) else v


def _uuid(v: Any) -> UUID | None:
    try:
        return UUID(str(v))
    except (TypeError, ValueError):
        return None


# ─────────────────────────────────────────────────────────────── profile
def get_profile(org: str, student: str) -> dict | None:
    return db.fetch_one("SELECT * FROM public.wellness_profiles WHERE org_code = %s AND student_code = %s", (org, student))


def upsert_profile(org: str, student: str, exam_date: date | None, avatar: str) -> dict:
    return db.fetch_one(
        "INSERT INTO public.wellness_profiles (org_code, student_code, exam_date, avatar) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT (org_code, student_code) DO UPDATE SET exam_date = EXCLUDED.exam_date, "
        "avatar = EXCLUDED.avatar, tips_key = NULL, updated_at = NOW() RETURNING *", (org, student, exam_date, avatar))


def cache_tips(org: str, student: str, key: str, tips: dict) -> None:
    db.execute("UPDATE public.wellness_profiles SET tips_json = %s, tips_key = %s WHERE org_code = %s AND student_code = %s",
               (Jsonb(tips), key, org, student))


# ─────────────────────────────────────────────────────────────── journals
_J_COLS = "journal_id, kind, entry_text, stress_input, mood_score, analysis, coping_done, ai_source, created_at"


def shape_journal(r: dict) -> dict:
    return {"id": str(r["journal_id"]), "kind": r["kind"], "date": _iso(r["created_at"]), "text": r["entry_text"],
            "stress_input": r["stress_input"], "analysis": r["analysis"] or {}, "copingDone": r["coping_done"] or [],
            "aiSource": r["ai_source"]}


def add_journal(org: str, student: str, kind: str, text: str, stress: int, analysis: dict, ai_source: str) -> dict:
    row = db.fetch_one(
        f"INSERT INTO public.wellness_journals (org_code, student_code, kind, entry_text, stress_input, mood_score, analysis, "
        f"ai_source) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING {_J_COLS}",
        (org, student, kind, text, stress, int(analysis.get("mood_score") or max(1, 100 - stress)), Jsonb(analysis), ai_source))
    triggers = [str(t) for t in (analysis.get("triggers") or [])][:6]
    if triggers and kind == "journal":       # MindAlign: journal triggers feed Aura's memory
        add_memory(org, student, "recent_triggers", f"Recent stress triggers: {', '.join(triggers)}"[:300], source="journal")
    return shape_journal(row)


def list_journals(org: str, student: str, limit: int = 50) -> list[dict]:
    rows = db.fetch_all(f"SELECT {_J_COLS} FROM public.wellness_journals WHERE org_code = %s AND student_code = %s "
                        "ORDER BY created_at DESC LIMIT %s", (org, student, max(1, min(200, limit))))
    return [shape_journal(r) for r in rows]


def get_journal(org: str, student: str, journal_id: str) -> dict | None:
    jid = _uuid(journal_id)
    if not jid:
        return None
    r = db.fetch_one(f"SELECT {_J_COLS} FROM public.wellness_journals WHERE journal_id = %s AND org_code = %s AND student_code = %s",
                     (jid, org, student))
    return shape_journal(r) if r else None


def delete_journal(org: str, student: str, journal_id: str) -> bool:
    jid = _uuid(journal_id)
    if not jid:
        return False
    with db.connection() as conn:
        return conn.execute("DELETE FROM public.wellness_journals WHERE journal_id = %s AND org_code = %s AND student_code = %s",
                            (jid, org, student)).rowcount > 0


def mark_coping(org: str, student: str, journal_id: str, title: str, done: bool) -> tuple[list[str], bool] | None:
    """Toggle one coping strategy. Returns (coping_done, newly_done) or None when the journal is not the caller's."""
    jid = _uuid(journal_id)
    if not jid:
        return None
    with db.connection() as conn:
        r = conn.execute("SELECT coping_done, analysis FROM public.wellness_journals WHERE journal_id = %s AND org_code = %s "
                         "AND student_code = %s FOR UPDATE", (jid, org, student)).fetchone()
        if not r:
            return None
        titles = {str(c.get("title")) for c in (r["analysis"] or {}).get("coping_strategies") or [] if isinstance(c, dict)}
        if title not in titles:
            return None
        current = [t for t in (r["coping_done"] or []) if isinstance(t, str)]
        newly = done and title not in current
        nxt = sorted(set(current) | {title}) if done else [t for t in current if t != title]
        conn.execute("UPDATE public.wellness_journals SET coping_done = %s WHERE journal_id = %s", (Jsonb(nxt), jid))
        return nxt, newly


def latest_context(org: str, student: str) -> tuple[int, list[str]]:
    """(current_stress, recent_triggers) from the latest entry — MindAlign student_context."""
    r = db.fetch_one("SELECT stress_input, analysis FROM public.wellness_journals WHERE org_code = %s AND student_code = %s "
                     "ORDER BY created_at DESC LIMIT 1", (org, student))
    if not r:
        return 50, []
    return int(r["stress_input"]), [str(t) for t in ((r["analysis"] or {}).get("triggers") or [])][:6]


def journal_references(org: str, student: str, limit: int = 12) -> list[dict]:
    rows = db.fetch_all("SELECT journal_id, entry_text, mood_score, analysis, created_at FROM public.wellness_journals "
                        "WHERE org_code = %s AND student_code = %s AND kind = 'journal' ORDER BY created_at DESC LIMIT %s",
                        (org, student, limit))
    return [{"id": str(r["journal_id"]), "date": r["created_at"].strftime("%d %b %Y"), "text": r["entry_text"],
             "mood_score": r["mood_score"], "triggers": (r["analysis"] or {}).get("triggers") or [],
             "summary": (r["analysis"] or {}).get("analysis_summary")} for r in rows]


# ─────────────────────────────────────────────────────────────── chat + memory + guardrails
def save_chat(org: str, student: str, role: str, content: str, channel: str = "chat",
              guardrail_type: str | None = None, ai_source: str | None = None) -> None:
    db.execute("INSERT INTO public.wellness_chat_messages (org_code, student_code, role, content, channel, guardrail_type, ai_source) "
               "VALUES (%s,%s,%s,%s,%s,%s,%s)", (org, student, role, content, channel, guardrail_type, ai_source))


def chat_history(org: str, student: str, limit: int = 60) -> list[dict]:
    rows = db.fetch_all("SELECT message_id, role, content, channel, guardrail_type, ai_source, created_at FROM ("
                        " SELECT * FROM public.wellness_chat_messages WHERE org_code = %s AND student_code = %s "
                        " ORDER BY message_id DESC LIMIT %s) t ORDER BY message_id", (org, student, max(1, min(200, limit))))
    return [{"id": r["message_id"], "role": r["role"], "content": r["content"], "channel": r["channel"],
             "guardrailType": r["guardrail_type"], "aiSource": r["ai_source"], "timestamp": _iso(r["created_at"])} for r in rows]


def clear_chat(org: str, student: str) -> int:
    with db.connection() as conn:
        return conn.execute("DELETE FROM public.wellness_chat_messages WHERE org_code = %s AND student_code = %s",
                            (org, student)).rowcount


def add_memory(org: str, student: str, category: str, text: str, source: str = "chat") -> None:
    db.execute("INSERT INTO public.wellness_memories (org_code, student_code, category, memory_text, source) VALUES (%s,%s,%s,%s,%s) "
               "ON CONFLICT (org_code, student_code, category, memory_text) DO UPDATE SET updated_at = NOW()",
               (org, student, category[:40], text.strip()[:300], source))


def list_memories(org: str, student: str) -> list[dict]:
    rows = db.fetch_all("SELECT memory_id, category, memory_text, source, created_at, updated_at FROM public.wellness_memories "
                        "WHERE org_code = %s AND student_code = %s ORDER BY updated_at DESC", (org, student))
    return [{"id": r["memory_id"], "category": r["category"], "text": r["memory_text"], "source": r["source"],
             "updatedAt": _iso(r["updated_at"])} for r in rows]


def delete_memory(org: str, student: str, memory_id: int) -> bool:
    with db.connection() as conn:
        return conn.execute("DELETE FROM public.wellness_memories WHERE memory_id = %s AND org_code = %s AND student_code = %s",
                            (memory_id, org, student)).rowcount > 0


def log_guardrail(org: str, student: str, guardrail_type: str, severity: str, message: str) -> None:
    db.execute("INSERT INTO public.wellness_guardrail_events (org_code, student_code, guardrail_type, severity, user_message) "
               "VALUES (%s,%s,%s,%s,%s)", (org, student, guardrail_type, severity, message[:4000]))


# ─────────────────────────────────────────────────────────────── daily quiz
def get_quiz(org: str, student: str, day: date) -> dict | None:
    return db.fetch_one("SELECT * FROM public.wellness_daily_quiz WHERE org_code = %s AND student_code = %s AND quiz_date = %s",
                        (org, student, day))


def save_quiz(org: str, student: str, day: date, question: dict) -> dict:
    return db.fetch_one("INSERT INTO public.wellness_daily_quiz (org_code, student_code, quiz_date, question) VALUES (%s,%s,%s,%s) "
                        "ON CONFLICT (org_code, student_code, quiz_date) DO UPDATE SET question = public.wellness_daily_quiz.question "
                        "RETURNING *", (org, student, day, Jsonb(question)))


def answer_quiz(org: str, student: str, day: date, idx: int, correct: bool) -> bool:
    with db.connection() as conn:
        return conn.execute("UPDATE public.wellness_daily_quiz SET answer_idx = %s, is_correct = %s, answered_at = NOW() "
                            "WHERE org_code = %s AND student_code = %s AND quiz_date = %s AND answer_idx IS NULL",
                            (idx, correct, org, student, day)).rowcount > 0


# ─────────────────────────────────────────────────────────────── dashboard
def dashboard_stats(org: str, student: str) -> dict:
    s = db.fetch_one("SELECT COUNT(*)::int AS n, ROUND(AVG(stress_input))::int AS avg_stress FROM public.wellness_journals "
                     "WHERE org_code = %s AND student_code = %s", (org, student))
    trend = db.fetch_all("SELECT journal_id, mood_score, created_at FROM (SELECT * FROM public.wellness_journals WHERE org_code = %s "
                         "AND student_code = %s ORDER BY created_at DESC LIMIT 7) t ORDER BY created_at", (org, student))
    return {"avgStress": s["avg_stress"] or 0, "journalsCount": s["n"],
            "moodTrend": [{"id": str(r["journal_id"]), "date": _iso(r["created_at"]), "mood": r["mood_score"]} for r in trend]}


# ─────────────────────────────────────────────────────────────── teacher aggregates (no free text ever)
def class_overview(org: str, class_code: str, days: int) -> list[dict]:
    return db.fetch_all(
        """
        SELECT u.user_code, u.full_name, u.roll_number,
               p.level, p.total_xp, p.breath_cycles, (p.student_code IS NOT NULL) AS has_profile,
               j.entries, j.checkins, j.avg_stress, j.avg_mood, j.last_entry,
               (SELECT mood_score FROM public.wellness_journals x WHERE x.org_code = u.org_code AND x.student_code = u.user_code
                ORDER BY created_at DESC LIMIT 1) AS latest_mood,
               (SELECT COALESCE(json_agg(t.mood_score ORDER BY t.created_at), '[]'::json) FROM (
                   SELECT mood_score, created_at FROM public.wellness_journals x WHERE x.org_code = u.org_code
                   AND x.student_code = u.user_code ORDER BY created_at DESC LIMIT 7) t) AS mood_trend,
               g.crisis, g.alerts_open, g.alerts_total, a.last_activity
        FROM public.app_users u
        LEFT JOIN public.wellness_profiles p ON p.org_code = u.org_code AND p.student_code = u.user_code
        LEFT JOIN LATERAL (
            SELECT COUNT(*) FILTER (WHERE kind = 'journal')::int AS entries, COUNT(*) FILTER (WHERE kind = 'checkin')::int AS checkins,
                   ROUND(AVG(stress_input))::int AS avg_stress, ROUND(AVG(mood_score))::int AS avg_mood, MAX(created_at) AS last_entry
            FROM public.wellness_journals x WHERE x.org_code = u.org_code AND x.student_code = u.user_code
              AND x.created_at >= NOW() - make_interval(days => %s)) j ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*) FILTER (WHERE guardrail_type = 'crisis_self_harm')::int AS crisis,
                   COUNT(*) FILTER (WHERE acknowledged_at IS NULL AND severity IN ('CRITICAL', 'HIGH', 'MEDIUM'))::int AS alerts_open,
                   COUNT(*)::int AS alerts_total
            FROM public.wellness_guardrail_events e WHERE e.org_code = u.org_code AND e.student_code = u.user_code
              AND e.created_at >= NOW() - make_interval(days => %s)) g ON TRUE
        LEFT JOIN LATERAL (
            SELECT MAX(created_at) AS last_activity FROM public.wellness_xp_events v
            WHERE v.org_code = u.org_code AND v.student_code = u.user_code) a ON TRUE
        WHERE u.org_code = %s AND u.class_code = %s AND u.user_role = 'student' AND u.is_active
        ORDER BY u.roll_number NULLS LAST, u.full_name
        """, (days, days, org, class_code))


def class_triggers(org: str, class_code: str, days: int, limit: int = 8) -> list[dict]:
    return db.fetch_all(
        "SELECT trig AS trigger, COUNT(*)::int AS count FROM public.wellness_journals j JOIN public.app_users u "
        "ON u.org_code = j.org_code AND u.user_code = j.student_code, jsonb_array_elements_text(j.analysis->'triggers') trig "
        "WHERE j.org_code = %s AND u.class_code = %s AND j.kind = 'journal' AND j.created_at >= NOW() - make_interval(days => %s) "
        "GROUP BY trig ORDER BY count DESC LIMIT %s", (org, class_code, days, limit))


def student_detail(org: str, student: str, days: int) -> dict:
    series = db.fetch_all("SELECT created_at, mood_score, stress_input, kind FROM public.wellness_journals WHERE org_code = %s "
                          "AND student_code = %s AND created_at >= NOW() - make_interval(days => %s) ORDER BY created_at",
                          (org, student, days))
    triggers = db.fetch_all("SELECT trig AS trigger, COUNT(*)::int AS count FROM public.wellness_journals j, "
                            "jsonb_array_elements_text(j.analysis->'triggers') trig WHERE j.org_code = %s AND j.student_code = %s "
                            "AND j.kind = 'journal' AND j.created_at >= NOW() - make_interval(days => %s) GROUP BY trig "
                            "ORDER BY count DESC LIMIT 10", (org, student, days))
    activity = db.fetch_all("SELECT activity, COUNT(*)::int AS count, SUM(xp)::int AS xp FROM public.wellness_xp_events "
                            "WHERE org_code = %s AND student_code = %s AND created_at >= NOW() - make_interval(days => %s) "
                            "GROUP BY activity ORDER BY count DESC", (org, student, days))
    alerts = db.fetch_all("SELECT event_id, guardrail_type, severity, created_at, acknowledged_at, acknowledged_by "
                          "FROM public.wellness_guardrail_events WHERE org_code = %s AND student_code = %s "
                          "ORDER BY created_at DESC LIMIT 50", (org, student))
    return {
        "series": [{"date": _iso(r["created_at"]), "mood": r["mood_score"], "stress": r["stress_input"], "kind": r["kind"]} for r in series],
        "triggers": triggers, "activity": activity,
        "alerts": [{"id": a["event_id"], "type": a["guardrail_type"], "severity": a["severity"], "date": _iso(a["created_at"]),
                    "acknowledgedAt": _iso(a["acknowledged_at"]), "acknowledgedBy": a["acknowledged_by"]} for a in alerts],
    }


def acknowledge_alert(org: str, event_id: int, teacher: str, class_codes: set[str]) -> bool:
    with db.connection() as conn:
        return conn.execute(
            "UPDATE public.wellness_guardrail_events e SET acknowledged_at = NOW(), acknowledged_by = %s FROM public.app_users u "
            "WHERE e.event_id = %s AND e.org_code = %s AND u.org_code = e.org_code AND u.user_code = e.student_code "
            "AND u.class_code = ANY(%s) AND e.acknowledged_at IS NULL", (teacher, event_id, org, list(class_codes))).rowcount > 0
