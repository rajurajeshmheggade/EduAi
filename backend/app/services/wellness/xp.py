"""Server-authoritative XP & levels (MindAlign gamification, moved off the client).

MindAlign kept XP in localStorage, so any student could set their own level. Here every award is a row in
wellness_xp_events with a FIXED amount per activity and a daily cap, applied in one transaction with a row lock on
the profile. Level rule is MindAlign's: `level * 100` XP to level up, XP carries over, one level per award.
"""
from __future__ import annotations

from typing import Any

from ... import db

# activity → (xp, daily cap). Amounts are MindAlign's.
XP_RULES: dict[str, tuple[int, int]] = {
    "mood_checkin": (15, 10),
    "journal": (40, 10),
    "coping_task": (20, 30),
    "breathing_cycle": (30, 20),
    "pomodoro": (50, 12),
    "balloon_pop": (10, 100),
    "stress_quest": (50, 10),
    "quiz_correct": (25, 1),
    "quiz_participation": (10, 1),
}
# Activities the browser may report directly (the rest are awarded by their own endpoints).
CLIENT_ACTIVITIES = {"breathing_cycle", "pomodoro", "balloon_pop", "stress_quest"}
LEVEL_TITLES = {1: "Mindful Rookie", 2: "Zen Scholar", 3: "Focus Guru", 4: "Calm Conqueror"}


def level_title(level: int) -> str:
    return LEVEL_TITLES.get(level, "Ascended Sage")


def xp_state(profile: dict) -> dict[str, Any]:
    level = int(profile["level"])
    return {"xp": int(profile["xp"]), "level": level, "levelTitle": level_title(level), "xpToNext": level * 100,
            "totalXp": int(profile["total_xp"])}


def award(org: str, student: str, activity: str, details: str | None = None) -> dict[str, Any]:
    """Award XP for one activity. Returns {awarded, leveledUp, capped, ...xp_state}."""
    amount, cap = XP_RULES[activity]
    with db.connection() as conn:
        prof = conn.execute("SELECT xp, level, total_xp, breath_cycles FROM public.wellness_profiles WHERE org_code = %s "
                            "AND student_code = %s FOR UPDATE", (org, student)).fetchone()
        if not prof:
            return {"awarded": 0, "leveledUp": False, "capped": False, "xp": 0, "level": 1, "levelTitle": level_title(1),
                    "xpToNext": 100, "totalXp": 0}
        today = conn.execute("SELECT COUNT(*) AS n FROM public.wellness_xp_events WHERE org_code = %s AND student_code = %s "
                             "AND activity = %s AND created_at >= date_trunc('day', NOW())", (org, student, activity)).fetchone()["n"]
        if today >= cap:
            return {"awarded": 0, "leveledUp": False, "capped": True, **xp_state(prof)}
        xp, level = int(prof["xp"]) + amount, int(prof["level"])
        leveled = False
        if xp >= level * 100:
            xp -= level * 100
            level += 1
            leveled = True
        conn.execute("INSERT INTO public.wellness_xp_events (org_code, student_code, activity, xp, details) VALUES (%s,%s,%s,%s,%s)",
                     (org, student, activity, amount, (details or "")[:200] or None))
        new = conn.execute(
            "UPDATE public.wellness_profiles SET xp = %s, level = %s, total_xp = total_xp + %s, "
            "breath_cycles = breath_cycles + %s, updated_at = NOW() WHERE org_code = %s AND student_code = %s "
            "RETURNING xp, level, total_xp, breath_cycles",
            (xp, level, amount, 1 if activity == "breathing_cycle" else 0, org, student)).fetchone()
    return {"awarded": amount, "leveledUp": leveled, "capped": False, **xp_state(new)}
