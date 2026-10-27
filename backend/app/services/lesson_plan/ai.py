"""JSON completions for the Lesson Plan / Session Plan generators on EduAI's own provider (get_llm()).

Port of Rapid's LessonPlanAi: the prompts are written as one user message; the reply is cleaned (code fences
stripped, the outermost JSON array/object extracted). Object prompts use the provider's JSON mode plus one
bounded repair retry. Array prompts must NOT use JSON mode (OpenAI's json_object only allows objects).

Every call is tagged with a `[TASK:LP:<kind>]` marker in the system message so the offline MockLLM can answer it.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ...providers import get_llm

log = logging.getLogger("eduai.lessonplan")

SYSTEM = ("[TASK:LP:{kind}]\nYou are an expert curriculum designer and master teacher for Indian schools. "
          "Follow the user's instructions exactly. Reply with valid JSON only — no prose, no code fences.")
REPAIR = "\n\nReturn ONLY a single valid JSON value — no prose, no code fences, no trailing commas, no comments."


def extract_json(content: str) -> str:
    """Strip a ``` fence, then return the outermost JSON array (preferred when it comes first) or object.
    Falls back to the trimmed text if nothing parses."""
    txt = (content or "").strip()
    fence = txt.find("```")
    if fence >= 0:
        nl = txt.find("\n", fence)
        end = txt.find("```", nl + 1) if nl >= 0 else -1
        if nl >= 0 and end > nl:
            txt = txt[nl + 1:end].strip()
    a, a_end = txt.find("["), txt.rfind("]")
    o, o_end = txt.find("{"), txt.rfind("}")
    cand = None
    if a >= 0 and a_end > a and (o < 0 or a < o):
        cand = txt[a:a_end + 1]
    elif o >= 0 and o_end > o:
        cand = txt[o:o_end + 1]
    if cand is not None:
        try:
            json.loads(cand)
            return cand
        except ValueError:
            pass
    return txt


def _parseable(s: str) -> bool:
    if not s or not s.strip():
        return False
    try:
        json.loads(s)
        return True
    except ValueError:
        return False


def _chat(kind: str, prompt: str, json_mode: bool, temperature: float) -> str:
    llm = get_llm()
    return llm.chat(SYSTEM.format(kind=kind), [{"role": "user", "content": prompt}],
                    json_mode=json_mode, temperature=temperature)


def complete_json(kind: str, prompt: str, temperature: float = 0.4) -> str:
    """Prompt-only JSON completion (array or object). Returns the cleaned JSON string (may be unparseable)."""
    return extract_json(_chat(kind, prompt, False, temperature))


def complete_json_object(kind: str, prompt: str, temperature: float = 0.4) -> str:
    """JSON-object completion with provider JSON mode and ONE bounded repair retry."""
    best = ""
    try:
        first = extract_json(_chat(kind, prompt, True, temperature))
        if _parseable(first):
            return first
        best = first
    except Exception as e:  # noqa: BLE001 — a provider hiccup gets the repair retry
        log.warning("lesson plan %s: first attempt failed: %s", kind, e)
    second = extract_json(_chat(kind, prompt + REPAIR, True, temperature))
    if _parseable(second):
        return second
    return best or second


def loads(s: str, default: Any = None) -> Any:
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default


def safe_array(s: str) -> list:
    v = loads(s)
    return v if isinstance(v, list) else []


def safe_string_array(s: str) -> list[str]:
    return [x for x in safe_array(s) if isinstance(x, str)]


def parse_or_raw(s: str) -> Any:
    v = loads(s, None)
    return s if v is None else v


def parse_or_error(s: str) -> Any:
    """Fail-closed: any parseable JSON passes through to the client's normaliser; otherwise an explicit marker."""
    v = loads(s, None)
    return {"error": "unparseable"} if v is None else v
