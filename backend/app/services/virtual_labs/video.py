"""Video completion for Virtual Labs: watching the lab's video(s) to the end unlocks Submit.

The browser reports the parts of a video it has actually played (merged [start, end] intervals — seeking adds
nothing) plus the duration, the playhead and whether the player reached its `ended` state. The server never takes the
client's word for how much was watched in one go:

  * coverage = the union of every reported interval, clipped to the duration (re-watching a part counts once);
  * credited watched time may grow by at most (time since the previous report) x MAX_RATE (the player's top speed),
    plus a little slack on the first report — so a fabricated "I watched it all" report only earns real elapsed time;
  * the duration is fixed by the first report (or the catalogue's own duration when that is longer) and later reports
    must agree with it;
  * complete = the end was reached AND credited time >= COMPLETE_RATIO x duration (seeking to the end does not count).
"""
from __future__ import annotations

from datetime import datetime

COMPLETE_RATIO = 0.9       # share of the video that must really have been played
MAX_RATE = 2.0             # fastest playback speed the in-app players allow
FIRST_SLACK = 3.0          # seconds credited on the very first report (playback started just before it was sent)
MAX_SEGMENTS = 200
MAX_DURATION = 6 * 3600.0


def merge(segments: list[list[float]] | list[tuple[float, float]], duration: float) -> list[list[float]]:
    """Sorted, merged intervals clipped to [0, duration]; empty / inverted ones dropped. Kept to MAX_SEGMENTS by
    dropping the shortest intervals (losing a little coverage rather than inventing any)."""
    cleaned: list[list[float]] = []
    for seg in segments:
        if len(seg) != 2:
            continue
        s, e = max(0.0, float(seg[0])), min(float(duration), float(seg[1]))
        if e - s > 0.01:
            cleaned.append([round(s, 2), round(e, 2)])
    cleaned.sort()
    out: list[list[float]] = []
    for s, e in cleaned:
        if out and s <= out[-1][1] + 0.05:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    while len(out) > MAX_SEGMENTS:
        i = min(range(len(out)), key=lambda k: out[k][1] - out[k][0])
        out.pop(i)
    return out


def covered(segments: list[list[float]]) -> float:
    return round(sum(e - s for s, e in segments), 2)


def credit(*, previous: float, coverage: float, last_update: datetime | None, now: datetime) -> float:
    """New credited seconds: towards the reported coverage, but no faster than real time at MAX_RATE since the last
    report (FIRST_SLACK on the first report). Never decreases."""
    allowance = FIRST_SLACK if last_update is None else max(0.0, (now - last_update).total_seconds()) * MAX_RATE
    return round(max(previous, min(coverage, previous + allowance)), 2)


def is_complete(*, watched: float, duration: float, reached_end: bool) -> bool:
    return reached_end and duration > 0 and watched >= COMPLETE_RATIO * duration


def duration_matches(pinned: float, reported: float) -> bool:
    return abs(pinned - reported) <= max(3.0, 0.03 * pinned)


def catalogue_duration(resource: dict) -> float | None:
    """The catalogue's own duration of a video (seconds) when it states one."""
    d = resource.get("duration")
    try:
        d = float(d)
    except (TypeError, ValueError):
        return None
    return d if 0 < d <= MAX_DURATION else None


def view(row: dict | None) -> dict | None:
    """Progress of one video as the student and the teacher see it."""
    if not row:
        return None
    duration = float(row["duration_seconds"])
    watched = float(row["watched_seconds"])
    return {"resource_id": row["resource_id"], "duration_seconds": duration, "watched_seconds": watched,
            "coverage": round(min(1.0, watched / duration), 4) if duration else 0.0, "segments": row["segments"],
            "last_position": float(row["last_position"]), "reached_end": row["reached_end"],
            "completed": row["completed_at"] is not None, "completed_at": row["completed_at"]}
