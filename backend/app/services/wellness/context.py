"""The student's academic context, read from EduAI's own records.

MindAlign asked each user to pick a competitive exam (JEE, NEET, ...) and pitched every prompt at it. Inside a school
that is wrong: the student is in a class and section, studies that class's subjects, and has a knowledge level shown
by their graded assessments. Every prompt, fallback and screen uses this context instead.

Sources, with the same visibility rules as the rest of EduAI:
  class / section / term   app_users + classes
  subjects                 class_subjects for the student's class
  knowledge level          evaluation_candidate_scripts the student can already see (offline exams once PUBLISHED,
                           online tests and assignments once released), newest 20
  upcoming                 assigned online tests / assignments not yet submitted, and homework not yet handed in
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from ... import db

RECENT_RESULTS = 20
MAX_UPCOMING = 5

# (min %, level, how to pitch work for it). Bands sit on EduAI's grade scale (A+ 90 · A 80 · B+ 70 · B 60 · C 50).
LEVELS = [
    (85, "Advanced", "strong grasp of the syllabus; ready for stretch, higher-order and multi-step questions"),
    (70, "Proficient", "comfortable with core concepts; benefits from application questions and mixed revision"),
    (50, "Developing", "still consolidating core concepts; needs clear step-by-step explanations and confidence-building practice"),
    (0, "Foundational", "needs the basics rebuilt; use simple language, very small steps and plenty of encouragement"),
]
UNASSESSED = "Not yet assessed"
UNASSESSED_GUIDANCE = "no graded assessments yet; pitch at the standard level for their grade"
KIND_LABELS = {"ONLINE_TEST": "Online test", "ASSIGNMENT": "Assignment", "HOMEWORK": "Homework"}

# Visible-result rule shared with routers/assessments.py + routers/evaluation.py (students never see unreleased marks).
_VISIBLE_RESULT = ("s.processing_status IN ('EVALUATED', 'REVIEWED') AND s.total_max_marks > 0 AND (t.status = 'PUBLISHED' "
                   "OR (t.assessment_type IN ('ONLINE_TEST', 'ASSIGNMENT') AND t.results_release = 'INSTANT'))")


def level_for(pct: float | None) -> tuple[str, str]:
    if pct is None:
        return UNASSESSED, UNASSESSED_GUIDANCE
    return next((name, how) for cut, name, how in LEVELS if pct >= cut)


def _grade_section(class_code: str | None, class_name: str | None) -> tuple[int | None, str | None]:
    text = f"{class_name or ''} {class_code or ''}"
    g = re.search(r"(?:grade|class|std|standard|year)?\s*[-_ ]?\b(\d{1,2})\b", text, re.I)
    grade = int(g.group(1)) if g and 1 <= int(g.group(1)) <= 12 else None
    s = re.search(r"section\s+([A-Za-z0-9]{1,3})\b", class_name or "", re.I) \
        or re.search(r"\d{1,2}\s*[-_ ]\s*([A-Za-z])\b", class_code or "")
    return grade, (s.group(1).upper() if s else None)


def _fmt_date(d: date | None) -> str:
    return f"{d.day} {d.strftime('%b %Y')}" if d else "no date"


@dataclass
class StudentContext:
    name: str
    class_code: str | None
    class_name: str | None
    grade: int | None
    section: str | None
    term: str | None
    subjects: list[str] = field(default_factory=list)
    avg_pct: float | None = None
    assessments: int = 0
    by_subject: list[dict] = field(default_factory=list)
    upcoming: list[dict] = field(default_factory=list)
    exam_date: date | None = None          # optional, self-set "my next exams start" date from the wellness profile

    # ---- labels used by prompts, fallbacks and guardrails
    @property
    def first_name(self) -> str:
        return (self.name or "").split(" ")[0] or "there"

    @property
    def grade_label(self) -> str:
        return f"Grade {self.grade}" if self.grade else (self.class_name or "school")

    @property
    def class_label(self) -> str:
        return self.class_name or self.class_code or "their class"

    @property
    def study_label(self) -> str:
        return f"your {self.grade_label} studies"

    @property
    def exams_label(self) -> str:
        return f"your {self.grade_label} tests and exams"

    @property
    def level(self) -> str:
        return level_for(self.avg_pct)[0]

    @property
    def guidance(self) -> str:
        return level_for(self.avg_pct)[1]

    @property
    def age_hint(self) -> str:
        return f"a student of about {self.grade + 5}-{self.grade + 6} years" if self.grade else "a school student"

    @property
    def who(self) -> str:
        bits = [self.class_label] + ([self.term] if self.term else [])
        return f"a {self.grade_label} school student ({', '.join(bits)})"

    def subject_level(self, subject: str) -> tuple[str, str]:
        row = next((s for s in self.by_subject if s["subject"].lower() == subject.lower()), None)
        return level_for(row["avgPct"]) if row else level_for(self.avg_pct)

    @property
    def strongest(self) -> str | None:
        rows = [s for s in self.by_subject if s["avgPct"] is not None]
        return max(rows, key=lambda s: s["avgPct"])["subject"] if len(rows) > 1 else None

    @property
    def needs_support(self) -> str | None:
        rows = [s for s in self.by_subject if s["avgPct"] is not None]
        if not rows:
            return None
        low = min(rows, key=lambda s: s["avgPct"])
        return low["subject"] if low["avgPct"] < 70 and (len(rows) > 1 or low["avgPct"] < 50) else None

    @property
    def countdown(self) -> dict | None:
        """Next test-like date: the student's own exam date or the next assigned online test, whichever is sooner."""
        today = date.today()
        options = [{"label": f"{u['subject']} · {u['title']}", "date": u["date"], "source": "school"}
                   for u in self.upcoming if u["kind"] == "ONLINE_TEST" and u["date"]]
        if self.exam_date and self.exam_date >= today:
            options.append({"label": f"{self.grade_label} exams", "date": self.exam_date.isoformat(), "source": "self"})
        return min(options, key=lambda o: o["date"]) if options else None

    # ---- prompt + API views
    def prompt_block(self) -> str:
        """Facts the AI may use. No marks of other students, no teacher notes; first name only."""
        lines = [f"- Student: {self.first_name}, {self.who}; {self.age_hint}"]
        lines.append(f"- Class subjects: {', '.join(self.subjects) if self.subjects else 'not listed'}")
        if self.avg_pct is None:
            lines.append(f"- Knowledge level: {UNASSESSED} — {UNASSESSED_GUIDANCE} ({self.grade_label}).")
        else:
            per = "; ".join(f"{s['subject']} {s['avgPct']:.0f}% {s['level']}" for s in self.by_subject)
            lines.append(f"- Knowledge level: {self.level} — average {self.avg_pct:.0f}% across {self.assessments} graded "
                         f"assessment{'s' if self.assessments != 1 else ''}" + (f" ({per})" if per else "") + ".")
            lines.append(f"  How to pitch: {self.guidance}.")
            if self.needs_support:
                lines.append(f"  Needs most support in: {self.needs_support}.")
        if self.upcoming:
            lines.append("- Coming up: " + "; ".join(
                f"{u['subject']} {u['kindLabel'].lower()} \"{u['title']}\" on {_fmt_date(date.fromisoformat(u['date']))}"
                for u in self.upcoming[:3]))
        if self.exam_date and self.exam_date >= date.today():
            lines.append(f"- The student says their next exams start on {_fmt_date(self.exam_date)}.")
        return "\n".join(lines)

    def to_api(self) -> dict[str, Any]:
        return {
            "className": self.class_label, "gradeLabel": self.grade_label, "grade": self.grade, "section": self.section,
            "term": self.term, "subjects": self.subjects,
            "knowledge": {"level": self.level, "avgPct": round(self.avg_pct, 1) if self.avg_pct is not None else None,
                          "assessments": self.assessments, "bySubject": self.by_subject,
                          "strongest": self.strongest, "needsSupport": self.needs_support},
            "upcoming": self.upcoming, "countdown": self.countdown,
        }


def _results(org: str, student: str) -> tuple[float | None, int, list[dict]]:
    rows = db.fetch_all(
        f"""SELECT cs.subject_name AS subject, s.percentage
            FROM public.evaluation_candidate_scripts s
            JOIN public.evaluation_tests t ON t.eval_test_id = s.eval_test_id
            JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code AND cs.subject_code = t.subject_code
            WHERE s.org_code = %s AND s.student_user_code = %s AND {_VISIBLE_RESULT}
            ORDER BY COALESCE(s.evaluated_at, s.submitted_at, s.uploaded_at) DESC NULLS LAST LIMIT %s""",
        (org, student, RECENT_RESULTS))
    if not rows:
        return None, 0, []
    per: dict[str, list[float]] = {}
    for r in rows:
        per.setdefault(r["subject"], []).append(float(r["percentage"]))
    by_subject = [{"subject": k, "avgPct": round(sum(v) / len(v), 1), "level": level_for(sum(v) / len(v))[0], "assessments": len(v)}
                  for k, v in sorted(per.items())]
    allp = [float(r["percentage"]) for r in rows]
    return sum(allp) / len(allp), len(allp), by_subject


def _upcoming(org: str, student: str, class_code: str) -> list[dict]:
    rows = db.fetch_all(
        """SELECT * FROM (
             SELECT t.test_title AS title, cs.subject_name AS subject, t.assessment_type AS kind, t.due_at::date AS on_date
             FROM public.evaluation_tests t
             JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code AND cs.subject_code = t.subject_code
             LEFT JOIN public.evaluation_candidate_scripts s ON s.eval_test_id = t.eval_test_id AND s.student_user_code = %s
             WHERE t.org_code = %s AND t.class_code = %s AND t.is_assigned AND t.assessment_type IN ('ONLINE_TEST', 'ASSIGNMENT')
               AND t.due_at >= NOW() AND (s.script_id IS NULL OR s.processing_status = 'IN_PROGRESS')
             UNION ALL
             SELECT h.title, cs.subject_name, 'HOMEWORK', h.due_date
             FROM public.homeworks h
             JOIN public.class_subjects cs ON cs.org_code = h.org_code AND cs.class_code = h.class_code AND cs.subject_code = h.subject_code
             LEFT JOIN public.homework_submissions hs ON hs.homework_id = h.homework_id AND hs.student_user_code = %s
             WHERE h.org_code = %s AND h.class_code = %s AND h.due_date >= CURRENT_DATE AND hs.hw_submission_id IS NULL
           ) u ORDER BY on_date LIMIT %s""",
        (student, org, class_code, student, org, class_code, MAX_UPCOMING))
    return [{"title": r["title"], "subject": r["subject"], "kind": r["kind"], "kindLabel": KIND_LABELS.get(r["kind"], r["kind"]),
             "date": r["on_date"].isoformat() if isinstance(r["on_date"], (date, datetime)) else r["on_date"]} for r in rows]


def build(org: str, student: str, exam_date: date | None = None) -> StudentContext:
    u = db.fetch_one(
        "SELECT u.full_name, u.class_code, u.year_code, u.cycle_code, c.class_name FROM public.app_users u "
        "LEFT JOIN public.classes c ON c.org_code = u.org_code AND c.class_code = u.class_code "
        "WHERE u.org_code = %s AND u.user_code = %s", (org, student)) or {}
    class_code = u.get("class_code")
    grade, section = _grade_section(class_code, u.get("class_name"))
    subjects = [r["subject_name"] for r in db.fetch_all(
        "SELECT subject_name FROM public.class_subjects WHERE org_code = %s AND class_code = %s ORDER BY subject_name",
        (org, class_code))] if class_code else []
    avg, n, by_subject = _results(org, student)
    term = " · ".join(x for x in (u.get("year_code"), u.get("cycle_code")) if x) or None
    return StudentContext(name=u.get("full_name") or student, class_code=class_code, class_name=u.get("class_name"),
                          grade=grade, section=section, term=term, subjects=subjects, avg_pct=avg, assessments=n,
                          by_subject=by_subject, upcoming=_upcoming(org, student, class_code) if class_code else [],
                          exam_date=exam_date)


def class_knowledge(org: str, class_code: str) -> dict[str, dict]:
    """Per-student knowledge level for the teacher overview (one query for the whole class)."""
    rows = db.fetch_all(
        f"""SELECT student_user_code AS code, ROUND(AVG(percentage), 1) AS avg, COUNT(*)::int AS n FROM (
              SELECT s.student_user_code, s.percentage,
                     ROW_NUMBER() OVER (PARTITION BY s.student_user_code
                                        ORDER BY COALESCE(s.evaluated_at, s.submitted_at, s.uploaded_at) DESC NULLS LAST) AS rn
              FROM public.evaluation_candidate_scripts s JOIN public.evaluation_tests t ON t.eval_test_id = s.eval_test_id
              WHERE t.org_code = %s AND t.class_code = %s AND s.student_user_code IS NOT NULL AND {_VISIBLE_RESULT}) x
            WHERE rn <= %s GROUP BY student_user_code""", (org, class_code, RECENT_RESULTS))
    return {r["code"]: {"level": level_for(float(r["avg"]))[0], "avgPct": float(r["avg"]), "assessments": r["n"]} for r in rows}
