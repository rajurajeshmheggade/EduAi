"""Holidays in timetable (#10)."""
from datetime import date, timedelta

A = "/ICMELive/api/v1/admin"
C = "/ICMELive/api/v1/classroom"


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _iso(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def test_school_wide_holiday_visible_to_every_class(client, admin):
    r = client.post(f"{A}/holidays", headers=admin, json={
        "name": "Founder's Day", "start_date": _iso(5), "end_date": _iso(5), "holiday_type": "SCHOOL"})
    assert r.status_code == 201, r.text
    hid = r.json()["holiday_id"]

    student = _login(client, "student@demo.edu")       # Grade-10-A
    teacher = _login(client, "teacher@demo.edu")
    for h in (student, teacher):
        week = client.get(f"{C}/my-timetable", headers=h).json()
        assert any(x["holiday_id"] == hid for x in week["holidays"])

    client.delete(f"{A}/holidays/{hid}", headers=admin)


def test_class_specific_holiday_only_visible_to_that_class(client, admin):
    r = client.post(f"{A}/holidays", headers=admin, json={
        "name": "Grade 9 excursion", "start_date": _iso(6), "end_date": _iso(6), "holiday_type": "SCHOOL",
        "scope": "CLASS", "class_codes": ["Grade-9-B"]})
    assert r.status_code == 201, r.text
    hid = r.json()["holiday_id"]

    student_10a = _login(client, "student@demo.edu")   # Grade-10-A: unrelated, must not see it
    week = client.get(f"{C}/my-timetable", headers=student_10a).json()
    assert all(x["holiday_id"] != hid for x in week["holidays"])

    admin_list = client.get(f"{A}/holidays", headers=admin, params={"class_code": "Grade-9-B"}).json()["holidays"]
    assert any(x["holiday_id"] == hid for x in admin_list)
    admin_list_other = client.get(f"{A}/holidays", headers=admin, params={"class_code": "Grade-10-A"}).json()["holidays"]
    assert all(x["holiday_id"] != hid for x in admin_list_other)

    client.delete(f"{A}/holidays/{hid}", headers=admin)


def test_draft_holiday_hidden_until_published(client, admin):
    r = client.post(f"{A}/holidays", headers=admin, json={
        "name": "Tentative closure", "start_date": _iso(7), "end_date": _iso(7), "status": "DRAFT"})
    hid = r.json()["holiday_id"]
    student = _login(client, "student@demo.edu")
    week = client.get(f"{C}/my-timetable", headers=student).json()
    assert all(x["holiday_id"] != hid for x in week["holidays"])

    pub = client.put(f"{A}/holidays/{hid}", headers=admin, json={
        "name": "Tentative closure", "start_date": _iso(7), "end_date": _iso(7), "status": "PUBLISHED"})
    assert pub.status_code == 200 and pub.json()["status"] == "PUBLISHED"
    week2 = client.get(f"{C}/my-timetable", headers=student).json()
    assert any(x["holiday_id"] == hid for x in week2["holidays"])

    client.delete(f"{A}/holidays/{hid}", headers=admin)


def test_holiday_validation(client, admin):
    assert client.post(f"{A}/holidays", headers=admin, json={
        "name": "Bad range", "start_date": _iso(5), "end_date": _iso(1)}).status_code == 422
    assert client.post(f"{A}/holidays", headers=admin, json={
        "name": "No class picked", "start_date": _iso(5), "end_date": _iso(5), "scope": "CLASS"}).status_code == 422


def test_only_admins_manage_holidays(client, teacher, student):
    body = {"name": "Nope", "start_date": _iso(1), "end_date": _iso(1)}
    assert client.post(f"{A}/holidays", headers=teacher, json=body).status_code == 403
    assert client.post(f"{A}/holidays", headers=student, json=body).status_code == 403
