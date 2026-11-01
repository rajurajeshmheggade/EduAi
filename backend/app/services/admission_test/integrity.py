"""Integrity score, warnings and auto-submit, derived from stored proctoring events (spec §6.3 / §6.4).

    integrity = max(0, 100 − Σ_type min(cap_type, Σ points(events of that type)))
    band:  85–100 High · 60–84 Moderate · 0–59 Low

Events inside the calibration window, disabled rules and non-flag records (presence snapshots) never deduct or warn.
Pure functions over plain dicts so they are unit-tested with fixtures; the router recomputes on every batch and at
submit.
"""
from __future__ import annotations

from collections import defaultdict

from .config import FLAGS, NOT_FLAGS, TUNABLES


def band(score: float) -> str:
    b = TUNABLES["integrity_bands"]
    return "High" if score >= b["high"] else "Moderate" if score >= b["moderate"] else "Low"


def event_points(code: str, duration_ms: int | float | None, multiplier: float = 1.0) -> float:
    """Points one event deducts before the per-type cap (TAB_HIDDEN / NO_FACE add 1 per extra 10 s)."""
    f = FLAGS.get(code)
    if not f:
        return 0.0
    pts = f.points
    if f.extra_every_s and duration_ms:
        beyond = max(0.0, float(duration_ms) / 1000 - f.duration_s)
        pts += beyond // f.extra_every_s
    return round(pts * multiplier, 2)


def counts(e: dict, eff: dict) -> bool:
    """Does this event count (deduct / warn)?"""
    code = e["code"]
    return code in FLAGS and code not in NOT_FLAGS and not e.get("calibration") and eff["rules"].get(code, True)


def evaluate(events: list[dict], eff: dict) -> dict:
    """events: [{code, duration_ms, calibration, server_ts?}] in server order; eff: config.effective(...)."""
    totals: dict[str, float] = defaultdict(float)
    occurrences: dict[str, int] = defaultdict(int)
    warnings = critical = mismatches = 0
    for e in events:
        if not counts(e, eff):
            continue
        code = e["code"]
        f = FLAGS[code]
        totals[code] += event_points(code, e.get("duration_ms"), eff["points"])
        occurrences[code] += 1
        if f.warn == "always" or (f.warn == "third" and occurrences[code] >= 3):
            warnings += 1
        if f.severity == "Crit":
            critical += 1
        if code == "FACE_MISMATCH":
            mismatches += 1
    deducted = {code: min(FLAGS[code].cap * eff["points"], pts) for code, pts in totals.items()}
    score = max(0, round(100 - sum(deducted.values())))
    reason = None
    if warnings >= eff["max_warnings"]:
        reason = f"{warnings} warnings (limit {eff['max_warnings']})"
    elif critical >= eff["critical_limit"]:
        reason = f"{critical} critical flags (limit {eff['critical_limit']})"
    elif score < eff["auto_submit_below"]:
        reason = f"integrity {score} below {eff['auto_submit_below']}"
    elif mismatches >= 2:
        reason = "face did not match the ID photo twice"
    return {"score": score, "band": band(score), "warnings": warnings, "critical": critical,
            "deducted": {k: round(v, 2) for k, v in deducted.items()}, "occurrences": dict(occurrences),
            "auto_submit": reason}
