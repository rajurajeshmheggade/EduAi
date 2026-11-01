"""Question snapshots, answer validation and deterministic scoring for admission tests.

Answer shapes (what the exam view sends, option ids are ORIGINAL option indices, so shuffling never changes keys):
    MCQ / SJT          {"option": int}
    MULTI              {"options": [int, …]}
    NUMERICAL          {"value": "12.5"}
    SHORT / DESCRIPTIVE / REFLECTIVE / IDEAS   {"text": "…"}
Answer keys (server only, never sent to the exam view):
    MCQ {"option": i} · MULTI {"options": [i, …]} · NUMERICAL {"value": x, "tolerance": t}
    SHORT {"accept": ["…"], "regex": "…"} (optional; without it the AI grades) · SJT {"points": [2, 1, 0, 0]}
"""
from __future__ import annotations

import re
from decimal import Decimal

OBJECTIVE = {"MCQ", "MULTI", "NUMERICAL", "SHORT"}
CHOICE = {"MCQ", "MULTI", "SJT"}
TEXT = {"SHORT", "DESCRIPTIVE", "REFLECTIVE", "IDEAS"}
HQ_TYPES = {"SJT", "REFLECTIVE", "IDEAS"}

QTYPE_FROM_EVAL = {"MCQ": "MCQ", "SHORT_ANSWER": "SHORT", "DESCRIPTIVE": "DESCRIPTIVE", "NUMERICAL": "NUMERICAL"}

_LABEL = re.compile(r"^\s*[\(\[]?\s*([a-hA-H]|[ivx]{1,4}|\d{1,2})\s*[\)\].:]\s+")
_MARKS = re.compile(r"\s*[\(\[]\s*(\d+(?:\.\d+)?)\s*(?:m|mk|mks|mark|marks)?\s*[\)\]]\s*$", re.I)
_NUMBER = re.compile(r"[-+−]?\d+(?:\.\d+)?")
_SPACE = re.compile(r"\s+")


def _num(v) -> float:
    return float(v) if isinstance(v, (int, float, Decimal)) else float(str(v))


# ---------------------------------------------------------------- import (snapshot) mapping
def clean_option(text: str) -> str:
    """'(b) -15 cm' -> '-15 cm' (options are shuffled, so printed labels would mislead)."""
    return _LABEL.sub("", str(text or "")).strip() or str(text or "").strip()


def option_index(correct: str | None, raw_options: list) -> int | None:
    """Correct option of an evaluation MCQ ('b', '(b)', '2' or the option text) -> index."""
    if not correct or not raw_options:
        return None
    c = str(correct).strip().lower().strip("()[]. ")
    for i, o in enumerate(raw_options):
        m = _LABEL.match(str(o))
        if m and m.group(1).lower() == c:
            return i
    if len(c) == 1 and c.isalpha() and ord(c) - 97 < len(raw_options):
        return ord(c) - 97
    if c.isdigit() and 1 <= int(c) <= len(raw_options):
        return int(c) - 1
    for i, o in enumerate(raw_options):
        if clean_option(o).lower() == str(correct).strip().lower():
            return i
    return None


def parse_rubric(points: list | None, marks: float) -> list[dict]:
    """["Formula 1/v + 1/u = 1/f (1M)", "Substitution"] -> [{criterion, marks}]; unmarked points share what is left."""
    items = [str(p).strip() for p in (points or []) if str(p).strip()]
    if not items:
        return [{"criterion": "Matches the model answer", "marks": float(marks)}]
    out, unmarked = [], []
    for p in items:
        m = _MARKS.search(p)
        if m:
            out.append({"criterion": _MARKS.sub("", p).strip() or p, "marks": float(m.group(1))})
        else:
            out.append({"criterion": p, "marks": None})
            unmarked.append(len(out) - 1)
    left = max(0.0, float(marks) - sum(x["marks"] for x in out if x["marks"] is not None))
    for i in unmarked:
        out[i]["marks"] = round(left / len(unmarked), 2)
    return out


def numeric_key(model_answer: str | None) -> dict | None:
    """First number of the model answer ('v = -30 cm' -> -30) with a 1 % tolerance (min 0.01)."""
    m = _NUMBER.search((model_answer or "").replace("−", "-"))
    if not m:
        return None
    v = float(m.group(0).replace("−", "-"))
    return {"value": v, "tolerance": max(0.01, abs(v) * 0.01)}


def snapshot(master: dict, section: str, source_label: str, order: int) -> dict:
    """evaluation_master_questions row -> admission_questions columns (a copy: later edits never change it)."""
    qtype = QTYPE_FROM_EVAL.get(master.get("question_type") or "DESCRIPTIVE", "DESCRIPTIVE")
    marks = float(master["max_marks"])
    raw = list(master.get("mcq_options") or [])
    options, key = [], None
    if qtype == "MCQ":
        options = [clean_option(o) for o in raw]
        idx = option_index(master.get("correct_option"), raw)
        key = {"option": idx} if idx is not None else None
    elif qtype == "NUMERICAL":
        key = numeric_key(master.get("model_answer_text"))
    return {"section": section, "qtype": qtype, "prompt": master["question_text"], "options": options, "answer_key": key,
            "rubric": parse_rubric(master.get("key_rubric_points"), marks), "model_answer": master.get("model_answer_text"),
            "marks": marks, "origin": "IMPORTED", "source_eval_test_id": master["eval_test_id"],
            "source_master_q_id": master["master_q_id"], "source_label": source_label, "display_order": order,
            "status": "APPROVED" if (qtype != "MCQ" or key) else "DRAFT"}


# ---------------------------------------------------------------- answers
def normalise_answer(q: dict, answer: dict | None, max_chars: int) -> dict | None:
    """Validated answer in its canonical shape, or None for a cleared answer. Raises ValueError."""
    if answer is None:
        return None
    qtype, n = q["qtype"], len(q.get("options") or [])
    if qtype in ("MCQ", "SJT"):
        v = answer.get("option")
        if v is None:
            return None
        if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v < n:
            raise ValueError("Choose one of the options")
        return {"option": v}
    if qtype == "MULTI":
        vs = answer.get("options") or []
        if not isinstance(vs, list) or any(not isinstance(x, int) or isinstance(x, bool) or not 0 <= x < n for x in vs):
            raise ValueError("Choose from the options")
        return {"options": sorted(set(vs))} if vs else None
    if qtype == "NUMERICAL":
        v = str(answer.get("value") or "").strip()
        if not v:
            return None
        if len(v) > 40:
            raise ValueError("Enter a number")
        return {"value": v}
    text = answer.get("text")
    if text is None:
        return None
    if not isinstance(text, str) or len(text) > max_chars:
        raise ValueError(f"Answers are limited to {max_chars} characters")
    return {"text": text} if text.strip() else None


def norm_text(s: str) -> str:
    return _SPACE.sub(" ", (s or "").strip().lower()).strip(" .")


def objective_score(q: dict, answer: dict | None) -> float | None:
    """Marks for a deterministically scorable question; None when the AI must grade it."""
    qtype, key, marks = q["qtype"], q.get("answer_key"), float(q["marks"])
    if qtype in ("DESCRIPTIVE", "REFLECTIVE", "IDEAS", "SJT"):
        return None
    if qtype in ("MCQ", "MULTI") and not key:
        return None
    if not answer:
        return 0.0
    if qtype == "MCQ":
        return marks if answer.get("option") == key.get("option") else 0.0
    if qtype == "MULTI":
        return marks if sorted(answer.get("options") or []) == sorted(key.get("options") or []) else 0.0
    if qtype == "NUMERICAL":
        if not key or key.get("value") is None:
            return None
        try:
            v = _num(str(answer.get("value")).replace("−", "-").replace(",", ""))
        except ValueError:
            return 0.0
        return marks if abs(v - _num(key["value"])) <= _num(key.get("tolerance") or 0.01) else 0.0
    if qtype == "SHORT":
        if not key or not (key.get("accept") or key.get("regex")):
            return None
        given = norm_text(answer.get("text", ""))
        if any(norm_text(a) == given for a in key.get("accept") or []):
            return marks
        if key.get("regex"):
            try:
                if re.fullmatch(key["regex"], given, re.I):
                    return marks
            except re.error:
                pass
        return 0.0
    return None


def sjt_points(q: dict, answer: dict | None) -> int | None:
    """Keyed SJT points (Best 2 / Acceptable 1 / Poor 0) or None when unanswered."""
    if not answer or answer.get("option") is None:
        return None
    pts = (q.get("answer_key") or {}).get("points") or []
    i = answer["option"]
    return int(pts[i]) if 0 <= i < len(pts) else 0


def answered(q: dict, answer: dict | None) -> bool:
    if not answer:
        return False
    if q["qtype"] == "MULTI":
        return bool(answer.get("options"))
    if q["qtype"] in ("MCQ", "SJT"):
        return answer.get("option") is not None
    if q["qtype"] == "NUMERICAL":
        return bool(str(answer.get("value") or "").strip())
    return bool((answer.get("text") or "").strip())
