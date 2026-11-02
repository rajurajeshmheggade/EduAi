"""AI avatar tutor — explains one textbook page the way a teacher would (NCERT style).

The page text (only the page text: no student data) goes to the tutor LLM (AI_TUTOR_PROVIDER / PROVIDER_MODE), which
returns a structured lesson: an introduction, every key point of the page explained in classroom language, important
terms, a recap and one check question. Each key point carries a short exact quote from the page so the reader can
highlight what is being explained. In mock mode (or if the AI fails) an offline extractive lesson is built instead.
The lesson is turned into a spoken script for the avatar.
"""
from __future__ import annotations

import json
import logging
import re

from ..providers import get_tutor_llm

log = logging.getLogger("eduai.tutor")

PROMPT_VERSION = "lesson-v3"
MAX_PAGE_CHARS = 6000

SYSTEM = """You are an experienced, warm school teacher in India. You are explaining ONE page of an NCERT-style textbook
out loud to your {grade} students, as you would in class.

Rules:
- Use only what is on the page. Do not add facts that are not there.
- Cover EVERY key point on the page, in the order the page presents them. Do not skip any.
- Talk directly to your students, warmly, the way a good teacher does in class: "Let us see…", "Imagine…",
  "Notice that…", "You may wonder…". Simple words, short clear sentences.
- For every key point, explain WHY or HOW, not just what, and give a simple everyday example or comparison that an
  Indian student would recognise wherever it helps understanding.
- Write for listening: no markdown, bullets, emojis or symbols. Write numbers, years and units the way a teacher says
  them (for example "seventeen eighty-nine", "twenty per cent", "nine point eight metres per second squared").
  Expand abbreviations.
- Never start with "This page discusses" or "This page explores". Sound like a person teaching, not a summary.

Example of the voice to use (a different topic, for tone only):
  intro: "Let us look at this page together. Here we will find out why things fall to the ground, and why it matters
  in our daily life."
  explanation: "Imagine you drop a ball from your hand. It falls down, doesn't it? That happens because the Earth pulls
  everything towards itself. We call this pull gravity. So the next time you see a mango fall from a tree, remember,
  it is gravity at work."

- If the page is a contents page, index, credits page, a page of pictures or an exercise page, say so briefly and
  explain what it is for. For exercises, explain how to approach each question without giving the final answers.

Return JSON only:
{{"title": "short title of the page",
 "intro": "2-3 sentences: what this page is about and why it matters",
 "key_points": [{{"heading": "3-8 words", "explanation": "3-6 sentences, as you would explain it in class",
                 "quote": "5-12 consecutive words copied exactly from the page that this point explains"}}],
 "terms": [{{"term": "an important word on the page", "meaning": "its meaning in one simple sentence"}}],
 "recap": "2-3 sentences summing up the page",
 "question": "one short question to check understanding"}}"""

_CUES = re.compile(r"\b(is called|are called|is known as|are known as|refers? to|means|is defined|was|were|led to|"
                   r"resulted in|because|therefore|thus|important|main|first|began)\b", re.I)


def _grade(tb: dict) -> str:
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\b", f"{tb.get('class_code') or ''} {tb.get('title') or ''}")
    return f"Class {m.group(1)}" if m and 1 <= int(m.group(1)) <= 12 else "school"


def _s(v: object, n: int) -> str:
    return " ".join(str(v or "").split())[:n]


def clean_lesson(d: dict) -> dict:
    """Validates / trims the LLM's JSON into the lesson shape the reader uses."""
    kps = [{"heading": _s(k.get("heading"), 120), "explanation": _s(k.get("explanation"), 1500), "quote": _s(k.get("quote"), 200)}
           for k in (d.get("key_points") or [])[:12] if isinstance(k, dict) and _s(k.get("explanation"), 10)]
    terms = [{"term": _s(t.get("term"), 80), "meaning": _s(t.get("meaning"), 300)}
             for t in (d.get("terms") or [])[:8] if isinstance(t, dict) and _s(t.get("term"), 2) and _s(t.get("meaning"), 2)]
    return {"title": _s(d.get("title"), 160), "intro": _s(d.get("intro"), 900), "key_points": kps, "terms": terms,
            "recap": _s(d.get("recap"), 900), "question": _s(d.get("question"), 300)}


def extractive_lesson(paras: list[str], sents: list[str], page: int, chapter: str | None) -> dict:
    """Offline lesson: headings and the most informative sentences of the page, in page order."""
    headings = [p[:-1] for p in paras if len(p) < 90 and p.endswith(".") and p.count(". ") == 0 and len(p.split()) <= 12]
    body = [s for s in sents if len(s) > 40 and s.rstrip(".") not in headings]
    ranked = sorted(range(len(body)), key=lambda i: (-(len(_CUES.findall(body[i])) * 2 + (1 if 60 < len(body[i]) < 260 else 0)), i))
    picks = sorted(ranked[:5])
    where = f"of the chapter {chapter}" if chapter else "of our textbook"
    about = f" It is about {headings[0]}." if headings else ""
    if not body:
        return {"title": headings[0] if headings else f"Page {page}", "intro": f"Page {page} has very little text to explain. "
                "It may be a picture, a title or a blank page. Look at it carefully, and then we will move on.",
                "key_points": [], "terms": [], "recap": "", "question": ""}
    kps = [{"heading": " ".join(body[i].split()[:6]).rstrip(",;:"), "explanation": body[i], "quote": " ".join(body[i].split()[:9])}
           for i in picks]
    return {"title": headings[0] if headings else f"Page {page}",
            "intro": f"Let us understand page {page} {where}.{about} Listen carefully to the main points.",
            "key_points": kps, "terms": [],
            "recap": "Those are the main points of this page. Read the page once more on your own to remember them.",
            "question": f"Can you explain {headings[0].lower()} in your own words?" if headings else ""}


def generate(tb: dict, page: int, paras: list[str], sents: list[str], chapter: str | None) -> tuple[dict, str]:
    """(lesson, engine label). Falls back to the offline lesson in mock mode or when the AI call fails."""
    llm = get_tutor_llm()
    if llm.name.startswith("mock") or not sents:
        return extractive_lesson(paras, sents, page, chapter), "offline"
    text = "\n\n".join(paras)[:MAX_PAGE_CHARS]
    user = (f"Book: {tb['title']}\nChapter: {chapter or 'not known'}\nPage {page} of {tb['total_pages']}.\n\n"
            f"PAGE TEXT:\n{text}")
    try:
        raw = llm.chat(SYSTEM.format(grade=_grade(tb)), [{"role": "user", "content": user}], json_mode=True, temperature=0.5)
        lesson = clean_lesson(json.loads(raw))
        if not (lesson["intro"] or lesson["key_points"]):
            raise ValueError("empty lesson")
        return lesson, llm.name
    except Exception as e:  # noqa: BLE001 — the student still gets an explanation
        log.warning("AI tutor lesson failed for %s p%s: %s", tb["textbook_id"], page, type(e).__name__)
        return extractive_lesson(paras, sents, page, chapter), "offline-fallback"


ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"]


def script(lesson: dict) -> list[dict]:
    """Lesson -> spoken parts [{text, quote, point}] in the order the avatar says them."""
    parts: list[dict] = []
    if lesson["intro"]:
        parts.append({"text": lesson["intro"], "quote": None, "point": None})
    n = len(lesson["key_points"])
    for i, k in enumerate(lesson["key_points"]):
        lead = "Finally" if i == n - 1 and n > 2 else ORDINALS[i] if i < len(ORDINALS) else "Next"
        head = k["heading"].rstrip(". ")
        parts.append({"text": f"{lead}, {head}. {k['explanation']}" if head else f"{lead}, {k['explanation']}",
                      "quote": k["quote"] or None, "point": i})
    if lesson["terms"]:
        words = " ".join(f"{t['term']} means {t['meaning'].rstrip('. ')}." for t in lesson["terms"])
        parts.append({"text": f"Let us remember some important words. {words}", "quote": None, "point": None})
    if lesson["recap"]:
        parts.append({"text": f"To sum up. {lesson['recap']}", "quote": None, "point": None})
    if lesson["question"]:
        parts.append({"text": f"Here is a question for you. {lesson['question']} Think about it, and ask me in the chat "
                              "below if you need help.", "quote": None, "point": None})
    return parts
