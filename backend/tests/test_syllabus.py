import pytest

from app.services.syllabus import parse_outline

A = "/ICMELive/api/v1/admin"
C = "/ICMELive/api/v1/classroom"


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def admin(client):
    h = _login(client, "admin@demo.edu")
    for code, name in [("SYL-A", "Syllabus A"), ("SYL-B", "Syllabus B")]:
        r = client.post(f"{A}/classes", headers=h, json={"class_code": code, "class_name": name})
        assert r.status_code == 201, r.text
        r = client.put(f"{A}/classes/{code}/subjects/SCI-8", headers=h, json={"subject_name": "Science"})
        assert r.status_code == 200, r.text
    return h


def S(cls="SYL-A", subj="SCI-8"):
    return f"{A}/classes/{cls}/subjects/{subj}/syllabus"


# ---------------------------------------------------------------- unit: outline parser
def test_parse_outline_chapters_and_topics():
    text = """Chapter 1: Motion
  - Distance and displacement
  1.2 Speed and velocity
2. Force and laws of motion
• Newton's first law

Unit 3 - Gravitation"""
    out = parse_outline(text)
    assert [c["title"] for c in out] == ["Motion", "Force and laws of motion", "Gravitation"]
    assert out[0]["topics"] == ["Distance and displacement", "Speed and velocity"]
    assert out[1]["topics"] == ["Newton's first law"]
    assert out[2]["topics"] == []


def test_parse_outline_rejects_topic_without_chapter():
    with pytest.raises(ValueError, match="Line 1"):
        parse_outline("  - orphan topic")


# ---------------------------------------------------------------- API
def test_chapter_and_topic_crud_and_ordering(client, admin):
    r = client.post(f"{S()}/chapters", headers=admin, json={"title": "Matter", "topics": ["States of matter", "Diffusion"]})
    assert r.status_code == 201, r.text
    r = client.post(f"{S()}/chapters", headers=admin, json={"title": "Atoms"})
    syl = r.json()
    assert [c["title"] for c in syl["chapters"]] == ["Matter", "Atoms"]
    assert [c["number"] for c in syl["chapters"]] == [1, 2]
    matter, atoms = syl["chapters"]
    assert [t["title"] for t in matter["topics"]] == ["States of matter", "Diffusion"]

    # edit chapter, add / edit / reorder / delete topics
    syl = client.patch(f"{S()}/chapters/{atoms['chapter_id']}", headers=admin, json={"title": "Atoms and molecules", "description": "Basics"}).json()
    assert syl["chapters"][1]["title"] == "Atoms and molecules" and syl["chapters"][1]["description"] == "Basics"
    syl = client.post(f"{S()}/chapters/{atoms['chapter_id']}/topics", headers=admin, json={"titles": ["Atomic mass", "Mole concept"]}).json()
    t_mass, t_mole = syl["chapters"][1]["topics"]
    syl = client.post(f"{S()}/topics/{t_mole['topic_id']}/move", headers=admin, json={"direction": "up"}).json()
    assert [t["title"] for t in syl["chapters"][1]["topics"]] == ["Mole concept", "Atomic mass"]
    syl = client.patch(f"{S()}/topics/{t_mass['topic_id']}", headers=admin, json={"title": "Atomic & molecular mass"}).json()
    assert syl["chapters"][1]["topics"][1]["title"] == "Atomic & molecular mass"
    syl = client.delete(f"{S()}/topics/{t_mass['topic_id']}", headers=admin).json()
    assert len(syl["chapters"][1]["topics"]) == 1

    # chapter reorder; moving the first one up is a no-op
    syl = client.post(f"{S()}/chapters/{atoms['chapter_id']}/move", headers=admin, json={"direction": "up"}).json()
    assert [c["title"] for c in syl["chapters"]] == ["Atoms and molecules", "Matter"]
    syl = client.post(f"{S()}/chapters/{atoms['chapter_id']}/move", headers=admin, json={"direction": "up"}).json()
    assert syl["chapters"][0]["title"] == "Atoms and molecules"

    summary = client.get(f"{A}/classes/SYL-A/syllabus-summary", headers=admin).json()
    assert summary["subjects"]["SCI-8"] == {"chapters": 2, "topics": 3}

    # delete chapter cascades its topics
    syl = client.delete(f"{S()}/chapters/{matter['chapter_id']}", headers=admin).json()
    assert syl["chapter_count"] == 1 and syl["topic_count"] == 1


def test_import_and_copy(client, admin):
    r = client.post(f"{S()}/import", headers=admin, json={"text": "1. Cell\n  - Cell wall\n  - Nucleus\n2. Tissues", "mode": "replace"})
    assert r.status_code == 200, r.text
    syl = r.json()
    assert [c["title"] for c in syl["chapters"]] == ["Cell", "Tissues"] and syl["topic_count"] == 2
    syl = client.post(f"{S()}/import", headers=admin, json={"text": "Ch 3: Motion"}).json()  # append
    assert syl["chapter_count"] == 3
    assert client.post(f"{S()}/import", headers=admin, json={"text": "- orphan"}).status_code == 422

    # copy to Section B
    r = client.post(f"{S('SYL-B')}/copy", headers=admin, json={"from_class_code": "SYL-A"})
    assert r.status_code == 200, r.text
    assert [c["title"] for c in r.json()["chapters"]] == ["Cell", "Tissues", "Motion"]
    assert client.post(f"{S('SYL-B')}/copy", headers=admin, json={"from_class_code": "SYL-B"}).status_code == 422


def test_syllabus_scoping_and_teacher_view(client, admin, teacher):
    # unknown subject / chapter of another subject
    assert client.get(S(subj="NOPE"), headers=admin).status_code == 404
    other = client.get(S("SYL-B"), headers=admin).json()["chapters"][0]["chapter_id"]
    assert client.patch(f"{S()}/chapters/{other}", headers=admin, json={"title": "x"}).status_code == 404
    # teachers cannot edit, and only see subjects they teach
    assert client.get(S(), headers=teacher).status_code == 403
    assert client.get(f"{C}/syllabus", headers=teacher, params={"class_code": "SYL-A", "subject_code": "SCI-8"}).status_code == 403
    client.put(f"{A}/classes/SYL-A/subjects/SCI-8", headers=admin, json={"subject_name": "Science", "teacher_code": "EMP1001"})
    r = client.get(f"{C}/syllabus", headers=teacher, params={"class_code": "SYL-A", "subject_code": "SCI-8"})
    assert r.status_code == 200, r.text
    assert r.json()["chapter_count"] == 3
    # removing and re-adding the subject keeps its syllabus
    client.delete(f"{A}/classes/SYL-A/subjects/SCI-8", headers=admin)
    assert client.get(S(), headers=admin).status_code == 404
    client.put(f"{A}/classes/SYL-A/subjects/SCI-8", headers=admin, json={"subject_name": "Science"})
    assert client.get(S(), headers=admin).json()["chapter_count"] == 3
