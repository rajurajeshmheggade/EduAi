"""Demo data for admission tests: one Physics Assignment (6 questions) for the demo teacher, so "Import from my
assessments" has something to import.   python -m scripts.seed_admission_test

Idempotent. Run `python -m scripts.seed` first (demo school, teacher EMP1001, Grade-10-A).
"""
from __future__ import annotations

from psycopg.types.json import Jsonb

from app import db
from app.db import close_pool

TITLE = "Force and Laws of Motion – Unit Test 2"
QUESTIONS = [
    ("1", "MCQ", "What is the SI unit of force?", 1, ["(a) Joule", "(b) Newton", "(c) Watt", "(d) Pascal"], "b", "(b) Newton", []),
    ("2", "MCQ", "Which law of motion explains why a passenger falls forward when a moving bus stops suddenly?", 1,
     ["(a) First law (inertia)", "(b) Second law", "(c) Third law", "(d) Law of gravitation"], "a", "(a) First law — inertia of motion", []),
    ("3", "NUMERICAL", "A force acts on a 2 kg mass and gives it an acceleration of 3 m/s². Find the force in newtons.", 2, [], None,
     "F = ma = 2 × 3 = 6 N", ["Formula F = ma (1M)", "Answer 6 N (1M)"]),
    ("4", "SHORT_ANSWER", "Define momentum and give its SI unit.", 2, [], None,
     "Momentum is the product of mass and velocity, p = mv. Its SI unit is kg m/s.", ["Momentum = mass × velocity (1M)", "SI unit kg m/s (1M)"]),
    ("5", "DESCRIPTIVE", "State Newton's third law of motion and explain it with one everyday example.", 3, [], None,
     "To every action there is an equal and opposite reaction. Example: when we walk we push the ground backwards and the ground pushes us forward.",
     ["Statement of the third law (1M)", "Action and reaction act on different bodies (1M)", "Correct everyday example (1M)"]),
    ("6", "MCQ", "A cricket player lowers his hands while catching a ball. This increases the time of impact and therefore:", 1,
     ["(a) increases the force", "(b) decreases the force on his hands", "(c) increases momentum", "(d) stops the ball instantly"], "b",
     "(b) decreases the force on his hands", []),
]


def run() -> None:
    teacher = db.fetch_one("SELECT org_code FROM public.app_users WHERE user_code = 'EMP1001'")
    if not teacher:
        raise SystemExit("Run `python -m scripts.seed` first (demo teacher EMP1001 not found)")
    org = teacher["org_code"]
    t = db.fetch_one("SELECT eval_test_id FROM public.evaluation_tests WHERE org_code = %s AND test_title = %s", (org, TITLE))
    if t:
        print("present:", TITLE)
        return
    with db.connection() as conn:
        t = conn.execute(
            "INSERT INTO public.evaluation_tests (org_code, class_code, subject_code, evaluation_scope, chapter_number, chapter_title, test_title, "
            "pass_percentage, created_by, assessment_type, instructions, is_assigned, assigned_at) VALUES (%s,'Grade-10-A','PHY101','CHAPTER_LEVEL',9,"
            "'Force and Laws of Motion',%s,40,'EMP1001','ASSIGNMENT','Answer all questions.',FALSE,NULL) RETURNING eval_test_id",
            (org, TITLE)).fetchone()
        for i, (sl, qtype, text, marks, options, correct, model, rubric) in enumerate(QUESTIONS, 1):
            conn.execute(
                "INSERT INTO public.evaluation_master_questions (eval_test_id, sl_no, display_order, question_text, max_marks, model_answer_text, "
                "key_rubric_points, question_type, mcq_options, correct_option) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (t["eval_test_id"], sl, i, text, marks, model, Jsonb(rubric), qtype, Jsonb(options), correct))
        conn.execute("UPDATE public.evaluation_tests SET total_questions = %s, total_max_marks = %s WHERE eval_test_id = %s",
                     (len(QUESTIONS), sum(q[3] for q in QUESTIONS), t["eval_test_id"]))
    print("created:", TITLE)


if __name__ == "__main__":
    run()
    close_pool()
