"""NLP learning-content repository: Chapter → Topic → Learning content (segments).

The chapter files under backend/nlp are single-line text exported from textbook PDFs: stopwords removed, every page
followed by a second, interleaved copy of itself (the PDF's duplicated text layer, separated by "Reprint 2025-26"),
headings repeated several times. There is no Topic level on disk, so it is derived here, deterministically:

1. **Clean** — page markers become page breaks; immediately repeated token runs ("11.1 ELECTRIC CURRENT 11.1 ELECTRIC
   CURRENT …", "Let us read Let us read") collapse to one; windows whose word 5-grams were already seen (the
   duplicated layer) are dropped; HTML / Markdown markup is stripped.
2. **Topics** — (a) numbered headings in the text ("11.1 ELECTRIC CURRENT CIRCUIT") when the chapter has at least
   two; else (b) the institution's own syllabus topics (syllabus_topics) for a syllabus chapter whose title matches,
   with each content segment assigned to its best-matching topic; else (c) labelled sections of the cleaned text.
3. **Learning content** — each topic's text split at sentence boundaries into ~200–320-word segments with stable ids
   (a hash of the location and the text), which the teacher previews and the generator is grounded on.

The org-independent part (1, 2a/2c, 3) is cached per file (path, mtime, size), so it is computed lazily once and
recomputed when the file changes.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

from .. import nlp_catalog
from .text import content_words, short_id, squash, stem, words

_REPRINT = re.compile(r"Reprint\s+\d{4}\s*[-–]\s*\d{2,4}", re.I)
_TAG = re.compile(r"<[^>]{0,200}>")
_MD = re.compile(r"\*\*|__|(?:(?<=\s)|^)#{1,6}(?=\s)")
_SENT_END = re.compile(r"[.!?]['\"”’)]*$")

TARGET_WORDS = 240
MAX_WORDS = 340
MIN_TAIL_WORDS = 90
SECTION_SEGMENTS = 3
MAX_PREVIEW_CHARS = 16_000


# ════════════════════════════════════════════════════════════ cleaning
def _collapse_repeats(tokens: list[str], max_n: int = 40) -> list[str]:
    """Drop immediately repeated runs of 1..max_n tokens (the PDF's doubled words, lines and headings)."""
    out: list[str] = []
    low: list[str] = []
    for t in tokens:
        out.append(t)
        low.append(t.lower())
        size = len(out)
        for n in range(1, min(max_n, size // 2) + 1):
            if low[-1] == low[-1 - n] and low[-n:] == low[-2 * n:-n]:
                del out[-n:]
                del low[-n:]
                break
    return out


def _windows(tokens: list[str], size: int = 120) -> list[list[str]]:
    """Split into ~size-token windows, preferring to cut after a sentence end."""
    out, cur = [], []
    for t in tokens:
        cur.append(t)
        if len(cur) >= size and _SENT_END.search(t) or len(cur) >= size * 2:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def _shingles(tokens: list[str], n: int = 5) -> set[tuple[str, ...]]:
    low = [t.lower().strip(".,;:!?\"'()“”‘’") for t in tokens]
    low = [t for t in low if t]
    return {tuple(low[i:i + n]) for i in range(max(0, len(low) - n + 1))}


def clean_text(raw: str) -> str:
    """Deterministic cleaning of one chapter file (see the module docstring). Returns plain text."""
    text = _TAG.sub(" ", raw or "")
    text = _MD.sub(" ", text)
    pages = [p for p in _REPRINT.split(text) if p.strip()]
    seen: set[tuple[str, ...]] = set()
    kept: list[str] = []
    for page in pages:
        tokens = _collapse_repeats(page.split())
        for win in _windows(tokens):
            sh = _shingles(win)
            if sh and len(sh & seen) / len(sh) >= 0.5:
                continue  # the duplicated text layer of a page already kept
            seen |= sh
            kept.extend(win)
    return squash(" ".join(_collapse_repeats(kept)))


# ════════════════════════════════════════════════════════════ topics from numbered headings
_HEADING = re.compile(
    r"(?<![\w.(/=-])(\d{1,2})\.(\d{1,2})(?!\.\d|\d)\s+"
    r"((?:[A-Z][A-Z0-9’'&\-,:()]*\s+){0,11}[A-Z][A-Z0-9’'&\-()]*)(?=\s|$)")
# Title-case headings ("2.1 Discovery Sub-atomic Particles insight …"): trusted only as a run of ≥3 in sequence.
_HEADING_TC = re.compile(
    r"(?<![\w.(/=-])(\d{1,2})\.(\d{1,2})(?!\.\d|\d)\s+"
    r"((?:[A-Z][\w’'\-]*,?\s+){0,7}[A-Z][\w’'\-]*)(?=\s+[a-z0-9(“\"‘]|\s*$)")
_NOT_HEADING = {"table", "fig", "figure", "eq", "equation", "example", "section", "activity", "box", "exercise",
                "chapter", "page", "see", "refer", "class", "unit", "ex", "q", "question", "and", "to", "or"}
_FURNITURE_TITLES = {"EXAMPLE", "EXAMPLES", "ACTIVITY", "FIGURE", "TABLE", "BOX", "FIG"}
# Capitalised words that usually begin the sentence after a title-case heading, not the heading itself.
_SENTENCE_STARTERS = set("""now sometimes consider you figure fig chapter like using different let we this these here
there such also however thus hence therefore example activity recall observe look suppose imagine boojho paheli think
do did what how why when where which who as if so then after before many most some all every each one two it its
our your they he she in on at for from by with when while table""".split())
# Exercise items are numbered like sections ("2.5 Calculate …"): a title-case "heading" starting with one is not one.
_IMPERATIVES = set("""calculate using use give show arrange indicate following among similar explain describe define find
write state draw name list compare distinguish discuss prove solve determine compute estimate derive obtain identify
classify match fill complete choose what why how which who whom when where is are can does do consider suggest predict
justify differentiate illustrate mention account evaluate""".split())


_ACRONYMS = {"DNA", "RNA", "ATP", "EMF", "AC", "DC", "LED", "LCD", "CPU", "GDP", "GNP", "HDI", "UN", "UNO", "USA", "UK",
             "SI", "CNG", "LPG", "PVC", "HIV", "AIDS", "IT", "AI", "DDT", "NCERT", "RBI", "WTO", "IMF", "PDS", "MRP"}


def _repair_title(title: str) -> str:
    """Undo the PDF's drop-cap / kerning splits in a heading: "FACTORS RESIST CTORS RESISTANCE ANCE" → "FACTORS
    RESISTANCE" (a token that is the tail of an earlier token, or the head of the next one, is a fragment)."""
    toks = [t for t in title.split() if t]
    out: list[str] = []
    for i, t in enumerate(toks):
        core = t.strip(",:()")
        if len(core) <= 1 and core not in ("A", "I"):
            continue
        if any(len(o) > len(core) and o.strip(",:()").endswith(core) for o in out):
            continue
        ahead = [x.strip(",:()") for x in toks[i + 1:i + 4]]
        if any(len(x) > len(core) and x.startswith(core) for x in ahead):
            continue
        if out and out[-1].strip(",:()") == core:
            continue
        out.append(t)
    # a repeated run left over ("HEATING EFFECT CURRENT EFFECT CURRENT")
    for n in range(len(out) // 2, 0, -1):
        for i in range(len(out) - 2 * n + 1):
            if out[i:i + n] == out[i + n:i + 2 * n]:
                del out[i + n:i + 2 * n]
                break
    return " ".join(out[:12])


def _title_case(s: str) -> str:
    out = []
    for w in s.split():
        core = re.sub(r"[^A-Za-z]", "", w)
        out.append(w if core in _ACRONYMS or any(ch.isdigit() for ch in w) else w[:1] + w[1:].lower())
    return " ".join(out).strip(" ,:-")


def _heading_candidates(text: str, pattern: re.Pattern, upper: bool) -> list[dict]:
    by_number: dict[tuple[int, int], dict] = {}
    for m in pattern.finditer(text):
        before = text[max(0, m.start() - 12):m.start()].split()
        if before and before[-1].lower().strip(".:,") in _NOT_HEADING:
            continue
        title = m.group(3).strip(" ,:-")
        if upper:
            title = _repair_title(title)
        else:
            toks = title.split()[:8]
            while len(toks) > 1 and toks[-1].lower().strip(",") in _SENTENCE_STARTERS:
                toks.pop()
            title = " ".join(toks).strip(",")
            if toks[0].lower() in _IMPERATIVES:
                continue
        letters = re.sub(r"[^A-Za-z]", "", title)
        if len(letters) < 4 or len(title) > 90 or title.upper() in _FURNITURE_TITLES:
            continue
        if upper and not re.search(r"[A-Z]{3,}", title):
            continue
        key = (int(m.group(1)), int(m.group(2)))
        h = by_number.get(key)
        if h is None:
            by_number[key] = {"major": key[0], "minor": key[1], "title": title, "start": m.start(), "end": m.end()}
        elif upper and len(letters) > len(re.sub(r"[^A-Za-z]", "", h["title"])) and m.start() - h["start"] < 600:
            h["title"] = title  # a fuller copy of the same heading close by ("OHM'S LA" … "OHM'S LAW")
            h["end"] = max(h["end"], m.end())
    found = sorted(by_number.values(), key=lambda h: h["start"])
    if not found:
        return []
    major = Counter(h["major"] for h in found).most_common(1)[0][0]
    out, last_minor = [], 0
    for h in found:
        if h["major"] != major or h["minor"] <= last_minor:
            continue
        last_minor = h["minor"]
        out.append(h)
    for x, y in zip(out, out[1:]):
        x["end"] = min(x["end"], y["start"])
    return out


def _headings(text: str) -> list[dict]:
    """Numbered section headings of the chapter (x.1, x.2 …): upper-case ones when there are ≥2, else title-case ones
    when there are ≥3 (a weaker signal, since sentences in this text also start with a capital). A title-case
    heading followed by fewer than 60 words before the next one is an exercise item or a reference, not a section."""
    up = _heading_candidates(text, _HEADING, True)
    if len(up) >= 2:
        return up
    tc = _heading_candidates(text, _HEADING_TC, False)
    kept: list[dict] = []
    for i, h in enumerate(tc):
        nxt = tc[i + 1]["start"] if i + 1 < len(tc) else len(text)
        if len(text[h["end"]:nxt].split()) >= 60 or (kept and i + 1 == len(tc)):
            kept.append(h)
    for x, y in zip(kept, kept[1:]):
        x["end"] = min(x["end"], y["start"])
    return kept if len(kept) >= 3 else []


# ════════════════════════════════════════════════════════════ segmentation + labels
def _split_long(sentence: str) -> list[str]:
    toks = sentence.split()
    if len(toks) <= MAX_WORDS:
        return [sentence]
    return [" ".join(toks[i:i + TARGET_WORDS]) for i in range(0, len(toks), TARGET_WORDS)]


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[\"“‘(]?[A-Z0-9])", squash(text))
    out = []
    for p in parts:
        if p.strip():
            out.extend(_split_long(p.strip()))
    return out


def _segment(text: str) -> list[str]:
    segs, cur, n = [], [], 0
    for s in _sentences(text):
        w = len(s.split())
        if cur and n + w > MAX_WORDS:
            segs.append(" ".join(cur))
            cur, n = [], 0
        cur.append(s)
        n += w
        if n >= TARGET_WORDS:
            segs.append(" ".join(cur))
            cur, n = [], 0
    if cur:
        if segs and n < MIN_TAIL_WORDS:
            segs[-1] = segs[-1] + " " + " ".join(cur)
        else:
            segs.append(" ".join(cur))
    return segs


_LATEX = re.compile(r"\\[A-Za-z]+|\$")


def _terms(text: str) -> list[str]:
    return content_words(_LATEX.sub(" ", text), 4)


def _keywords(text: str, df: Counter, n_docs: int, k: int = 3) -> list[str]:
    tf = Counter(w for w in _terms(text) if not w.isdigit() and "_" not in w)
    if not tf:
        return []
    scored = sorted(tf, key=lambda w: (-(tf[w] * math.log(1 + n_docs / (1 + df[w]))), w))
    out: list[str] = []
    for w in scored:
        if all(stem(w) != stem(o) for o in out):
            out.append(w)
        if len(out) == k:
            break
    return out


# ════════════════════════════════════════════════════════════ cached chapter structure (org-independent)
@lru_cache(maxsize=128)
def _structure(path: str, mtime_ns: int, size: int, class_label: str, subject: str, chapter: str) -> dict:
    raw = Path(path).read_text(encoding="utf-8", errors="ignore")
    text = clean_text(raw)
    loc = f"{class_label}|{subject}|{chapter}"
    heads = _headings(text)
    blocks: list[tuple[str, str | None, str]] = []  # (title, number, text)
    if heads:
        intro = text[:heads[0]["start"]].strip()
        if len(intro.split()) >= 40:
            blocks.append(("Introduction", None, intro))
        for i, h in enumerate(heads):
            body = text[h["end"]: heads[i + 1]["start"] if i + 1 < len(heads) else len(text)].strip()
            if body:
                blocks.append((_title_case(h["title"]), f"{h['major']}.{h['minor']}", body))
    else:
        blocks.append(("", None, text))

    segments: list[dict] = []
    raw_topics: list[dict] = []
    for title, number, body in blocks:
        ids = []
        for seg in _segment(body):
            sid = "s-" + short_id(loc, seg)
            if any(s["id"] == sid for s in segments):
                continue
            segments.append({"id": sid, "text": seg, "word_count": len(seg.split()), "order": len(segments)})
            ids.append(sid)
        if ids:
            raw_topics.append({"title": title, "number": number, "segment_ids": ids})

    df: Counter = Counter()
    for s in segments:
        df.update(set(_terms(s["text"])))
    for s in segments:
        s["keywords"] = _keywords(s["text"], df, len(segments))

    topics: list[dict] = []
    if heads:
        topics = raw_topics
        source = "headings"
    else:
        source = "segments"
        ids = [s["id"] for s in segments]
        for i in range(0, len(ids), SECTION_SEGMENTS):
            group = [s for s in segments if s["id"] in ids[i:i + SECTION_SEGMENTS]]
            kws = _keywords(" ".join(s["text"] for s in group), df, len(segments), k=3)
            label = f"Section {i // SECTION_SEGMENTS + 1}" + (f" · {', '.join(kws)}" if kws else "")
            topics.append({"title": label, "number": None, "segment_ids": [s["id"] for s in group]})
    for t in topics:
        t["id"] = "t-" + short_id(loc, t["title"], t["segment_ids"][0], n=10)
    seg_topic = {}
    for t in topics:
        for sid in t["segment_ids"]:
            seg_topic.setdefault(sid, t["id"])
    by_topic: dict[str, int] = {}
    for s in segments:
        tid = seg_topic.get(s["id"])
        by_topic[tid] = by_topic.get(tid, 0) + 1
        s["title"] = f"Part {by_topic[tid]}" + (f" · {', '.join(s['keywords'])}" if s["keywords"] else "")
    return {
        "class_label": class_label, "subject": subject, "chapter": chapter,
        "source_file": Path(path).relative_to(nlp_catalog.ROOT).as_posix() if Path(path).is_relative_to(nlp_catalog.ROOT) else Path(path).name,
        "raw_chars": len(raw), "clean_chars": len(text), "topic_source": source,
        "topics": topics, "segments": {s["id"]: s for s in segments},
    }


def chapter_structure(class_label: str, subject: str, chapter: str) -> dict:
    """Raises FileNotFoundError if the triple isn't in the catalogue."""
    path = nlp_catalog.chapter_path(class_label, subject, chapter)
    st = path.stat()
    return _structure(str(path), st.st_mtime_ns, st.st_size, class_label, subject, chapter)


# ════════════════════════════════════════════════════════════ org syllabus topics (b)
def _norm_title(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())).strip()


def syllabus_topics_for(chapter: str, syllabus: list[dict]) -> list[dict]:
    """syllabus = [{"chapter_title", "topics": [{"topic_id", "title"}]}] for the teacher's class + subject. Returns
    the topics of the chapter whose title matches the NLP chapter name (exact, or one contains the other)."""
    want = _norm_title(chapter)
    if not want:
        return []
    exact, near = [], []
    for ch in syllabus:
        have = _norm_title(re.sub(r"^\s*(chapter|unit|lesson)?\s*\d+\s*[:.\-–]?\s*", "", ch["chapter_title"], flags=re.I))
        topics = [t for t in ch.get("topics", []) if (t.get("title") or "").strip()]
        if not have or len(topics) < 2:
            continue   # a syllabus chapter without at least two topics cannot provide the Topic level
        if have == want:
            exact.append(topics)
        elif want in have or have in want:
            near.append(topics)
    return (exact or near or [[]])[0]


def _assign_to_syllabus(struct: dict, topics: list[dict]) -> list[dict]:
    segs = sorted(struct["segments"].values(), key=lambda s: s["order"])
    keys = [{stem(w) for w in content_words(t["title"], 3)} for t in topics]
    seg_stems = [Counter(stem(w) for w in content_words(s["text"], 3)) for s in segs]
    assigned: list[list[str]] = [[] for _ in topics]
    prev = 0
    for s, cnt in zip(segs, seg_stems):
        scores = [sum(cnt[k] for k in ks) for ks in keys]
        best = max(range(len(topics)), key=lambda i: (scores[i], -abs(i - prev))) if any(scores) else prev
        assigned[best].append(s["id"])
        prev = best
    for i, ids in enumerate(assigned):
        if not ids and segs:  # a syllabus topic the text never names: its single best segment (shared)
            j = max(range(len(segs)), key=lambda j: (sum(seg_stems[j][k] for k in keys[i]), -j))
            ids.append(segs[j]["id"])
    loc = f"{struct['class_label']}|{struct['subject']}|{struct['chapter']}"
    return [{"id": "st-" + short_id(loc, str(t.get("topic_id") or t["title"]), n=10), "title": t["title"].strip(),
             "number": None, "segment_ids": ids, "syllabus_topic_id": str(t.get("topic_id") or "")}
            for t, ids in zip(topics, assigned)]


def resolve_topics(struct: dict, syllabus: list[dict] | None = None) -> tuple[str, list[dict]]:
    """(topic_source, topics) — numbered headings win, then the org's syllabus topics, then labelled sections."""
    if struct["topic_source"] == "headings":
        return "headings", struct["topics"]
    topics = syllabus_topics_for(struct["chapter"], syllabus or [])
    if topics:
        return "syllabus", _assign_to_syllabus(struct, topics)
    return struct["topic_source"], struct["topics"]


def topic_view(struct: dict, topic: dict) -> dict:
    segs = [struct["segments"][s] for s in topic["segment_ids"] if s in struct["segments"]]
    return {"id": topic["id"], "title": topic["title"], "number": topic.get("number"),
            "segment_count": len(segs), "word_count": sum(s["word_count"] for s in segs)}


def segment_view(seg: dict, preview_chars: int = 280) -> dict:
    text = seg["text"]
    return {"id": seg["id"], "title": seg["title"], "word_count": seg["word_count"], "keywords": seg["keywords"],
            "preview": text if len(text) <= preview_chars else text[:preview_chars].rsplit(" ", 1)[0] + " …"}


def selected_segments(struct: dict, topic: dict, segment_ids: list[str] | None) -> list[dict]:
    """The topic's segments, narrowed to `segment_ids` when given. Ids not under the topic raise KeyError, so a
    request can never ground generation on content outside the selected topic."""
    allowed = topic["segment_ids"]
    if segment_ids:
        bad = [s for s in segment_ids if s not in allowed]
        if bad:
            raise KeyError(bad[0])
        ids = [s for s in allowed if s in set(segment_ids)]
    else:
        ids = list(allowed)
    return [struct["segments"][s] for s in ids]


def word_count(s: str) -> int:
    return len(words(s))
