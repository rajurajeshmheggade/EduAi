"""DIKSHA integration: adapter, normalisation, licence rules and the teacher -> student workflow.

All DIKSHA traffic is served by httpx.MockTransport from fixtures trimmed out of real responses captured from
https://diksha.gov.in (tests/fixtures/diksha); nothing here depends on live DIKSHA availability.
"""
import json
from pathlib import Path

import httpx
import pytest

from app.config import get_settings
from app.services.diksha import access as acc
from app.services.diksha import normalize as nz
from app.services.diksha.client import DikshaClient, DikshaError, set_client

FIX = Path(__file__).parent / "fixtures" / "diksha"
A = "/ICMELive/api/v1/admin"
D = "/ICMELive/api/v1/library/diksha"
L = "/ICMELive/api/v1/library"

ACCOUNTANCY = "do_31310347535505817611436"      # CBSE Class 11 textbook (hierarchy_textbook.json)
PDF_NCND = "do_431359533151554764811286"        # NCERT chapter PDF, CC BY-NC-ND 4.0
VIDEO_IN_BOOK = "do_31310415723157913612322"    # mp4 in the Accountancy book, CC BY-SA 4.0
MATH1 = "do_3137971439485173761413"             # CBSE Class 1 textbook (search fixture)
KA_BOOK_EMPTY = "do_314307573126103040112510"   # Karnataka textbook whose units have no resources


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def _nodes(n):
    yield n
    for c in n.get("children") or []:
        yield from _nodes(c)


class FakeDiksha:
    """Routes the three verified endpoints to fixtures; records requests; lets a test inject failures."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.fail: dict = {}
        self.hierarchies = {}
        for f in ("hierarchy_textbook.json", "hierarchy_ka_youtube.json", "hierarchy_empty_units.json"):
            d = load(f)
            self.hierarchies[d["result"]["content"]["identifier"]] = d
        self.nodes = {}
        for d in self.hierarchies.values():
            for n in _nodes(d["result"]["content"]):
                self.nodes[n["identifier"]] = {k: v for k, v in n.items() if k != "children"}
        for c in load("search_textbooks.json")["result"]["content"]:
            self.nodes.setdefault(c["identifier"], c)
        self.reads = {d["result"]["content"]["identifier"]: d for d in (load("read_pdf_ncnd.json"), load("read_video_ccby.json"))}
        self.search_body = load("search_textbooks.json")

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail.get("timeout"):
            raise httpx.ReadTimeout("timed out", request=request)
        if "status" in self.fail:
            return httpx.Response(self.fail["status"], json={"params": {"err": "ERR", "errmsg": "internal host 10.0.0.1 details"}})
        if self.fail.get("garbage"):
            return httpx.Response(200, text="<html>not json</html>")
        path = request.url.path
        if path == "/api/content/v1/search":
            req = json.loads(request.content)["request"]
            if req["filters"].get("se_subjects") == ["nothing-matches"]:
                return httpx.Response(200, json={"responseCode": "OK", "result": {"count": 0, "facets": []}})
            body = json.loads(json.dumps(self.search_body))
            if self.fail.get("incomplete"):
                body["result"]["content"].append({"name": "record without identifier"})
            return httpx.Response(200, json=body)
        if path.startswith("/api/content/v1/read/"):
            cid = path.rsplit("/", 1)[1]
            if cid in self.reads:
                return httpx.Response(200, json=self.reads[cid])
            if cid in self.nodes:
                return httpx.Response(200, json={"responseCode": "OK", "result": {"content": self.nodes[cid]}})
            return httpx.Response(404, json=load("read_not_found.json"))
        if path.startswith("/api/course/v1/hierarchy/"):
            cid = path.rsplit("/", 1)[1]
            if cid in self.hierarchies:
                return httpx.Response(200, json=self.hierarchies[cid])
            return httpx.Response(404, json=load("hierarchy_not_found.json"))
        return httpx.Response(404, json={})


@pytest.fixture()
def fake():
    f = FakeDiksha()
    set_client(DikshaClient("https://diksha.gov.in", 5, 1000, 0, transport=httpx.MockTransport(f)))
    yield f
    set_client(None)


def _login(client, ident, password="Passw0rd!"):
    r = client.post("/api/v1/auth/login", json={"email": ident, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def users(client):
    u = {k: _login(client, e) for k, e in [("admin", "admin@demo.edu"), ("priya", "teacher@demo.edu"), ("kavya", "kavya@demo.edu"),
                                           ("rohan", "student@demo.edu"), ("kabir", "kabir@demo.edu")]}
    r = client.put(f"{A}/classes/Grade-10-A", headers=u["admin"], json={"class_name": "Grade 10 — Section A", "class_teacher_code": "EMP1001",
                                                                       "is_active": True, "grade_number": 10})
    assert r.status_code == 200
    return u


# ---------------------------------------------------------------- normalisation
def test_normalize_search_item_keeps_source_metadata():
    raw = load("search_textbooks.json")["result"]["content"][0]
    it = nz.normalize_item(raw)
    assert it["source_id"] == raw["identifier"] and it["kind"] == "textbook"
    assert it["classes"] == [1] and it["boards"] == ["CBSE"] and it["mediums"] == ["English"]
    assert it["license"] == {"name": "CC BY-NC-SA 4.0", "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode"}
    assert it["author"] == "Toondemy" and it["copyright"] == "Creative Edtech Pvt Ltd" and it["organisation"] == ["CBSE"]
    assert it["official_url"] == f"https://diksha.gov.in/play/collection/{raw['identifier']}?contentType=TextBook"
    assert it["cover_url"].startswith("https://files.odev.oci.diksha.gov.in/")


def test_missing_optional_metadata_stays_missing():
    it = nz.normalize_item({"identifier": "do_1234567", "mimeType": "application/pdf"})
    assert it["name"] is None and it["cover_url"] is None and it["classes"] == [] and it["attributions"] == []
    assert it["license"] == {"name": None, "url": None} and it["kind"] == "resource"
    assert nz.normalize_item({"identifier": "do_1234567", "appIcon": "https://evil.example.com/x.png"})["cover_url"] is None


def test_hierarchy_preserves_order_types_and_empty_units():
    tree = nz.normalize_tree(load("hierarchy_textbook.json")["result"]["content"])
    assert [u["name"] for u in tree["units"]] == ["1-Introduction to Accounting", "2-Theory Base of Accounting"]
    first = tree["units"][0]
    assert [u["index"] for u in first["units"]] == sorted(u["index"] for u in first["units"])
    types = {r["resource_type"] for r in nz.iter_resources(tree)}
    assert {"pdf", "video", "interactive"} <= types
    pdf = nz.find_resource(tree, PDF_NCND)
    assert pdf["path"][0] == "1-Introduction to Accounting" and pdf["license"]["name"] == "CC BY-NC-ND 4.0"
    assert pdf["attributions"] == ["NCERT"] and pdf["author"] == "NCERT"
    empty = nz.normalize_tree(load("hierarchy_empty_units.json")["result"]["content"])
    assert empty["resource_count"] == 0 and empty["empty_units"] == 3 and len(empty["units"]) == 3


def test_youtube_ids_and_labels():
    assert nz.youtube_id("https://youtu.be/jEbA7ZVKAz0") == "jEbA7ZVKAz0"
    assert nz.youtube_id("https://www.youtube.com/watch?v=jEbA7ZVKAz0&t=3") == "jEbA7ZVKAz0"
    assert nz.youtube_id("https://youtu.be/not-an-id!") is None
    assert nz.label("state (karnataka)") == "State (Karnataka)" and nz.label("ii language english") == "II Language English"


# ---------------------------------------------------------------- licence rules
def _res(license_name, rtype="pdf", url="https://obj.diksha.gov.in/ntp-content-production/x.pdf"):
    return {"kind": "resource", "resource_type": rtype, "license": {"name": license_name}, "artifact_url": url,
            "official_url": "https://diksha.gov.in/play/content/do_1"}


def test_permission_matrix_per_license(monkeypatch):
    by = acc.permissions(_res("CC BY 4.0"))
    assert by["embed"] and by["download"] and by["modify"] and not by["store_copy"] and not by["redistribute"]
    nd = acc.permissions(_res("CC BY-ND 4.0"))
    assert nd["embed"] and not nd["modify"]
    ncnd = acc.permissions(_res("CC BY-NC-ND 4.0"))
    assert not ncnd["embed"] and not ncnd["download"] and ncnd["review_required"] and ncnd["eligible"]
    unknown = acc.permissions(_res(None))
    assert not unknown["embed"] and not unknown["eligible"] and unknown["review_required"]
    yt = acc.permissions(_res("Standard YouTube License", "youtube"))
    assert yt["embed"] and not yt["download"]
    monkeypatch.setattr(get_settings(), "diksha_embed_noncommercial", True)
    assert acc.permissions(_res("CC BY-NC-ND 4.0"))["embed"]


def test_viewer_selection_and_unauthorized_embed_prevention():
    assert acc.viewer(_res("CC BY 4.0"))["viewer"] == "pdf"
    assert acc.viewer(_res("CC BY-NC-SA 4.0"))["viewer"] == "official"           # NC without approval
    assert acc.viewer(_res("CC BY 4.0", url="https://elsewhere.example.org/x.pdf"))["viewer"] == "official"  # host not allowed
    assert acc.viewer(_res("CC BY 4.0", "video", "https://obj.diksha.gov.in/a/master.m3u8"))["viewer"] == "official"
    assert acc.viewer(_res("CC BY 4.0", "interactive"))["viewer"] == "official"
    yt = acc.viewer(_res("CC BY-SA 4.0", "youtube", "https://youtu.be/jEbA7ZVKAz0"))
    assert yt == {"viewer": "youtube", "src": "https://www.youtube-nocookie.com/embed/jEbA7ZVKAz0",
                  "official_url": "https://diksha.gov.in/play/content/do_1"}
    shown = acc.present({**_res("CC BY 4.0"), "preview_url": "x", "streaming_url": "y"})
    assert "artifact_url" not in shown and "streaming_url" not in shown and shown["access"]["viewer"] == "pdf"


# ---------------------------------------------------------------- adapter behaviour
def test_client_errors_are_safe_and_typed(fake):
    c = DikshaClient("https://diksha.gov.in", 5, 1000, 0, transport=httpx.MockTransport(fake))
    fake.fail = {"timeout": True}
    with pytest.raises(DikshaError) as e:
        c.read(PDF_NCND)
    assert e.value.kind == "timeout"
    fake.fail = {"status": 500}
    with pytest.raises(DikshaError) as e:
        c.read(PDF_NCND)
    assert e.value.kind == "unavailable" and "10.0.0.1" not in str(e.value)
    fake.fail = {"status": 429}
    n = len(fake.requests)
    with pytest.raises(DikshaError) as e:
        c.read(PDF_NCND)
    assert e.value.kind == "rate_limited" and len(fake.requests) - n == 2   # one retry
    fake.fail = {"garbage": True}
    with pytest.raises(DikshaError) as e:
        c.read(PDF_NCND)
    assert e.value.kind == "invalid_response"
    fake.fail = {}
    with pytest.raises(DikshaError) as e:
        c.read("do_unknownid000")
    assert e.value.kind == "not_found"
    n = len(fake.requests)
    with pytest.raises(DikshaError) as e:
        c.read("../../etc/passwd")
    assert e.value.kind == "invalid_id" and len(fake.requests) == n          # rejected before any request


def test_client_window_cap_and_cache(fake):
    c = DikshaClient("https://diksha.gov.in", 5, 1000, 60, transport=httpx.MockTransport(fake))
    n = len(fake.requests)
    out = c.search({"filters": {"status": ["Live"]}, "limit": 24, "offset": 9990})
    assert out["window_exceeded"] and out["content"] == [] and len(fake.requests) == n
    c.search({"filters": {"status": ["Live"]}, "limit": 24, "offset": 0})
    c.search({"filters": {"status": ["Live"]}, "limit": 24, "offset": 0})
    assert len(fake.requests) == n + 1     # second identical search served from the cache


# ---------------------------------------------------------------- catalog API
def test_search_sends_filters_and_pages(client, users, fake):
    r = client.get(f"{D}/search", headers=users["priya"], params={"board": "cbse", "class_number": 6, "subject": "English",
                                                                  "medium": "english", "page": 3, "page_size": 10})
    assert r.status_code == 200, r.text
    body = r.json()
    sent = json.loads(fake.requests[-1].content)["request"]
    assert sent["filters"]["se_boards"] == ["CBSE"] and sent["filters"]["se_gradeLevels"] == ["Class 6"]
    assert sent["filters"]["se_subjects"] == ["English"] and sent["filters"]["se_mediums"] == ["english"]
    assert sent["filters"]["primaryCategory"] == ["Digital Textbook"] and sent["offset"] == 20 and sent["limit"] == 10
    assert body["total"] == 293 and len(body["items"]) == 3 and body["items"][0]["permissions"]["discover"]
    assert body["items"][0]["published_to"] == []
    # default scope: every supported board, Classes 5-12
    client.get(f"{D}/search", headers=users["priya"])
    sent = json.loads(fake.requests[-1].content)["request"]
    assert sent["filters"]["se_boards"] == ["NCERT", "CBSE", "State (Karnataka)"]
    assert sent["filters"]["se_gradeLevels"] == [f"Class {c}" for c in range(5, 13)] and sent["sort_by"] == {"name": "asc"}


def test_search_validation_empty_incomplete_and_errors(client, users, fake):
    assert client.get(f"{D}/search", headers=users["priya"], params={"board": "ICSE"}).status_code == 422
    assert client.get(f"{D}/search", headers=users["priya"], params={"class_number": 4}).status_code == 422
    assert client.get(f"{D}/search", headers=users["priya"], params={"content_type": "Course"}).status_code == 422
    assert client.get(f"{D}/search", headers=users["rohan"]).status_code == 403          # students use their library
    empty = client.get(f"{D}/search", headers=users["priya"], params={"subject": "nothing-matches"}).json()
    assert empty["items"] == [] and empty["total"] == 0
    fake.fail = {"incomplete": True}
    assert len(client.get(f"{D}/search", headers=users["priya"], params={"q": "x"}).json()["items"]) == 3  # bad record skipped
    fake.fail = {"timeout": True}
    r = client.get(f"{D}/search", headers=users["priya"], params={"q": "y"})
    assert r.status_code == 504 and "try again" in r.json()["detail"].lower()
    fake.fail = {}
    r = client.get(f"{D}/search", headers=users["priya"], params={"page": 500, "page_size": 24})
    assert r.status_code == 200 and r.json()["window_exceeded"] and r.json()["items"] == []


def test_filters_come_from_source_facets(client, users, fake):
    f = client.get(f"{D}/filters", headers=users["priya"]).json()
    assert [b["value"] for b in f["boards"]] == ["NCERT", "CBSE", "State (Karnataka)"]
    assert next(b for b in f["boards"] if b["value"] == "CBSE")["count"] == 293
    assert [c["value"] for c in f["classes"]] == list(range(5, 13))
    assert next(c for c in f["classes"] if c["value"] == 10)["count"] == 53
    assert {"value": "mathematics", "label": "Mathematics", "count": 40} in f["subjects"]
    assert f["mediums"][0] == {"value": "english", "label": "English", "count": 293}


def test_textbook_hierarchy_and_resource_access(client, users, fake):
    t = client.get(f"{D}/textbooks/{ACCOUNTANCY}", headers=users["priya"]).json()
    assert t["book"]["name"].startswith("(NEW) Accountancy") and t["book"]["classes"] == [11]
    chapter = t["units"][0]
    etext = next(u for u in chapter["units"] if u["name"] == "e-Textbook")
    pdf = etext["resources"][0]
    assert pdf["source_id"] == PDF_NCND and pdf["access"]["viewer"] == "official"           # NC-ND: official link
    assert pdf["permissions"]["review_required"] and "artifact_url" not in pdf
    video = client.get(f"{D}/resources/{VIDEO_IN_BOOK}", headers=users["priya"], params={"within": ACCOUNTANCY}).json()
    assert video["license"]["name"] == "CC BY-SA 4.0" and video["access"]["viewer"] == "video"
    assert video["access"]["src"].startswith("https://obj.diksha.gov.in/") and video["access"]["src"].endswith(".mp4")
    empty = client.get(f"{D}/textbooks/{KA_BOOK_EMPTY}", headers=users["priya"]).json()
    assert empty["resource_count"] == 0 and all(u["resource_count"] == 0 for u in empty["units"])
    assert client.get(f"{D}/textbooks/do_doesnotexist123", headers=users["priya"]).status_code == 404
    assert client.get(f"{D}/textbooks/not-an-id", headers=users["priya"]).status_code == 422


# ---------------------------------------------------------------- publishing & Student Library
def test_teacher_publish_student_access_and_unpublish(client, users, fake):
    p, k = users["priya"], users["kavya"]
    # Grade-10-A is Class 10: a Class 11 book is refused; Class 1 is outside 5-12; unknown ids 404
    r = client.post(f"{D}/publications", headers=p, json={"items": [{"source_id": ACCOUNTANCY}], "class_code": "Grade-10-A", "subject_code": "PHY101"})
    assert r.status_code == 422 and "Class 11" in r.json()["detail"]
    r = client.post(f"{D}/publications", headers=p, json={"items": [{"source_id": MATH1}], "class_code": "Grade-9-B", "subject_code": "PHY101"})
    assert r.status_code == 422 and "5–12" in r.json()["detail"]
    assert client.post(f"{D}/publications", headers=p, json={"items": [{"source_id": "do_doesnotexist123"}], "class_code": "Grade-9-B",
                                                             "subject_code": "PHY101"}).status_code == 404
    assert client.post(f"{D}/publications", headers=k, json={"items": [{"source_id": ACCOUNTANCY}], "class_code": "Grade-10-A",
                                                             "subject_code": "PHY101"}).status_code == 403
    # a resource must really belong to the textbook it was chosen from
    r = client.post(f"{D}/publications", headers=p, json={"items": [{"source_id": "do_3137489904471326721346", "within": ACCOUNTANCY}],
                                                          "class_code": "Grade-9-B", "subject_code": "PHY101"})
    assert r.status_code == 422

    # Grade-9-B has no grade set: publish the textbook + one resource from it (Priya teaches Physics there)
    body = {"items": [{"source_id": ACCOUNTANCY}, {"source_id": VIDEO_IN_BOOK, "within": ACCOUNTANCY}], "class_code": "Grade-9-B", "subject_code": "PHY101"}
    r = client.post(f"{D}/publications", headers=p, json=body)
    assert r.status_code == 200, r.text
    assert len(r.json()["published"]) == 2 and r.json()["student_count"] >= 1
    again = client.post(f"{D}/publications", headers=p, json=body).json()
    assert again["published"] == [] and len(again["already_published"]) == 2               # idempotent (FR-015)

    found = client.get(f"{D}/search", headers=p, params={"q": "anything"}).json()
    assert all(i["published_to"] == [] for i in found["items"])                             # fixture books not published

    # student of Grade-9-B sees both; Grade-10-A student sees none and cannot open them
    lib = client.get(f"{L}/student/books", headers=users["kabir"]).json()
    ext = {e["source_id"]: e for e in lib["external"]}
    assert set(ext) == {ACCOUNTANCY, VIDEO_IN_BOOK}
    assert ext[ACCOUNTANCY]["kind"] == "textbook" and ext[VIDEO_IN_BOOK]["context"]["textbook_id"] == ACCOUNTANCY
    assert "artifact_url" not in ext[VIDEO_IN_BOOK]["metadata"]
    assert {"subject_code": "PHY101", "subject_name": "Physics"} in lib["subjects"]
    assert client.get(f"{L}/student/books", headers=users["rohan"]).json()["external"] == []
    assert client.get(f"{D}/textbooks/{ACCOUNTANCY}", headers=users["rohan"]).status_code == 404
    assert client.get(f"{D}/resources/{VIDEO_IN_BOOK}", headers=users["rohan"], params={"within": ACCOUNTANCY}).status_code == 404

    # Grade-9-B student: open the textbook, then a resource inside it (verified against the hierarchy)
    t = client.get(f"{D}/textbooks/{ACCOUNTANCY}", headers=users["kabir"])
    assert t.status_code == 200 and t.json()["units"]
    pdf = client.get(f"{D}/resources/{PDF_NCND}", headers=users["kabir"], params={"within": ACCOUNTANCY}).json()
    assert pdf["access"]["viewer"] == "official" and pdf["attributions"] == ["NCERT"]
    assert client.get(f"{D}/resources/{PDF_NCND}", headers=users["kabir"]).status_code == 404      # not published on its own
    assert client.get(f"{D}/resources/{MATH1}", headers=users["kabir"], params={"within": ACCOUNTANCY}).status_code == 404

    # teacher view + admin audit include DIKSHA items; unpublish removes from the Student Library
    mine = client.get(f"{L}/publications/mine", headers=p, params={"status": "published"}).json()["publications"]
    dk = [m for m in mine if m["source"] == "diksha"]
    assert {m["source_id"] for m in dk} == {ACCOUNTANCY, VIDEO_IN_BOOK} and all(m["can_unpublish"] for m in dk)
    pid = next(m["publication_id"] for m in dk if m["source_id"] == VIDEO_IN_BOOK)
    assert client.post(f"{L}/publications/{pid}/unpublish", headers=p).json()["status"] == "unpublished"
    assert {e["source_id"] for e in client.get(f"{L}/student/books", headers=users["kabir"]).json()["external"]} == {ACCOUNTANCY}
    log = client.get(f"{L}/publications", headers=users["admin"]).json()["publications"]
    events = [e["action"] for x in log if x.get("source_id") == VIDEO_IN_BOOK for e in x["events"]]
    assert sorted(events) == ["published", "unpublished"]


def test_refresh_marks_removed_items_unavailable(client, users, fake):
    from app import db
    db.execute("UPDATE public.library_source_items SET fetched_at = NOW() - INTERVAL '3 days'")
    fake.reads.clear()
    fake.nodes.pop(ACCOUNTANCY, None)          # the textbook disappears from DIKSHA
    r = client.post(f"{D}/refresh", headers=users["admin"]).json()
    assert r["unavailable"] >= 1
    lib = client.get(f"{L}/student/books", headers=users["kabir"]).json()
    assert next(e for e in lib["external"] if e["source_id"] == ACCOUNTANCY)["source_status"] == "unavailable"
    assert client.post(f"{D}/refresh", headers=users["priya"]).status_code == 403
