"""Aggregated role dashboards."""
D = "/ICMELive/api/v1/dashboard"


def test_teacher_dashboard(client, teacher, student):
    r = client.get(f"{D}/teacher", headers=teacher)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kpis"]["classes"] == 2 and d["kpis"]["students"] >= 4
    assert {"homework_to_review", "active_assessments", "attention", "attendance_month", "today_slots"} <= d.keys()
    assert all("attendance_marked" in s for s in d["today_slots"])
    assert client.get(f"{D}/teacher", headers=student).status_code == 403


def test_student_dashboard(client, student, teacher):
    r = client.get(f"{D}/student", headers=student)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["class_code"] == "Grade-10-A" and d["threshold"] == 75
    assert {"attendance_month", "homework", "upcoming", "results", "subjects"} <= d.keys()
    assert {s["subject_code"] for s in d["subjects"]} >= {"PHY101", "MATH-12"}
    assert client.get(f"{D}/student", headers=teacher).status_code == 403


def test_admin_dashboard(client, admin, teacher):
    r = client.get(f"{D}/admin", headers=admin)
    assert r.status_code == 200, r.text
    d = r.json()
    assert {"attendance_trend", "class_attendance", "assessments", "recent_members"} <= d.keys()
    assert {"online_tests", "assignments", "offline_exams", "evaluated"} <= d["assessments"].keys()
    assert client.get(f"{D}/admin", headers=teacher).status_code == 403
