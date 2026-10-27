"""Seed demo organisation, classes, users (+ optional sample attendance).   python -m scripts.seed

Demo password for all users: Passw0rd!  (development only)
Platform owner bootstrap (FRD v3 FR-SA-01): superadmin / superadmin — flagged to change on first login.
"""
import random
from datetime import date, time, timedelta

from psycopg.types.json import Jsonb

from app import db
from app.security import hash_password

PASSWORD = "Passw0rd!"
ORG = "DEMO-SCHOOL"
PLATFORM = "PLATFORM"
SUPERADMIN = ("superadmin", "superadmin")  # user code / password

USERS = [
    # user_code, name, email, role, class, subjects, roll
    ("ADMIN001", "Aarav Admin", "admin@demo.edu", "orgadmin", None, [], None),
    ("EMP1001", "Priya Teacher", "teacher@demo.edu", "teacher", "Grade-10-A", ["PHY101", "MATH-12"], None),
    ("EMP1002", "Kavya Teacher", "kavya@demo.edu", "teacher", "Grade-9-B", ["ENG-9"], None),
    ("REG2026001", "Rohan Student", "student@demo.edu", "student", "Grade-10-A", ["PHY101", "MATH-12"], "1"),
    ("REG2026002", "Meera Student", "meera@demo.edu", "student", "Grade-10-A", ["PHY101"], "2"),
    ("REG2026003", "Ishaan Verma", "ishaan@demo.edu", "student", "Grade-10-A", ["PHY101", "MATH-12"], "3"),
    ("REG2026004", "Ananya Iyer", "ananya@demo.edu", "student", "Grade-10-A", ["PHY101", "MATH-12"], "4"),
    ("REG2026101", "Kabir Shah", "kabir@demo.edu", "student", "Grade-9-B", ["PHY101", "ENG-9"], "1"),
    ("REG2026102", "Sara Khan", "sara@demo.edu", "student", "Grade-9-B", ["PHY101", "ENG-9"], "2"),
]

CLASSES = [
    # class_code, name, class teacher, [(subject, name, subject teacher)]
    ("Grade-10-A", "Grade 10 — Section A", "EMP1001",
     [("PHY101", "Physics", "EMP1001"), ("MATH-12", "Mathematics", "EMP1001")]),
    # Priya teaches Physics here but is NOT the class teacher: she can mark PHY101 attendance, not add students.
    ("Grade-9-B", "Grade 9 — Section B", "EMP1002",
     [("PHY101", "Physics", "EMP1001"), ("ENG-9", "English", "EMP1002")]),
]


def run(demo_attendance: bool = False) -> None:
    db.execute(
        "INSERT INTO public.organizations(org_code, customer_code, org_name, institution_level) "
        "VALUES (%s,'ICME','Demo International School','school') ON CONFLICT (org_code) DO NOTHING",
        (ORG,),
    )
    db.execute(
        "INSERT INTO public.organizations(org_code, customer_code, org_name, institution_level) "
        "VALUES (%s,'ICME','EduAI Platform','school') ON CONFLICT (org_code) DO NOTHING",
        (PLATFORM,),
    )
    pw = hash_password(PASSWORD)
    # Earlier seeds used SUPER001 / super@eduai.app — rename in place so there is a single platform owner.
    db.execute("UPDATE public.app_users SET user_code = %s, email = 'superadmin@eduai.cloud' "
               "WHERE user_code = 'SUPER001'", (SUPERADMIN[0],))
    db.call_scalar("usp_create_user", SUPERADMIN[0], PLATFORM, "ICME", "Super Admin",
                   "superadmin@eduai.cloud", hash_password(SUPERADMIN[1]), "superadmin", None, None, None, [],
                   casts=[None] * 10 + ["text[]"])
    db.execute("UPDATE public.app_users SET must_change_password = TRUE WHERE user_code = %s", (SUPERADMIN[0],))
    for code, name, email, role, klass, subjects, roll in USERS:
        db.call_scalar(
            "usp_create_user", code, ORG, "ICME", name, email, pw, role,
            "2026-27", "Term-1", klass, subjects, casts=[None] * 10 + ["text[]"],
        )
        if roll:
            db.execute("UPDATE public.app_users SET roll_number = %s WHERE user_code = %s", (roll, code))

    # Direct inserts (not usp_upsert_class_subject) so re-seeding never widens a student's explicit subjects.
    for klass, name, class_teacher, subjects in CLASSES:
        db.execute(
            "INSERT INTO public.classes(org_code, class_code, class_name, year_code, cycle_code, class_teacher_code) "
            "VALUES (%s,%s,%s,'2026-27','Term-1',%s) ON CONFLICT (org_code, class_code) DO NOTHING",
            (ORG, klass, name, class_teacher),
        )
        for subj, sname, teacher in subjects:
            db.execute(
                "INSERT INTO public.class_subjects(org_code, class_code, subject_code, subject_name, teacher_code) "
                "VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (ORG, klass, subj, sname, teacher),
            )
    _demo_timetable()
    if demo_attendance:
        _demo_attendance()
        _demo_homework()
    print(f"Seeded org {ORG} with {len(USERS)} users (password: {PASSWORD}) + {SUPERADMIN[0]} / {SUPERADMIN[1]}")


# Bell schedule: 8 periods of 45 minutes from 09:00 with a 15-minute break after period 3.
def period_times(n: int) -> tuple[time, time]:
    start = 9 * 60 + (n - 1) * 45 + (15 if n > 3 else 0)
    return time(start // 60, start % 60), time((start + 45) // 60, (start + 45) % 60)


TIMETABLE = {
    # class: [(day, period, subject)] — Priya (EMP1001) teaches 10-A PHY/MATH and 9-B PHY with no clashes
    "Grade-10-A": [(d, 1, "PHY101") for d in (1, 3, 5)] + [(d, 2, "MATH-12") for d in (1, 2, 3, 4, 5)]
                  + [(d, 4, "PHY101") for d in (2, 4)],
    "Grade-9-B": [(d, 3, "PHY101") for d in (1, 2, 3, 4, 5)] + [(d, 1, "ENG-9") for d in (1, 2, 3, 4, 5)],
}


def _demo_timetable() -> None:
    if db.fetch_one("SELECT 1 FROM public.timetable_slots WHERE org_code = %s LIMIT 1", (ORG,)):
        return
    for klass, slots in TIMETABLE.items():
        for day, period, subject in slots:
            start, end = period_times(period)
            db.call_scalar("usp_upsert_timetable_slot", ORG, klass, subject, None, day, period, start, end, None,
                           "ADMIN001", casts=[None, None, None, None, "smallint", "smallint", "time", "time", None, None])


def _demo_homework() -> None:
    if db.fetch_one("SELECT 1 FROM public.homeworks WHERE org_code = %s LIMIT 1", (ORG,)):
        return
    today = date.today()
    hw = db.fetch_one(
        "INSERT INTO public.homeworks(org_code, class_code, subject_code, title, instructions, due_date, assigned_by) "
        "VALUES (%s,'Grade-10-A','PHY101',%s,%s,%s,'EMP1001') RETURNING homework_id",
        (ORG, "Newton's laws — 5 everyday examples",
         "For each of Newton's three laws, write one everyday example and explain it in 2-3 lines. "
         "Upload a photo of your notebook page.", today + timedelta(days=2)))
    db.execute(
        "INSERT INTO public.homeworks(org_code, class_code, subject_code, title, instructions, due_date, assigned_by) "
        "VALUES (%s,'Grade-10-A','MATH-12',%s,%s,%s,'EMP1001')",
        (ORG, "Quadratic equations — Exercise 4.2", "Solve questions 1 to 10 of Exercise 4.2 showing all steps.",
         today + timedelta(days=4)))
    db.execute(
        "INSERT INTO public.homework_submissions(homework_id, org_code, student_user_code, submission_notes) "
        "VALUES (%s,%s,'REG2026003',%s)", (hw["homework_id"], ORG, "Done in my notebook, pages 12-13."))


def _demo_attendance(days: int = 45) -> None:
    rng = random.Random(2026)
    roster = {c: [u[0] for u in USERS if u[3] == "student" and u[4] == c] for c, *_ in CLASSES}
    for back in range(days, 0, -1):
        d = date.today() - timedelta(days=back)
        if d.weekday() >= 5:  # school days only
            continue
        for klass, _, _, subjects in CLASSES:
            for subj, _, teacher in subjects:
                recs = [{"student_user_code": s,
                         "status": rng.choices(["present", "absent", "late", "excused"], [86, 8, 4, 2])[0]}
                        for s in roster[klass]]
                db.call_scalar("usp_save_attendance", ORG, klass, subj, d, "Period-1", teacher, Jsonb(recs))


if __name__ == "__main__":
    from scripts.migrate import run as migrate

    migrate()
    run(demo_attendance=True)
    db.close_pool()
