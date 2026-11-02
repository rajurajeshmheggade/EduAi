"""Syllabus text import: turn a pasted outline into chapters with sub-topics.

    Chapter 1: Motion            -> chapter "Motion"
      - Distance and displacement -> topic (indented, or starting with - * • –)
      1.2 Speed and velocity      -> topic (numbered like 1.2)
    2. Force and laws of motion  -> chapter "Force and laws of motion"

Chapter numbering prefixes ("Chapter 3:", "Ch. 3 -", "Unit 2.", "3)", "3.") are stripped; positions decide order.
"""
from __future__ import annotations

import re

MAX_TITLE = 300
_BULLET = re.compile(r"^[-*•–·]\s*")
_SUBNUM = re.compile(r"^\d+\.\d+[.)]?\s+")
_CHAPTER_PREFIX = re.compile(r"^(?:(?:chapter|chap|ch|unit|lesson)\.?\s*\d+\s*[:.)\-–]?\s*|\d+\s*[.):\-–]\s*)", re.I)


def parse_outline(text: str) -> list[dict]:
    """[{title, topics: [str]}]. Raises ValueError for a topic before any chapter or an over-long line."""
    chapters: list[dict] = []
    for n, raw in enumerate(text.splitlines(), 1):
        if not raw.strip():
            continue
        line = raw.strip()
        is_topic = raw[:1] in (" ", "\t") or bool(_BULLET.match(line)) or bool(_SUBNUM.match(line))
        if is_topic:
            title = _SUBNUM.sub("", _BULLET.sub("", line)).strip()
            if not chapters:
                raise ValueError(f"Line {n}: a sub-topic needs a chapter line above it")
            target = chapters[-1]["topics"]
        else:
            title = _CHAPTER_PREFIX.sub("", line).strip() or line
            chapters.append({"title": "", "topics": []})
            target = None
        if len(title) > MAX_TITLE:
            raise ValueError(f"Line {n}: keep titles under {MAX_TITLE} characters")
        if target is None:
            chapters[-1]["title"] = title
        elif title:
            target.append(title)
    return chapters
