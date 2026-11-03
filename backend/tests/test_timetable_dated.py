"""Date-level timetable (spec 5.1-5.4): resolver, working days, dated CRUD, conflicts, copy, bell schedule, rooms,
RBAC, and the four timetable bug fixes (notification dedup, holiday window, dashboards, changed_by_name)."""
from datetime import date, timedelta

import pytest

A = "/ICMELive/api/v1/admin"
C = "/ICMELive/api/v1/classroom"
D = "/ICMELive/api/v1/dashboard"
N = "/ICMELive/api/v1/notifications"

# Seeded weekly template (scripts/seed.py), all taught by Priya (EMP1001) unless noted:
#   Grade-10-A: P1 PHY101 Mon/Wed/Fri 09:00-09:45 · P2 MATH-12 Mon-Fri 09:45-10:30 · P4 PHY101 Tue/Thu 11:30-12:15
#   Grade-9-B:  P1 ENG-9 Mon-Fri 09:00-09:45 (Kavya, EMP1002) · P3 PHY101 Mon-Fri 10:30-11:15


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _day(weekday: int, weeks: int = 3) -> date:
    """The ISO `weekday` (1 = Monday) of the week `weeks` weeks from now."""
    mon = date.today() - timedelta(days=date.today().isoweekday() - 1) + timedelta(weeks=weeks)
    return mon + timedelta(days=weekday - 1)


def _cal(client, h, start: date, end: date | None = None, **params) -> list[dict]:
    r = client.get(f"{A}/timetable/calendar", headers=h,
                   params={"start": start.isoformat(), "end": (end or start).isoformat(), **params})
    assert r.status_code == 200, r.text
    return r.json()["sessions"]


def _at(sessions, class_code, period, d: date | None = None):
    return next((s for s in sessions if s["class_code"] == class_code and s["period_number"] == period
                 and (d is None or s["session_date"] == d.isoformat())), None)


def _put(client, h, d: date, **kw):
    body = {"class_code": "Grade-10-A", "subject_code": "PHY101", "session_date": d.isoformat(), "period_number": 6,
            "start_time": "13:00", "end_time": "13:45", **kw}
    return client.put(f"{A}/timetable/sessions", headers=h, json=body)


def _entries_cleanup(client, h, start: date, end: date, org=None):
    params = {"org_code": org} if org else {}
    for s in _cal(client, h, start, end, **params):
        if s["entry_id"]:
            client.delete(f"{A}/timetable/sessions/{s['entry_id']}", headers=h, params=params)


@pytest.fixture
def clean(client, admin):
    """Removes every dated entry the test created in the next ~10 weeks."""
    yield
    _entries_cleanup(client, admin, date.today() - timedelta(days=1), date.today() + timedelta(days=90))


# ---------------------------------------------------------------- resolver (5.1)
def test_resolver_merges_template_dated_entries_holidays_and_draft(client, admin, student, teacher, clean):
    mon = _day(1)
    week = _cal(client, admin, mon, class_code="Grade-10-A")
    assert {(s["period_number"], s["source"], s["status"]) for s in week} == {(1, "TEMPLATE", "SCHEDULED"), (2, "TEMPLATE", "SCHEDULED")}

    sub = _put(client, admin, mon, subject_code="MATH-12", period_number=2, start_time="09:45", end_time="10:30",
               teacher_code="EMP1002", note="Priya at a workshop")           # substitute on one date
    assert sub.status_code == 200, sub.text
    s = sub.json()["session"]
    assert s["source"] == "OVERRIDE" and s["teacher_code"] == "EMP1002" and s["template_teacher_code"] == "EMP1001"
    # the substitute is notified, and sees the change although Grade-10-A isn't one of her weekly classes
    kav = _login(client, "kavya@demo.edu")
    assert any("Priya at a workshop" in (n["body"] or "") for n in client.get(N, headers=kav).json()["notifications"])
    kchanges = client.get(f"{C}/my-timetable", headers=kav).json()["recent_changes"]
    assert any(c["class_code"] == "Grade-10-A" and c["session_date"] == mon.isoformat() for c in kchanges)
    cancel = client.post(f"{A}/timetable/sessions/cancel", headers=admin,
                         json={"class_code": "Grade-10-A", "session_date": mon.isoformat(), "period_number": 1,
                               "reason": "Assembly"})
    assert cancel.status_code == 200, cancel.text
    extra = _put(client, admin, mon)                                          # P6 13:00 extra Physics
    assert extra.status_code == 200 and extra.json()["session"]["source"] == "DATED"

    day = _cal(client, admin, mon, class_code="Grade-10-A")
    assert _at(day, "Grade-10-A", 1)["status"] == "CANCELLED" and _at(day, "Grade-10-A", 1)["note"] == "Assembly"
    assert _at(day, "Grade-10-A", 2)["teacher_name"] == "Kavya Teacher"
    assert _at(day, "Grade-10-A", 6)["subject_name"] == "Physics"
    # the following Monday is untouched: weekly pattern only
    nxt = _cal(client, admin, mon + timedelta(days=7), class_code="Grade-10-A")
    assert {s["source"] for s in nxt} == {"TEMPLATE"} and len(nxt) == 2

    # teacher-wise: Priya still sees her reassigned period (flagged by template_teacher_code), Kavya sees the cover
    priya = _cal(client, admin, mon, teacher_code="EMP1001")
    assert _at(priya, "Grade-10-A", 2)["teacher_code"] == "EMP1002" and _at(priya, "Grade-9-B", 3)
    kavya = _cal(client, admin, mon, teacher_code="EMP1002")
    assert _at(kavya, "Grade-10-A", 2) and _at(kavya, "Grade-9-B", 1)

    # same picture for the student and the teacher ("my timetable")
    mine = client.get(f"{C}/my-timetable", headers=student, params={"start": mon.isoformat(), "end": mon.isoformat()}).json()
    assert {(x["period_number"], x["status"]) for x in mine["sessions"]} == {(1, "CANCELLED"), (2, "SCHEDULED"), (6, "SCHEDULED")}
    tmine = client.get(f"{C}/my-timetable", headers=teacher, params={"start": mon.isoformat(), "end": mon.isoformat()}).json()
    covered = _at(tmine["sessions"], "Grade-10-A", 2)
    assert covered["is_mine"] is False and _at(tmine["sessions"], "Grade-10-A", 6)["is_mine"] is True

    # a published full-day holiday turns weekly periods into HOLIDAY; explicit dated sessions still run
    h = client.post(f"{A}/holidays", headers=admin, json={"name": "Sports day", "start_date": mon.isoformat(),
                                                           "end_date": mon.isoformat()}).json()
    try:
        day = _cal(client, admin, mon, class_code="Grade-9-B")
        assert {s["status"] for s in day} == {"HOLIDAY"} and day[0]["holiday_name"] == "Sports day"
        assert _at(_cal(client, admin, mon, class_code="Grade-10-A"), "Grade-10-A", 6)["status"] == "SCHEDULED"
    finally:
        client.delete(f"{A}/holidays/{h['holiday_id']}", headers=admin)

    # draft class: hidden from the student's calendar, still visible to the admin
    client.patch(f"{A}/classes/Grade-10-A/timetable-status", headers=admin, json={"status": "DRAFT"})
    try:
        hidden = client.get(f"{C}/my-timetable", headers=student, params={"start": mon.isoformat(), "end": mon.isoformat()}).json()
        assert hidden["sessions"] == [] and _cal(client, admin, mon, class_code="Grade-10-A")
    finally:
        client.patch(f"{A}/classes/Grade-10-A/timetable-status", headers=admin, json={"status": "PUBLISHED"})


def test_resolver_respects_effective_range(client, admin, clean):
    sat = _day(6, 2)
    r = client.put(f"{A}/timetable", headers=admin, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 12,
        "start_time": "16:00", "end_time": "16:45", "effective_from": sat.isoformat(),
        "effective_to": (sat + timedelta(days=7)).isoformat()})
    assert r.status_code == 200, r.text
    try:
        dates = {s["session_date"] for s in _cal(client, admin, sat - timedelta(days=7), sat + timedelta(days=14),
                                                 class_code="Grade-10-A") if s["period_number"] == 12}
        assert dates == {sat.isoformat(), (sat + timedelta(days=7)).isoformat()}
    finally:
        client.delete(f"{A}/timetable/{r.json()['slot_id']}", headers=admin)


def test_my_timetable_defaults_to_this_week_and_stays_backward_compatible(client, student):
    r = client.get(f"{C}/my-timetable", headers=student)
    assert r.status_code == 200
    d = r.json()
    assert {"today", "slots", "holidays", "recent_changes"} <= d.keys()           # unchanged contract
    mon = date.today() - timedelta(days=date.today().isoweekday() - 1)
    assert d["range"] == {"start": mon.isoformat(), "end": (mon + timedelta(days=6)).isoformat()}
    assert d["working_days"] == [1, 2, 3, 4, 5, 6, 7] and d["bell_schedule"]["default"]
    assert all(s["class_code"] == "Grade-10-A" for s in d["sessions"])
    assert client.get(f"{C}/my-timetable", headers=student,
                      params={"start": "2026-01-01", "end": "2026-12-31"}).status_code == 422


# ---------------------------------------------------------------- working days (5.2)
def test_saturday_sunday_are_configurable_working_days(client, admin, teacher, clean):
    sat, sun = _day(6), _day(7)
    assert client.get(f"{A}/timetable/working-days", headers=admin).json()["working_days"] == [1, 2, 3, 4, 5, 6, 7]
    weekly = client.put(f"{A}/timetable", headers=admin, json={
        "class_code": "Grade-9-B", "subject_code": "ENG-9", "day_of_week": 6, "period_number": 12,
        "start_time": "16:00", "end_time": "16:45"})
    assert weekly.status_code == 200, weekly.text
    try:
        r = client.put(f"{A}/timetable/working-days", headers=admin, json={"working_days": [5, 1, 2, 3, 4, 4]})
        assert r.status_code == 200 and r.json() == {"working_days": [1, 2, 3, 4, 5], "weekly_periods_on_closed_days": 1}
        # closed days: weekly periods produce no sessions, and nothing new can be scheduled
        assert _cal(client, admin, sat, sun, class_code="Grade-9-B") == []
        closed = _put(client, admin, sat)
        assert closed.status_code == 409 and closed.json()["conflicts"][0]["kind"] == "NON_WORKING_DAY"
        assert "Saturday is not a working day" in closed.json()["detail"]
        w = client.put(f"{A}/timetable", headers=admin, json={
            "class_code": "Grade-9-B", "subject_code": "ENG-9", "day_of_week": 7, "period_number": 12,
            "start_time": "16:00", "end_time": "16:45"})
        assert w.status_code == 409 and w.json()["conflicts"][0]["kind"] == "NON_WORKING_DAY"

        # open Saturday again (Sunday stays closed): Saturday scheduling works, and the weekly period is back
        client.put(f"{A}/timetable/working-days", headers=admin, json={"working_days": [1, 2, 3, 4, 5, 6]})
        assert _put(client, admin, sat).status_code == 200
        assert {s["period_number"] for s in _cal(client, admin, sat, class_code="Grade-9-B")} == {12}
        assert _put(client, admin, sun).status_code == 409

        assert client.put(f"{A}/timetable/working-days", headers=admin, json={"working_days": []}).status_code == 422
        assert client.put(f"{A}/timetable/working-days", headers=admin, json={"working_days": [8]}).status_code == 422
        assert client.put(f"{A}/timetable/working-days", headers=teacher, json={"working_days": [1]}).status_code == 403
    finally:
        client.put(f"{A}/timetable/working-days", headers=admin, json={"working_days": [1, 2, 3, 4, 5, 6, 7]})
        client.delete(f"{A}/timetable/{weekly.json()['slot_id']}", headers=admin)


# ---------------------------------------------------------------- dated CRUD (5.3)
def test_dated_session_add_edit_move_cancel_restore(client, admin, clean):
    wed = _day(3)
    r = _put(client, admin, wed, period_number=7, start_time="14:00", end_time="14:45", room_number="LAB-1")
    assert r.status_code == 200, r.text
    s = r.json()["session"]
    assert s["source"] == "DATED" and s["room_number"] == "LAB-1" and s["teacher_code"] == "EMP1001"

    edited = _put(client, admin, wed, period_number=7, start_time="14:15", end_time="15:00", subject_code="MATH-12")
    assert edited.status_code == 200 and edited.json()["session"]["entry_id"] == s["entry_id"]
    assert edited.json()["session"]["subject_name"] == "Mathematics"

    moved = _put(client, admin, wed, period_number=8, original_period_number=7, start_time="15:00", end_time="15:45",
                 subject_code="MATH-12")
    assert moved.status_code == 200, moved.text
    day = _cal(client, admin, wed, class_code="Grade-10-A")
    assert _at(day, "Grade-10-A", 7) is None and _at(day, "Grade-10-A", 8)["start_time"] == "15:00"

    # editing a weekly period on one date creates an override; deleting the override restores the weekly period
    ov = _put(client, admin, wed, period_number=2, subject_code="MATH-12", start_time="09:50", end_time="10:30")
    assert ov.status_code == 200 and ov.json()["session"]["source"] == "OVERRIDE"
    restored = client.delete(f"{A}/timetable/sessions/{ov.json()['session']['entry_id']}", headers=admin)
    assert restored.status_code == 200 and restored.json()["restored"]["source"] == "TEMPLATE"
    assert _at(_cal(client, admin, wed, class_code="Grade-10-A"), "Grade-10-A", 2)["start_time"] == "09:45"

    # cancel: a dated extra disappears; a weekly period is marked cancelled for that date only
    assert client.post(f"{A}/timetable/sessions/cancel", headers=admin, json={
        "class_code": "Grade-10-A", "session_date": wed.isoformat(), "period_number": 8}).status_code == 200
    assert _at(_cal(client, admin, wed, class_code="Grade-10-A"), "Grade-10-A", 8) is None
    again = client.post(f"{A}/timetable/sessions/cancel", headers=admin, json={
        "class_code": "Grade-10-A", "session_date": wed.isoformat(), "period_number": 8})
    assert again.status_code == 404

    # validation
    assert _put(client, admin, wed, subject_code="ENG-9").status_code == 422                 # not a 10-A subject
    assert _put(client, admin, wed, start_time="10:00", end_time="09:00").status_code == 422
    assert _put(client, admin, wed, is_online=True).status_code == 422                        # no meeting URL
    assert _put(client, admin, wed, teacher_code="NOPE-1").status_code == 422
    assert _put(client, admin, wed, class_code="NO-CLASS").status_code == 404
    assert _put(client, admin, wed, period_number=13).status_code == 422
    assert client.delete(f"{A}/timetable/sessions/00000000-0000-0000-0000-000000000000", headers=admin).status_code == 404
    assert client.get(f"{A}/timetable/calendar", headers=admin,
                      params={"start": "2026-01-01", "end": "2026-06-30"}).status_code == 422


# ---------------------------------------------------------------- conflicts (5.3)
def test_dated_conflicts_teacher_class_room_and_dry_run(client, admin, clean):
    tue = _day(2)
    assert _put(client, admin, tue, period_number=7, start_time="14:00", end_time="14:45", room_number="LAB-1").status_code == 200
    assert _put(client, admin, tue, class_code="Grade-9-B", subject_code="ENG-9", period_number=6,
                start_time="13:30", end_time="14:15").status_code == 200                  # Kavya, 9-B

    teacher = _put(client, admin, tue, class_code="Grade-9-B", period_number=8, start_time="14:15", end_time="15:00")
    assert teacher.status_code == 409 and "EMP1001" in teacher.json()["detail"]                # Priya is in 10-A
    assert [c["kind"] for c in teacher.json()["conflicts"]] == ["TEACHER_CLASH"]
    room = _put(client, admin, tue, class_code="Grade-9-B", subject_code="ENG-9", period_number=8,
                start_time="14:15", end_time="15:00", room_number=" lab-1 ")
    assert room.status_code == 409 and room.json()["conflicts"][0]["kind"] == "ROOM_CLASH"
    online = _put(client, admin, tue, class_code="Grade-9-B", subject_code="ENG-9", period_number=8, start_time="14:15",
                  end_time="15:00", room_number="LAB-1", is_online=True, online_url="https://meet.example.com/x")
    assert online.status_code == 200                                                           # online: no room needed
    overlap = _put(client, admin, tue, period_number=8, start_time="14:30", end_time="15:15")
    assert overlap.status_code == 409 and "CLASS_CLASH" in {c["kind"] for c in overlap.json()["conflicts"]}

    # dry run reports every conflict at once and writes nothing
    chk = client.post(f"{A}/timetable/check-conflicts", headers=admin, json={
        "class_code": "Grade-9-B", "session_date": tue.isoformat(), "period_number": 9, "subject_code": "PHY101",
        "start_time": "14:00", "end_time": "14:45", "room_number": "LAB-1"})
    assert chk.status_code == 200 and chk.json()["ok"] is False
    assert {c["kind"] for c in chk.json()["conflicts"]} == {"TEACHER_CLASH", "ROOM_CLASH", "CLASS_CLASH"}
    assert _at(_cal(client, admin, tue, class_code="Grade-9-B"), "Grade-9-B", 9) is None
    free = client.post(f"{A}/timetable/check-conflicts", headers=admin, json={
        "class_code": "Grade-9-B", "session_date": tue.isoformat(), "period_number": 9, "subject_code": "ENG-9",
        "start_time": "16:00", "end_time": "16:45"})
    assert free.json() == {"ok": True, "conflicts": []}
    assert client.post(f"{A}/timetable/check-conflicts", headers=admin, json={
        "class_code": "Grade-9-B", "period_number": 9, "start_time": "16:00", "end_time": "16:45"}).status_code == 422

    # warnings never block: the default bell's break (11:15-11:30) and a holiday
    brk = _put(client, admin, tue, class_code="Grade-9-B", subject_code="ENG-9", period_number=10,
               start_time="11:15", end_time="11:45")
    assert brk.status_code == 200 and [w["kind"] for w in brk.json()["warnings"]] == ["BREAK_OVERLAP"]


def test_weekly_conflicts_are_effective_range_and_dated_aware(client, admin, clean):
    weekly = lambda **kw: client.put(f"{A}/timetable", headers=admin, json={  # noqa: E731
        "class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 12,
        "start_time": "16:00", "end_time": "16:45", **kw})
    a = weekly(effective_from="2027-01-01", effective_to="2027-03-31")
    assert a.status_code == 200, a.text
    ids = [a.json()["slot_id"]]
    try:
        # same teacher, same weekday and time, but the date ranges don't overlap -> fine
        b = weekly(class_code="Grade-9-B", effective_from="2027-04-01", effective_to="2027-06-30")
        assert b.status_code == 200, b.text
        ids.append(b.json()["slot_id"])
        c = weekly(class_code="Grade-9-B", effective_from="2027-03-01", effective_to="2027-06-30")
        assert c.status_code == 409 and c.json()["conflicts"][0]["kind"] == "TEACHER_CLASH"
        # room clash between weekly periods (room comes from the period or the class's home room)
        r1 = weekly(period_number=11, start_time="17:00", end_time="17:45", room_number="HALL",
                    effective_from=None, effective_to=None)
        assert r1.status_code == 200
        ids.append(r1.json()["slot_id"])
        r2 = weekly(class_code="Grade-9-B", subject_code="ENG-9", period_number=11, start_time="17:15",
                    end_time="17:45", room_number="hall")
        assert r2.status_code == 409 and r2.json()["conflicts"][0]["kind"] == "ROOM_CLASH"

        # weekly vs an upcoming dated session of the same teacher on that weekday
        sat = _day(6)
        assert _put(client, admin, sat, class_code="Grade-9-B", period_number=10, start_time="18:00",
                    end_time="18:45").status_code == 200
        clash = weekly(period_number=10, start_time="18:15", end_time="19:00")
        assert clash.status_code == 409
        hit = clash.json()["conflicts"][0]
        assert hit["kind"] == "TEACHER_CLASH" and hit["conflict_date"] == sat.isoformat() and hit["source"] == "DATED"
        # ...unless the weekly period starts after that date
        later = weekly(period_number=10, start_time="18:15", end_time="19:00",
                       effective_from=(sat + timedelta(days=1)).isoformat())
        assert later.status_code == 200
        ids.append(later.json()["slot_id"])
    finally:
        for i in ids:
            client.delete(f"{A}/timetable/{i}", headers=admin)


# ---------------------------------------------------------------- copy from another date (5.3)
def test_copy_class_day_to_another_date_skip_overwrite_replace(client, admin, student, clean):
    mon, tue, sat = _day(1, 4), _day(2, 4), _day(6, 4)
    body = {"source_date": mon.isoformat(), "class_codes": ["Grade-10-A"]}
    dry = client.post(f"{A}/timetable/copy", headers=admin, json={**body, "target_dates": [sat.isoformat()], "dry_run": True})
    assert dry.status_code == 200 and len(dry.json()["copied"]) == 2
    assert _cal(client, admin, sat, class_code="Grade-10-A") == []                       # dry run wrote nothing

    before = len(client.get(N, headers=student).json()["notifications"])
    r = client.post(f"{A}/timetable/copy", headers=admin, json={**body, "target_dates": [sat.isoformat()]})
    assert r.status_code == 200, r.text
    assert {c["period_number"] for c in r.json()["copied"]} == {1, 2} and not r.json()["skipped"]
    day = _cal(client, admin, sat, class_code="Grade-10-A")
    assert {(s["period_number"], s["source"], s["copied_from"]) for s in day} == {(1, "DATED", mon.isoformat()),
                                                                                  (2, "DATED", mon.isoformat())}
    notes = client.get(N, headers=student).json()["notifications"]
    assert len(notes) == before + 1 and "Timetable updated" in notes[0]["title"]
    assert client.post(f"{A}/timetable/copy", headers=admin, json={**body, "target_dates": [sat.isoformat()]}).json()["unchanged"] == 2

    # Tuesday has its own P2 (same) and P4: skip keeps P4, adds P1
    skip = client.post(f"{A}/timetable/copy", headers=admin, json={**body, "target_dates": [tue.isoformat()]}).json()
    assert [c["period_number"] for c in skip["copied"]] == [1] and skip["unchanged"] == 1
    # replace_target makes Tuesday identical to Monday: P4 is cancelled for that date only
    rep = client.post(f"{A}/timetable/copy", headers=admin,
                      json={**body, "target_dates": [tue.isoformat()], "mode": "overwrite", "replace_target": True}).json()
    assert [(c["period_number"], c["subject_name"]) for c in rep["cancelled"]] == [(4, "Physics")]
    day = _cal(client, admin, tue, class_code="Grade-10-A")
    assert {(s["period_number"], s["status"]) for s in day} == {(1, "SCHEDULED"), (2, "SCHEDULED"), (4, "CANCELLED")}
    assert {s["status"] for s in _cal(client, admin, tue + timedelta(days=7), class_code="Grade-10-A")} == {"SCHEDULED"}


def test_copy_skips_and_reports_conflicts_occupied_holidays(client, admin, clean):
    mon, thu, fri = _day(1, 5), _day(4, 5), _day(5, 5)
    # Thursday: Priya covers 9-B's English in P1, so she can't also take 10-A's copied P1 (09:00)
    assert _put(client, admin, thu, class_code="Grade-9-B", period_number=1, start_time="09:00", end_time="09:45",
                teacher_code="EMP1001").status_code == 200
    r = client.post(f"{A}/timetable/copy", headers=admin, json={
        "source_date": mon.isoformat(), "class_codes": ["Grade-10-A"], "target_dates": [thu.isoformat()]}).json()
    assert r["copied"] == [] and r["unchanged"] == 1
    sk = r["skipped"][0]
    assert sk["reason"] == "CONFLICT" and sk["period_number"] == 1 and sk["conflicts"][0]["kind"] == "TEACHER_CLASH"

    # occupied period in skip mode; overwrite replaces it
    assert _put(client, admin, fri, period_number=1, subject_code="MATH-12", start_time="09:00",
                end_time="09:45").status_code == 200
    occ = client.post(f"{A}/timetable/copy", headers=admin, json={
        "source_date": mon.isoformat(), "class_codes": ["Grade-10-A"], "target_dates": [fri.isoformat()]}).json()
    assert [s["reason"] for s in occ["skipped"]] == ["OCCUPIED"]
    ow = client.post(f"{A}/timetable/copy", headers=admin, json={
        "source_date": mon.isoformat(), "class_codes": ["Grade-10-A"], "target_dates": [fri.isoformat()],
        "mode": "overwrite"}).json()
    assert ow["copied"][0]["action"] == "REPLACED" and ow["copied"][0]["replaced"]["subject_name"] == "Mathematics"

    # holiday on the target date
    h = client.post(f"{A}/holidays", headers=admin, json={"name": "Local festival", "start_date": thu.isoformat(),
                                                           "end_date": thu.isoformat()}).json()
    try:
        hol = client.post(f"{A}/timetable/copy", headers=admin, json={
            "source_date": mon.isoformat(), "class_codes": ["Grade-9-B"], "target_dates": [thu.isoformat()]}).json()
        assert hol["copied"] == [] and {s["reason"] for s in hol["skipped"]} == {"HOLIDAY"}
    finally:
        client.delete(f"{A}/holidays/{h['holiday_id']}", headers=admin)


def test_copy_teacher_scope_range_and_week(client, admin, clean):
    mon, tue = _day(1, 6), _day(2, 6)
    t = client.post(f"{A}/timetable/copy", headers=admin, json={
        "source_date": mon.isoformat(), "teacher_code": "EMP1001", "target_dates": [tue.isoformat()]}).json()
    # Monday: 10-A P1 + P2, 9-B P3 (all Priya). Tuesday already has P2 and 9-B P3 -> only 10-A P1 is new
    assert [(c["class_code"], c["period_number"]) for c in t["copied"]] == [("Grade-10-A", 1)] and t["unchanged"] == 2

    client.put(f"{A}/timetable/working-days", headers=admin, json={"working_days": [1, 2, 3, 4, 5, 6]})
    try:
        rng = client.post(f"{A}/timetable/copy", headers=admin, json={
            "source_date": mon.isoformat(), "class_codes": ["Grade-9-B"], "dry_run": True,
            "target_start": (mon + timedelta(days=7)).isoformat(), "target_end": (mon + timedelta(days=13)).isoformat()}).json()
        assert rng["non_working_days_skipped"] == 1 and rng["days"] == 6        # Sunday skipped
    finally:
        client.put(f"{A}/timetable/working-days", headers=admin, json={"working_days": [1, 2, 3, 4, 5, 6, 7]})

    # copy week: a one-off session in the source week is repeated in the next two weeks
    wed = _day(3, 6)
    assert _put(client, admin, wed, class_code="Grade-9-B", subject_code="ENG-9", period_number=9,
                start_time="15:00", end_time="15:45").status_code == 200
    wk = client.post(f"{A}/timetable/copy-week", headers=admin, json={
        "source_week": wed.isoformat(), "target_week": (wed + timedelta(days=7)).isoformat(), "weeks": 2,
        "class_codes": ["Grade-9-B"]})
    assert wk.status_code == 200, wk.text
    assert sorted(c["date"] for c in wk.json()["copied"]) == [(wed + timedelta(days=7)).isoformat(),
                                                               (wed + timedelta(days=14)).isoformat()]
    assert wk.json()["unchanged"] == 20                                          # 2 weeks x 10 weekly periods

    bad = [
        {"source_date": mon.isoformat(), "target_dates": [tue.isoformat()], "teacher_code": "EMP1001", "class_codes": ["Grade-9-B"]},
        {"source_date": mon.isoformat(), "target_dates": [mon.isoformat()]},
        {"source_date": mon.isoformat(), "target_start": mon.isoformat(), "target_end": (mon + timedelta(days=80)).isoformat()},
        {"source_date": mon.isoformat()},
        {"source_date": mon.isoformat(), "target_dates": [tue.isoformat()], "teacher_code": "EMP1001", "replace_target": True},
    ]
    for b in bad:
        assert client.post(f"{A}/timetable/copy", headers=admin, json=b).status_code == 422, b
    assert client.post(f"{A}/timetable/copy-week", headers=admin, json={
        "source_week": mon.isoformat(), "target_week": tue.isoformat()}).status_code == 422
    assert client.post(f"{A}/timetable/copy", headers=admin, json={
        "source_date": mon.isoformat(), "target_dates": [tue.isoformat()], "class_codes": ["NOPE"]}).status_code == 404


# ---------------------------------------------------------------- bell schedule & breaks, rooms (5.3)
def test_bell_schedule_periods_breaks_and_per_day(client, admin, teacher):
    b = client.get(f"{A}/timetable/bell-schedule", headers=admin).json()
    assert b["configured"] is False and len([i for i in b["default"] if i["item_kind"] == "PERIOD"]) == 8
    assert [i["label"] for i in b["default"] if i["item_kind"] == "BREAK"] == ["Break"]
    try:
        # first customisation is Saturday only: the built-in bell becomes the configured default for other days
        sat = client.put(f"{A}/timetable/bell-schedule", headers=admin, json={"day_of_week": 6, "items": [
            {"period_number": 1, "start_time": "08:00", "end_time": "08:40"},
            {"item_kind": "BREAK", "label": "Snack", "start_time": "08:40", "end_time": "08:50"},
            {"period_number": 2, "start_time": "08:50", "end_time": "09:30"}]})
        assert sat.status_code == 200, sat.text
        assert sat.json()["configured"] is True and len(sat.json()["default"]) == 9
        assert [i["label"] for i in sat.json()["by_day"]["6"]] == [None, "Snack", None]

        d = client.put(f"{A}/timetable/bell-schedule", headers=admin, json={"items": [
            {"period_number": n, "start_time": f"{8 + n:02d}:00", "end_time": f"{8 + n:02d}:45"} for n in range(1, 4)] + [
            {"item_kind": "BREAK", "label": "Lunch", "start_time": "11:45", "end_time": "12:30"}]})
        assert d.status_code == 200 and [i["item_kind"] for i in d.json()["default"]] == ["PERIOD"] * 3 + ["BREAK"]
        mine = client.get(f"{C}/my-timetable", headers=teacher).json()["bell_schedule"]
        assert mine["default"] == d.json()["default"] and mine["by_day"]["6"]

        tue = _day(2, 7)
        w = _put(client, admin, tue, class_code="Grade-9-B", subject_code="ENG-9", period_number=9,
                 start_time="12:00", end_time="12:45")
        assert w.status_code == 200 and w.json()["warnings"][0]["message"].startswith("Overlaps Lunch")
        client.delete(f"{A}/timetable/sessions/{w.json()['session']['entry_id']}", headers=admin)

        bad = [
            [{"period_number": 1, "start_time": "09:00", "end_time": "09:45"}, {"period_number": 2, "start_time": "09:30", "end_time": "10:15"}],
            [{"period_number": 1, "start_time": "09:00", "end_time": "09:45"}, {"period_number": 1, "start_time": "10:00", "end_time": "10:45"}],
            [{"item_kind": "PERIOD", "start_time": "09:00", "end_time": "09:45"}],
            [{"period_number": 1, "start_time": "09:45", "end_time": "09:00"}],
        ]
        for items in bad:
            assert client.put(f"{A}/timetable/bell-schedule", headers=admin, json={"items": items}).status_code == 422
        assert client.put(f"{A}/timetable/bell-schedule", headers=teacher, json={"items": []}).status_code == 403
    finally:
        client.put(f"{A}/timetable/bell-schedule", headers=admin, json={"day_of_week": 6, "items": []})
        client.put(f"{A}/timetable/bell-schedule", headers=admin, json={"items": []})
    assert client.get(f"{A}/timetable/bell-schedule", headers=admin).json()["configured"] is False


def test_rooms_master_crud_and_rename(client, admin, teacher, clean):
    r = client.post(f"{A}/rooms", headers=admin, json={"room_code": "SCI-LAB", "room_name": "Science lab",
                                                       "room_type": "LAB", "capacity": 30})
    assert r.status_code == 201, r.text
    room = r.json()
    try:
        assert client.post(f"{A}/rooms", headers=admin, json={"room_code": "sci-lab"}).status_code == 409
        assert client.post(f"{A}/rooms", headers=admin, json={"room_code": "Bad;code"}).status_code == 422
        assert client.post(f"{A}/rooms", headers=admin, json={"room_code": "X", "capacity": 0}).status_code == 422
        assert any(x["room_code"] == "SCI-LAB" for x in client.get(f"{A}/rooms", headers=admin).json()["rooms"])
        wed = _day(3, 7)
        assert _put(client, admin, wed, room_number="sci-lab").status_code == 200
        ren = client.put(f"{A}/rooms/{room['room_id']}", headers=admin, json={"room_code": "LAB-A", "room_type": "LAB"})
        assert ren.status_code == 200 and ren.json()["room_code"] == "LAB-A"
        assert _at(_cal(client, admin, wed, class_code="Grade-10-A"), "Grade-10-A", 6)["room_number"] == "LAB-A"
        assert client.post(f"{A}/rooms", headers=teacher, json={"room_code": "T1"}).status_code == 403
        assert client.put(f"{A}/rooms/00000000-0000-0000-0000-000000000000", headers=admin,
                          json={"room_code": "Z"}).status_code == 404
    finally:
        assert client.delete(f"{A}/rooms/{room['room_id']}", headers=admin).status_code == 200
    assert client.delete(f"{A}/rooms/{room['room_id']}", headers=admin).status_code == 404


# ---------------------------------------------------------------- RBAC
def test_teachers_and_students_cannot_manage_the_dated_timetable(client, teacher, student):
    d = _day(2).isoformat()
    for h in (teacher, student):
        assert client.get(f"{A}/timetable/calendar", headers=h, params={"start": d, "end": d}).status_code == 403
        assert _put(client, h, _day(2)).status_code == 403
        assert client.post(f"{A}/timetable/sessions/cancel", headers=h, json={
            "class_code": "Grade-10-A", "session_date": d, "period_number": 1}).status_code == 403
        assert client.post(f"{A}/timetable/copy", headers=h, json={"source_date": d, "target_dates": [d]}).status_code == 403
        assert client.post(f"{A}/timetable/check-conflicts", headers=h, json={
            "class_code": "Grade-10-A", "session_date": d, "period_number": 1, "start_time": "09:00",
            "end_time": "09:45"}).status_code == 403
        assert client.get(f"{A}/rooms", headers=h).status_code == 403
        assert client.get(f"{A}/timetable/bell-schedule", headers=h).status_code == 403


def test_orgadmin_is_pinned_and_superadmin_works_cross_org(client, admin, student, clean):
    sa = _login(client, "superadmin", "superadmin")
    r = client.post(f"{A}/organizations", headers=sa, json={
        "org_code": "TT-ORG", "org_name": "Timetable Test School",
        "admin": {"full_name": "Tara Admin", "email": "tara@ttorg.in", "user_code": "TT-ADM1", "password": "Adm1n!pass"}})
    assert r.status_code == 201, r.text
    other = _login(client, "TT-ADM1", "Adm1n!pass")
    mon = _day(1)
    # pinned: ?org_code= is ignored for an institution admin, so DEMO-SCHOOL's data is out of reach
    assert _cal(client, other, mon, org_code="DEMO-SCHOOL") == []
    assert client.get(f"{A}/timetable/calendar", headers=other, params={
        "start": mon.isoformat(), "end": mon.isoformat(), "class_code": "Grade-10-A", "org_code": "DEMO-SCHOOL"}).status_code == 404
    assert client.put(f"{A}/timetable/sessions", headers=other, params={"org_code": "DEMO-SCHOOL"}, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "session_date": mon.isoformat(), "period_number": 6,
        "start_time": "13:00", "end_time": "13:45"}).status_code == 404
    client.put(f"{A}/timetable/working-days", headers=other, params={"org_code": "DEMO-SCHOOL"}, json={"working_days": [1]})
    assert client.get(f"{A}/timetable/working-days", headers=admin).json()["working_days"] == [1, 2, 3, 4, 5, 6, 7]

    # super-admin acts on any institution via ?org_code=, and is named in the change history (bug fix)
    assert len(_cal(client, sa, mon, org_code="DEMO-SCHOOL", class_code="Grade-10-A")) == 2
    s = client.put(f"{A}/timetable/sessions", headers=sa, params={"org_code": "DEMO-SCHOOL"}, json={
        "class_code": "Grade-10-A", "subject_code": "PHY101", "session_date": (date.today() + timedelta(days=2)).isoformat(),
        "period_number": 12, "start_time": "19:00", "end_time": "19:45", "note": "Exam revision"})
    assert s.status_code == 200, s.text
    changes = client.get(f"{C}/my-timetable", headers=student).json()["recent_changes"]
    mine = next(c for c in changes if c["reason"] == "Exam revision")
    assert mine["changed_by_name"] == "Super Admin" and mine["change_kind"] == "ADDED" and mine["session_date"]


# ---------------------------------------------------------------- bug fixes
def test_every_change_to_the_same_slot_is_notified(client, admin, student):
    """Bug 1: the dedup key had no change id, so a second change to the same period was silently dropped."""
    body = {"class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": 6, "period_number": 8,
            "start_time": "15:00", "end_time": "15:45"}
    slot = client.put(f"{A}/timetable", headers=admin, json=body).json()
    try:
        for start, end, why in (("15:05", "15:50", "First move"), ("15:10", "15:55", "Second move")):
            assert client.put(f"{A}/timetable", headers=admin,
                              json={**body, "start_time": start, "end_time": end, "change_reason": why}).status_code == 200
        bodies = [n["body"] or "" for n in client.get(N, headers=student).json()["notifications"]]
        assert any("First move" in b for b in bodies) and any("Second move" in b for b in bodies)
    finally:
        client.delete(f"{A}/timetable/{slot['slot_id']}", headers=admin)


def test_upcoming_holidays_cover_about_a_month(client, admin, student):
    """Bug 2: the holiday window ended in roughly the year 4052 instead of a month ahead."""
    near = client.post(f"{A}/holidays", headers=admin, json={
        "name": "Near holiday", "start_date": (date.today() + timedelta(days=20)).isoformat(),
        "end_date": (date.today() + timedelta(days=20)).isoformat()}).json()
    far = client.post(f"{A}/holidays", headers=admin, json={
        "name": "Far holiday", "start_date": (date.today() + timedelta(days=60)).isoformat(),
        "end_date": (date.today() + timedelta(days=60)).isoformat()}).json()
    try:
        ids = {h["holiday_id"] for h in client.get(f"{C}/my-timetable", headers=student).json()["holidays"]}
        assert near["holiday_id"] in ids and far["holiday_id"] not in ids
    finally:
        for h in (near, far):
            client.delete(f"{A}/holidays/{h['holiday_id']}", headers=admin)


def test_dashboards_use_the_resolved_timetable(client, admin, teacher, student, clean):
    """Bug 3: dashboards listed DRAFT classes' and out-of-range periods and ignored holidays and dated changes."""
    today, dow = date.today(), date.today().isoweekday()
    slot_ids = []
    try:
        for period, start, extra in ((11, "20:00", {}), (10, "19:00", {"effective_to": (today - timedelta(days=1)).isoformat()})):
            r = client.put(f"{A}/timetable", headers=admin, json={
                "class_code": "Grade-10-A", "subject_code": "PHY101", "day_of_week": dow, "period_number": period,
                "start_time": start, "end_time": start[:3] + "45", **extra})
            assert r.status_code == 200, r.text
            slot_ids.append(r.json()["slot_id"])
        assert _put(client, admin, today, period_number=12, start_time="21:00", end_time="21:30").status_code == 200

        periods = lambda h, who: {s["period_number"] for s in client.get(f"{D}/{who}", headers=h).json()["today_slots"]}  # noqa: E731
        assert {11, 12} <= periods(student, "student") and 10 not in periods(student, "student")   # out of range
        assert {11, 12} <= periods(teacher, "teacher") and 10 not in periods(teacher, "teacher")

        client.patch(f"{A}/classes/Grade-10-A/timetable-status", headers=admin, json={"status": "DRAFT"})
        try:
            assert periods(student, "student") == set()
            assert not {10, 11, 12} & periods(teacher, "teacher")
        finally:
            client.patch(f"{A}/classes/Grade-10-A/timetable-status", headers=admin, json={"status": "PUBLISHED"})

        h = client.post(f"{A}/holidays", headers=admin, json={"name": "Grade 10 trip", "start_date": today.isoformat(),
                                                               "end_date": today.isoformat(), "scope": "CLASS",
                                                               "class_codes": ["Grade-10-A"]}).json()
        try:
            d = client.get(f"{D}/student", headers=student).json()
            assert d["holiday_today"] == "Grade 10 trip" and {s["period_number"] for s in d["today_slots"]} == {12}
        finally:
            client.delete(f"{A}/holidays/{h['holiday_id']}", headers=admin)
    finally:
        for i in slot_ids:
            client.delete(f"{A}/timetable/{i}", headers=admin)


def test_dated_substitute_can_mark_attendance(client, admin, clean):
    kavya = _login(client, "kavya@demo.edu")
    body = {"class_code": "Grade-10-A", "subject_code": "MATH-12", "attendance_date": date.today().isoformat(),
            "session_slot": "Period-12", "records": [{"student_user_code": "REG2026001", "status": "present"}]}
    assert client.post(f"{C}/attendance", headers=kavya, json=body).status_code == 403
    assert _put(client, admin, date.today(), subject_code="MATH-12", teacher_code="EMP1002", period_number=12,
                start_time="21:00", end_time="21:30").status_code == 200
    assert client.post(f"{C}/attendance", headers=kavya, json=body).status_code == 200
