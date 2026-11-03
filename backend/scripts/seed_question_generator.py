"""Demo data for the AI Question Generator (idempotent; called from scripts.seed).

* Keeps the `question_generator` AI module switched on for the demo school.
* Syllabus (migration 012 tables) for every demo class subject that maps onto the NLP content repository: the
  subject's own chapters (for Physics in Class IX / X only the physics chapters of the Science book) with the
  chapter's numbered section headings as syllabus topics, so the database side of the Class → Subject → Chapter →
  Topic dropdowns has real rows. Existing syllabus chapters (same title) are left alone.
* With breadth=True (``python -m scripts.seed``, not the test fixture, whose dashboard counts assume two classes):
  two more classes for teacher@demo.edu in other grades — Grade-8-C Science (Class VIII) and Grade-12-A Chemistry
  (Class XII) — so many more chapters can be tried.

    python -m scripts.seed_question_generator
"""
from __future__ import annotations

import re

from app import db
from app.services.qgen import content, mapping

ORG = "DEMO-SCHOOL"
TEACHER = "EMP1001"
MAX_CHAPTERS = 14
EXTRA_CLASSES = [
    # class_code, name, grade, [(subject, name, subject teacher)]
    ("Grade-8-C", "Grade 8 — Section C", 8, [("SCI-8", "Science", TEACHER)]),
    ("Grade-12-A", "Grade 12 — Section A", 12, [("CHEM-12", "Chemistry", TEACHER)]),
]
_SMALL = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with", "its"}
_SKIP_TOPICS = {"introduction", "summary", "exercises", "what you have learnt", "conclusion"}


def nice_title(name: str) -> str:
    words = re.split(r"(\s+)", name.strip())
    out = []
    for i, w in enumerate(words):
        out.append(w if w.isspace() or (i and w.lower() in _SMALL) else w[:1].upper() + w[1:])
    return "".join(out)


def enable_module() -> None:
    db.execute("UPDATE public.organizations SET ai_modules = array_append(ai_modules, 'question_generator') "
               "WHERE org_code = %s AND NOT ('question_generator' = ANY(ai_modules))", (ORG,))


def seed_extra_classes() -> list[str]:
    added = []
    for code, name, grade, subjects in EXTRA_CLASSES:
        row = db.fetch_one(
            "INSERT INTO public.classes(org_code, class_code, class_name, year_code, cycle_code, class_teacher_code, grade_number) "
            "VALUES (%s,%s,%s,'2026-27','Term-1',NULL,%s) ON CONFLICT (org_code, class_code) DO NOTHING RETURNING class_code",
            (ORG, code, name, grade))
        if row:
            added.append(code)
        for subj, sname, teacher in subjects:
            db.execute("INSERT INTO public.class_subjects(org_code, class_code, subject_code, subject_name, teacher_code) "
                       "VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", (ORG, code, subj, sname, teacher))
    return added


def seed_syllabus(org: str = ORG) -> int:
    """Syllabus chapters + topics derived from the content repository. Returns the number of chapters added."""
    added = 0
    for m in mapping.org_mappings(org):
        if not m["nlp_class"] or not m["nlp_subject"]:
            continue
        own, _, _ = mapping.ranked_chapters(m)
        existing = {content._norm_title(r["title"]) for r in db.fetch_all(
            "SELECT title FROM public.syllabus_chapters WHERE org_code = %s AND class_code = %s AND subject_code = %s",
            (org, m["class_code"], m["subject_code"]))}
        pos = db.fetch_one("SELECT COALESCE(MAX(position), 0) AS p FROM public.syllabus_chapters WHERE org_code = %s "
                           "AND class_code = %s AND subject_code = %s", (org, m["class_code"], m["subject_code"]))["p"]
        for chapter in own[:MAX_CHAPTERS]:
            title = nice_title(chapter)
            if content._norm_title(title) in existing:
                continue
            st = content.chapter_structure(m["nlp_class"], m["nlp_subject"], chapter)
            topics = [t["title"] for t in st["topics"] if st["topic_source"] == "headings"
                      and t["title"].lower() not in _SKIP_TOPICS][:12]
            pos += 1
            ch = db.fetch_one(
                "INSERT INTO public.syllabus_chapters(org_code, class_code, subject_code, position, title, description) "
                "VALUES (%s,%s,%s,%s,%s,%s) RETURNING chapter_id",
                (org, m["class_code"], m["subject_code"], pos, title[:300],
                 f"Content repository: Class {m['nlp_class']} / {m['nlp_subject']} / {chapter}"))
            for i, t in enumerate(topics, start=1):
                db.execute("INSERT INTO public.syllabus_topics(chapter_id, position, title) VALUES (%s,%s,%s)",
                           (ch["chapter_id"], i, t[:300]))
            existing.add(content._norm_title(title))
            added += 1
    return added


def run(breadth: bool = False) -> dict:
    enable_module()
    extra = seed_extra_classes() if breadth else []
    return {"extra_classes": extra, "syllabus_chapters": seed_syllabus()}


if __name__ == "__main__":
    print(run(breadth=True))
    db.close_pool()
