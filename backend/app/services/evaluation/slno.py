"""SL.No helpers shared by master parsing and script segmentation.

Two marker styles are recognised at the start of a line:
  explicit  — "SL.No 1", "S.No. 2", "Q3", "Question 4(a)", "Ans 1:"   (preferred when present)
  plain     — "1.", "2)", "4a.", "4 (a):"                             (fallback)
Numbered steps *inside* an answer ("1. Angle of incidence…") are therefore not mistaken for new questions
whenever the document uses explicit markers.
"""
from __future__ import annotations

import re

_PREFIX = r"(?:sl\.?\s*no\.?|s\.?\s*no\.?|q(?:uestion|n|ues)?\.?|ans(?:wer)?\.?)"
_NUM = r"(\d{1,3})\s*(?:\(\s*([a-z])\s*\)|([a-z])(?![a-z]))?"
EXPLICIT = re.compile(rf"^[ \t]*{_PREFIX}\s*[:#\-]?\s*{_NUM}\s*[\).:\-–]?\s*", re.I | re.M)
PLAIN = re.compile(rf"^[ \t]*{_NUM}\s*[\).:\-–]\s+", re.I | re.M)


def normalise(sl_no: str) -> str:
    """'4 (a)' -> '4a', ' Q1 ' -> '1'."""
    s = re.sub(r"[\s()\[\].:]+", "", str(sl_no).lower())
    s = re.sub(r"^(?:slno|sno|question|ques|qn|q|answer|ans)", "", s)
    return s


def sort_key(sl_no: str) -> tuple[int, str]:
    m = re.match(r"(\d+)(.*)", sl_no)
    return (int(m.group(1)), m.group(2)) if m else (10_000, sl_no)


def _code(m: re.Match) -> str:
    return m.group(1) + (m.group(2) or m.group(3) or "").lower()


def split_by_slno(text: str, wanted: set[str] | None = None) -> list[tuple[str, str, int]]:
    """Split text into [(sl_no, body, start_offset)] in document order.

    With `wanted`, only those SL.Nos start a new block (first occurrence wins; later repeats are kept as text).
    """
    for pattern in (EXPLICIT, PLAIN):
        hits = []
        seen: set[str] = set()
        for m in pattern.finditer(text):
            code = _code(m)
            if (wanted is None or code in wanted) and code not in seen:
                seen.add(code)
                hits.append((code, m.start(), m.end()))
        if hits:
            out = []
            for i, (code, start, body_start) in enumerate(hits):
                end = hits[i + 1][1] if i + 1 < len(hits) else len(text)
                out.append((code, text[body_start:end].strip(), start))
            return out
    return []


# ---------------------------------------------------------------- marks & rubric points
_MARK_TAG = r"(\d+(?:\.\d+)?)\s*(?:m|mk|mks|mark|marks)\b"
_TRAILING_MARKS = re.compile(
    rf"[\(\[]\s*{_MARK_TAG}\s*[\)\]]\s*$|[\(\[]\s*(\d+(?:\.\d+)?)\s*[\)\]]\s*$|(?:marks?\s*[:=]\s*)(\d+(?:\.\d+)?)\s*$",
    re.I,
)
_ANY_MARKS = re.compile(rf"[\(\[]\s*{_MARK_TAG}\s*[\)\]]|\b{_MARK_TAG}", re.I)
_POINT_TAG = re.compile(rf"[\(\[]\s*[+-]?\s*{_MARK_TAG}\s*[\)\]]", re.I)
_TOTAL = re.compile(rf"total\s*[:=-]?\s*{_MARK_TAG}", re.I)


def split_marks(question: str) -> tuple[str, float | None]:
    """'State Snell's law. (5 marks)' -> ("State Snell's law.", 5.0)"""
    q = question.strip()
    m = _TRAILING_MARKS.search(q)
    if m:
        val = next(g for g in m.groups() if g)
        return q[: m.start()].strip(), float(val)
    m = _ANY_MARKS.search(q)
    if m:
        val = next(g for g in m.groups() if g)
        return (q[: m.start()] + q[m.end():]).strip(), float(val)
    return q, None


def rubric_points(answer: str) -> list[str]:
    """Pull '… (2M)'-style step marks out of a model answer; falls back to bullet lines."""
    # Each point runs from the end of the previous mark tag up to and including its own tag, so text with
    # its own brackets — "angle of incidence (i) equals angle of reflection (r) (2M)" — stays in one point.
    pts, prev = [], 0
    for m in _POINT_TAG.finditer(answer):
        seg = re.sub(r"^[\s.;,\-–•*]*(?:\d+[\).]\s+)?", "", answer[prev:m.end()]).strip()
        prev = m.end()
        if len(re.sub(_POINT_TAG, "", seg).strip()) > 3:
            pts.append(seg)
    if pts:
        return pts
    bullets = [re.sub(r"^\s*(?:[-*•]|\d+[\).])\s+", "", ln).strip() for ln in answer.splitlines()
               if re.match(r"^\s*(?:[-*•]|\d+[\).])\s+\S", ln)]
    return [b for b in bullets if len(b) > 3]


def point_marks(point: str) -> float | None:
    m = _ANY_MARKS.search(point)
    return float(next(g for g in m.groups() if g)) if m else None


def answer_total(answer: str) -> float | None:
    m = _TOTAL.search(answer)
    if m:
        return float(m.group(1))
    marks = [point_marks(p) for p in rubric_points(answer)]
    return sum(x for x in marks if x) or None


# ---------------------------------------------------------------- MCQ (FR-TST-01/04)
_OPTION = re.compile(r"(?:^|\s|\n)\(?([a-dA-D])[\).]\s+(.+?)(?=(?:\s|\n)\(?[a-dA-D][\).]\s|$)", re.S)
_CORRECT = re.compile(r"^\s*(?:(?:correct\s*)?(?:option|answer|ans)\s*[:\-]?\s*)?\(?([a-dA-D])\)?(?=[\s.:)\-,]|$)", re.I)


def split_options(question: str) -> tuple[str, list[str]]:
    """'Unit of force? (a) newton (b) joule (c) watt (d) pascal' -> ('Unit of force?', ['(a) newton', …]).
    Needs at least two consecutive options starting at (a)."""
    first = re.search(r"(?:^|\s)\(?[aA][\).]\s", question)
    if not first:
        return question, []
    opts = [(m.group(1).lower(), " ".join(m.group(2).split())) for m in _OPTION.finditer(question[first.start():])]
    letters = [k for k, _ in opts]
    if len(opts) < 2 or letters != list("abcd"[: len(letters)]):
        return question, []
    return question[: first.start()].strip(), [f"({k}) {v}" for k, v in opts]


def option_letter(answer: str | None, options: list[str]) -> str | None:
    """Student or key answer -> option letter: 'b', '(b)', 'B) joule', 'Option b', or the option text itself."""
    if not answer or not answer.strip():
        return None
    a = answer.strip()
    m = _CORRECT.match(a)
    letters = [o[1].lower() for o in options if len(o) > 2 and o[0] == "("]
    if m and (not letters or m.group(1).lower() in letters):
        return m.group(1).lower()
    norm = " ".join(a.lower().split())
    for o in options:
        text = " ".join(re.sub(r"^\([a-d]\)\s*", "", o, flags=re.I).lower().split())
        if text and text == norm:
            return o[1].lower()
    return None
