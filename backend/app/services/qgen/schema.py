"""The question-type catalogue and its typed schemas (one Pydantic model per type, discriminated by `type`).

Seventeen types, modelled on the AI RAPID DEV assessment studio (MCQ, MRQ, True/False, Fill in the blanks, Match,
Assertion–Reason, Short answer) plus the CBSE paper types it lacks as authoring types (one-word, long answer, essay,
case / scenario / passage-based with sub-questions, HOTS, diagram-based, numerical and arrange-in-order). Every
rich field is sanitised (richtext.sanitize) and length-checked on its visible text, using RAPID's limits
(questionLimits.ts: stem 2000 / short-answer stem 3000 / answer 2000 / option 500 / statement 1000 / hint 300 /
alternate 100 / title 200).
"""
from __future__ import annotations

import random
import re
import uuid
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

from . import richtext

QType = Literal["MCQ", "MRQ", "TRUE_FALSE", "FILL_BLANK", "MATCH", "ONE_WORD", "SHORT_ANSWER", "LONG_ANSWER", "ESSAY",
                "ASSERTION_REASON", "CASE_BASED", "SCENARIO_BASED", "HOTS", "DIAGRAM", "PASSAGE", "NUMERICAL",
                "ORDERING"]
Difficulty = Literal["EASY", "MEDIUM", "HARD"]
Bloom = Literal["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"]
Origin = Literal["AI", "MANUAL", "BANK"]
Language = Literal["en", "hi", "kn", "ta"]

LIMITS = {"question": 2000, "short_question": 3000, "passage": 8000, "answer": 2000, "long_answer": 6000,
          "essay_answer": 8000, "option": 500, "statement": 1000, "hint": 300, "alternate": 100, "title": 200,
          "point": 300, "explanation": 3000}

COMPOSITE = ("CASE_BASED", "SCENARIO_BASED", "PASSAGE")
HIGHER_ORDER = ("ANALYZE", "EVALUATE", "CREATE")
LANGUAGES = [{"code": "en", "label": "English"}, {"code": "hi", "label": "हिंदी (Hindi)"},
             {"code": "kn", "label": "ಕನ್ನಡ (Kannada)"}, {"code": "ta", "label": "தமிழ் (Tamil)"}]
LANGUAGE_NAMES = {"en": "English", "hi": "Hindi", "kn": "Kannada", "ta": "Tamil"}
DIFFICULTIES = [{"code": "EASY", "label": "Easy"}, {"code": "MEDIUM", "label": "Medium"}, {"code": "HARD", "label": "Hard"}]
BLOOMS = [{"code": "REMEMBER", "label": "Remember"}, {"code": "UNDERSTAND", "label": "Understand"},
          {"code": "APPLY", "label": "Apply"}, {"code": "ANALYZE", "label": "Analyze"},
          {"code": "EVALUATE", "label": "Evaluate"}, {"code": "CREATE", "label": "Create"}]

AR_INSTRUCTION_DEFAULT = ("Two statements are given, one labelled as Assertion (A) and the other is labelled as Reason "
                          "(R). Select the correct answer to these questions from the codes (A), (B), (C) and (D) as "
                          "given below.")
AR_CODES_DEFAULT = [
    "Both Assertion (A) and Reason (R) are true and Reason (R) is the correct explanation of the Assertion (A).",
    "Both Assertion (A) and Reason (R) are true, but Reason (R) is not the correct explanation of the Assertion (A).",
    "Assertion (A) is true, but Reason (R) is false.",
    "Assertion (A) is false, but Reason (R) is true.",
]

# ════════════════════════════════════════════════════════════ catalogue (served to the UI: GET /qgen/meta)
# options: the type-specific generator inputs — {key: {label, kind: int|bool|choice, min, max, default, choices}}
TYPE_CATALOGUE: list[dict[str, Any]] = [
    {"code": "MCQ", "label": "Multiple Choice (MCQ)", "group": "Objective", "default_marks": 1, "auto_gradable": True,
     "description": "One correct option among 2–8 (default 4).",
     "options": {"option_count": {"label": "Options", "kind": "int", "min": 2, "max": 6, "default": 4},
                 "layout": {"label": "Option layout", "kind": "choice", "default": "list",
                            "choices": [["list", "One per line"], ["two", "Two columns"], ["four", "Four columns"]]}}},
    {"code": "MRQ", "label": "Multiple Response (MRQ)", "group": "Objective", "default_marks": 2, "auto_gradable": False,
     "description": "Two or more correct options; partial credit max(0, (right − wrong) / total correct) × marks.",
     "options": {"option_count": {"label": "Options", "kind": "int", "min": 4, "max": 8, "default": 5},
                 "correct_count": {"label": "Correct options", "kind": "int", "min": 2, "max": 4, "default": 2}}},
    {"code": "TRUE_FALSE", "label": "True / False", "group": "Objective", "default_marks": 1, "auto_gradable": True,
     "description": "One or more statements, each True or False; marks split per statement.",
     "options": {"statements": {"label": "Statements per question", "kind": "int", "min": 1, "max": 5, "default": 1}}},
    {"code": "FILL_BLANK", "label": "Fill in the Blanks", "group": "Objective", "default_marks": 1, "auto_gradable": False,
     "description": "Blanks written as [answer] in the text; alternates, case sensitivity, optional word bank.",
     "options": {"blanks": {"label": "Blanks per question", "kind": "int", "min": 1, "max": 3, "default": 1},
                 "word_bank": {"label": "Show a word bank", "kind": "bool", "default": False}}},
    {"code": "MATCH", "label": "Match the Following", "group": "Objective", "default_marks": 4, "auto_gradable": False,
     "description": "Pairs of Column I and Column II; Column II is shuffled on the paper.",
     "options": {"pairs": {"label": "Pairs", "kind": "int", "min": 2, "max": 8, "default": 4},
                 "per_pair_marks": {"label": "Marks per pair", "kind": "bool", "default": True}}},
    {"code": "ONE_WORD", "label": "One-Word Answer (VSA)", "group": "Objective", "default_marks": 1, "auto_gradable": False,
     "description": "A very short answer: one word or term.", "options": {}},
    {"code": "ASSERTION_REASON", "label": "Assertion and Reasoning", "group": "Objective", "default_marks": 1,
     "auto_gradable": True, "description": "Assertion (A) and Reason (R) with the four standard codes A–D.", "options": {}},
    {"code": "NUMERICAL", "label": "Numerical", "group": "Objective", "default_marks": 2, "auto_gradable": False,
     "description": "A calculation with a numeric answer, unit and tolerance.",
     "options": {"tolerance_percent": {"label": "Tolerance (%)", "kind": "int", "min": 0, "max": 10, "default": 0}}},
    {"code": "ORDERING", "label": "Arrange in Order", "group": "Objective", "default_marks": 2, "auto_gradable": False,
     "description": "Put steps or events in the correct sequence.",
     "options": {"items": {"label": "Items to arrange", "kind": "int", "min": 3, "max": 8, "default": 4}}},
    {"code": "SHORT_ANSWER", "label": "Short Answer", "group": "Subjective", "default_marks": 2, "auto_gradable": False,
     "description": "Two to three sentences; model answer and key points.",
     "options": {"key_points": {"label": "Key points", "kind": "int", "min": 2, "max": 5, "default": 3}}},
    {"code": "LONG_ANSWER", "label": "Long Answer", "group": "Subjective", "default_marks": 5, "auto_gradable": False,
     "description": "A detailed answer; model answer and marking points.",
     "options": {"marking_points": {"label": "Marking points", "kind": "int", "min": 3, "max": 8, "default": 5}}},
    {"code": "ESSAY", "label": "Descriptive / Essay", "group": "Subjective", "default_marks": 10, "auto_gradable": False,
     "description": "An open answer with a model answer and a marking rubric.",
     "options": {"word_limit": {"label": "Word limit", "kind": "int", "min": 100, "max": 1500, "default": 300}}},
    {"code": "HOTS", "label": "HOTS (Higher-Order Thinking)", "group": "Subjective", "default_marks": 4,
     "auto_gradable": False, "description": "An Analyse / Evaluate / Create question with a model answer.",
     "options": {"key_points": {"label": "Key points", "kind": "int", "min": 2, "max": 5, "default": 3}}},
    {"code": "DIAGRAM", "label": "Diagram-Based", "group": "Subjective", "default_marks": 3, "auto_gradable": False,
     "description": "Refers to a diagram: upload one, or the AI describes the diagram to draw and label.",
     "options": {"labels": {"label": "Labels", "kind": "int", "min": 2, "max": 8, "default": 4}}},
    {"code": "CASE_BASED", "label": "Case-Based", "group": "Composite", "default_marks": 4, "auto_gradable": False,
     "description": "A case followed by sub-questions of mixed types.",
     "options": {"sub_questions": {"label": "Sub-questions", "kind": "int", "min": 2, "max": 6, "default": 4},
                 "numbering": {"label": "Numbering", "kind": "choice", "default": "alpha",
                               "choices": [["alpha", "(a), (b), (c)"], ["roman", "(i), (ii), (iii)"]]}}},
    {"code": "SCENARIO_BASED", "label": "Scenario-Based", "group": "Composite", "default_marks": 4, "auto_gradable": False,
     "description": "A real-life scenario followed by application sub-questions.",
     "options": {"sub_questions": {"label": "Sub-questions", "kind": "int", "min": 2, "max": 6, "default": 3},
                 "numbering": {"label": "Numbering", "kind": "choice", "default": "alpha",
                               "choices": [["alpha", "(a), (b), (c)"], ["roman", "(i), (ii), (iii)"]]}}},
    {"code": "PASSAGE", "label": "Passage-Based / Comprehension", "group": "Composite", "default_marks": 5,
     "auto_gradable": False, "description": "A reading passage followed by comprehension sub-questions.",
     "options": {"sub_questions": {"label": "Sub-questions", "kind": "int", "min": 2, "max": 6, "default": 4},
                 "numbering": {"label": "Numbering", "kind": "choice", "default": "roman",
                               "choices": [["alpha", "(a), (b), (c)"], ["roman", "(i), (ii), (iii)"]]}}},
]
TYPES = {t["code"]: t for t in TYPE_CATALOGUE}
TYPE_LABELS = {t["code"]: t["label"] for t in TYPE_CATALOGUE}

# ════════════════════════════════════════════════════════════ normalisation (RAPID taxonomyMatch.ts aliases)
_BLOOM_ALIASES = {
    "remember": "REMEMBER", "remembering": "REMEMBER", "knowledge": "REMEMBER", "knowing": "REMEMBER", "know": "REMEMBER",
    "recall": "REMEMBER", "recalling": "REMEMBER", "understand": "UNDERSTAND", "understanding": "UNDERSTAND",
    "comprehension": "UNDERSTAND", "comprehend": "UNDERSTAND", "comprehending": "UNDERSTAND", "apply": "APPLY",
    "applying": "APPLY", "application": "APPLY", "applied": "APPLY", "analyse": "ANALYZE", "analyze": "ANALYZE",
    "analysing": "ANALYZE", "analyzing": "ANALYZE", "analysis": "ANALYZE", "analytical": "ANALYZE",
    "evaluate": "EVALUATE", "evaluating": "EVALUATE", "evaluation": "EVALUATE", "create": "CREATE",
    "creating": "CREATE", "creation": "CREATE", "creative": "CREATE", "synthesis": "CREATE", "synthesise": "CREATE",
    "synthesize": "CREATE", "synthesising": "CREATE", "synthesizing": "CREATE",
}
_DIFFICULTY_ALIASES = {"easy": "EASY", "simple": "EASY", "low": "EASY", "medium": "MEDIUM", "moderate": "MEDIUM",
                       "average": "MEDIUM", "intermediate": "MEDIUM", "hard": "HARD", "difficult": "HARD",
                       "high": "HARD", "challenging": "HARD", "tough": "HARD"}


def normalise_bloom(v: Any) -> str | None:
    key = re.sub(r"[^a-z]", "", str(v or "").lower())
    return _BLOOM_ALIASES.get(key)


def normalise_difficulty(v: Any) -> str | None:
    key = re.sub(r"[^a-z]", "", str(v or "").lower())
    return _DIFFICULTY_ALIASES.get(key)


def default_marks(qtype: str, difficulty: str = "MEDIUM", parts: int = 1) -> float:
    """Marks assigned automatically when the teacher leaves them blank: per type, per part for the multi-part
    objective types, one more for a Hard subjective question."""
    if qtype in ("TRUE_FALSE", "FILL_BLANK"):
        return float(max(1, parts))
    if qtype == "MATCH":
        return float(max(2, parts))
    base = float(TYPES[qtype]["default_marks"])
    if difficulty == "HARD" and qtype in ("SHORT_ANSWER", "LONG_ANSWER", "HOTS", "NUMERICAL", "DIAGRAM"):
        base += 1
    return base


def share_marks(total: float, count: int) -> list[float]:
    """Even split with the remainder on the first part (RAPID questionScoring.ts shareMarks)."""
    if count <= 1:
        return [round(total, 2)]
    each = round(total / count, 2)
    shares = [each] * count
    shares[0] = round(total - each * (count - 1), 2)
    return shares


def mrq_score(marks: float, right: int, wrong: int, total_correct: int) -> float:
    """MRQ partial credit: max(0, (right − wrong) / totalCorrect) × marks."""
    if total_correct <= 0:
        return 0.0
    return round(max(0.0, (right - wrong) / total_correct) * marks, 2)


def new_id(prefix: str = "") -> str:
    return prefix + uuid.uuid4().hex[:12]


# ════════════════════════════════════════════════════════════ field helpers
Id = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_\-]+$")]


def _rich(v: Any, limit: int, what: str, required: bool = True) -> str:
    out = richtext.sanitize(v)
    n = richtext.plain_len(out)
    if required and n == 0:
        raise ValueError(f"{what} is required")
    if n > limit:
        raise ValueError(f"{what} is too long ({n} characters, at most {limit})")
    return out


def _plain(v: Any, limit: int, what: str, required: bool = True) -> str:
    out = re.sub(r"\s+", " ", richtext.plain(richtext.sanitize(v)) if isinstance(v, str) and "<" in v else str(v or "")).strip()
    if required and not out:
        raise ValueError(f"{what} is required")
    if len(out) > limit:
        raise ValueError(f"{what} is too long ({len(out)} characters, at most {limit})")
    return out


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Option(_M):
    id: Id
    text: str

    @field_validator("text", mode="before")
    @classmethod
    def _t(cls, v):
        return _rich(v, LIMITS["option"], "Option text")


class MrqOption(Option):
    correct: bool = False


class Statement(_M):
    id: Id
    text: str
    answer: bool

    @field_validator("text", mode="before")
    @classmethod
    def _t(cls, v):
        return _rich(v, LIMITS["statement"], "Statement")


class BlankRule(_M):
    alternates: list[str] = Field(default_factory=list, max_length=5)
    case_sensitive: bool = False

    @field_validator("alternates", mode="before")
    @classmethod
    def _a(cls, v):
        return [_plain(x, LIMITS["alternate"], "Alternate answer") for x in (v or []) if str(x or "").strip()]


class Pair(_M):
    id: Id
    left: str
    right: str

    @field_validator("left", "right", mode="before")
    @classmethod
    def _t(cls, v):
        return _rich(v, LIMITS["option"], "Match entry")


class MarkPoint(_M):
    text: str
    marks: float = Field(default=1, ge=0, le=100)

    @field_validator("text", mode="before")
    @classmethod
    def _t(cls, v):
        return _plain(v, LIMITS["point"], "Point")


class OrderItem(_M):
    id: Id
    text: str

    @field_validator("text", mode="before")
    @classmethod
    def _t(cls, v):
        return _rich(v, LIMITS["option"], "Item")


class Media(_M):
    media_id: uuid.UUID
    caption: str = Field(default="", max_length=200)


def _points(v: Any) -> list[str]:
    return [_plain(x, LIMITS["point"], "Key point") for x in (v or []) if str(x or "").strip()]


def _derangement(ids: list[str], seed: str) -> list[str]:
    """A deterministic shuffle where (when possible) no item keeps its place — used for Column II and ordering."""
    if len(ids) < 2:
        return list(ids)
    rng = random.Random(seed)
    for _ in range(50):
        out = ids[:]
        rng.shuffle(out)
        if all(a != b for a, b in zip(out, ids)):
            return out
    return ids[1:] + ids[:1]


# ════════════════════════════════════════════════════════════ type data
class McqData(_M):
    options: list[Option] = Field(min_length=2, max_length=8)
    correct: Id
    layout: Literal["list", "two", "four"] = "list"

    @model_validator(mode="after")
    def _v(self):
        ids = [o.id for o in self.options]
        if len(set(ids)) != len(ids):
            raise ValueError("Option ids must be unique")
        if self.correct not in ids:
            raise ValueError("Choose the correct option")
        return self


class MrqData(_M):
    options: list[MrqOption] = Field(min_length=4, max_length=8)
    partial_credit: bool = True

    @model_validator(mode="after")
    def _v(self):
        ids = [o.id for o in self.options]
        if len(set(ids)) != len(ids):
            raise ValueError("Option ids must be unique")
        n = sum(o.correct for o in self.options)
        if n < 2:
            raise ValueError("A multiple-response question needs at least two correct options")
        if n == len(self.options):
            raise ValueError("At least one option must be incorrect")
        return self


class TrueFalseData(_M):
    statements: list[Statement] = Field(min_length=1, max_length=10)


class FillBlankData(_M):
    blanks: list[BlankRule] = Field(default_factory=list, max_length=10)
    word_bank: bool = False
    distractors: list[str] = Field(default_factory=list, max_length=6)

    @field_validator("distractors", mode="before")
    @classmethod
    def _d(cls, v):
        return [_plain(x, LIMITS["alternate"], "Word-bank word") for x in (v or []) if str(x or "").strip()]


class MatchData(_M):
    pairs: list[Pair] = Field(min_length=2, max_length=10)
    right_order: list[Id] = Field(default_factory=list)
    per_pair_marks: bool = True
    left_title: str = Field(default="Column I", max_length=60)
    right_title: str = Field(default="Column II", max_length=60)

    @model_validator(mode="after")
    def _v(self):
        ids = [p.id for p in self.pairs]
        if len(set(ids)) != len(ids):
            raise ValueError("Pair ids must be unique")
        if sorted(self.right_order) != sorted(ids):
            self.right_order = _derangement(ids, "|".join(ids))
        return self


class OneWordData(_M):
    answer: str
    alternates: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("answer", mode="before")
    @classmethod
    def _a(cls, v):
        return _plain(v, LIMITS["alternate"], "Answer")

    @field_validator("alternates", mode="before")
    @classmethod
    def _alt(cls, v):
        return [_plain(x, LIMITS["alternate"], "Alternate answer") for x in (v or []) if str(x or "").strip()]


class ShortAnswerData(_M):
    model_answer: str
    key_points: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("model_answer", mode="before")
    @classmethod
    def _m(cls, v):
        return _rich(v, LIMITS["answer"], "Model answer")

    @field_validator("key_points", mode="before")
    @classmethod
    def _k(cls, v):
        return _points(v)


class HotsData(ShortAnswerData):
    @field_validator("model_answer", mode="before")
    @classmethod
    def _m(cls, v):
        return _rich(v, 4000, "Model answer")


class LongAnswerData(_M):
    model_answer: str
    marking_points: list[MarkPoint] = Field(default_factory=list, max_length=12)

    @field_validator("model_answer", mode="before")
    @classmethod
    def _m(cls, v):
        return _rich(v, LIMITS["long_answer"], "Model answer")


class EssayData(_M):
    model_answer: str
    rubric: list[MarkPoint] = Field(default_factory=list, max_length=10)
    word_limit: int | None = Field(default=None, ge=20, le=3000)

    @field_validator("model_answer", mode="before")
    @classmethod
    def _m(cls, v):
        return _rich(v, LIMITS["essay_answer"], "Model answer")


class AssertionReasonData(_M):
    assertion: str
    reason: str
    answer: Literal["A", "B", "C", "D"]

    @field_validator("assertion", "reason", mode="before")
    @classmethod
    def _t(cls, v):
        return _rich(v, LIMITS["statement"], "Assertion / reason")

    @field_validator("answer", mode="before")
    @classmethod
    def _a(cls, v):
        return str(v or "").strip().strip("()").upper()[:1]


class DiagramData(_M):
    diagram_description: str = ""
    labels: list[str] = Field(default_factory=list, max_length=12)
    model_answer: str
    key_points: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("diagram_description", mode="before")
    @classmethod
    def _d(cls, v):
        return _plain(v, 1000, "Diagram description", required=False)

    @field_validator("labels", mode="before")
    @classmethod
    def _l(cls, v):
        return [_plain(x, 80, "Label") for x in (v or []) if str(x or "").strip()]

    @field_validator("model_answer", mode="before")
    @classmethod
    def _m(cls, v):
        return _rich(v, 3000, "Model answer")

    @field_validator("key_points", mode="before")
    @classmethod
    def _k(cls, v):
        return _points(v)


class NumericalData(_M):
    answer: float
    unit: str = Field(default="", max_length=30)
    tolerance: float = Field(default=0, ge=0)
    solution: str = ""

    @field_validator("solution", mode="before")
    @classmethod
    def _s(cls, v):
        return _rich(v, LIMITS["explanation"], "Solution", required=False)

    @field_validator("unit", mode="before")
    @classmethod
    def _u(cls, v):
        return _plain(v, 30, "Unit", required=False)


class OrderingData(_M):
    items: list[OrderItem] = Field(min_length=3, max_length=10)   # in the CORRECT order
    display_order: list[Id] = Field(default_factory=list)          # as printed on the paper

    @model_validator(mode="after")
    def _v(self):
        ids = [i.id for i in self.items]
        if len(set(ids)) != len(ids):
            raise ValueError("Item ids must be unique")
        if sorted(self.display_order) != sorted(ids) or self.display_order == ids:
            self.display_order = _derangement(ids, "order|" + "|".join(ids))
        return self


# ════════════════════════════════════════════════════════════ questions
class _QBase(_M):
    id: Id = Field(default_factory=lambda: new_id("q"))
    text: str
    marks: float = Field(gt=0, le=100)
    difficulty: Difficulty = "MEDIUM"
    bloom: Bloom = "UNDERSTAND"
    topic: str = Field(default="", max_length=300)
    hint: str = ""
    explanation: str = ""
    media: list[Media] = Field(default_factory=list, max_length=4)
    source_refs: list[Id] = Field(default_factory=list, max_length=40)
    origin: Origin = "MANUAL"
    bank_id: uuid.UUID | None = None

    @field_validator("text", mode="before")
    @classmethod
    def _text(cls, v):
        return _rich(v, LIMITS["question"], "Question text")

    @field_validator("hint", mode="before")
    @classmethod
    def _hint(cls, v):
        return _plain(v, LIMITS["hint"], "Hint", required=False)

    @field_validator("explanation", mode="before")
    @classmethod
    def _expl(cls, v):
        return _rich(v, LIMITS["explanation"], "Explanation", required=False)

    @field_validator("difficulty", mode="before")
    @classmethod
    def _diff(cls, v):
        return normalise_difficulty(v) or v

    @field_validator("bloom", mode="before")
    @classmethod
    def _bloom(cls, v):
        return normalise_bloom(v) or v

    @field_validator("marks", mode="before")
    @classmethod
    def _marks(cls, v):
        try:
            return round(float(v), 2)
        except (TypeError, ValueError):
            return v


class McqQ(_QBase):
    type: Literal["MCQ"]
    data: McqData


class MrqQ(_QBase):
    type: Literal["MRQ"]
    data: MrqData


class TrueFalseQ(_QBase):
    type: Literal["TRUE_FALSE"]
    data: TrueFalseData

    @field_validator("text", mode="before")
    @classmethod
    def _text(cls, v):  # the statements carry the content; the stem is optional ("State True or False")
        return _rich(v, LIMITS["question"], "Question text", required=False) or "State whether the following statements are True or False."


_BLANK = re.compile(r"\[([^\[\]\n]{1,100})\]")


def blanks_of(text_html: str) -> list[str]:
    """The [answer] markers of a fill-in-the-blank question, in reading order (equations excluded)."""
    no_math = re.sub(r'<span class="math"[^>]*>.*?</span>', " ", text_html or "", flags=re.S)
    return [m.strip() for m in _BLANK.findall(richtext.plain(no_math, math="latex"))]


class FillBlankQ(_QBase):
    type: Literal["FILL_BLANK"]
    data: FillBlankData

    @model_validator(mode="after")
    def _v(self):
        answers = blanks_of(self.text)
        if not answers:
            raise ValueError("Write each blank's answer in square brackets, e.g. “Water boils at [100] °C”")
        if len(answers) > 10:
            raise ValueError("At most 10 blanks per question")
        rules = list(self.data.blanks[:len(answers)])
        rules += [BlankRule() for _ in range(len(answers) - len(rules))]
        self.data.blanks = rules
        return self


class MatchQ(_QBase):
    type: Literal["MATCH"]
    data: MatchData

    @field_validator("text", mode="before")
    @classmethod
    def _text(cls, v):
        return _rich(v, LIMITS["title"], "Title", required=False) or "Match the items in Column I with those in Column II."


class OneWordQ(_QBase):
    type: Literal["ONE_WORD"]
    data: OneWordData


class ShortAnswerQ(_QBase):
    type: Literal["SHORT_ANSWER"]
    data: ShortAnswerData

    @field_validator("text", mode="before")
    @classmethod
    def _text(cls, v):
        return _rich(v, LIMITS["short_question"], "Question text")


class LongAnswerQ(_QBase):
    type: Literal["LONG_ANSWER"]
    data: LongAnswerData


class EssayQ(_QBase):
    type: Literal["ESSAY"]
    data: EssayData


class AssertionReasonQ(_QBase):
    type: Literal["ASSERTION_REASON"]
    data: AssertionReasonData

    @field_validator("text", mode="before")
    @classmethod
    def _text(cls, v):
        return _rich(v, LIMITS["question"], "Question text", required=False) or "Assertion–Reason"


class HotsQ(_QBase):
    type: Literal["HOTS"]
    data: HotsData

    @model_validator(mode="after")
    def _v(self):
        if self.bloom not in HIGHER_ORDER:
            raise ValueError("A HOTS question must be at Bloom level Analyze, Evaluate or Create")
        return self


class DiagramQ(_QBase):
    type: Literal["DIAGRAM"]
    data: DiagramData

    @model_validator(mode="after")
    def _v(self):
        if not self.media and not self.data.diagram_description:
            raise ValueError("A diagram-based question needs an image or a description of the diagram")
        return self


class NumericalQ(_QBase):
    type: Literal["NUMERICAL"]
    data: NumericalData


class OrderingQ(_QBase):
    type: Literal["ORDERING"]
    data: OrderingData

    @field_validator("text", mode="before")
    @classmethod
    def _text(cls, v):
        return _rich(v, LIMITS["question"], "Question text", required=False) or "Arrange the following in the correct order."


SubQuestion = Annotated[Union[McqQ, MrqQ, TrueFalseQ, FillBlankQ, MatchQ, OneWordQ, ShortAnswerQ, LongAnswerQ, EssayQ,
                              AssertionReasonQ, HotsQ, DiagramQ, NumericalQ, OrderingQ], Field(discriminator="type")]


class CompositeData(_M):
    passage: str
    passage_title: str = Field(default="", max_length=200)
    sub_questions: list[SubQuestion] = Field(min_length=1, max_length=8)
    numbering: Literal["alpha", "roman"] = "alpha"

    @field_validator("passage", mode="before")
    @classmethod
    def _p(cls, v):
        return _rich(v, LIMITS["passage"], "Passage / case text")


class _CompositeQ(_QBase):
    data: CompositeData

    @model_validator(mode="before")
    @classmethod
    def _sum_marks(cls, v):
        """The marks of a composite question are always the sum of its sub-questions' marks."""
        if isinstance(v, dict) and isinstance(v.get("data"), dict):
            try:
                total = sum(float(s.get("marks") or 0) for s in v["data"].get("sub_questions") or [])
                if total > 0:
                    v = {**v, "marks": round(total, 2)}
            except (TypeError, ValueError, AttributeError):
                pass
        return v


class CaseBasedQ(_CompositeQ):
    type: Literal["CASE_BASED"]


class ScenarioBasedQ(_CompositeQ):
    type: Literal["SCENARIO_BASED"]


class PassageQ(_CompositeQ):
    type: Literal["PASSAGE"]


Question = Annotated[Union[McqQ, MrqQ, TrueFalseQ, FillBlankQ, MatchQ, OneWordQ, ShortAnswerQ, LongAnswerQ, EssayQ,
                           AssertionReasonQ, HotsQ, DiagramQ, NumericalQ, OrderingQ, CaseBasedQ, ScenarioBasedQ,
                           PassageQ], Field(discriminator="type")]
QuestionAdapter: TypeAdapter = TypeAdapter(Question)


def validate_question(raw: dict) -> dict:
    """Validate + normalise one question; returns the JSON-ready dict. Raises pydantic.ValidationError."""
    return QuestionAdapter.validate_python(raw).model_dump(mode="json")


def error_text(e: Exception) -> str:
    errs = getattr(e, "errors", None)
    if callable(errs):
        parts = []
        for x in errs()[:4]:
            loc = ".".join(str(p) for p in x.get("loc", ()) if not isinstance(p, int) and p not in QType.__args__)
            msg = str(x.get("msg", "")).removeprefix("Value error, ")
            parts.append(f"{loc}: {msg}" if loc else msg)
        return "; ".join(parts)
    return str(e)


# ════════════════════════════════════════════════════════════ text views used by de-dup, bank search, grounding
def question_plain(q: dict) -> str:
    """Everything a reader sees in the question (stem + parts), as plain text with $latex$."""
    d, t = q.get("data") or {}, q.get("type")
    parts = [richtext.plain(q.get("text"))]
    if t in ("MCQ", "MRQ"):
        parts += [richtext.plain(o["text"]) for o in d.get("options", [])]
    elif t == "TRUE_FALSE":
        parts += [richtext.plain(s["text"]) for s in d.get("statements", [])]
    elif t == "MATCH":
        parts += [richtext.plain(p["left"]) + " " + richtext.plain(p["right"]) for p in d.get("pairs", [])]
    elif t == "ASSERTION_REASON":
        parts += [richtext.plain(d.get("assertion")), richtext.plain(d.get("reason"))]
    elif t == "ORDERING":
        parts += [richtext.plain(i["text"]) for i in d.get("items", [])]
    elif t in COMPOSITE:
        parts.append(richtext.plain(d.get("passage")))
        parts += [question_plain(s) for s in d.get("sub_questions", [])]
    elif t == "DIAGRAM":
        parts.append(d.get("diagram_description", ""))
    return "\n".join(p for p in parts if p)


def stem_plain(q: dict) -> str:
    """The part that identifies a question for duplicate checks (generic stems fall back to their content)."""
    t = q.get("type")
    if t in ("MCQ", "MRQ", "TRUE_FALSE", "MATCH", "ORDERING", "ASSERTION_REASON") or t in COMPOSITE:
        return question_plain(q)
    return richtext.plain(q.get("text"))


def answer_plain(q: dict) -> str:
    """The answer key of a question as plain text (used for grounding checks and the online-test mapping)."""
    d, t = q.get("data") or {}, q.get("type")
    if t == "MCQ":
        o = next((o for o in d["options"] if o["id"] == d["correct"]), None)
        return richtext.plain(o["text"]) if o else ""
    if t == "MRQ":
        return "; ".join(richtext.plain(o["text"]) for o in d["options"] if o.get("correct"))
    if t == "TRUE_FALSE":
        return "; ".join(f"{i + 1}. {'True' if s['answer'] else 'False'}" for i, s in enumerate(d["statements"]))
    if t == "FILL_BLANK":
        return "; ".join(blanks_of(q.get("text", "")))
    if t == "MATCH":
        order = d.get("right_order") or [p["id"] for p in d["pairs"]]
        return "; ".join(f"{richtext.plain(p['left'])} → {richtext.plain(p['right'])}" for p in d["pairs"] if p["id"] in order)
    if t == "ONE_WORD":
        return d.get("answer", "")
    if t in ("SHORT_ANSWER", "HOTS", "LONG_ANSWER", "ESSAY", "DIAGRAM"):
        return richtext.plain(d.get("model_answer"))
    if t == "ASSERTION_REASON":
        return d.get("answer", "")
    if t == "NUMERICAL":
        return f"{d.get('answer')} {d.get('unit') or ''}".strip()
    if t == "ORDERING":
        return " → ".join(richtext.plain(i["text"]) for i in d.get("items", []))
    if t in COMPOSITE:
        return "; ".join(answer_plain(s) for s in d.get("sub_questions", []))
    return ""
