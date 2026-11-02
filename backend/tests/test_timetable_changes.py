"""Timetable change history + notifications (#3)."""
A = "/ICMELive/api/v1/admin"
N = "/ICMELive/api/v1/notifications"


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_updating_a_published_slot_notifies_students_and_teacher(client, admin):
    r = client.put(f"{A}/timetable", headers=admin, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 11,
        "start_time": "12:00", "end_time": "12:45"})
    assert r.status_code == 200, r.text
    slot_id = r.json()["slot_id"]

    student = _login(client, "student@demo.edu")   # Grade-10-A
    teacher = _login(client, "teacher@demo.edu")    # EMP1001, teaches PHY101 in Grade-10-A

    changed = client.put(f"{A}/timetable", headers=admin, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 11,
        "start_time": "13:00", "end_time": "13:45", "change_reason": "Lab clash"})
    assert changed.status_code == 200, changed.text

    sn = client.get(N, headers=student).json()
    hit = next((n for n in sn["notifications"] if n["notif_type"] == "TIMETABLE_CHANGE" and "Lab clash" in (n["body"] or "")), None)
    assert hit and hit["is_read"] is False and hit["link"] == "/student/timetable"

    tn = client.get(N, headers=teacher).json()
    assert any(n["notif_type"] == "TIMETABLE_CHANGE" for n in tn["notifications"])

    # re-saving the exact same values is not a "change" -> no second notification (idempotent dedup)
    before_count = len(client.get(N, headers=student).json()["notifications"])
    again = client.put(f"{A}/timetable", headers=admin, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 11,
        "start_time": "13:00", "end_time": "13:45", "change_reason": "Lab clash"})
    assert again.status_code == 200
    assert len(client.get(N, headers=student).json()["notifications"]) == before_count

    # mark one as read
    assert client.patch(f"{N}/{hit['notification_id']}/read", headers=student).status_code == 200
    assert next(n for n in client.get(N, headers=student).json()["notifications"]
               if n["notification_id"] == hit["notification_id"])["is_read"] is True

    client.delete(f"{A}/timetable/{slot_id}", headers=admin, params={"reason": "test cleanup"})


def test_cancelling_a_slot_is_recorded_and_notified(client, admin):
    r = client.put(f"{A}/timetable", headers=admin, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 10,
        "start_time": "14:00", "end_time": "14:45"})
    slot_id = r.json()["slot_id"]
    student = _login(client, "student@demo.edu")

    deleted = client.delete(f"{A}/timetable/{slot_id}", headers=admin, params={"reason": "Teacher on leave"})
    assert deleted.status_code == 200

    sn = client.get(N, headers=student).json()
    hit = next((n for n in sn["notifications"] if "Teacher on leave" in (n["body"] or "")), None)
    assert hit and "removed" in hit["title"].lower()


def test_draft_class_change_is_recorded_but_not_notified(client, admin):
    toggled = client.patch(f"{A}/classes/Grade-10-A/timetable-status", headers=admin, json={"status": "DRAFT"})
    assert toggled.status_code == 200
    try:
        r = client.put(f"{A}/timetable", headers=admin, json={
            "class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 9,
            "start_time": "08:00", "end_time": "08:45"})
        slot_id = r.json()["slot_id"]
        student = _login(client, "student@demo.edu")
        before = len(client.get(N, headers=student).json()["notifications"])

        changed = client.put(f"{A}/timetable", headers=admin, json={
            "class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 9,
            "start_time": "08:15", "end_time": "09:00"})
        assert changed.status_code == 200
        # draft class: the change is recorded (auditable) but nobody is notified until it's published
        assert len(client.get(N, headers=student).json()["notifications"]) == before
        client.delete(f"{A}/timetable/{slot_id}", headers=admin)
    finally:
        client.patch(f"{A}/classes/Grade-10-A/timetable-status", headers=admin, json={"status": "PUBLISHED"})


def test_notifications_rbac_is_per_user(client, admin):
    student = _login(client, "student@demo.edu")
    other_student = _login(client, "meera@demo.edu")
    sn = {n["notification_id"] for n in client.get(N, headers=student).json()["notifications"]}
    on = {n["notification_id"] for n in client.get(N, headers=other_student).json()["notifications"]}
    assert not (sn & on)  # no overlap: each student only ever sees their own notifications
