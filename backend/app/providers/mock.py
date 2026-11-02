"""Offline mock providers so the whole platform runs without Azure credentials.

* MockEmbeddings: deterministic hashed bag-of-words (+bigrams) in 1536 dims, L2-normalised.
  Cosine similarity reflects lexical overlap, so k=3 retrieval is meaningful in tests/demos.
* MockLLM: extractive, citation-bearing answers and templated teaching guides.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
from typing import Iterator

from ..config import get_settings

_STOP = set(
    "a an the of to in on for and or is are was were be been it its this that these those with as by at from "
    "what why how when which who whom do does did can could should would will you your i we they he she them "
    "about into than then so if not no yes also any all".split()
)
_WORD = re.compile(r"[a-z0-9]+")


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def _features(text: str) -> list[str]:
    toks = [_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1]
    return toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]


class MockEmbeddings:
    def __init__(self) -> None:
        self.dim = get_settings().embedding_dim

    def _one(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for f in _features(text):
            h = hashlib.md5(f.encode()).digest()
            idx = int.from_bytes(h[:4], "little") % self.dim
            v[idx] += 1.0 if h[4] & 1 else -1.0
            # second slot reduces collision noise
            idx2 = int.from_bytes(h[5:9], "little") % self.dim
            v[idx2] += 0.5 if h[9] & 1 else -0.5
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]


_SRC = re.compile(r"### Source \d+ — \[Page (\d+)\][^\n]*\n(.*?)(?=\n### Source|\Z)", re.S)
_SENT = re.compile(r"(?<=[.!?])\s+")


class MockLLM:
    name = "mock-llm"

    # -- chat ---------------------------------------------------------------
    def chat(self, system: str, messages: list[dict], *, json_mode: bool = False, temperature: float = 0.2) -> str:
        lp = re.search(r"\[TASK:LP:(\w+)\]", system)
        if lp:
            from .mock_lessonplan import answer

            kind = lp.group(1)
            prompt = system if kind == "assistant" else (messages[-1]["content"] if messages else "")
            return answer(kind, prompt, messages)
        adm = re.search(r"\[TASK:ADM:(\w+)\]", system)
        if adm:
            from .mock_admission import answer as adm_answer

            return adm_answer(adm.group(1), system, messages)
        if "[TASK:GUIDE]" in system:
            return json.dumps(self._guide(system, messages[-1]["content"]))
        if "[TASK:RAG]" in system:
            return self._rag(system, messages[-1]["content"])
        if "[TASK:COPILOT]" in system:
            return self._copilot(system, messages[-1]["content"] if messages else "")
        return "Mock response."

    def chat_stream(self, system: str, messages: list[dict], *, temperature: float = 0.2) -> Iterator[str]:
        text = self.chat(system, messages)
        for tok in re.findall(r"\S+\s*", text):
            time.sleep(0.01)
            yield tok

    def transcribe(self, audio: bytes, filename: str) -> str:
        raise NotImplementedError("Voice transcription requires PROVIDER_MODE=azure or openai (Whisper).")

    def vision_json(self, system: str, text: str, images: list[bytes], *, temperature: float = 0.0) -> str:
        raise NotImplementedError("Handwriting OCR requires PROVIDER_MODE=azure or openai (GPT-4o vision).")

    # -- RAG ----------------------------------------------------------------
    def _rag(self, system: str, question: str) -> str:
        qf = set(_features(question))
        scored: list[tuple[float, str, str]] = []
        for page, body in _SRC.findall(system):
            for sent in _SENT.split(" ".join(body.split())):
                if len(sent) < 25:
                    continue
                sf = set(_features(sent))
                overlap = len(qf & sf)
                if overlap:
                    scored.append((overlap / math.sqrt(len(sf) + 1), page, sent.strip()))
        if not scored:
            return (
                "I couldn't find this in the textbook sections I retrieved for you. "
                "Try rephrasing the question or ask your teacher about it."
            )
        scored.sort(key=lambda t: -t[0])
        picked, seen = [], set()
        for _, page, sent in scored:
            if sent in seen:
                continue
            seen.add(sent)
            picked.append((page, sent))
            if len(picked) == 3:
                break
        lines = [f"- {sent} [Page {page}]" for page, sent in picked]
        pages = sorted({p for p, _ in picked}, key=int)
        refs = ", ".join(f"[Page {p}]" for p in pages)
        return "Here is what your textbook says:\n\n" + "\n".join(lines) + f"\n\nFor more detail, read {refs}."

    # -- Admin Copilot --------------------------------------------------------
    def _copilot(self, system: str, question: str) -> str:
        """Answers from the REAL aggregated snapshot embedded in the system prompt (see services/copilot.py) —
        only the natural-language templating is mocked, same as _rag/_guide above."""
        m = re.search(r"\n(\{.*\})\s*$", system, re.S)
        try:
            snap = json.loads(m.group(1)) if m else {}
        except (ValueError, AttributeError):
            snap = {}
        q = question.lower()
        advice = "[INTENT:ADVICE]" in system  # services/copilot.py wants_advice(): "suggest…", "how can I improve…"
        if "attendance_this_month_percent" in snap:  # student snapshot shape (services/copilot.py build_student_snapshot)
            return self._copilot_student_advice(snap) if advice else self._copilot_student(snap, q)
        if "my_teaching" in snap:  # teacher snapshot shape (build_teacher_snapshot): own classes + institution view
            return self._copilot_teacher_advice(snap) if advice else self._copilot_teacher(snap, q)
        return self._copilot_staff_advice(snap) if advice else self._copilot_staff(snap, q)

    def _copilot_teacher(self, snap: dict, q: str) -> str:
        t = snap["my_teaching"]
        lines: list[str] = []
        periods = t["periods_today"]
        if any(w in q for w in ("today", "period", "timetable", "schedule")) and "attendance" not in q:
            if t["holiday_today"]:
                lines.append(f"Today is a holiday ({t['holiday_today']}).")
            elif periods:
                first = periods[0]
                lines.append(f"You have {len(periods)} period(s) today, starting with {first['subject']} for "
                             f"{first['class']} at {first['start_time']}.")
            else:
                lines.append("You have no periods scheduled today.")
        if "attendance" in q:
            todo = [p for p in periods if not p["attendance_marked"]]
            if "month" in q and t["attendance_this_month"]:
                lines.append("This month: " + "; ".join(f"{a['class']} {a['subject']} {a['percent']}%"
                                                        for a in t["attendance_this_month"][:4]) + ".")
            elif todo:
                lines.append(f"Attendance is still to be marked for {len(todo)} of today's period(s): "
                             + ", ".join(f"P{p['period']} {p['subject']} ({p['class']})" for p in todo[:4]) + ".")
            else:
                lines.append("Attendance is marked for all of today's periods." if periods else "No periods need attendance today.")
        if any(w in q for w in ("homework", "review", "submission")):
            n = t["homework_submissions_to_review"]
            lines.append(f"{n} homework submission(s) are waiting for your review"
                         + (f", most in \"{t['homework_to_review'][0]['title']}\"." if n and t["homework_to_review"] else "."))
        if any(w in q for w in ("assessment", "test", "evaluat", "script", "exam", "attention")):
            att = t["assessments_needing_attention"]
            lines.append(f"{len(att)} assessment(s) need your attention"
                         + (f" (e.g. \"{att[0]['title']}\": {', '.join(att[0]['reasons'])})" if att else "")
                         + f"; {t['scripts_awaiting_evaluation']} script(s) are awaiting evaluation"
                         + f" and {len(t['active_assessments'])} test(s) are open.")
        if any(w in q for w in ("class", "student")) and not lines:
            lines.append(f"You teach {len(t['my_classes'])} class(es) with {t['students_taught']} student(s): "
                         + "; ".join(f"{c['class']} ({', '.join(c['my_subjects']) or 'class teacher'})" for c in t["my_classes"]) + ".")
        if not lines and any(w in q for w in ("teacher", "staff", "admission", "applicant", "consent")):
            return self._copilot_staff(snap, q)
        if not lines:
            lines.append(f"You have {len(periods)} period(s) today, {t['attendance_still_to_mark_today']} still to mark for "
                         f"attendance, and {t['homework_submissions_to_review']} homework submission(s) to review.")
        return " ".join(lines)

    def _copilot_teacher_advice(self, snap: dict) -> str:
        """Concrete next steps from this teacher's OWN classes (class level, never an individual student)."""
        t = snap["my_teaching"]
        tips: list[str] = []
        if t["attendance_still_to_mark_today"]:
            tips.append(f"Mark attendance for the {t['attendance_still_to_mark_today']} period(s) still open today "
                        "(Attendance) — ideally during the period itself.")
        if t["homework_submissions_to_review"]:
            first = t["homework_to_review"][0]["title"] if t["homework_to_review"] else None
            tips.append(f"Review the {t['homework_submissions_to_review']} homework submission(s) waiting"
                        + (f", starting with \"{first}\"" if first else "") + " (Homework).")
        for a in t["assessments_needing_attention"][:2]:
            tips.append(f"Fix \"{a['title']}\" ({a['class']}): {', '.join(a['reasons'])} (Online tests / AI Evaluation).")
        if t["scripts_awaiting_evaluation"]:
            tips.append(f"{t['scripts_awaiting_evaluation']} script(s) are awaiting evaluation — run or check them in AI Evaluation.")
        low = [a for a in t["attendance_this_month"] if a["percent"] is not None and a["percent"] < 85]
        if low:
            w = min(low, key=lambda a: a["percent"])
            tips.append(f"Attendance in {w['class']} {w['subject']} is {w['percent']}% this month — talk to the class "
                        "teacher about repeated absences and keep periods engaging.")
        weak = [r for r in t["recent_results"] if r["class_average_percent"] is not None and float(r["class_average_percent"]) < 60]
        if weak:
            r = min(weak, key=lambda r: float(r["class_average_percent"]))
            tips.append(f"The class average for \"{r['title']}\" ({r['class']}) was {r['class_average_percent']}% — "
                        "plan a short re-teach and a quick practice quiz (Lesson Plans / AI Question Generator).")
        if t["periods_today"] and len(tips) < 2:
            tips.append(f"You have {len(t['periods_today'])} period(s) today — check the lesson plan for "
                        f"{t['periods_today'][0]['subject']} ({t['periods_today'][0]['class']}) before it starts.")
        if not tips:
            tips.append("You're all caught up — a good moment to prepare next week's lesson plans and a quick revision quiz.")
        return "Here's what I'd suggest for your classes:\n\n" + "\n".join(f"- {x}" for x in tips[:5])

    def _copilot_staff_advice(self, snap: dict) -> str:
        """Concrete, aggregated next steps grounded in the snapshot's own figures (most urgent first)."""
        inst, adm = snap.get("institution"), snap.get("admissions")
        tips: list[str] = []
        if adm and adm["data_requests_overdue"]:
            tips.append(f"Resolve the {adm['data_requests_overdue']} overdue data request(s) first — they are compliance "
                        "deadlines (Admissions → Data requests).")
        if inst and inst["classes_without_class_teacher"]:
            tips.append(f"Assign a class teacher to the {inst['classes_without_class_teacher']} class(es) that have none "
                        "(Admin console → Classes).")
        if inst and inst["class_subjects_without_teacher"]:
            tips.append(f"Map a subject teacher to the {inst['class_subjects_without_teacher']} class subject(s) still "
                        "without one, so timetables and homework can run.")
        if inst:
            today, month = inst["attendance_today_percent"], inst["attendance_this_month_percent"]
            if today is None:
                tips.append("Attendance isn't marked yet today — remind class teachers to mark it before first period ends.")
            if month is not None and month < 90:
                tips.append(f"Attendance is {month}% this month — ask class teachers to follow up on repeated absences "
                            "and share the monthly attendance report with parents.")
        if adm and adm["consent_pending"]:
            tips.append(f"Follow up with the families of the {adm['consent_pending']} applicant(s) whose consent is still pending.")
        if not tips:
            if not inst and not adm:
                return "I don't have an aggregated snapshot to base suggestions on yet — make sure an institution is selected."
            tips.append("Nothing in the snapshot needs urgent attention — keep marking attendance daily and review "
                        "the admissions pipeline weekly.")
        return "Here are some suggestions based on your institution's current figures:\n\n" + "\n".join(f"- {t}" for t in tips[:5])

    def _copilot_student_advice(self, snap: dict) -> str:
        """Concrete next steps from the student's OWN snapshot only (never a comparison with anyone else)."""
        if "note" in snap:
            return snap["note"]
        tips: list[str] = []
        month = snap["attendance_this_month_percent"]
        if month is not None and month < 85:
            tips.append(f"Your attendance is {month}% this month — aim for 85% or more by attending every class this week.")
        weak = [s for s in snap["attendance_by_subject"] if s["percent"] is not None and s["percent"] < 75]
        if weak:
            w = min(weak, key=lambda s: s["percent"])
            tips.append(f"{w['subject']} attendance is lowest at {w['percent']}% — don't miss its next periods.")
        if snap["homework_pending_count"]:
            nxt = snap["homework_due_soon"][0] if snap["homework_due_soon"] else None
            tips.append(f"Clear your {snap['homework_pending_count']} pending homework item(s)"
                        + (f", starting with \"{nxt['title']}\" ({nxt['subject']}) due {nxt['due_date']}." if nxt else "."))
        if snap["upcoming_tests_and_assignments"]:
            u = snap["upcoming_tests_and_assignments"][0]
            tips.append(f"Prepare for \"{u['title']}\" ({u['subject']}) — revise for 20–30 minutes a day before {u['due_at']}.")
        scored = [r for r in snap["recent_results"] if r["percentage"] is not None]
        if scored:
            low = min(scored, key=lambda r: float(r["percentage"]))
            if float(low["percentage"]) < 75:
                tips.append(f"Your {low['subject']} result was {low['percentage']}% — go over the mistakes in "
                            f"\"{low['title']}\" and ask your teacher about anything unclear.")
            else:
                tips.append(f"Your recent results look solid (lowest {low['percentage']}% in {low['subject']}) — keep "
                            "revising a little every day.")
        if snap["todays_periods"]:
            tips.append(f"You have {len(snap['todays_periods'])} period(s) today — skim your notes for "
                        f"{snap['todays_periods'][0]['subject']} before it starts.")
        if not tips:
            tips.append("You're all caught up — use the AI Classroom to review a chapter, and plan 30 minutes of revision a day.")
        return "Here's what I'd suggest, based on your own data:\n\n" + "\n".join(f"- {t}" for t in tips[:5])

    def _copilot_staff(self, snap: dict, q: str) -> str:
        inst, adm = snap.get("institution"), snap.get("admissions")
        lines: list[str] = []
        if inst and any(w in q for w in ("teacher", "staff")):
            lines.append(f"{inst['teachers']} active teacher(s)."
                         + (f" {inst['classes_without_class_teacher']} class(es) still need a class teacher."
                            if inst["classes_without_class_teacher"] else ""))
        if inst and ("student" in q or "class" in q or "seat" in q):
            lines.append(f"{inst['students']} active student(s) across {inst['classes']} class(es).")
        if inst and "attendance" in q:
            today, month = inst["attendance_today_percent"], inst["attendance_this_month_percent"]
            lines.append(f"Attendance is {today if today is not None else 'not yet marked'}% today and "
                         f"{month if month is not None else 'not available'}% so far this month.")
        if adm and any(w in q for w in ("admission", "applicant", "consent", "enquir", "withdraw")):
            lines.append(f"{adm['applicants_total']} applicant(s) on file. Consent: {adm['consent_granted']} granted, "
                         f"{adm['consent_pending']} pending, {adm['consent_withdrawn']} withdrawn."
                         + (f" {adm['data_requests_overdue']} data request(s) are overdue." if adm["data_requests_overdue"] else ""))
        if not lines:
            if inst:
                lines.append(f"This institution has {inst['students']} students, {inst['teachers']} teachers and "
                             f"{inst['classes']} classes; attendance today is "
                             f"{inst['attendance_today_percent'] if inst['attendance_today_percent'] is not None else 'not yet marked'}%.")
            if adm:
                lines.append(f"Admissions: {adm['applicants_total']} applicant(s), {adm['consent_pending']} awaiting consent.")
        if not lines:
            return "I don't have an aggregated snapshot to answer from yet — make sure an institution is selected."
        return " ".join(lines)

    def _copilot_student(self, snap: dict, q: str) -> str:
        if "note" in snap:
            return snap["note"]
        lines: list[str] = []
        if "attendance" in q:
            lines.append(f"Your attendance is {snap['attendance_this_month_percent'] if snap['attendance_this_month_percent'] is not None else 'not yet marked'}% "
                         f"this month ({snap['attendance_overall_percent'] if snap['attendance_overall_percent'] is not None else 'n/a'}% overall).")
        if any(w in q for w in ("homework", "due", "assignment", "pending")):
            n = snap["homework_pending_count"]
            if n:
                nxt = snap["homework_due_soon"][0]
                lines.append(f"You have {n} homework item(s) pending, next due: \"{nxt['title']}\" ({nxt['subject']}) by {nxt['due_date']}.")
            else:
                lines.append("You have no pending homework right now.")
        if any(w in q for w in ("today", "timetable", "period", "class")):
            periods = snap["todays_periods"]
            lines.append(f"You have {len(periods)} period(s) today." if periods else "No periods are scheduled for you today.")
        if any(w in q for w in ("result", "score", "mark", "grade")):
            if snap["recent_results"]:
                r = snap["recent_results"][0]
                lines.append(f"Your most recent result: \"{r['title']}\" ({r['subject']}) — {r['percentage']}%, grade {r['grade']}.")
            else:
                lines.append("No published results yet.")
        if not lines:
            lines.append(f"This month your attendance is "
                         f"{snap['attendance_this_month_percent'] if snap['attendance_this_month_percent'] is not None else 'not yet marked'}%, "
                         f"with {snap['homework_pending_count']} homework item(s) pending.")
        return " ".join(lines)

    # -- Teaching guide -----------------------------------------------------
    def _guide(self, system: str, content: str) -> dict:
        level = (re.search(r"LEVEL:\s*(\w+)", system) or [None, "school"])[1]
        minutes = int((re.search(r"DURATION:\s*(\d+)", system) or [None, "45"])[1])
        title = (re.search(r"CHAPTER:\s*(.+)", content) or [None, "this chapter"])[1].strip()
        body = content.split("TEXT:", 1)[-1]
        sents = [s.strip() for s in _SENT.split(" ".join(body.split())) if len(s.strip()) > 30]
        key = sents[:12] or [f"Introduce the main ideas of {title}."]
        concepts = [s for s in key[:5]]
        audience = {"school": "students in a school classroom", "college": "undergraduates", "coaching": "exam-focused batch learners"}.get(level, "students")
        t1, t2, t3 = round(minutes * 0.15), round(minutes * 0.55), round(minutes * 0.2)
        script = [
            {"minutes": f"0-{t1}", "step": "Hook & recap", "script": f"Open with a quick question to {audience} that connects {title} to something familiar."},
            {"minutes": f"{t1}-{t1 + t2}", "step": "Concept delivery", "script": " ".join(concepts[:3])},
            {"minutes": f"{t1 + t2}-{t1 + t2 + t3}", "step": "Guided practice", "script": "Work one example on the board, then let pairs attempt a similar one."},
            {"minutes": f"{t1 + t2 + t3}-{minutes}", "step": "Wrap-up", "script": "Summarise in three bullets and preview the next session."},
        ]
        objectives = [f"Explain: {c.rstrip('.')}" for c in concepts[:3]] or [f"Understand {title}"]
        md = (
            f"# How to teach: {title}\n\n**Level:** {level} · **Duration:** {minutes} min\n\n"
            "## Learning objectives\n" + "\n".join(f"- {o}" for o in objectives) + "\n\n"
            "## Pacing plan\n" + "\n".join(f"- **{s['minutes']} min — {s['step']}:** {s['script']}" for s in script)
        )
        return {
            "lesson_plan_markdown": md,
            "analogies_and_hooks": {
                "opening_hook": f"Ask: where have you seen {title.lower()} in everyday life?",
                "analogy": f"Compare the core idea of {title} to a familiar everyday system, then map each part back to the textbook terms.",
                "learning_objectives": objectives,
                "delivery_script": script,
            },
            "board_work_blueprint": [
                {"step": 1, "board": f"Write the title '{title}' and the key term list."},
                {"step": 2, "board": "Draw the main diagram from the textbook and label each part."},
                {"step": 3, "board": "Box the definition and underline the formula/rule to remember."},
            ],
            "common_misconceptions": [
                {"misconception": "Students memorise definitions without understanding them.", "clarification": "Ask learners to restate each idea in their own words with an example."},
                {"misconception": "Students mix up closely related terms.", "clarification": "Contrast the terms side by side on the board."},
            ],
            "formative_questions": [
                {"question": f"In one sentence, what is the main idea of {title}?", "expected_answer": key[0]},
                {"question": "Give one real-life example of this concept.", "expected_answer": "Any relevant, correct example."},
                {"question": "What would change if one key condition were different?", "expected_answer": "Reasoned prediction tied to the textbook rule."},
            ],
        }
