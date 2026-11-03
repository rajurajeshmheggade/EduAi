"""Student proctoring: modules, the rules students acknowledge, the flag catalogue and the per-module thresholds.

The server is the authority on severity: the device only says *what* it detected (a code, when, for how long); the
catalogue below decides how serious it is, escalating long or repeated episodes. Thresholds are per school and per
module (admin console -> Proctoring); anything not overridden uses the defaults here, chosen to keep false positives
low (conditions must hold for several seconds before they count).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Module = Literal["ONLINE_TEST", "VIRTUAL_LAB", "AI_CLASSROOM"]
MODULES: tuple[str, ...] = ("ONLINE_TEST", "VIRTUAL_LAB", "AI_CLASSROOM")
MODULE_LABEL = {"ONLINE_TEST": "Online test", "VIRTUAL_LAB": "Virtual lab", "AI_CLASSROOM": "AI Classroom"}

OPEN = ("PRECHECK", "ACTIVE", "INTERRUPTED")
DONE = ("SUBMITTED", "ENDED_BY_TEACHER", "CLOSED")

# ---------------------------------------------------------------- rules the student acknowledges (spec 2.2)
RULES_VERSION = "2026-11-v1"
RULES = [
    "Keep your face visible throughout the examination.",
    "Ensure adequate lighting.",
    "Do not leave the examination window.",
    "Do not switch tabs or applications.",
    "Do not use unauthorised devices.",
    "Do not communicate with other individuals.",
    "Do not disable camera or microphone permissions.",
    "Follow the examination time limit.",
    "Any suspicious activity may be reported to the teacher.",
]
ACKNOWLEDGEMENT = "I have read and understood all examination rules and instructions."


def notice(retention_days: int) -> dict:
    """Plain-language privacy notice shown with the rules (flags only — nothing visual or audible leaves the device)."""
    return {
        "captured": ["Proctoring flags: what was detected (for example “face not visible” or “switched tab”), "
                     "when, for how long and how serious it is",
                     "Camera and microphone connection status, and the names of the devices you choose",
                     "Whether the exam page is in full screen and in focus"],
        "not_captured": ["No video, photos or images — the camera picture stays on your device",
                         "No audio recording — the microphone is used for a loudness level only",
                         "No face recognition and no emotion analysis"],
        "where": "Detection runs on this device. Only the flags are sent to EduAI.",
        "who_sees": "Your assigned teacher(s). Flags are signals for a teacher to review, not proof of anything.",
        "retention": f"Flags are deleted {retention_days} days after the session ends.",
    }


# ---------------------------------------------------------------- flag catalogue
Severity = Literal["Info", "Low", "Medium", "High", "Critical"]
SEVERITIES: tuple[str, ...] = ("Info", "Low", "Medium", "High", "Critical")
Category = Literal["suspicious", "camera", "presence", "session"]


@dataclass(frozen=True)
class Flag:
    label: str
    severity: Severity
    category: Category
    escalates: bool = False    # long episodes (duration > escalate_after_seconds) go up one level
    repeats: bool = True       # the Nth occurrence in a session (repeat_escalation_count) goes up one level
    server: bool = False       # raised by the server only


FLAGS: dict[str, Flag] = {
    "NO_FACE": Flag("Face not visible", "Medium", "presence", escalates=True),
    "MULTIPLE_FACES": Flag("More than one person in view", "High", "suspicious"),
    "LOOKING_AWAY": Flag("Looking away from the screen for a while", "Low", "suspicious"),
    "PHONE_DETECTED": Flag("Phone in view", "High", "suspicious"),
    "EXTRA_DEVICE": Flag("Another laptop or screen in view", "Medium", "suspicious"),
    "VOICE_DETECTED": Flag("Sustained talking or noise", "Low", "suspicious"),
    "TAB_HIDDEN": Flag("Switched tab or minimised the window", "Medium", "suspicious", escalates=True),
    "WINDOW_BLUR": Flag("Focus moved to another application", "Low", "suspicious"),
    "FULLSCREEN_EXIT": Flag("Left full screen", "Medium", "suspicious"),
    "COPY_PASTE": Flag("Copy, cut or paste", "Low", "suspicious"),
    "CAMERA_BLOCKED": Flag("Camera covered or too dark", "Medium", "camera", escalates=True),
    "CAMERA_LOST": Flag("Camera disconnected or permission removed", "High", "camera"),
    "MIC_LOST": Flag("Microphone disconnected or permission removed", "Medium", "camera"),
    "NETWORK_OFFLINE": Flag("Connection dropped", "Info", "session", repeats=False),
    "SESSION_RESUMED": Flag("Session resumed", "Info", "session", repeats=False),
    "SANCTIONED_AWAY": Flag("Left the page with permission (allowed)", "Info", "session", repeats=False),
    "PERF_DEGRADED": Flag("On-device detection slowed down", "Info", "session", repeats=False),
    "SESSION_LEFT": Flag("Left the exam page", "Medium", "session", server=True),
    "HEARTBEAT_MISSING": Flag("Proctoring stopped reporting (session interrupted)", "High", "session", server=True),
}
CLIENT_CODES = frozenset(c for c, f in FLAGS.items() if not f.server)
# Codes behind the dashboard's "camera issues" / "suspicious activity" indicators.
CAMERA_CODES = frozenset(c for c, f in FLAGS.items() if f.category == "camera")
SUSPICIOUS_CODES = frozenset(c for c, f in FLAGS.items() if f.category == "suspicious")


def level(sev: str) -> int:
    return SEVERITIES.index(sev) if sev in SEVERITIES else 0


def bump(sev: str) -> str:
    return SEVERITIES[min(level(sev) + 1, len(SEVERITIES) - 1)] if sev != "Info" else sev


def severity_for(code: str, duration_ms: int, previous: int, settings: dict) -> str:
    """Base severity, one level up for a long episode and one level up from the Nth occurrence (never above High
    from escalation alone, so Critical always means a High flag that is both long and repeated)."""
    f = FLAGS[code]
    sev = f.severity
    if sev == "Info":
        return sev
    if f.escalates and duration_ms >= settings["escalate_after_seconds"] * 1000:
        sev = bump(sev)
    if f.repeats and previous + 1 >= settings["repeat_escalation_count"]:
        sev = bump(sev)
    return sev if level(sev) <= level("High") or level(f.severity) >= level("High") else "High"


# ---------------------------------------------------------------- thresholds
# (min, max) for numeric settings; booleans and notify_min_severity are validated by the API model.
DEFAULTS: dict = {
    "enabled": True,
    "camera_required": True,
    "mic_required": False,
    "fullscreen_required": False,
    "detect_multiple_faces": True,
    "detect_looking_away": False,
    "detect_objects": True,
    "detect_voice": False,
    "no_face_seconds": 8,
    "multiple_faces_seconds": 3,
    "looking_away_seconds": 8,
    "camera_blocked_seconds": 5,
    "window_blur_seconds": 3,
    "voice_seconds": 5,
    "voice_db": 18,
    "object_min_confidence": 0.6,
    "escalate_after_seconds": 30,
    "repeat_escalation_count": 3,
    "heartbeat_missing_seconds": 45,
    "notify_on_start": True,
    "notify_min_severity": "High",
    "notify_cooldown_seconds": 120,
    "teacher_can_end": True,
    "retention_days": 180,
}
# Online tests are the strictest; Virtual Labs may send the student to DIKSHA's player in another tab (allowed and
# logged as SANCTIONED_AWAY); AI Classroom is study time, so object detection and the microphone stay off and a
# session start is shown on the live dashboard without a bell notification.
MODULE_DEFAULTS: dict[str, dict] = {
    "ONLINE_TEST": {"mic_required": True, "fullscreen_required": True, "detect_voice": True},
    "VIRTUAL_LAB": {},
    "AI_CLASSROOM": {"detect_objects": False, "notify_on_start": False, "notify_min_severity": "Critical"},
}
NUMERIC_LIMITS: dict[str, tuple[float, float]] = {
    "no_face_seconds": (2, 120), "multiple_faces_seconds": (1, 60), "looking_away_seconds": (2, 120),
    "camera_blocked_seconds": (1, 60), "window_blur_seconds": (1, 60), "voice_seconds": (1, 60), "voice_db": (6, 40),
    "object_min_confidence": (0.3, 0.95), "escalate_after_seconds": (5, 600), "repeat_escalation_count": (2, 20),
    "heartbeat_missing_seconds": (20, 600), "notify_cooldown_seconds": (0, 3600), "retention_days": (7, 730),
}


def defaults_for(module: str) -> dict:
    return {**DEFAULTS, **MODULE_DEFAULTS.get(module, {})}


def merge(module: str, overrides: dict | None) -> dict:
    """Effective settings: module defaults overlaid with the saved overrides (unknown / invalid keys are ignored)."""
    out = defaults_for(module)
    for k, v in (overrides or {}).items():
        if k not in out:
            continue
        if isinstance(out[k], bool):
            if isinstance(v, bool):
                out[k] = v
        elif k == "notify_min_severity":
            if v in SEVERITIES:
                out[k] = v
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            lo, hi = NUMERIC_LIMITS.get(k, (float("-inf"), float("inf")))
            out[k] = type(out[k])(min(max(v, lo), hi))
    return out


def client_rules(settings: dict) -> dict:
    """What the student's device needs to run its detectors with the thresholds the server uses."""
    s = settings
    return {
        "camera_required": s["camera_required"], "mic_required": s["mic_required"], "fullscreen_required": s["fullscreen_required"],
        "detect_multiple_faces": s["detect_multiple_faces"], "detect_looking_away": s["detect_looking_away"],
        "detect_objects": s["detect_objects"], "detect_voice": s["detect_voice"],
        "durations_ms": {"NO_FACE": s["no_face_seconds"] * 1000, "MULTIPLE_FACES": s["multiple_faces_seconds"] * 1000,
                         "LOOKING_AWAY": s["looking_away_seconds"] * 1000, "CAMERA_BLOCKED": s["camera_blocked_seconds"] * 1000,
                         "WINDOW_BLUR": s["window_blur_seconds"] * 1000, "VOICE_DETECTED": s["voice_seconds"] * 1000},
        "voice_db": s["voice_db"], "object_min_confidence": s["object_min_confidence"],
        "heartbeat_seconds": 10, "face_fps": 2, "object_fps": 0.5,
        "labels": {c: f.label for c, f in FLAGS.items()},
    }
