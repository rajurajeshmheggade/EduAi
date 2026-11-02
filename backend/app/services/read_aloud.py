"""AI avatar tutor — explains (or reads) the open textbook page aloud.

* Page text comes straight from the PDF page layout (not the overlapping RAG chunks), is cleaned for listening
  (running headers, page numbers, reprint footers and line-wrap hyphens removed; headings detected by type size get a
  pause).
* mode "explain" (default): the AI tutor turns the page into a teacher's explanation (services.page_lesson);
  mode "read": the page is read word for word.
* The script is split into sentence segments of about TTS_SEGMENT_CHARS characters (the very first one is a single
  sentence so speech starts quickly). The client plays segment by segment; the server pre-voices the rest of the page
  and prepares the next page in the background.
* Text is made speakable before synthesis ("e.g." -> "for example", "1789" -> "seventeen eighty-nine", units …).
* Voice follows the subject teacher: male when the teacher's gender is 'male', otherwise female.
* Scripts and synthesised audio are cached in storage, so a page is explained and voiced once per engine / voice.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from .. import db
from ..config import get_settings
from ..providers.speech import Voice, get_speech
from ..security import CurrentUser
from . import page_lesson
from .storage import get_storage

log = logging.getLogger("eduai.read_aloud")

Mode = Literal["explain", "read"]
CACHE_VERSION = "v2"
MAX_SEGMENTS = 60
FIRST_SEGMENT_CHARS = 140

_NOISE = re.compile(r"^(?:\d{1,4}|page\s+\d+.*|reprint\s*\d{4}.*|©.*|not to be republished.*)$", re.I)
_TERMINAL = re.compile(r"[.!?।:;][\"'”’)]*$")
_SPLIT = re.compile(r"(?<=[.!?।])[\"'”’)]*\s+(?=[\"'“‘(\[]?[A-Z0-9ऀ-෿])")
_ABBR = re.compile(r"\b(?:e\.g|i\.e|etc|vs|viz|cf|approx|Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Fig|Figs|No|Nos|Vol|Ch|Eq|Art|[A-Z])\.$")
MARGIN = 0.07   # page-edge band holding running headers, page numbers and reprint footers


def paragraphs(page: dict) -> list[str]:
    """PyMuPDF `page.get_text("dict")` -> paragraphs to read: running headers / footers / page numbers dropped,
    headings (larger or bold type) kept as their own paragraph so the voice pauses after them."""
    w, h = page["width"] or 1, page["height"] or 1
    lines: list[tuple[int, str, float, bool, float, float]] = []
    weight: dict[float, int] = {}
    for bi, block in enumerate(page["blocks"]):
        if block.get("type", 0) != 0:      # image block
            continue
        for ln in block["lines"]:
            spans = [s for s in ln["spans"] if s["text"].strip()]
            if not spans:
                continue
            text = " ".join("".join(s["text"] for s in ln["spans"]).split())
            x0, _, x1, _ = ln["bbox"]
            rotated = abs(ln.get("dir", (1.0, 0.0))[1]) > 0.2
            if len(text) < 80 and (rotated or x1 < w * MARGIN or x0 > w * (1 - MARGIN)):
                continue                   # running header printed sideways / in the side margin
            size = round(max(s["size"] for s in spans), 1)
            bold = all(s["flags"] & 16 for s in spans)
            weight[size] = weight.get(size, 0) + len(text)
            lines.append((bi, text, size, bold, ln["bbox"][1], ln["bbox"][3]))
    body = max(weight, key=weight.get) if weight else 0.0

    paras: list[str] = []
    cur: list[str] = []
    cur_block = -1

    def flush() -> None:
        if cur:
            paras.append(" ".join(cur))
            cur.clear()

    for bi, text, size, bold, y0, y1 in lines:
        if len(text) < 80 and (y1 < h * MARGIN or y0 > h * (1 - MARGIN)):
            continue
        if _NOISE.match(text):
            continue
        if len(text) < 120 and (size >= body * 1.15 or (bold and size >= body * 0.95)):
            flush()
            if paras and paras[-1].endswith("⁣") and bi == cur_block:   # heading wrapped onto a second line
                paras[-1] = paras[-1][:-1] + " " + text + "⁣"
            else:
                paras.append(text + "⁣")
            cur_block = bi
            continue
        if bi != cur_block:
            flush()
            cur_block = bi
        if cur and cur[-1].endswith("-") and text[:1].islower():           # "exam-" + "ple" -> "example"
            cur[-1] = cur[-1][:-1] + text
        else:
            cur.append(text)
    flush()
    return [p[:-1] + ("" if _TERMINAL.search(p[:-1]) else ".") if p.endswith("⁣") else p for p in paras]


def sentences(paras: list[str]) -> list[str]:
    """Paragraphs -> sentences (abbreviations such as 'e.g.' or 'Fig.' do not end a sentence)."""
    out: list[str] = []
    for p in paras:
        for part in _SPLIT.split(p):
            part = part.strip()
            if not part:
                continue
            if out and _ABBR.search(out[-1]):
                out[-1] += " " + part
            else:
                out.append(part)
    return [s for s in out if any(c.isalnum() for c in s)]


def _split_long(sentence: str, limit: int) -> list[str]:
    if len(sentence) <= limit * 2:
        return [sentence]
    out, rest = [], sentence
    while len(rest) > limit * 2:
        cut = max(rest.rfind(", ", 0, limit * 2), rest.rfind("; ", 0, limit * 2))
        cut = cut + 1 if cut > limit // 2 else rest.rfind(" ", 0, limit * 2)
        if cut <= 0:
            cut = limit * 2
        out.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    return out + [rest] if rest else out


def segment(sents: list[str], limit: int | None = None, first: int | None = None) -> list[str]:
    """Groups sentences into segments of about `limit` characters (never splitting a sentence that fits). With
    `first`, the first segment closes after its first sentence once it reaches that many characters, so the voice
    can start sooner."""
    limit = limit or get_settings().tts_segment_chars
    segs: list[str] = []
    cur = ""
    for s in (piece for sent in sents for piece in _split_long(sent, limit)):
        if cur and (len(cur) + 1 + len(s) > limit or (first and not segs and len(cur) >= first)):
            segs.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        segs.append(cur)
    return segs[:MAX_SEGMENTS]


def _page_layout(tb: dict, page: int) -> dict:
    import pymupdf as fitz

    storage = get_storage()
    path = getattr(storage, "resolve_path", None)
    doc = fitz.open(str(path(tb["blob_pdf_url"]))) if path else fitz.open(stream=storage.get(tb["blob_pdf_url"]), filetype="pdf")
    try:
        if page > doc.page_count:
            raise LookupError(page)
        return doc[page - 1].get_text("dict")
    finally:
        doc.close()


def _cached(key: str) -> bytes | None:
    try:
        return get_storage().get(key)
    except Exception:  # noqa: BLE001 — a cache miss (missing file / blob)
        return None


def _chapter(tb: dict, page: int) -> str | None:
    for c in db.call_rows("usp_list_chapters", tb["textbook_id"]):
        if c["first_page"] <= page <= (c["last_page"] or c["first_page"]):
            return c["chapter_title"]
    return None


def _segments(parts: list[dict]) -> list[dict]:
    out: list[dict] = []
    for part in parts:
        for text in segment(sentences([part["text"]]), first=None if out else FIRST_SEGMENT_CHARS):
            out.append({"text": text, "quote": part.get("quote"), "point": part.get("point")})
    return out[:MAX_SEGMENTS]


_lesson_locks = [threading.Lock() for _ in range(16)]


def page_script(tb: dict, page: int, mode: Mode = "explain") -> dict:
    """{"segments": [{text, quote, point}], "lesson": {...} | None, "engine": str} for one page, cached."""
    tutor = page_lesson.get_tutor_llm().name if mode == "explain" else "text"
    tag = re.sub(r"[^A-Za-z0-9.-]+", "_", tutor)
    key = f"read-aloud/{CACHE_VERSION}/{tb['textbook_id']}/{mode}-{page_lesson.PROMPT_VERSION}-{tag}-p{page}.json"
    with _lesson_locks[int(hashlib.md5(key.encode()).hexdigest()[:4], 16) % len(_lesson_locks)]:
        hit = _cached(key)        # a prefetch and a play of one page ask the AI once
        if hit is not None:
            return json.loads(hit)
        paras = paragraphs(_page_layout(tb, page))
        sents = sentences(paras)
        if mode == "read":
            out = {"segments": _segments([{"text": s} for s in sents]) if sents else [], "lesson": None, "engine": "text"}
        else:
            lesson, engine = page_lesson.generate(tb, page, paras, sents, _chapter(tb, page))
            out = {"segments": _segments(page_lesson.script(lesson)), "lesson": lesson, "engine": engine}
            if engine == "offline-fallback":      # the AI failed: serve the offline lesson, try the AI again next time
                return out
        get_storage().put(key, json.dumps(out).encode(), "application/json")
        return out


# ---------------------------------------------------------------- speakable text
_ONES = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
         "seventeen eighteen nineteen").split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _two(n: int) -> str:
    return _ONES[n] if n < 20 else _TENS[n // 10] + ("" if n % 10 == 0 else "-" + _ONES[n % 10])


def say_year(y: int) -> str:
    """1789 -> 'seventeen eighty-nine', 1800 -> 'eighteen hundred', 1905 -> 'nineteen oh five',
    2008 -> 'two thousand and eight', 2024 -> 'twenty twenty-four'."""
    hi, lo = divmod(y, 100)
    if 2000 <= y <= 2009:
        return "two thousand" + ("" if lo == 0 else f" and {_ONES[lo]}")
    if lo == 0:
        return f"{_two(hi)} hundred"
    return f"{_two(hi)} {'oh ' + _ONES[lo] if lo < 10 else _two(lo)}"


_SPEAK: list[tuple[re.Pattern, str]] = [(re.compile(a), b) for a, b in [
    (r"\be\.\s?g\.", "for example"), (r"\bi\.\s?e\.", "that is"), (r"\betc\.", "et cetera"), (r"\bviz\.", "namely"),
    (r"\bFigs?\.\s*", "Figure "), (r"\bCh\.\s*(?=\d)", "Chapter "), (r"\bNo\.\s*(?=\d)", "Number "),
    (r"\bpp?\.\s*(?=\d)", "page "), (r"\bB\.\s?C\.(?:\s?E\.)?", "B C"), (r"\bA\.\s?D\.", "A D"),
    (r"(\d)\s*%", r"\1 per cent"), (r"(\d)\s*°\s*C\b", r"\1 degrees Celsius"), (r"(\d)\s*°", r"\1 degrees"),
    (r"(\d)\s*m/s²", r"\1 metres per second squared"), (r"(\d)\s*m/s\b", r"\1 metres per second"),
    (r"(\d)\s*km/h\b", r"\1 kilometres per hour"), (r"(\d)\s*km\b", r"\1 kilometres"), (r"(\d)\s*kg\b", r"\1 kilograms"),
    (r"(\d)\s*cm\b", r"\1 centimetres"), (r"(\d)\s*mm\b", r"\1 millimetres"), (r"(\d)\s*m\b", r"\1 metres"),
    (r"(\d)\s*g\b", r"\1 grams"), (r"₹\s*(?=\d)", "rupees "), (r"\s*&\s*", " and "),
    (r"(?<=\d)\s*[-–]\s*(?=\d)", " to "), (r"\s*[–—]\s*", ", "), (r"[‘’]", "'"), (r"[“”]", '"'),
]]
_YEAR = re.compile(r"(?<![\d.])(?<!\d,)\b(1[1-9]\d\d|20\d\d)\b(?!\d|[.,]\d|\s*(?:kilo|metres|grams|per cent|centi|milli))")


def speakable(text: str) -> str:
    """Rewrites text so the voice pronounces it the way a teacher would (captions keep the original)."""
    for pat, repl in _SPEAK:
        text = pat.sub(repl, text)
    text = _YEAR.sub(lambda m: say_year(int(m.group(1))), text)
    return " ".join(text.split())


_locks = [threading.Lock() for _ in range(32)]   # striped: a prefetch and a play of one segment synthesise once


def segment_audio(text: str, voice: Voice) -> tuple[bytes, str]:
    """Audio for one segment; cached per engine + voice + text so the same page is voiced once."""
    speech = get_speech()
    digest = hashlib.sha256(f"{speech.label}|speak-v1|{voice}|{text}".encode()).hexdigest()
    key = f"read-aloud/{CACHE_VERSION}/audio/{digest[:2]}/{digest}"
    with _locks[int(digest[:4], 16) % len(_locks)]:
        for ext, mime in (("mp3", "audio/mpeg"), ("wav", "audio/wav")):
            hit = _cached(f"{key}.{ext}")
            if hit is not None:
                return hit, mime
        data, mime = speech.synthesize(speakable(text), voice)
        get_storage().put(f"{key}.{'mp3' if mime == 'audio/mpeg' else 'wav'}", data, mime)
    return data, mime


def avatar_teacher(user: CurrentUser, tb: dict) -> dict:
    """The teacher whose avatar reads this book: subject teacher of the student's class, else the class teacher,
    else whoever uploaded the book. A teacher previewing the classroom gets their own avatar."""
    org = tb["org_code"]
    code = None
    if user.role == "teacher":
        code = user.user_code
    else:
        me = db.fetch_one("SELECT class_code FROM public.app_users WHERE org_code = %s AND user_code = %s",
                          (org, user.user_code))
        cls = me["class_code"] if me else None
        if cls:
            row = db.fetch_one("SELECT teacher_code FROM public.class_subjects WHERE org_code = %s AND class_code = %s "
                               "AND subject_code = %s", (org, cls, tb["subject_code"]))
            code = row["teacher_code"] if row else None
            if not code:
                row = db.fetch_one("SELECT class_teacher_code FROM public.classes WHERE org_code = %s AND class_code = %s",
                                   (org, cls))
                code = row["class_teacher_code"] if row else None
        code = code or tb["uploaded_by"]
    t = db.fetch_one("SELECT full_name, gender FROM public.app_users WHERE org_code = %s AND user_code = %s "
                     "AND user_role IN ('teacher','orgadmin')", (org, code)) if code else None
    gender = t["gender"] if t else None
    return {
        "teacher": {"name": t["full_name"], "gender": gender} if t else None,
        "voice": "male" if gender == "male" else "female",
    }


# ---------------------------------------------------------------- background warm-up
_warmer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="read-aloud-warm")
_latest: dict[tuple[str, str, str], int] = {}
_latest_lock = threading.Lock()


def warm(tb: dict, page: int, mode: Mode, voice: Voice, reader: str) -> None:
    """Voices the rest of `page` in order, then prepares the next page (script + first part), in one background
    worker. A newer request from the same reader for the same book cancels the remaining steps."""
    who = (reader, str(tb["textbook_id"]), mode)
    with _latest_lock:
        if _latest.get(who) == page:
            return
        _latest[who] = page

    def stale() -> bool:
        return _latest.get(who) != page

    def job() -> None:
        try:
            for seg in page_script(tb, page, mode)["segments"]:
                if stale():
                    return
                segment_audio(seg["text"], voice)
            if page < tb["total_pages"] and not stale():
                nxt = page_script(tb, page + 1, mode)["segments"]
                if nxt and not stale():
                    segment_audio(nxt[0]["text"], voice)
        except Exception as e:  # noqa: BLE001 — warm-up is best effort; the reader fetches on demand anyway
            log.info("read-aloud warm-up stopped: %s", type(e).__name__)

    _warmer.submit(job)
