"""AI avatar tutor — explains (or reads) the open textbook page aloud.

* Page text comes straight from the PDF page layout (not the overlapping RAG chunks), is cleaned for listening
  (running headers, page numbers, reprint footers and line-wrap hyphens removed; headings detected by type size get a
  pause).
* mode "explain" (default): the AI tutor turns the page into a teacher's explanation (services.page_lesson);
  mode "read": the page is read word for word.
* The script is split into sentence segments of about TTS_SEGMENT_CHARS characters (the very first one is a single
  sentence so speech starts quickly). The client plays segment by segment.
* A background page pipeline (services.page_pipeline) prepares what each reader needs next while they listen: the
  next pages' scripts and first parts, then the rest of the open page's audio. It is cancelled / re-aimed when the
  reader jumps elsewhere, and every page and part is built once however many readers ask (single-flight).
* Text is made speakable before synthesis ("e.g." -> "for example", "1789" -> "seventeen eighty-nine", units …).
* Voice follows the subject teacher: male when the teacher's gender is 'male', otherwise female.
* Scripts and synthesised audio are cached in storage, so a page is explained and voiced once per engine / voice.
  Script keys carry the textbook's content checksum and the prompt version, so changed content is re-explained.
  If the AI fails, the offline lesson is cached too (stable parts for audio) and marked so the AI is asked again
  later; the replaced script stays readable by version for anyone part-way through it.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from collections import OrderedDict
from typing import Literal

from .. import db
from ..config import get_settings
from ..providers.speech import SpeechUnavailable, Voice, get_speech
from ..security import CurrentUser
from . import page_lesson
from .page_pipeline import Pipeline, SingleFlight, Step
from .storage import get_storage

log = logging.getLogger("eduai.read_aloud")

Mode = Literal["explain", "read"]
SCRIPT_CACHE = "v3"   # page scripts; v3 = content-versioned keys, cached fallbacks, script versions
AUDIO_CACHE = "v2"    # voiced parts (unchanged: audio already voiced stays valid)
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


# ---------------------------------------------------------------- page scripts (cached)
_flight = SingleFlight()            # one build per page / one synthesis per part, however many readers ask at once
_memo: OrderedDict[str, tuple[dict, float]] = OrderedDict()   # recently used scripts, so audio requests skip storage
_memo_lock = threading.Lock()
MEMO_SIZE = 256
OFFLINE = ("offline", "offline-fallback")


def _cached(key: str) -> bytes | None:
    try:
        return get_storage().get(key)
    except Exception:  # noqa: BLE001 — a cache miss (missing file / blob)
        return None


def _exists(key: str) -> bool:
    path = getattr(get_storage(), "resolve_path", None)
    return path(key).exists() if path else _cached(key) is not None


def content_version(tb: dict) -> str:
    """Changes whenever the textbook's PDF does (checksum set at indexing, migration 027), so cached pages of an
    old upload are never served for new content."""
    digest = tb.get("content_sha256") or hashlib.sha256(f"{tb['blob_pdf_url']}|{tb['total_pages']}".encode()).hexdigest()
    return digest.strip()[:16]


def script_key(tb: dict, page: int, mode: Mode) -> str:
    tutor = page_lesson.get_tutor_llm().name if mode == "explain" else "text"
    tag = re.sub(r"[^A-Za-z0-9.-]+", "_", tutor)
    return (f"read-aloud/{SCRIPT_CACHE}/{tb['textbook_id']}/{content_version(tb)}/"
            f"{mode}-{page_lesson.PROMPT_VERSION}-{tag}-p{page}.json")


def _remember(key: str, script: dict) -> None:
    # A fallback is re-read from storage now and then: another worker process may have replaced it with the AI's.
    until = time.monotonic() + 30 if script.get("fallback") else float("inf")
    with _memo_lock:
        _memo[key] = (script, until)
        _memo.move_to_end(key)
        while len(_memo) > MEMO_SIZE:
            _memo.popitem(last=False)


def _load(key: str) -> dict | None:
    with _memo_lock:
        hit = _memo.get(key)
        if hit and hit[1] > time.monotonic():
            _memo.move_to_end(key)
            return hit[0]
    raw = _cached(key)
    try:
        script = json.loads(raw) if raw is not None else None
    except ValueError:            # half-written by another process: treat as a miss
        return None
    if script is not None:
        _remember(key, script)
    return script


def _store(key: str, script: dict) -> None:
    get_storage().put(key, json.dumps(script).encode(), "application/json")
    _remember(key, script)


def _version(segments: list[dict]) -> str:
    return hashlib.sha256("\n".join(s["text"] for s in segments).encode()).hexdigest()[:12]


def _archived(key: str, version: str) -> str:
    return f"{key[:-5]}@{version}.json"


def _context(tb: dict, page: int) -> dict | None:
    """The previous page's lesson in brief, when the AI has already explained it (continuity between pages)."""
    if page <= 1:
        return None
    prev = _load(script_key(tb, page - 1, "explain"))
    if not prev or prev.get("engine") in OFFLINE:
        return None
    return page_lesson.context_of(prev.get("lesson"), page - 1)


def _build(tb: dict, page: int, mode: Mode, key: str, replacing: dict | None = None) -> dict:
    paras = paragraphs(_page_layout(tb, page))
    sents = sentences(paras)
    if mode == "read":
        out: dict = {"segments": _segments([{"text": s} for s in sents]) if sents else [], "lesson": None, "engine": "text"}
    else:
        ctx = _context(tb, page)
        lesson, engine = page_lesson.generate(tb, page, paras, sents, _chapter(tb, page), ctx)
        out = {"segments": _segments(page_lesson.script(lesson)), "lesson": lesson, "engine": engine}
        if ctx:
            out["context_page"] = ctx["page"]
        if engine == "offline-fallback":
            out["fallback"] = True      # the AI failed: cached all the same (stable parts), replaced later
    out["version"] = _version(out["segments"])
    out["created"] = time.time()
    if replacing and replacing.get("version") != out["version"]:
        # Readers part-way through the old script keep fetching its parts by version.
        get_storage().put(_archived(key, replacing["version"]), json.dumps(replacing).encode(), "application/json")
    _store(key, out)
    return out


def page_script(tb: dict, page: int, mode: Mode = "explain") -> dict:
    """{"segments": [{text, quote, point}], "lesson": {...} | None, "engine", "version", ...} for one page, cached
    per textbook content + prompt + tutor. Concurrent requests for one page build it once."""
    key = script_key(tb, page, mode)
    out = _load(key) or _flight.do(key, lambda: _load(key) or _build(tb, page, mode, key))
    s = get_settings()
    if out.get("fallback") and time.time() - out.get("created", 0) >= s.read_aloud_fallback_retry_seconds:
        if s.read_aloud_prewarm:        # ask the AI again in the background; the next request gets its lesson
            pipeline().submit(Step(f"upgrade|{key}", lambda _cancelled: _upgrade(tb, page, mode, key)), rank=50)
        else:
            out = _upgrade(tb, page, mode, key)
    return out


def _upgrade(tb: dict, page: int, mode: Mode, key: str) -> dict:
    """Re-asks the AI for a page whose cached lesson is the offline fallback; a real lesson replaces it."""
    def run() -> dict:
        cur = _load(key)
        return cur if cur is not None and not cur.get("fallback") else _build(tb, page, mode, key, replacing=cur)
    return _flight.do(key, run)


def script_version(tb: dict, page: int, mode: Mode, version: str) -> dict | None:
    """The page's script as it was at `version` (current, or an archived one a newer lesson replaced)."""
    cur = page_script(tb, page, mode)
    if cur.get("version") == version:
        return cur
    return _load(_archived(script_key(tb, page, mode), version))


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


# ---------------------------------------------------------------- voice
def _audio_key(text: str, voice: Voice) -> str:
    digest = hashlib.sha256(f"{get_speech().label}|speak-v1|{voice}|{text}".encode()).hexdigest()
    return f"read-aloud/{AUDIO_CACHE}/audio/{digest[:2]}/{digest}"


def _audio_ready(key: str) -> bool:
    return _exists(f"{key}.mp3") or _exists(f"{key}.wav")


def segment_audio(text: str, voice: Voice) -> tuple[bytes, str]:
    """Audio for one segment; cached per engine + voice + text so the same page is voiced once."""
    key = _audio_key(text, voice)

    def synth() -> tuple[bytes, str]:
        for ext, mime in (("mp3", "audio/mpeg"), ("wav", "audio/wav")):
            hit = _cached(f"{key}.{ext}")
            if hit is not None:
                return hit, mime
        data, mime = get_speech().synthesize(speakable(text), voice)
        get_storage().put(f"{key}.{'mp3' if mime == 'audio/mpeg' else 'wav'}", data, mime)
        return data, mime

    return _flight.do(key, synth)


# ---------------------------------------------------------------- whose avatar / voice
_teachers: dict[tuple, tuple[dict, float]] = {}
_teachers_lock = threading.Lock()

_TEACHER_SQL = """
SELECT u.full_name, u.gender
FROM (SELECT COALESCE(
        (SELECT cs.teacher_code FROM public.class_subjects cs
         WHERE cs.org_code = %(org)s AND cs.class_code = me.class_code AND cs.subject_code = %(subject)s),
        (SELECT c.class_teacher_code FROM public.classes c WHERE c.org_code = %(org)s AND c.class_code = me.class_code),
        %(uploader)s) AS code
      FROM (SELECT (SELECT class_code FROM public.app_users WHERE org_code = %(org)s AND user_code = %(me)s)
            AS class_code) me) pick
JOIN public.app_users u ON u.org_code = %(org)s AND u.user_code = pick.code AND u.user_role IN ('teacher', 'orgadmin')
"""


def avatar_teacher(user: CurrentUser, tb: dict) -> dict:
    """The teacher whose avatar reads this book: subject teacher of the student's class, else the class teacher,
    else whoever uploaded the book. A teacher previewing the classroom gets their own avatar. One query, cached for
    AVATAR_TEACHER_CACHE_SECONDS (every audio request needs it); admin edits to teachers clear the cache."""
    org = tb["org_code"]
    ck = (org, user.role, user.user_code, tb["subject_code"], tb["uploaded_by"])
    now = time.monotonic()
    with _teachers_lock:
        hit = _teachers.get(ck)
        if hit and hit[1] > now:
            return hit[0]
    if user.role == "teacher":
        t = db.fetch_one("SELECT full_name, gender FROM public.app_users WHERE org_code = %s AND user_code = %s "
                         "AND user_role IN ('teacher','orgadmin')", (org, user.user_code))
    else:
        t = db.fetch_one(_TEACHER_SQL, {"org": org, "me": user.user_code, "subject": tb["subject_code"],
                                        "uploader": tb["uploaded_by"]})
    gender = t["gender"] if t else None
    out = {"teacher": {"name": t["full_name"], "gender": gender} if t else None,
           "voice": "male" if gender == "male" else "female"}
    with _teachers_lock:
        if len(_teachers) > 5000:
            _teachers.clear()
        _teachers[ck] = (out, now + get_settings().avatar_teacher_cache_seconds)
    return out


def forget_avatar_teachers() -> None:
    """A teacher's name / gender or a class's teachers changed: look the avatars up again."""
    with _teachers_lock:
        _teachers.clear()


# ---------------------------------------------------------------- background page pipeline
_pipe: Pipeline | None = None
_pipe_lock = threading.Lock()


def pipeline() -> Pipeline:
    global _pipe
    with _pipe_lock:
        if _pipe is None:
            s = get_settings()
            _pipe = Pipeline(workers=s.read_aloud_workers, retries=s.read_aloud_retries, backoff=s.read_aloud_retry_backoff,
                             give_up=(LookupError, SpeechUnavailable), name="read-aloud")
        return _pipe


def _voice_part(tb: dict, page: int, mode: Mode, voice: Voice, index: int) -> None:
    segs = page_script(tb, page, mode)["segments"]
    if index < len(segs):
        segment_audio(segs[index]["text"], voice)


def _voice_rest(tb: dict, page: int, mode: Mode, voice: Voice, cancelled) -> None:
    for seg in page_script(tb, page, mode)["segments"][1:]:
        if cancelled():           # the reader went elsewhere: stop between parts
            return
        segment_audio(seg["text"], voice)


def _first_ready(tb: dict, page: int, mode: Mode, voice: Voice) -> bool:
    script = _load(script_key(tb, page, mode))
    return script is not None and (not script["segments"] or _audio_ready(_audio_key(script["segments"][0]["text"], voice)))


def lookahead(tb: dict, page: int, mode: Mode, voice: Voice) -> list[Step]:
    """What to prepare for a reader on `page`, most urgent first: this page's script and first part, the next page's
    script and first part, the rest of this page's audio, then the pages after that (READ_ALOUD_LOOKAHEAD_PAGES).
    Each page's lesson waits for the previous page's, so it can carry on from it. Ready work is left out."""
    s = get_settings()
    last = max(page, min(tb["total_pages"] or page, page + max(0, s.read_aloud_lookahead_pages)))
    steps: list[Step] = []

    def add_page(p: int) -> None:
        key = script_key(tb, p, mode)
        prev = f"script|{script_key(tb, p - 1, mode)}" if mode == "explain" and p > page else None
        if _load(key) is None:
            steps.append(Step(f"script|{key}", lambda _c, p=p: page_script(tb, p, mode), needs=prev))
        if not _first_ready(tb, p, mode, voice):
            steps.append(Step(f"audio|{key}|0|{voice}", lambda _c, p=p: _voice_part(tb, p, mode, voice, 0),
                              needs=f"script|{key}"))

    add_page(page)
    if page + 1 <= last:
        add_page(page + 1)
    key = script_key(tb, page, mode)
    script = _load(key)
    if script is None or not all(_audio_ready(_audio_key(x["text"], voice)) for x in script["segments"][1:]):
        steps.append(Step(f"rest|{key}|{voice}", lambda cancelled: _voice_rest(tb, page, mode, voice, cancelled),
                          needs=f"script|{key}"))
    for p in range(page + 2, last + 1):
        add_page(p)
    return steps


def prepare(tb: dict, page: int, mode: Mode, voice: Voice, reader: str) -> None:
    """Points this reader's pipeline at `page`: work for pages they left is cancelled (unless another reader needs
    it), and the window around `page` is queued in priority order on the shared worker pool."""
    pipeline().follow((tb["org_code"], reader), lookahead(tb, page, mode, voice))


def _state(step_key: str, flight_key: str) -> str | None:
    st = _pipe.state(step_key) if _pipe is not None else None
    return st or ("preparing" if _flight.busy(flight_key) else None)


def page_status(tb: dict, page: int, mode: Mode, voice: Voice) -> dict:
    """ready / preparing / queued / failed / idle for one page's script and first part — no AI, no PDF parsing."""
    key = script_key(tb, page, mode)
    script = _load(key)
    s_state = "ready" if script is not None else _state(f"script|{key}", key) or "idle"
    a_state = s_state
    if script is not None and script["segments"]:
        akey = _audio_key(script["segments"][0]["text"], voice)
        a_state = "ready" if _audio_ready(akey) else _state(f"audio|{key}|0|{voice}", akey) or "idle"
    both = {s_state, a_state}
    overall = next(st for st in ("failed", "preparing", "queued", "idle", "ready") if st in both)
    return {"page": page, "status": overall, "script": s_state, "audio": a_state,
            "engine": script["engine"] if script else None, "fallback": bool(script and script.get("fallback"))}
