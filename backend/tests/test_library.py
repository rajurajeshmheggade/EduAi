"""Digital Library: catalog, publishing, Student Library isolation, access permissions and audit (FRD §12)."""
import pytest

from app.services import library as lib

A = "/ICMELive/api/v1/admin"
L = "/ICMELive/api/v1/library"
# Test-database fixtures only (example.org is reserved for documentation); no real catalog data is seeded.
URL = "https://example.org/books/"


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def users(client):
    return {k: _login(client, e) for k, e in [("admin", "admin@demo.edu"), ("priya", "teacher@demo.edu"),
                                              ("kavya", "kavya@demo.edu"), ("rohan", "student@demo.edu"), ("kabir", "kabir@demo.edu")]}


def _book(client, h, **kw):
    body = {"board": "NCERT_CBSE", "class_number": 10, "subject_name": "Science", "language": "English",
            "title": "Test Science 10", "source_name": "Example Source", "source_url": URL + "sci10",
            "verification_status": "verified", **kw}
    r = client.post(f"{L}/books", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture(scope="module")
def books(client, users):
    a = users["admin"]
    # Grade-10-A is Class 10 (enables class matching); Grade-9-B left without a grade.
    r = client.put(f"{A}/classes/Grade-10-A", headers=a, json={"class_name": "Grade 10 — Section A", "class_teacher_code": "EMP1001",
                                                               "is_active": True, "grade_number": 10})
    assert r.status_code == 200 and r.json()["grade_number"] == 10
    return {
        "linked": _book(client, a),  # official link only (licence unknown)
        "reader": _book(client, a, title="Test Physics 10", subject_name="Physics", access_mode="in_app_reader",
                        license_status="verified", in_app_reader_allowed=True, source_url=URL + "phy10"),
        "pending": _book(client, a, title="Unverified Book", verification_status="pending", source_url=URL + "pending"),
        "class9": _book(client, a, title="Test Science 9", class_number=9, source_url=URL + "sci9"),
        "hindi": _book(client, a, title="Test Hindi Reader", subject_name="Hindi", language="Hindi", source_url=URL + "hin10"),
    }


# ---------------------------------------------------------------- unit
def test_access_rules_distinguish_view_embed_download():
    base = {"is_active": True, "verification_status": "verified", "license_status": "verified", "in_app_reader_allowed": True,
            "access_mode": "in_app_reader", "download_allowed": True, "file_key": None, "source_name": "S", "source_url": URL,
            "license_notice": None, "link_status": "ok", "chapters": []}
    assert lib.access_info(base)["mode"] == "in_app_embed"
    assert lib.access_info({**base, "file_key": "k"})["mode"] == "in_app_file"
    assert lib.access_info({**base, "file_key": "k"})["download_allowed"] is True
    no_licence = lib.access_info({**base, "license_status": "permission_required", "file_key": "k"})
    assert no_licence["mode"] == "official_link" and no_licence["download_allowed"] is False
    assert lib.access_info({**base, "in_app_reader_allowed": False})["mode"] == "official_link"
    assert lib.access_info({**base, "verification_status": "pending"})["mode"] == "unavailable"
    assert lib.access_info({**base, "is_active": False})["mode"] == "unavailable"


def test_source_url_and_csv_validation():
    with pytest.raises(ValueError):
        lib.validate_source_url("http://example.org/x")
    with pytest.raises(ValueError):
        lib.validate_source_url("https://user:pw@example.org/x")
    rows, errors = lib.parse_csv(
        "board,class_number,subject_name,language,title,source_name,source_url\n"
        "NCERT,5,EVS,English,Book A,Src,https://example.org/a\n"
        "Karnataka,13,Maths,Kannada,Book B,Src,https://example.org/b\n"
        "CBSE,4,Maths,French,Book C,Src,https://example.org/c\n")
    assert [r["title"] for r in rows] == ["Book A"] and rows[0]["board"] == "NCERT_CBSE"
    assert len(errors) == 2 and errors[0].startswith("Line 3") and "French" not in errors[0]


def test_link_check_blocks_private_hosts():
    assert lib.check_link("https://127.0.0.1/book.pdf") == "broken"
    assert lib.check_link("https://localhost/book.pdf") == "broken"


# ---------------------------------------------------------------- catalog
def test_teacher_sees_only_verified_records_with_filters(client, users, books):
    r = client.get(f"{L}/books", headers=users["priya"], params={"board": "NCERT_CBSE", "class_number": 10})
    titles = {b["title"] for b in r.json()["books"]}
    assert {"Test Science 10", "Test Physics 10", "Test Hindi Reader"} <= titles and "Unverified Book" not in titles
    r = client.get(f"{L}/books", headers=users["priya"], params={"class_number": 10, "language": "Hindi"})
    assert [b["title"] for b in r.json()["books"]] == ["Test Hindi Reader"]
    r = client.get(f"{L}/books", headers=users["priya"], params={"class_number": 3})
    assert r.json() == {"books": [], "total": 0, "page": 1, "page_size": 24}  # empty state, nothing fabricated
    admin = client.get(f"{L}/books", headers=users["admin"], params={"verification_status": "pending"}).json()
    assert [b["title"] for b in admin["books"]] == ["Unverified Book"]
    assert client.get(f"{L}/books", headers=users["rohan"]).status_code == 403  # students use /student/books
    # duplicates and non-https links are rejected
    assert client.post(f"{L}/books", headers=users["admin"], json={**{k: books["linked"][k] for k in (
        "board", "class_number", "subject_name", "language", "title", "source_name", "source_url")}}).status_code == 409
    bad = client.post(f"{L}/books", headers=users["admin"], json={"board": "NCERT_CBSE", "class_number": 1, "subject_name": "EVS",
                                                                 "language": "English", "title": "X", "source_name": "S", "source_url": "http://x.org"})
    assert bad.status_code == 422
    # institution admins cannot create platform records
    assert client.post(f"{L}/books", headers=users["admin"], json={"board": "NCERT_CBSE", "class_number": 1, "subject_name": "EVS",
                                                                  "language": "English", "title": "Y", "source_name": "S",
                                                                  "source_url": URL + "y", "scope": "platform"}).status_code == 403


def test_hosting_a_copy_requires_verified_licence(client, users, books):
    pdf = ("b.pdf", b"%PDF-1.4\n%test\n", "application/pdf")
    r = client.post(f"{L}/books/{books['linked']['book_id']}/file", headers=users["admin"], files={"file": pdf})
    assert r.status_code == 422
    r = client.post(f"{L}/books/{books['reader']['book_id']}/file", headers=users["admin"], files={"file": ("x.pdf", b"not a pdf", "application/pdf")})
    assert r.status_code == 415
    r = client.post(f"{L}/books/{books['reader']['book_id']}/file", headers=users["admin"], files={"file": pdf})
    assert r.status_code == 200 and r.json()["has_file"] is True and r.json()["access"] == "in_app_file"


# ---------------------------------------------------------------- publishing & student library
def test_publish_isolation_unpublish_and_audit(client, users, books):
    p, k = users["priya"], users["kavya"]
    targets = client.get(f"{L}/targets", headers=p).json()["targets"]
    assert {"Grade-10-A", "Grade-9-B"} <= {t["class_code"] for t in targets}  # class teacher of 10-A, Physics in 9-B

    # class mismatch is refused when the class has a grade
    r = client.post(f"{L}/publications", headers=p, json={"book_ids": [books["class9"]["book_id"]], "class_code": "Grade-10-A", "subject_code": "PHY101"})
    assert r.status_code == 422 and "Class 9" in r.json()["detail"]
    # unverified books cannot be published; a teacher cannot publish to a subject they do not teach
    r = client.post(f"{L}/publications", headers=p, json={"book_ids": [books["pending"]["book_id"]], "class_code": "Grade-10-A", "subject_code": "PHY101"})
    assert r.status_code in (404, 422)
    r = client.post(f"{L}/publications", headers=k, json={"book_ids": [books["reader"]["book_id"]], "class_code": "Grade-10-A", "subject_code": "PHY101"})
    assert r.status_code == 403

    body = {"book_ids": [books["reader"]["book_id"], books["linked"]["book_id"]], "class_code": "Grade-10-A", "subject_code": "PHY101"}
    r = client.post(f"{L}/publications", headers=p, json=body)
    assert r.status_code == 200, r.text
    assert sorted(r.json()["published"]) == ["Test Physics 10", "Test Science 10"] and r.json()["student_count"] >= 1
    again = client.post(f"{L}/publications", headers=p, json=body).json()  # FR-015 idempotent
    assert again["published"] == [] and len(again["already_published"]) == 2

    cat = client.get(f"{L}/books", headers=p, params={"class_number": 10, "subject": "Physics"}).json()["books"][0]
    assert cat["published_to"][0]["class_code"] == "Grade-10-A"

    # student of Grade-10-A sees both; student of Grade-9-B sees none and cannot open them
    mine = client.get(f"{L}/student/books", headers=users["rohan"]).json()
    assert {b["title"] for b in mine["books"]} == {"Test Physics 10", "Test Science 10"} and mine["class_code"] == "Grade-10-A"
    assert mine["subjects"] == [{"subject_code": "PHY101", "subject_name": "Physics"}]
    assert client.get(f"{L}/student/books", headers=users["kabir"]).json()["books"] == []
    assert client.get(f"{L}/books/{books['reader']['book_id']}/access", headers=users["kabir"]).status_code == 404

    # access methods honour permissions
    acc = client.get(f"{L}/books/{books['reader']['book_id']}/access", headers=users["rohan"]).json()
    assert acc["mode"] == "in_app_file" and acc["file_url"] and acc["download_allowed"] is False
    acc = client.get(f"{L}/books/{books['linked']['book_id']}/access", headers=users["rohan"]).json()
    assert acc["mode"] == "official_link" and "file_url" not in acc and acc["source_url"] == URL + "sci10"

    # filters on the student library
    assert client.get(f"{L}/student/books", headers=users["rohan"], params={"q": "physics"}).json()["books"][0]["title"] == "Test Physics 10"

    # unpublish: Kavya (not teaching 10-A Physics) cannot; Priya can; the book disappears; catalog record stays
    pubs = client.get(f"{L}/publications/mine", headers=p, params={"status": "published"}).json()["publications"]
    pid = next(x["publication_id"] for x in pubs if x["title"] == "Test Science 10")
    assert client.post(f"{L}/publications/{pid}/unpublish", headers=k).status_code == 403
    assert client.post(f"{L}/publications/{pid}/unpublish", headers=p).json()["status"] == "unpublished"
    assert {b["title"] for b in client.get(f"{L}/student/books", headers=users["rohan"]).json()["books"]} == {"Test Physics 10"}
    assert client.get(f"{L}/books/{books['linked']['book_id']}/access", headers=users["rohan"]).status_code == 404
    assert client.get(f"{L}/books/{books['linked']['book_id']}", headers=users["admin"]).status_code == 200

    # republish creates a fresh publication and the audit trail records every change
    client.post(f"{L}/publications", headers=p, json={**body, "book_ids": [books["linked"]["book_id"]]})
    log = client.get(f"{L}/publications", headers=users["admin"]).json()["publications"]
    actions = sorted(e["action"] for x in log if x["title"] == "Test Science 10" for e in x["events"])
    assert actions == ["published", "republished", "unpublished"]
    assert all(e["actor_code"] == "EMP1001" for x in log for e in x["events"])


def test_csv_import_skips_existing(client, users, books):
    csv = ("board,class_number,subject_name,language,title,source_name,source_url,verification_status\n"
           f"NCERT,10,Science,English,Test Science 10,Example Source,{URL}sci10,verified\n"
           f"KSB,8,Maths,Kannada,Test Ganita 8,Example Source,{URL}g8,verified\n"
           "NCERT,8,Maths,English,,Example Source,https://example.org/z,verified\n")
    r = client.post(f"{L}/books/import", headers=users["admin"], json={"csv_text": csv})
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1 and r.json()["skipped_existing"] == 1 and len(r.json()["errors"]) == 1


def test_delete_only_without_publishing_history(client, users, books):
    a = users["admin"]
    assert client.delete(f"{L}/books/{books['linked']['book_id']}", headers=a).status_code == 409  # was published
    assert client.delete(f"{L}/books/{books['hindi']['book_id']}", headers=users["priya"]).status_code == 403
    assert client.delete(f"{L}/books/{books['hindi']['book_id']}", headers=a).json() == {"deleted": True}
    assert client.get(f"{L}/books/{books['hindi']['book_id']}", headers=a).status_code == 404


def test_subject_options_include_class_subjects(client, users, books):
    # Teacher: catalog subjects + subjects they teach (Grade-10-A is Class 10: Physics, Mathematics)
    t = client.get(f"{L}/subjects", headers=users["priya"], params={"class_number": 10}).json()["subjects"]
    assert {"Physics", "Mathematics", "Science"} <= set(t)
    assert len(t) == len({x.lower() for x in t})  # no case duplicates
    # Admin: every class subject of the institution, even with an empty catalog for that class
    a = client.get(f"{L}/subjects", headers=users["admin"]).json()["subjects"]
    assert {"Physics", "Mathematics", "English"} <= set(a)
