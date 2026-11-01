"""Tunables (spec Appendix A), the universal proctoring flag catalogue (§6.2) and presets (§6.3).

The server is the authority: severity, points and caps come from here, never from the client. The client gets the
effective rule set (enabled rules, scaled durations) in GET /session so its sensors use the same thresholds.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

TUNABLES = {
    "exam_token_ttl_minutes": 240, "dob_attempts": 3, "supervisor_auth_attempts": 5, "grace_seconds": 30,
    "require_camera": True, "require_screen_share": True, "record_video": False,
    "preset": "standard", "max_warnings": 5, "critical_limit": 3, "auto_submit_below": 30,
    "calibration_seconds": 60, "face_fps": 2, "object_fps": 0.5,
    "face_match_interval_s": 30,
    # Max Euclidean distance between face-api descriptors of the ID photo and the live face (library default 0.6).
    # Calibrate on a small labelled set before go-live.
    "face_match_threshold": 0.6,
    "voice_db": 15, "presence_snapshot_s": 60, "max_evidence_per_session": 200,
    "max_events_per_minute": 240, "max_answer_chars": 5000, "evidence_retention_days": 90,
    "hq_sjt_items": 10, "hq_reflective_items": 2,
    "w_academic": 0.70, "w_hq": 0.30,
    "bands": {"strong": 75, "recommended": 60, "borderline": 45},
    "integrity_bands": {"high": 85, "moderate": 60},
    "heartbeat_missing_s": 30,
}

Severity = Literal["Info", "Low", "Med", "High", "Crit"]
WarnMode = Literal["always", "third", "never"]
Evidence = Literal["webcam", "screen", "webcam_first"] | None


@dataclass(frozen=True)
class Flag:
    label: str
    severity: Severity
    points: float
    cap: float
    warn: WarnMode            # always: High/Crit "Warn"; third: Medium, counts from the 3rd occurrence; never
    pause: bool = False       # blocks the questions until fixed (timer keeps running)
    evidence: Evidence = None
    duration_s: float = 0     # how long the condition must hold (client rules; scaled by preset)
    extra_every_s: float = 0  # +1 point per this many seconds beyond the trigger (TAB_HIDDEN, NO_FACE)
    server: bool = False      # raised by the server only


FLAGS: dict[str, Flag] = {
    "FULLSCREEN_EXIT": Flag("Left full screen", "High", 8, 24, "always", pause=True, evidence="webcam"),
    "TAB_HIDDEN": Flag("Switched tab or minimised", "High", 10, 30, "always", evidence="webcam", extra_every_s=10),
    "WINDOW_BLUR": Flag("Focus moved to another app", "Med", 5, 20, "third", evidence="screen", duration_s=1.5),
    "MULTI_MONITOR": Flag("Second screen attached", "High", 15, 30, "always", pause=True, evidence="screen"),
    "SCREEN_SHARE_STOPPED": Flag("Screen sharing ended", "Crit", 15, 30, "always", pause=True),
    "CAMERA_LOST": Flag("Camera stopped", "Crit", 15, 30, "always", pause=True),
    "CAMERA_BLOCKED": Flag("Camera covered or dark", "High", 10, 30, "always", evidence="webcam", duration_s=3),
    "NO_FACE": Flag("Candidate not visible", "High", 8, 32, "always", evidence="webcam", duration_s=5, extra_every_s=10),
    "MULTIPLE_FACES": Flag("Another person present", "Crit", 20, 40, "always", evidence="webcam", duration_s=2),
    "FACE_MISMATCH": Flag("Different person from the ID photo", "Crit", 25, 50, "always", evidence="webcam"),
    "LOOKING_AWAY": Flag("Head turned away", "Med", 3, 18, "third", evidence="webcam_first", duration_s=4),
    "PHONE_DETECTED": Flag("Phone in view", "Crit", 20, 40, "always", evidence="webcam"),
    "BOOK_OR_PAPER": Flag("Book or notes in view", "Med", 6, 18, "third", evidence="webcam"),
    "EXTRA_DEVICE": Flag("Laptop or monitor in view", "High", 10, 20, "always", evidence="webcam"),
    "VOICE_DETECTED": Flag("Talking or whispering", "Med", 4, 20, "third", duration_s=3),
    "COPY_PASTE": Flag("Copy, cut or paste attempt", "Med", 4, 16, "third"),
    "PASTE_BURST": Flag("Text inserted without typing", "High", 10, 30, "always", evidence="screen"),
    "BLOCKED_SHORTCUT": Flag("Forbidden key combination", "Low", 2, 10, "never"),
    "CONTEXT_MENU": Flag("Right-click", "Low", 1, 5, "never"),
    "PRINT_ATTEMPT": Flag("Tried to print", "Med", 5, 10, "third"),
    "DEVTOOLS_SUSPECTED": Flag("Developer tools likely open", "Med", 6, 18, "third", evidence="screen"),
    "WINDOW_RESIZED": Flag("Window not full size", "Med", 4, 12, "third", duration_s=3),
    "EXTENSION_INJECTION": Flag("Page modified by an extension", "Med", 6, 18, "third", evidence="screen"),
    # A dropped connection is not a behaviour: it deducts (capped) but never counts as a warning.
    "NETWORK_OFFLINE": Flag("Connection dropped", "Med", 3, 12, "never"),
    "HEARTBEAT_MISSING": Flag("Proctoring stopped reporting", "High", 10, 30, "always", server=True),
    "SECOND_SESSION": Flag("Exam opened in another tab or device", "Crit", 20, 40, "always"),
    "PORTAL_ACCESS_ATTEMPT": Flag("Tried to open the EduAI portal", "High", 10, 30, "always", evidence="screen"),
    "SUPERVISOR_AUTH_FAILED": Flag("Wrong supervisor password", "Med", 5, 15, "third", server=True),
    "PAGE_RELOAD": Flag("Page reloaded or resumed", "Low", 2, 10, "never"),
    "TIME_ANOMALY": Flag("Implausibly fast answers", "Info", 0, 0, "never", server=True),
    # Not flags: sparse presence snapshots and degraded sensing are recorded for the report only.
    "PRESENCE_SNAPSHOT": Flag("Presence snapshot", "Info", 0, 0, "never"),
    "PERF_DEGRADED": Flag("Proctoring slowed down", "Info", 0, 0, "never"),
}
CLIENT_CODES = {c for c, f in FLAGS.items() if not f.server}
NOT_FLAGS = {"PRESENCE_SNAPSHOT", "PERF_DEGRADED"}

# Presets scale points / durations and set the limits (§6.3).
PRESETS: dict[str, dict] = {
    "strict": {"points": 1.25, "durations": 0.75, "max_warnings": 3, "critical_limit": 2, "auto_submit_below": 40},
    "standard": {"points": 1.0, "durations": 1.0, "max_warnings": 5, "critical_limit": 3, "auto_submit_below": 30},
    "lenient": {"points": 0.75, "durations": 1.5, "max_warnings": 7, "critical_limit": 4, "auto_submit_below": 20},
}


def default_proctoring() -> dict:
    return {"preset": TUNABLES["preset"], "require_camera": TUNABLES["require_camera"],
            "require_screen_share": TUNABLES["require_screen_share"],
            "rules": {c: True for c in FLAGS if c not in NOT_FLAGS}}


def default_scoring() -> dict:
    return {"w_academic": TUNABLES["w_academic"], "w_hq": TUNABLES["w_hq"], "bands": dict(TUNABLES["bands"])}


def effective(proctoring: dict | None) -> dict:
    """Merged, validated proctoring settings for one test."""
    p = {**default_proctoring(), **(proctoring or {})}
    preset = PRESETS.get(p.get("preset") or "standard", PRESETS["standard"])
    rules = {c: bool((p.get("rules") or {}).get(c, True)) for c in FLAGS if c not in NOT_FLAGS}
    return {
        "preset": p.get("preset") if p.get("preset") in PRESETS else "standard",
        "points": preset["points"], "durations": preset["durations"],
        "max_warnings": preset["max_warnings"], "critical_limit": preset["critical_limit"],
        "auto_submit_below": preset["auto_submit_below"],
        "calibration_seconds": TUNABLES["calibration_seconds"],
        "require_camera": bool(p.get("require_camera", True)), "require_screen_share": bool(p.get("require_screen_share", True)),
        "rules": rules,
    }


def client_rules(proctoring: dict | None, *, disable_voice: bool = False) -> dict:
    """What the exam view needs to run its sensors with the same thresholds the server scores with."""
    e = effective(proctoring)
    flags = {}
    for code, f in FLAGS.items():
        if f.server or code in NOT_FLAGS:
            continue
        enabled = e["rules"].get(code, True) and not (code == "VOICE_DETECTED" and disable_voice)
        flags[code] = {"enabled": enabled, "label": f.label, "severity": f.severity, "warn": f.warn, "pause": f.pause,
                       "evidence": f.evidence, "duration_ms": round(f.duration_s * e["durations"] * 1000)}
    t = TUNABLES
    return {"preset": e["preset"], "max_warnings": e["max_warnings"], "calibration_seconds": e["calibration_seconds"],
            "require_camera": e["require_camera"], "require_screen_share": e["require_screen_share"],
            "face_fps": t["face_fps"], "object_fps": t["object_fps"], "face_match_interval_s": t["face_match_interval_s"],
            "face_match_threshold": t["face_match_threshold"], "voice_db": t["voice_db"],
            "presence_snapshot_s": t["presence_snapshot_s"], "flags": flags}
