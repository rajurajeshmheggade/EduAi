"""FRD v3: superadmin bootstrap, institution plan/modules, timetable (no double-booking), homework."""
from datetime import date, timedelta

import pytest

A = "/ICMELive/api/v1/admin"
C = "/ICMELive/api/v1/classroom"
PDF = b"%PDF-1.4\n% homework\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _slot(client, h, **kw):
    body = {"class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 1,
            "start_time": "09:00", "end_time": "09:45", **kw}
    return client.put(f"{A}/timetable", headers=h, json=body)


# ---------------------------------------------------------------- FR-SA-01..03
def test_superadmin_bootstrap_login_must_change_password(client):
    r = client.post("/api/v1/auth/login", json={"email": "superadmin", "password": "superadmin"})
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["role"] == "superadmin" and user["must_change_password"] is True


def test_institution_profile_modules_and_extra_admin(client):
    sa = _login(client, "superadmin", "superadmin")
    r = client.post(f"{A}/organizations", headers=sa, json={
        "org_code": "ZENITH", "org_name": "Zenith Coaching Academy", "institution_level": "coaching",
        "board_or_affiliation": "Competitive exam prep", "address": "Jayanagar, Bengaluru", "max_students": 1,
        "ai_modules": ["ai_avatar_tutor"],
        "admin": {"full_name": "Zed Admin", "email": "zed@zenith.in", "user_code": "ZN-ADM1"},
    })
    assert r.status_code == 201, r.text
    org = {o["org_code"]: o for o in client.get(f"{A}/organizations", headers=sa).json()["organizations"]}["ZENITH"]
    assert org["max_students"] == 1 and org["ai_modules"] == ["ai_avatar_tutor"] and org["admins"] == 1
    assert "PLATFORM" not in {o["org_code"] for o in client.get(f"{A}/organizations", headers=sa).json()["organizations"]}

    extra = client.post(f"{A}/organizations/ZENITH/admins", headers=sa,
                        json={"full_name": "Second Admin", "email": "two@zenith.in", "user_code": "ZN-ADM2"})
    assert extra.status_code == 201
    adm = _login(client, "ZN-ADM2", extra.json()["temporary_password"])
    me = client.get("/api/v1/auth/me", headers=adm).json()
    assert me["role"] == "orgadmin" and me["must_change_password"] is True and me["ai_modules"] == ["ai_avatar_tutor"]
    # institution admins cannot change their own plan
    assert client.put(f"{A}/settings", headers=adm, json={"max_students": 500}).status_code == 403
    assert client.put(f"{A}/settings", headers=adm, json={"address": "New address"}).json()["address"] == "New address"

    # max_students = 1 is enforced on enrolment
    client.post(f"{A}/teachers", headers=adm, json={"user_code": "ZN-T1", "full_name": "Zara T", "email": "zt@zenith.in",
                                                    "password": "Teach3r!pass", "qualification": "M.Sc Physics"})
    client.post(f"{A}/classes", headers=adm, json={"class_code": "NEET-A", "class_name": "NEET Batch A",
                                                   "class_teacher_code": "ZN-T1", "room_number": "R-12"})
    t = _login(client, "ZN-T1", "Teach3r!pass")
    assert client.post(f"{C}/classes/NEET-A/students", headers=t, json={"full_name": "First"}).status_code == 201
    over = client.post(f"{C}/classes/NEET-A/students", headers=t, json={"full_name": "Second"})
    assert over.status_code == 403 and "limit" in over.json()["detail"].lower()
    teachers = client.get(f"{A}/teachers", headers=adm).json()["teachers"]
    assert teachers[0]["qualification"] == "M.Sc Physics"
    assert client.get(f"{A}/classes", headers=adm).json()["classes"][0]["room_number"] == "R-12"


def test_rag_chatbot_module_gate(client):
    # GREENFIELD-like tenant with the chatbot disabled: students get 403 even for their own subject
    sa = _login(client, "superadmin", "superadmin")
    client.put(f"{A}/settings", headers=sa, params={"org_code": "DEMO-SCHOOL"}, json={"ai_modules": ["ai_avatar_tutor"]})
    try:
        st = _login(client, "student@demo.edu")
        r = client.post("/ICMELive/api/v1/rag/query", headers=st, json={"query": "what is force?", "subject_code": "PHY101", "stream": False})
        assert r.status_code == 403
    finally:
        client.put(f"{A}/settings", headers=sa, params={"org_code": "DEMO-SCHOOL"},
                   json={"ai_modules": ["rag_chatbot", "ai_avatar_tutor", "ocr_evaluation", "capability_analysis"]})


def test_change_password_clears_flag(client):
    sa = _login(client, "superadmin", "superadmin")
    assert client.post("/api/v1/auth/change-password", headers=sa,
                       json={"current_password": "superadmin", "new_password": "Sup3r-secret!"}).status_code == 200
    h = _login(client, "superadmin", "Sup3r-secret!")
    assert client.get("/api/v1/auth/me", headers=h).json()["must_change_password"] is False
    client.post("/api/v1/auth/change-password", headers=h, json={"current_password": "Sup3r-secret!", "new_password": "superadmin"})


def test_subject_type(client, admin):
    r = client.put(f"{A}/classes/Grade-10-A/subjects/CHEM-LAB", headers=admin,
                   json={"subject_name": "Chemistry Lab", "subject_type": "LAB"})
    subj = {s["subject_code"]: s for s in r.json()["subjects"]}
    assert subj["CHEM-LAB"]["subject_type"] == "LAB" and subj["PHY101"]["subject_type"] == "THEORY"
    assert client.put(f"{A}/classes/Grade-10-A/subjects/X1", headers=admin,
                      json={"subject_name": "Bad", "subject_type": "SPORTS"}).status_code == 422
    client.delete(f"{A}/classes/Grade-10-A/subjects/CHEM-LAB", headers=admin)


# ---------------------------------------------------------------- FR-AD-07 timetable
def test_timetable_create_and_teacher_double_booking_rejected(client, admin):
    r = _slot(client, admin)  # Saturday P1, Priya teaches PHY101 in 10-A
    assert r.status_code == 200, r.text
    slot = r.json()
    assert slot["teacher_code"] == "EMP1001" and slot["subject_name"] == "Physics" and slot["start_time"] == "09:00"

    # Same teacher, overlapping time, different class -> 409
    clash = _slot(client, admin, class_code="Grade-9-B", start_time="09:30", end_time="10:15")
    assert clash.status_code == 409 and "EMP1001" in clash.json()["detail"]
    # Same class, overlapping time in another period -> 409
    assert _slot(client, admin, period_number=2, start_time="09:30", end_time="10:15").status_code == 409
    # Non-overlapping is fine; re-saving the same (class, day, period) replaces it
    ok = _slot(client, admin, class_code="Grade-9-B", start_time="10:00", end_time="10:45")
    assert ok.status_code == 200
    again = _slot(client, admin, start_time="08:00", end_time="08:45")
    assert again.status_code == 200 and again.json()["slot_id"] == slot["slot_id"]

    assert _slot(client, admin, subject_code="ENG-9").status_code == 422          # not a 10-A subject
    assert _slot(client, admin, start_time="10:00", end_time="09:00").status_code == 422
    assert _slot(client, admin, teacher_code="ZN-T1").status_code == 422           # other tenant's teacher

    for s in (again.json(), ok.json()):
        assert client.delete(f"{A}/timetable/{s['slot_id']}", headers=admin).status_code == 200


def test_timetable_rbac_and_read_views(client, admin, teacher, student):
    assert _slot(client, teacher).status_code == 403
    mine = client.get(f"{C}/my-timetable", headers=teacher).json()
    assert mine["slots"] and all(s["teacher_code"] == "EMP1001" for s in mine["slots"])
    assert {s["class_code"] for s in mine["slots"]} == {"Grade-10-A", "Grade-9-B"}
    week = client.get(f"{C}/my-timetable", headers=student).json()["slots"]
    assert week and all(s["class_code"] == "Grade-10-A" for s in week)
    assert {s["subject_code"] for s in week} == {"PHY101", "MATH-12"}
    assert client.get(f"{A}/timetable", headers=admin, params={"class_code": "Grade-9-B"}).json()["slots"]


def test_timetabled_substitute_can_mark_attendance(client, admin):
    kavya = _login(client, "kavya@demo.edu")
    body = {"class_code": "Grade-10-A", "subject_code": "MATH-12", "attendance_date": date.today().isoformat(),
            "session_slot": "Period-7", "records": [{"student_user_code": "REG2026001", "status": "present"}]}
    assert client.post(f"{C}/attendance", headers=kavya, json=body).status_code == 403
    s = _slot(client, admin, subject_code="MATH-12", teacher_code="EMP1002", day_of_week=7, period_number=7,
              start_time="15:00", end_time="15:45")
    assert s.status_code == 200, s.text
    assert client.post(f"{C}/attendance", headers=kavya, json=body).status_code == 200
    client.delete(f"{A}/timetable/{s.json()['slot_id']}", headers=admin)


# ---------------------------------------------------------------- FR-TE-04 / FR-ST-04 homework
@pytest.fixture(scope="module")
def homework(client, teacher):
    r = client.post(f"{C}/homework", headers=teacher, data={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "title": "Ray diagrams",
        "instructions": "Draw all six concave-mirror cases.", "due_date": (date.today() + timedelta(days=2)).isoformat(),
    }, files={"attachment": ("sheet.pdf", PDF, "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()


def test_homework_create_validation_and_rbac(client, teacher, student, homework):
    assert homework["attachment_url"] and homework["students"] >= 4 and homework["submitted"] == 0
    past = {"class_code": "Grade-10-A", "subject_code": "PHY101", "title": "Old", "instructions": "x" * 5,
            "due_date": (date.today() - timedelta(days=1)).isoformat()}
    assert client.post(f"{C}/homework", headers=teacher, data=past).status_code == 422
    future = {**past, "due_date": (date.today() + timedelta(days=1)).isoformat()}
    assert client.post(f"{C}/homework", headers=student, data=future).status_code == 403
    kavya = _login(client, "kavya@demo.edu")  # not a 10-A teacher
    assert client.post(f"{C}/homework", headers=kavya, data=future).status_code == 403
    bad = client.post(f"{C}/homework", headers=teacher, data=future, files={"attachment": ("x.exe", b"MZ....", "application/octet-stream")})
    assert bad.status_code == 415


def test_student_sees_and_submits_homework(client, student, homework):
    mine = client.get(f"{C}/my-homework", headers=student).json()
    hw = next(h for h in mine["homework"] if h["homework_id"] == homework["homework_id"])
    assert hw["status"] == "PENDING" and hw["attachment_url"] and mine["pending"] >= 1
    hid = homework["homework_id"]
    assert client.post(f"{C}/my-homework/{hid}/submit", headers=student, data={}).status_code == 422
    r = client.post(f"{C}/my-homework/{hid}/submit", headers=student, data={"notes": "Done"},
                    files={"file": ("page.png", PNG, "image/png")})
    assert r.status_code == 200
    hw = next(h for h in client.get(f"{C}/my-homework", headers=student).json()["homework"] if h["homework_id"] == hid)
    assert hw["status"] == "SUBMITTED" and hw["file_url"] and hw["submission_notes"] == "Done"
    # resubmitting notes only keeps the earlier file
    client.post(f"{C}/my-homework/{hid}/submit", headers=student, data={"notes": "Updated"})
    hw = next(h for h in client.get(f"{C}/my-homework", headers=student).json()["homework"] if h["homework_id"] == hid)
    assert hw["file_url"] and hw["submission_notes"] == "Updated"


def test_other_class_student_cannot_submit(client, homework):
    kabir = _login(client, "kabir@demo.edu")  # Grade-9-B
    r = client.post(f"{C}/my-homework/{homework['homework_id']}/submit", headers=kabir, data={"notes": "x"})
    assert r.status_code == 404
    assert all(h["homework_id"] != homework["homework_id"] for h in client.get(f"{C}/my-homework", headers=kabir).json()["homework"])


def test_teacher_reviews_and_student_is_locked(client, teacher, student, homework):
    hid = homework["homework_id"]
    subs = {s["student_user_code"]: s for s in client.get(f"{C}/homework/{hid}/submissions", headers=teacher).json()["submissions"]}
    assert subs["REG2026001"]["status"] == "SUBMITTED" and subs["REG2026001"]["file_url"]
    assert subs["REG2026002"]["status"] == "PENDING"
    assert client.post(f"{C}/homework/{hid}/submissions/REG2026002/review", headers=teacher, json={}).status_code == 404
    r = client.post(f"{C}/homework/{hid}/submissions/REG2026001/review", headers=teacher, json={"remarks": "Neat work"})
    assert r.status_code == 200
    hw = next(h for h in client.get(f"{C}/my-homework", headers=student).json()["homework"] if h["homework_id"] == hid)
    assert hw["status"] == "REVIEWED" and hw["teacher_remarks"] == "Neat work"
    assert client.post(f"{C}/my-homework/{hid}/submit", headers=student, data={"notes": "late edit"}).status_code == 409
    listed = next(h for h in client.get(f"{C}/homework", headers=teacher, params={"class_code": "Grade-10-A"}).json()["homework"]
                  if h["homework_id"] == hid)
    assert listed["submitted"] == 1 and listed["reviewed"] == 1


def test_homework_file_is_served(client, student, homework):
    hw = next(h for h in client.get(f"{C}/my-homework", headers=student).json()["homework"] if h["homework_id"] == homework["homework_id"])
    path = "/files/" + hw["file_url"].rsplit("/files/", 1)[1]
    r = client.get(path)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
