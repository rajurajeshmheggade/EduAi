"""Published paper → Online Test / Assignment in the existing evaluation flow (evaluation_tests + master questions).

The evaluation engine knows four item kinds (MCQ graded exactly; SHORT_ANSWER / DESCRIPTIVE / NUMERICAL graded by
embeddings + the AI examiner against a model answer and rubric points). Mapping:

| Paper type | Evaluation item |
| --- | --- |
| MCQ, Assertion–Reason (four codes), True/False with one statement | MCQ — auto-graded exactly |
| Numerical | NUMERICAL (model answer "value unit", tolerance in the rubric) |
| Short answer, One-word, Fill in the blanks, MRQ, Match, Arrange in order, True/False (several statements) | SHORT_ANSWER, the answer key as model answer |
| Long answer, Essay, HOTS, Diagram-based | DESCRIPTIVE with the marking points / rubric |
| Case / Scenario / Passage-based | one item per sub-question (5a, 5b …), mapped by the sub-question's type; the passage is printed with the first |

The created test is a draft with its questions saved (status READY): the teacher sets the dates and assigns it in
Tests & AI evaluation as usual.
"""
from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from ... import db
from ...providers import get_embedder
from . import richtext
from .paper import ALPHA, ROMAN, match_columns, ordering_display, render_blanks
from .schema import COMPOSITE, blanks_of

EXACT = {"MCQ", "ASSERTION_REASON"}


def _t(html_: str | None) -> str:
    return richtext.plain(html_, math="text")


def _item(q: dict, sl_no: str, ar_codes: list[str], prefix: str = "") -> tuple[dict, str | None]:
    """(master row, warning or None) for one non-composite question."""
    t, d = q["type"], q["data"]
    text = prefix + _t(render_blanks(q["text"]) if t == "FILL_BLANK" else q["text"])
    base = {"sl_no": sl_no, "max_marks": float(q["marks"]), "mcq_options": [], "correct_option": None, "key_rubric_points": []}
    warning = None
    if t == "MCQ":
        opts = [f"({ALPHA[i]}) {_t(o['text'])}" for i, o in enumerate(d["options"])]
        i = next(k for k, o in enumerate(d["options"]) if o["id"] == d["correct"])
        return {**base, "question_type": "MCQ", "question_text": text, "mcq_options": opts, "correct_option": ALPHA[i],
                "model_answer_text": opts[i]}, None
    if t == "ASSERTION_REASON":
        opts = [f"({ALPHA[i]}) {c}" for i, c in enumerate(ar_codes)]
        i = "ABCD".index(d["answer"])
        stem = f"{text}\nAssertion (A): {_t(d['assertion'])}\nReason (R): {_t(d['reason'])}"
        return {**base, "question_type": "MCQ", "question_text": stem, "mcq_options": opts, "correct_option": ALPHA[i],
                "model_answer_text": opts[i]}, None
    if t == "TRUE_FALSE" and len(d["statements"]) == 1:
        s = d["statements"][0]
        opts = ["(a) True", "(b) False"]
        return {**base, "question_type": "MCQ", "question_text": f"{text}\n{_t(s['text'])}", "mcq_options": opts,
                "correct_option": "a" if s["answer"] else "b", "model_answer_text": opts[0 if s["answer"] else 1]}, None
    if t == "NUMERICAL":
        unit = d.get("unit") or ""
        rubric = [f"Final answer {d['answer']:g} {unit}".strip() + (f" (± {d['tolerance']:g})" if d.get("tolerance") else "")]
        return {**base, "question_type": "NUMERICAL", "question_text": text,
                "model_answer_text": (f"{d['answer']:g} {unit}".strip() + ("\n" + _t(d["solution"]) if d.get("solution") else "")),
                "key_rubric_points": rubric}, None
    if t == "TRUE_FALSE":
        lines = [f"({ROMAN[i]}) {_t(s['text'])}" for i, s in enumerate(d["statements"])]
        ans = "; ".join(f"({ROMAN[i]}) {'True' if s['answer'] else 'False'}" for i, s in enumerate(d["statements"]))
        return {**base, "question_type": "SHORT_ANSWER", "question_text": text + "\n" + "\n".join(lines),
                "model_answer_text": ans}, None
    if t == "MRQ":
        opts = [f"({ALPHA[i]}) {_t(o['text'])}" for i, o in enumerate(d["options"])]
        ans = ", ".join(opts[i] for i, o in enumerate(d["options"]) if o["correct"])
        return {**base, "question_type": "SHORT_ANSWER", "question_text": text + "\n" + "\n".join(opts) +
                "\n(Write the letters of all correct options.)", "model_answer_text": ans}, None
    if t == "FILL_BLANK":
        return {**base, "question_type": "SHORT_ANSWER", "question_text": text,
                "model_answer_text": "; ".join(blanks_of(q["text"]))}, None
    if t == "MATCH":
        left, right = match_columns(q)
        letter = {p["id"]: lt for lt, p in right}
        body = "\n".join(f"{i + 1}. {_t(p['left'])}" for i, p in enumerate(left)) + "\n" + \
            "\n".join(f"({lt}) {_t(p['right'])}" for lt, p in right)
        return {**base, "question_type": "SHORT_ANSWER", "question_text": text + "\n" + body,
                "model_answer_text": ", ".join(f"{i + 1}-({letter[p['id']]})" for i, p in enumerate(left))}, None
    if t == "ORDERING":
        shown = ordering_display(q)
        pos = {it["id"]: lt for lt, it in shown}
        body = "\n".join(f"({lt}) {_t(it['text'])}" for lt, it in shown)
        return {**base, "question_type": "SHORT_ANSWER", "question_text": text + "\n" + body,
                "model_answer_text": " → ".join(pos[i["id"]] for i in d["items"])}, None
    if t == "ONE_WORD":
        return {**base, "question_type": "SHORT_ANSWER", "question_text": text,
                "model_answer_text": d["answer"] + (f" (also accepted: {', '.join(d['alternates'])})" if d.get("alternates") else "")}, None
    if t == "SHORT_ANSWER":
        return {**base, "question_type": "SHORT_ANSWER", "question_text": text, "model_answer_text": _t(d["model_answer"]),
                "key_rubric_points": list(d.get("key_points") or [])}, None
    if t == "HOTS":
        return {**base, "question_type": "DESCRIPTIVE", "question_text": text, "model_answer_text": _t(d["model_answer"]),
                "key_rubric_points": list(d.get("key_points") or [])}, None
    if t == "LONG_ANSWER":
        return {**base, "question_type": "DESCRIPTIVE", "question_text": text, "model_answer_text": _t(d["model_answer"]),
                "key_rubric_points": [f"{p['text']} ({p['marks']:g}M)" for p in d.get("marking_points") or []]}, None
    if t == "ESSAY":
        return {**base, "question_type": "DESCRIPTIVE", "question_text": text + (f" (about {d['word_limit']} words)" if d.get("word_limit") else ""),
                "model_answer_text": _t(d["model_answer"]),
                "key_rubric_points": [f"{p['text']} ({p['marks']:g}M)" for p in d.get("rubric") or []]}, None
    if t == "DIAGRAM":
        if q.get("media"):
            warning = f"Q{sl_no}: the diagram image is not shown in the online test runner — use an Assignment (students upload their work) for it."
        return {**base, "question_type": "DESCRIPTIVE",
                "question_text": text + (f"\n[Diagram: {d['diagram_description']}]" if d.get("diagram_description") else ""),
                "model_answer_text": _t(d["model_answer"]), "key_rubric_points": list(d.get("key_points") or [])}, warning
    raise ValueError(f"Unsupported type {t}")


def map_items(items: list[dict], ar_codes: list[str]) -> tuple[list[dict], list[str]]:
    rows, warnings = [], []
    for n, it in enumerate(items, start=1):
        q = it["question"]
        if q["type"] in COMPOSITE:
            d = q["data"]
            for k, sub in enumerate(d["sub_questions"]):
                prefix = (_t(q["text"]) + "\n" + _t(d["passage"]) + "\n\n") if k == 0 else f"(Refer to the passage in Q{n}{ALPHA[0]}.) "
                row, w = _item(sub, f"{n}{ALPHA[k]}", ar_codes, prefix)
                rows.append(row)
                if w:
                    warnings.append(w)
        else:
            row, w = _item(q, str(n), ar_codes)
            rows.append(row)
            if w:
                warnings.append(w)
    return rows, warnings


def create_assessment(paper: dict, *, user: Any, assessment_type: str, duration_minutes: int | None,
                      ar_codes: list[str]) -> dict:
    rows, warnings = map_items(paper["items"], ar_codes)
    vectors = get_embedder().embed([f"{r['question_text']}\n{r['model_answer_text']}" for r in rows])
    total = round(sum(r["max_marks"] for r in rows), 2)
    instr = "\n".join(paper["header"].get("general_instructions") or []) or None
    with db.connection() as conn:
        t = conn.execute(
            "INSERT INTO public.evaluation_tests(org_code, class_code, subject_code, evaluation_scope, chapter_title, "
            "test_title, pass_percentage, created_by, assessment_type, instructions, duration_minutes, results_release, "
            "total_max_marks, total_questions, status) VALUES (%s,%s,%s,%s,%s,%s,40,%s,%s,%s,%s,'ON_PUBLISH',%s,%s,'READY') "
            "RETURNING eval_test_id",
            (user.org_code, paper["class_code"], paper["subject_code"],
             "CHAPTER_LEVEL" if paper.get("chapter") else "SUBJECT_LEVEL", paper.get("chapter"),
             (paper["header"].get("exam_title") or paper["title"])[:300], user.user_code, assessment_type, instr,
             duration_minutes if assessment_type == "ONLINE_TEST" else None, total, len(rows))).fetchone()
        for order, (r, vec) in enumerate(zip(rows, vectors), start=1):
            conn.execute(
                "INSERT INTO public.evaluation_master_questions(eval_test_id, sl_no, display_order, question_type, "
                "question_text, mcq_options, correct_option, max_marks, model_answer_text, key_rubric_points, "
                "model_answer_embedding) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::vector)",
                (t["eval_test_id"], r["sl_no"], order, r["question_type"], r["question_text"][:10000],
                 Jsonb(r["mcq_options"]), r["correct_option"], r["max_marks"], r["model_answer_text"][:20000] or "—",
                 Jsonb(r["key_rubric_points"]), db.vec_literal(vec)))
    exact = sum(1 for r in rows if r["question_type"] == "MCQ")
    return {"eval_test_id": str(t["eval_test_id"]), "assessment_type": assessment_type, "items": len(rows),
            "auto_graded_exactly": exact, "ai_graded": len(rows) - exact, "total_marks": total, "warnings": warnings}
