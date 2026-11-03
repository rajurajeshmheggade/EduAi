"""Lab worksheet: what the student does around the simulation, and how it is marked.

  aim / materials / steps      briefing + procedure checklist the student ticks while performing the simulation
  observation table            columns (with units) x rows the student fills from the simulation
  questions                    viva voce: MCQs (marked automatically) and short answers (AI-suggested marks)
  conclusion + record_marks    lab record (observations + conclusion), AI-suggested marks

AI uses the tutor LLM (AI_TUTOR_PROVIDER, else PROVIDER_MODE). It sees only the experiment's DIKSHA metadata (title,
description, keywords, resource names), never the licensed files, and the teacher reviews every draft before assigning.
Without an AI provider a plain worksheet is drafted and short answers / the record wait for the teacher.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from ...providers import get_tutor_llm
from .labs import ROLE_LABEL

log = logging.getLogger("eduai.virtual_labs")

MAX_QUESTIONS = 20
MAX_ROWS = 20


# ---------------------------------------------------------------- schema
class Question(BaseModel):
    id: str = Field(default="", max_length=12)
    type: Literal["mcq", "short"]
    prompt: str = Field(min_length=3, max_length=1000)
    options: list[str] = Field(default_factory=list, max_length=6)
    answer: int | None = None                       # MCQ: index of the correct option
    model_answer: str | None = Field(default=None, max_length=2000)
    explanation: str | None = Field(default=None, max_length=1000)
    marks: float = Field(default=1, ge=0.5, le=20)

    @field_validator("options")
    @classmethod
    def _options(cls, v: list[str]) -> list[str]:
        out = [o.strip()[:300] for o in v if o and o.strip()]
        if len({o.lower() for o in out}) != len(out):
            raise ValueError("options must be different from each other")
        return out

    @model_validator(mode="after")
    def _shape(self):
        if self.type == "mcq":
            if len(self.options) < 2:
                raise ValueError("a multiple-choice question needs at least two options")
            if self.answer is None or not 0 <= self.answer < len(self.options):
                raise ValueError("choose the correct option for every multiple-choice question")
        else:
            self.options, self.answer = [], None
        return self


class Worksheet(BaseModel):
    aim: str = Field(min_length=3, max_length=1000)
    materials: list[str] = Field(default_factory=list, max_length=20)
    steps: list[str] = Field(default_factory=list, max_length=20)
    observation_columns: list[str] = Field(default_factory=list, max_length=8)
    observation_rows: int = Field(default=0, ge=0, le=MAX_ROWS)
    questions: list[Question] = Field(default_factory=list, max_length=MAX_QUESTIONS)
    conclusion_prompt: str | None = Field(default=None, max_length=500)
    record_marks: float = Field(default=5, ge=0, le=50)

    @field_validator("materials", "steps", "observation_columns")
    @classmethod
    def _lines(cls, v: list[str]) -> list[str]:
        return [s.strip()[:300] for s in v if s and s.strip()]

    @model_validator(mode="after")
    def _ids(self):
        for i, q in enumerate(self.questions, 1):
            q.id = f"q{i}"
        if not self.observation_columns:
            self.observation_rows = 0
        elif not self.observation_rows:
            self.observation_rows = 3
        if not (self.questions or self.record_marks):
            raise ValueError("add at least one question or give marks for the lab record")
        return self


def max_marks(ws: dict) -> float:
    return round(float(ws.get("record_marks") or 0) + sum(float(q["marks"]) for q in ws.get("questions") or []), 2)


def for_student(ws: dict, reveal: bool) -> dict:
    """Worksheet as the student sees it: correct options, model answers and explanations only after submission."""
    if reveal:
        return ws
    hidden = ("answer", "model_answer", "explanation")
    return {**ws, "questions": [{k: v for k, v in q.items() if k not in hidden} for q in ws.get("questions") or []]}


# ---------------------------------------------------------------- drafting
def _grade(lab: dict) -> str:
    n = (lab.get("collection") or {}).get("class_number")
    return f"Class {n}" if n else "school"


def _brief(lab: dict) -> str:
    c = lab.get("collection") or {}
    lines = [f"Experiment: {lab['name']}", f"Class: {c.get('class_number') or 'not stated'}",
             f"Subject: {c.get('subject') or ', '.join(c.get('subjects') or []) or 'not stated'}",
             f"Lab manual: {c.get('name') or 'Virtual lab'}"]
    if lab.get("summary"):
        lines.append(f"Description: {lab['summary']}")
    if lab.get("keywords"):
        lines.append("Keywords: " + ", ".join(lab["keywords"]))
    names = [f"- {r['role']}: {r.get('name')}" for r in lab.get("resources") or []][:14]
    if names:
        lines.append("Resources available to the student:\n" + "\n".join(names))
    return "\n".join(lines)


DRAFT_SYSTEM = """You are an experienced CBSE/NCERT teacher in India preparing a virtual-lab worksheet for {grade} students.
The student performs the online (OLabs) simulation described below inside the school's LMS and keeps a lab record.
Never mention the website or platform the simulation comes from.
Return ONLY a JSON object:
{{"aim": "one sentence starting with 'To'",
  "materials": ["apparatus / chemicals / materials used in the simulation"],
  "steps": ["4-8 short imperative steps the student performs in the simulation, in order"],
  "observation_columns": ["2-5 column headings with units, e.g. 'Length of pendulum l (cm)'"],
  "observation_rows": 3,
  "questions": [
    {{"type": "mcq", "prompt": "...", "options": ["...", "...", "...", "..."], "answer": 0, "explanation": "why"}},
    {{"type": "short", "prompt": "...", "model_answer": "2-3 sentence answer"}}
  ],
  "conclusion_prompt": "question that makes the student state the result / conclusion"}}
Rules: 4 viva MCQs (four options, exactly one correct; vary the position of the correct answer) and 2 short-answer
questions that test understanding of this experiment, its principle, observations and precautions. Accurate NCERT
science / mathematics at {grade} level, simple Indian English. For an activity that is not a measurement experiment
(e.g. a language or social-science activity) the steps describe the activity and observation_columns may be empty."""


def offline_draft(lab: dict) -> dict:
    name = lab["name"].rstrip(".")
    aim = name if re.match(r"(?i)^to\b", name) else f"To study {name[:1].lower()}{name[1:]}"
    roles = set((lab.get("roles") or {}).keys()) or {r["role"] for r in lab.get("resources") or []}
    steps = ["Read the aim and the theory of the experiment."]
    if "simulation" in roles:
        steps += ["Open the simulation and follow its on-screen instructions.",
                  "Change one quantity at a time and watch what happens.",
                  "Record each reading or observation in the table."]
    else:
        steps += ["Read the procedure carefully and note the apparatus used.", "Write down what you expect to observe."]
    if "video" in roles:
        steps.append("Watch the animation to check your method.")
    steps.append("Write your conclusion and answer the questions.")
    ws = Worksheet(
        aim=aim + ".", steps=steps, observation_columns=["S. No.", "What I did / changed", "What I observed"], observation_rows=3,
        questions=[
            Question(type="short", prompt="What was the aim of this experiment? Write it in your own words.", marks=2,
                     model_answer=aim + "."),
            Question(type="short", prompt="Describe one important observation you made and explain it.", marks=2),
            Question(type="short", prompt="Write two precautions you would take while doing this experiment in a real laboratory.", marks=2),
        ],
        conclusion_prompt="What do you conclude from your observations?", record_marks=4)
    return ws.model_dump()


def _from_ai(d: dict) -> dict:
    qs = []
    for q in (d.get("questions") or [])[:MAX_QUESTIONS]:
        try:
            if q.get("type") == "mcq":
                qs.append(Question(type="mcq", prompt=str(q.get("prompt") or ""), options=[str(o) for o in q.get("options") or []][:6],
                                   answer=int(q.get("answer")), explanation=(str(q.get("explanation") or "") or None), marks=1))
            else:
                qs.append(Question(type="short", prompt=str(q.get("prompt") or ""),
                                   model_answer=(str(q.get("model_answer") or "") or None), marks=2))
        except (ValueError, TypeError):
            continue  # drop a malformed question, keep the rest
    rows = d.get("observation_rows")
    ws = Worksheet(aim=str(d.get("aim") or "").strip(), materials=[str(x) for x in d.get("materials") or []][:20],
                   steps=[str(x) for x in d.get("steps") or []][:20],
                   observation_columns=[str(x) for x in d.get("observation_columns") or []][:8],
                   observation_rows=min(max(int(rows), 0), MAX_ROWS) if isinstance(rows, (int, float)) else 3,
                   questions=qs, conclusion_prompt=(str(d.get("conclusion_prompt") or "") or None), record_marks=4)
    return ws.model_dump()


def draft(lab: dict) -> tuple[dict, str]:
    """(worksheet, engine). AI draft when a provider is configured, otherwise (or on failure) the plain worksheet."""
    llm = get_tutor_llm()
    if llm.name.startswith("mock"):
        return offline_draft(lab), "offline"
    try:
        raw = llm.chat(DRAFT_SYSTEM.format(grade=_grade(lab)), [{"role": "user", "content": _brief(lab)}],
                       json_mode=True, temperature=0.4)
        ws = _from_ai(json.loads(raw))
        if not ws["questions"]:
            raise ValueError("no usable questions")
        return ws, llm.name
    except Exception as e:  # noqa: BLE001 — the teacher still gets a worksheet to edit
        log.warning("virtual-lab worksheet draft failed for %s: %s", lab.get("lab_id"), type(e).__name__)
        return offline_draft(lab), "offline-fallback"


# ---------------------------------------------------------------- marking
def _text(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def checks(ws: dict, work: dict) -> dict:
    """Completeness of the lab record (shown to the teacher whatever the AI does)."""
    rows = [r for r in work.get("observations") or [] if isinstance(r, list) and any(_text(c) for c in r)]
    answers = work.get("answers") or {}
    answered = sum(1 for q in ws.get("questions") or []
                   if (q["type"] == "mcq" and isinstance(answers.get(q["id"]), int)) or (q["type"] == "short" and _text(answers.get(q["id"]))))
    return {"rows_filled": len(rows), "rows_expected": ws.get("observation_rows") or 0,
            "steps_done": len(work.get("steps_done") or []), "steps_total": len(ws.get("steps") or []),
            "answered": answered, "questions": len(ws.get("questions") or []),
            "conclusion_words": len(_text(work.get("conclusion")).split())}


def auto_mark(ws: dict, answers: dict) -> tuple[float, float, list[dict]]:
    """MCQs: (score, max, per-question results)."""
    score, top, results = 0.0, 0.0, []
    for q in ws.get("questions") or []:
        if q["type"] != "mcq":
            continue
        top += q["marks"]
        given = answers.get(q["id"])
        ok = isinstance(given, int) and given == q["answer"]
        score += q["marks"] if ok else 0
        results.append({"id": q["id"], "correct": ok, "marks": q["marks"] if ok else 0, "max": q["marks"]})
    return round(score, 2), round(top, 2), results


REVIEW_SYSTEM = """You are a fair, encouraging {grade} science teacher in India marking a student's virtual-lab record.
Experiment: {name}
Aim: {aim}
Return ONLY JSON:
{{"questions": [{{"id": "q2", "marks": 1.5, "feedback": "one or two sentences"}}],
  "record": {{"marks": 3, "feedback": "on the observations and conclusion"}},
  "overall": "two or three sentences of feedback to the student: one strength, one thing to improve"}}
Mark each short answer out of its maximum against the model answer (credit correct ideas in the student's own words;
half marks allowed). Mark the record out of {record_marks}: are the observations complete, sensible for this
experiment and consistent with the conclusion? Write feedback directly to the student ("You…"). Never invent readings."""


def _review_input(ws: dict, work: dict) -> str:
    answers = work.get("answers") or {}
    parts = ["SHORT ANSWERS:"]
    for q in ws.get("questions") or []:
        if q["type"] == "short":
            parts.append(f"[{q['id']}] (max {q['marks']}) {q['prompt']}\nModel answer: {q.get('model_answer') or 'not given'}\n"
                         f"Student: {_text(answers.get(q['id'])) or '(no answer)'}")
    cols = ws.get("observation_columns") or []
    if cols:
        parts.append("OBSERVATION TABLE (" + " | ".join(cols) + "):")
        for r in work.get("observations") or []:
            if isinstance(r, list) and any(_text(c) for c in r):
                parts.append(" | ".join(_text(c) or "-" for c in r))
    parts.append(f"CONCLUSION ({ws.get('conclusion_prompt') or 'Conclusion'}): {_text(work.get('conclusion')) or '(none)'}")
    return "\n".join(parts)[:9000]


def _clamp(v, top: float) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return round(min(max(x, 0.0), top) * 2) / 2


def evaluate(lab: dict, ws: dict, work: dict) -> dict:
    """Marks a submission: MCQs exactly, short answers + record with the AI (when available).
    Returns {auto_score, auto_max, suggested_marks, feedback}; suggested_marks is None when something still needs the teacher."""
    answers = work.get("answers") or {}
    score, top, mcq = auto_mark(ws, answers)
    short = [q for q in ws.get("questions") or [] if q["type"] == "short"]
    record_max = float(ws.get("record_marks") or 0)
    fb: dict = {"engine": None, "mcq": mcq, "questions": [], "record": None, "overall": None, "checks": checks(ws, work)}
    if not short and not record_max:
        return {"auto_score": score, "auto_max": top, "suggested_marks": score, "feedback": fb}
    llm = get_tutor_llm()
    if llm.name.startswith("mock"):
        fb["engine"] = "offline"
        return {"auto_score": score, "auto_max": top, "suggested_marks": None, "feedback": fb}
    try:
        raw = llm.chat(REVIEW_SYSTEM.format(grade=_grade(lab), name=lab["name"], aim=ws["aim"], record_marks=record_max),
                       [{"role": "user", "content": _review_input(ws, work)}], json_mode=True, temperature=0.2)
        d = json.loads(raw)
        by_id = {str(x.get("id")): x for x in d.get("questions") or [] if isinstance(x, dict)}
        total = score
        for q in short:
            got = by_id.get(q["id"]) or {}
            m = _clamp(got.get("marks"), q["marks"]) if _text(answers.get(q["id"])) else 0.0
            if m is None:
                raise ValueError(f"no marks for {q['id']}")
            total += m
            fb["questions"].append({"id": q["id"], "marks": m, "max": q["marks"], "feedback": _text(got.get("feedback"))[:600] or None})
        if record_max:
            rec = d.get("record") if isinstance(d.get("record"), dict) else {}
            rm = _clamp(rec.get("marks"), record_max)
            if rm is None:
                raise ValueError("no record marks")
            total += rm
            fb["record"] = {"marks": rm, "max": record_max, "feedback": _text(rec.get("feedback"))[:800] or None}
        fb["overall"] = _text(d.get("overall"))[:800] or None
        fb["engine"] = llm.name
        return {"auto_score": score, "auto_max": top, "suggested_marks": round(total, 2), "feedback": fb}
    except Exception as e:  # noqa: BLE001 — submission never fails because of the AI; the teacher marks it
        log.warning("virtual-lab AI marking failed for %s: %s", lab.get("lab_id"), type(e).__name__)
        fb.update({"engine": "offline-fallback", "questions": [], "record": None, "overall": None})
        return {"auto_score": score, "auto_max": top, "suggested_marks": None, "feedback": fb}


# ---------------------------------------------------------------- lab assistant
ASSIST_SYSTEM = """You are a friendly lab assistant helping a {grade} student who is doing the virtual lab "{name}" right now.
Aim: {aim}
Procedure the student follows:
{steps}
Help the student perform the simulation and understand the science behind what they see: explain ideas simply, give
hints and guiding questions, point to the theory / procedure / animation resources of this lab, and suggest safety
precautions for the real laboratory. The student's worksheet questions are listed below: do NOT answer them directly
or write the student's conclusion or readings for them; guide them to work it out. Answer in at most 120 words of
simple Indian English, no markdown headings.
Worksheet questions (do not answer directly):
{questions}"""


def assist(lab: dict, ws: dict, question: str, history: list[dict]) -> tuple[str, str]:
    """(answer, engine)."""
    llm = get_tutor_llm()
    if llm.name.startswith("mock"):
        names = [ROLE_LABEL[r["role"]] for r in lab.get("resources") or [] if r["role"] in ("theory", "procedure", "manual", "video")]
        hint = f" The {', '.join(dict.fromkeys(names))} resources of this lab can help too." if names else ""
        return ("The AI lab assistant is not switched on for this school yet. Meanwhile, re-read the aim, follow the "
                "procedure checklist one step at a time, and change only one thing at a time in the simulation." + hint), "offline"
    system = ASSIST_SYSTEM.format(grade=_grade(lab), name=lab["name"], aim=ws["aim"],
                                  steps="\n".join(f"{i}. {s}" for i, s in enumerate(ws.get("steps") or [], 1)) or "(not given)",
                                  questions="\n".join(f"- {q['prompt']}" for q in ws.get("questions") or []) or "(none)")
    msgs = [{"role": m["role"], "content": m["content"][:1500]} for m in history[-6:] if m.get("role") in ("user", "assistant")]
    msgs.append({"role": "user", "content": question})
    try:
        return llm.chat(system, msgs, temperature=0.4).strip()[:2000], llm.name
    except Exception as e:  # noqa: BLE001
        log.warning("virtual-lab assistant failed for %s: %s", lab.get("lab_id"), type(e).__name__)
        return "Sorry, the lab assistant could not answer just now. Please try again in a moment.", "offline-fallback"
