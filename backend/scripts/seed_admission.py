"""Pravesh (admissions) demo data: three schools (CBSE, ICSE, State board), staff, parents, applicants (Classes 6-12),
consent notice v1 in English / Hindi / Kannada / Tamil and one recorded consent.   python -m scripts.seed

Runs as the database owner (row-level security does not apply to it). Idempotent: deterministic ids + upserts.
Demo password for every account: Passw0rd!  (development only)
"""
from __future__ import annotations

import uuid

from app import db
from app.security import hash_password
from app.services.admission import consent_templates as ct

PASSWORD = "Passw0rd!"
NS = uuid.UUID("6a1f0f3e-5b2a-4d0e-9a51-7a6f3f0c2b11")   # namespace for stable demo ids

SCHOOLS = [
    # org_code, name, board, city (DEMO-SCHOOL already exists from the main seed)
    ("DEMO-SCHOOL", "Demo International School", "CBSE", "Bengaluru"),
    ("SVM-ICSE", "Sri Vidya Mandir", "ICSE", "Chennai"),
    ("KPS-STATE", "Karnataka Public School", "Karnataka State Board", "Mysuru"),
]

STAFF = [
    # user_code, org, name, email, role
    ("SVM-A0001", "SVM-ICSE", "Dr. Meenakshi Sundaram", "principal@svm.edu", "orgadmin"),
    ("KPS-A0001", "KPS-STATE", "Shivakumar Gowda", "principal@kps.edu", "orgadmin"),
    ("DEMO-C0001", "DEMO-SCHOOL", "Ritu Sharma", "counsellor@demo.edu", "counsellor"),
    ("DEMO-R0001", "DEMO-SCHOOL", "Arvind Rao", "reviewer@demo.edu", "reviewer"),
    ("SVM-C0001", "SVM-ICSE", "Vignesh Kumar", "counsellor@svm.edu", "counsellor"),
]

# Families: (org, guardian name, relationship, phone, email/login or None, parent user_code or None, language,
#            [(child name, date of birth, gender, grade, previous school)])
FAMILIES = [
    ("DEMO-SCHOOL", "Sunita Verma", "mother", "9845012345", "parent@demo.edu", "DEMO-P0001", "hi",
     [("Aarav Verma", "2015-04-12", "male", 6, "Little Flower School"), ("Diya Verma", "2012-09-03", "female", 9, "Little Flower School")]),
    ("DEMO-SCHOOL", "Mohammed Irfan", "father", "9900112233", "irfan@demo.edu", "DEMO-P0002", "en",
     [("Ayaan Irfan", "2010-01-21", "male", 11, "Al-Ameen High School")]),
    ("DEMO-SCHOOL", "Kavitha Banerjee", "mother", "9123456780", None, None, "en",
     [("Ishita Banerjee", "2014-06-30", "female", 7, None)]),
    ("DEMO-SCHOOL", "Suresh Nair", "father", "9447001122", None, None, "en",
     [("Rahul Nair", "2013-11-08", "male", 8, "Kendriya Vidyalaya")]),
    ("DEMO-SCHOOL", "Anjali Kulkarni", "mother", "9822334455", None, None, "hi",
     [("Sneha Kulkarni", "2011-02-14", "female", 10, None)]),
    ("DEMO-SCHOOL", "Venkat Reddy", "father", "9848022338", None, None, "en",
     [("Arjun Reddy", "2009-07-19", "male", 12, "Narayana Junior College")]),
    ("DEMO-SCHOOL", "Shabana Shaikh", "guardian", "9819456723", None, None, "hi",
     [("Fatima Shaikh", "2015-10-01", "female", 6, None)]),
    ("SVM-ICSE", "Lakshmi Iyer", "mother", "9884455667", "parent@svm.edu", "SVM-P0001", "ta",
     [("Karthik Iyer", "2013-03-25", "male", 8, "PSBB Millennium School")]),
    ("SVM-ICSE", "Raghavan Srinivasan", "father", "9840011223", None, None, "ta",
     [("Nandini Raghavan", "2010-08-17", "female", 11, None), ("Pranav Srinivasan", "2015-12-05", "male", 6, None)]),
    ("KPS-STATE", "Manjunath Gowda", "father", "9448123456", "parent@kps.edu", "KPS-P0001", "kn",
     [("Ananya Gowda", "2014-05-09", "female", 7, "Government Higher Primary School")]),
    ("KPS-STATE", "Savitha Hegde", "mother", "9632587410", None, None, "kn",
     [("Rakesh Hegde", "2012-01-30", "male", 9, None)]),
]


def _id(*parts: str) -> str:
    return str(uuid.uuid5(NS, "/".join(parts)))


def _user(code: str, org: str, name: str, email: str, role: str, pw: str) -> None:
    db.call_scalar("usp_create_user", code, org, "ICME", name, email, pw, role, None, None, None, [],
                   casts=[None] * 10 + ["text[]"])


def run() -> None:
    pw = hash_password(PASSWORD)
    for org, name, board, city in SCHOOLS:
        db.execute("INSERT INTO public.organizations(org_code, customer_code, org_name, institution_level, board_or_affiliation, city) "
                   "VALUES (%s,'ICME',%s,'school',%s,%s) ON CONFLICT (org_code) DO UPDATE SET "
                   "board_or_affiliation = COALESCE(public.organizations.board_or_affiliation, EXCLUDED.board_or_affiliation), "
                   "city = COALESCE(public.organizations.city, EXCLUDED.city)", (org, name, board, city))
    for code, org, name, email, role in STAFF:
        _user(code, org, name, email, role, pw)

    applicants = 0
    for org, gname, rel, phone, email, parent_code, lang, children in FAMILIES:
        if parent_code:
            _user(parent_code, org, gname, email, "parent", pw)
        gid = _id(org, "guardian", gname)
        db.execute("INSERT INTO admission.guardians (guardian_id, org_code, user_code, full_name, relationship, phone, email, "
                   "preferred_language) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (guardian_id) DO NOTHING",
                   (gid, org, parent_code, gname, rel, phone, email, lang))
        for cname, dob, gender, grade, prev in children:
            aid = _id(org, "applicant", cname)
            db.execute("INSERT INTO admission.applicants (applicant_id, org_code, full_name, date_of_birth, gender, grade_applying, "
                       "previous_school, preferred_language, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'seed') "
                       "ON CONFLICT (applicant_id) DO NOTHING", (aid, org, cname, dob, gender, grade, prev, lang))
            db.execute("INSERT INTO admission.applicant_guardians (org_code, applicant_id, guardian_id) VALUES (%s,%s,%s) "
                       "ON CONFLICT DO NOTHING", (org, aid, gid))
            applicants += 1

    # Consent notice v1 per school in all four languages (Hindi/Kannada/Tamil flagged as draft translations in the UI).
    for org, name, _board, _city in SCHOOLS:
        for lang in ct.LANGUAGES:
            t = ct.render(lang, name)
            db.execute("INSERT INTO admission.consent_versions (version_id, org_code, version, language, title, body, purposes, created_by) "
                       "VALUES (%s,%s,1,%s,%s,%s,%s,'seed') ON CONFLICT (org_code, version, language) DO NOTHING",
                       (_id(org, "consent", "1", lang), org, lang, t["title"], t["body"], ct.PURPOSES))

    # One family has already consented in Hindi (Aarav); everyone else is still pending.
    aid, gid = _id("DEMO-SCHOOL", "applicant", "Aarav Verma"), _id("DEMO-SCHOOL", "guardian", "Sunita Verma")
    if not db.fetch_one("SELECT 1 FROM admission.consents WHERE applicant_id = %s", (aid,)):
        db.execute("INSERT INTO admission.consents (org_code, applicant_id, guardian_id, version_id, version, language, decision, "
                   "method, recorded_by) VALUES ('DEMO-SCHOOL', %s, %s, %s, 1, 'hi', 'granted', 'parent_portal', 'DEMO-P0001')",
                   (aid, gid, _id("DEMO-SCHOOL", "consent", "1", "hi")))
    print(f"Seeded admissions: {len(SCHOOLS)} schools, {len(STAFF)} staff, {len(FAMILIES)} families, {applicants} applicants "
          f"(password: {PASSWORD})")


if __name__ == "__main__":
    run()
