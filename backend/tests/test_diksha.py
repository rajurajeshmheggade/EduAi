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
ECML_IN_BOOK = "do_313068382451924992110420"    # ECML interactive in the Accountancy book (needs the source player)

_V = {"mimeType": "video/mp4", "primaryCategory": "Explanation Content", "se_boards": ["CBSE"], "se_gradeLevels": ["Class 10"],
      "se_subjects": ["Science"], "se_mediums": ["English"], "status": "Live"}
# A page of "video" search results as DIKSHA might return them: only the first can be shown in the app.
MIXED_VIDEOS = [
    {**_V, "identifier": "do_1000000000001", "name": "Refraction (CC BY)", "license": "CC BY 4.0",
     "artifactUrl": "https://obj.diksha.gov.in/ntp-content-production/content/assets/do_1000000000001/refraction.mp4"},
    {**_V, "identifier": "do_1000000000002", "name": "Reflection (NC)", "license": "CC BY-NC-SA 4.0",
     "artifactUrl": "https://obj.diksha.gov.in/ntp-content-production/content/assets/do_1000000000002/reflection.mp4"},
    {**_V, "identifier": "do_1000000000003", "name": "Lenses (YouTube licence on an MP4)", "license": "Standard YouTube License",
     "artifactUrl": "https://obj.diksha.gov.in/ntp-content-production/content/assets/do_1000000000003/lenses.mp4"},
    {**_V, "identifier": "do_1000000000004", "name": "Mirrors (HLS only)", "license": "CC BY 4.0",
     "artifactUrl": "https://obj.diksha.gov.in/ntp-content-production/content/assets/do_1000000000004/master.m3u8"},
    {**_V, "identifier": "do_1000000000005", "name": "Light (no licence)",
     "artifactUrl": "https://obj.diksha.gov.in/ntp-content-production/content/assets/do_1000000000005/light.mp4"},
]


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
        self.searches: list[dict] = []

    def _facet_response(self, req: dict) -> dict:
        """Facet counts for the resource content types (videos, PDFs, …), shaped like DIKSHA's answers."""
        f = req["filters"]
        mimes = {m.lower() for m in f.get("mimeType", [])}
        values: dict[str, list[dict]] = {}
        if "mimeType" in req.get("facets", []):
            values["mimeType"] = [{"name": "video/mp4", "count": 120}, {"name": "video/x-youtube", "count": 30},
                                  {"name": "application/pdf", "count": 200}, {"name": "application/vnd.ekstep.html-archive", "count": 15}]
        if mimes & {"video/mp4", "video/x-youtube"}:
            subjects = [{"name": "science", "count": 120}, {"name": "mathematics", "count": 30}, {"name": "history", "count": 0}]
            count = 150
        elif "application/pdf" in mimes:
            subjects = [{"name": "accountancy", "count": 150}, {"name": "english", "count": 50}]
            count = 200
        else:
            subjects, count = [], 0
        values["se_subjects"] = subjects
        values["se_mediums"] = ([{"name": "english", "count": 90}] if f.get("se_subjects")
                                else [{"name": "english", "count": 140}, {"name": "hindi", "count": 10}])
        return {"responseCode": "OK", "result": {"count": count, "facets": [{"name": k, "values": v} for k, v in values.items()
                                                                            if k in req.get("facets", [])]}}

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
            self.searches.append(req)
            if req["filters"].get("se_subjects") == ["nothing-matches"]:
                return httpx.Response(200, json={"responseCode": "OK", "result": {"count": 0, "facets": []}})
            if "mimeType" in req["filters"] and not req.get("limit"):
                return httpx.Response(200, json=self._facet_response(req))
            if "mimeType" in req["filters"]:
                return httpx.Response(200, json={"responseCode": "OK", "result": {"count": len(MIXED_VIDEOS), "content": MIXED_VIDEOS}})
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
    assert it["official_url"] == f"https://diksha.gov.in/play/collection/{raw['identifier']}?contentType=TextBook"   # internal only
    assert "official_url" not in acc.present(it) and "official_url" not in acc.public(it)
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
    assert by["embed"] and by["modify"] and not by["store_copy"] and not by["redistribute"]
    nd = acc.permissions(_res("CC BY-ND 4.0"))
    assert nd["embed"] and not nd["modify"]
    ncnd = acc.permissions(_res("CC BY-NC-ND 4.0"))
    assert not ncnd["embed"] and ncnd["review_required"] and ncnd["eligible"]
    unknown = acc.permissions(_res(None))
    assert not unknown["embed"] and not unknown["eligible"] and unknown["review_required"]
    yt = acc.permissions(_res("Standard YouTube License", "youtube"))
    assert yt["embed"]
    assert not any("DIKSHA" in n for x in (by, nd, ncnd, unknown, yt) for n in x["notes"])
    # search filters: only licences whose items can be shown; NonCommercial ones only after approval
    assert acc.embeddable_licenses() == ["CC BY 4.0", "CC BY-SA 4.0", "CC BY-ND 4.0", "Standard YouTube License"]
    assert "Standard YouTube License" not in acc.embeddable_licenses(youtube=False)
    monkeypatch.setattr(get_settings(), "diksha_embed_noncommercial", True)
    assert acc.permissions(_res("CC BY-NC-ND 4.0"))["embed"]
    assert {"CC BY-NC 4.0", "CC BY-NC-SA 4.0", "CC BY-NC-ND 4.0"} <= set(acc.embeddable_licenses())


def test_viewer_selection_and_unauthorized_embed_prevention():
    assert acc.viewer(_res("CC BY 4.0"))["viewer"] == "pdf"
    assert acc.viewer(_res("CC BY-NC-SA 4.0"))["viewer"] == "none"               # NC without approval: not shown at all
    assert acc.viewer(_res("CC BY 4.0", url="https://elsewhere.example.org/x.pdf"))["viewer"] == "none"  # host not allowed
    assert acc.viewer(_res("CC BY 4.0", "video", "https://obj.diksha.gov.in/a/master.m3u8"))["viewer"] == "none"
    assert acc.viewer(_res("CC BY 4.0", "interactive"))["viewer"] == "none"
    assert acc.viewer(_res("CC BY 4.0", "epub", "https://obj.diksha.gov.in/x.epub"))["viewer"] == "none"   # no in-app reader
    yt = acc.viewer(_res("CC BY-SA 4.0", "youtube", "https://youtu.be/jEbA7ZVKAz0"))
    assert yt == {"viewer": "youtube", "src": "https://www.youtube-nocookie.com/embed/jEbA7ZVKAz0", "video_id": "jEbA7ZVKAz0"}
    shown = acc.present({**_res("CC BY 4.0"), "preview_url": "x", "streaming_url": "y"})
    assert "artifact_url" not in shown and "streaming_url" not in shown and "official_url" not in shown
    assert shown["access"] == {"viewer": "pdf", "src": "https://obj.diksha.gov.in/ntp-content-production/x.pdf"}
    # visibility: resources only when showable in-app; textbooks when their licence is recognised
    assert acc.visible(_res("CC BY 4.0")) and not acc.visible(_res("CC BY-NC-ND 4.0")) and not acc.visible(_res(None))
    assert acc.visible({"kind": "textbook", "license": {"name": "CC BY-NC-ND 4.0"}})
    assert not acc.visible({"kind": "textbook", "license": {"name": None}})


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
    assert set(sent["filters"]["license"]) == set(acc.known_licenses())          # textbooks: any recognised licence
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


def _ids(t: dict) -> set[str]:
    def walk(units):
        for u in units:
            yield from (r["source_id"] for r in u["resources"])
            yield from walk(u["units"])
    return {r["source_id"] for r in t["resources"]} | set(walk(t["units"]))


def test_textbook_hierarchy_and_resource_access(client, users, fake):
    t = client.get(f"{D}/textbooks/{ACCOUNTANCY}", headers=users["priya"]).json()
    assert t["book"]["name"].startswith("(NEW) Accountancy") and t["book"]["classes"] == [11]
    assert "official_url" not in t["book"] and t["book"]["access"]["viewer"] == "none"   # the book opens as this chapter list
    # NC-ND PDFs (embedding not approved) and ECML packages (source player only) are left out; nothing links out
    ids = _ids(t)
    assert PDF_NCND not in ids and ECML_IN_BOOK not in ids and VIDEO_IN_BOOK in ids
    assert t["resource_count"] == len(ids)
    every = [r for u in t["units"] for x in [u, *u["units"]] for r in x["resources"]]
    assert every and all(r["access"]["viewer"] in ("pdf", "video", "audio", "youtube", "html") for r in every)
    assert all("official_url" not in r and "artifact_url" not in r for r in every)
    video = client.get(f"{D}/resources/{VIDEO_IN_BOOK}", headers=users["priya"], params={"within": ACCOUNTANCY}).json()
    assert video["license"]["name"] == "CC BY-SA 4.0" and video["access"]["viewer"] == "video"
    assert video["access"]["src"].startswith("https://obj.diksha.gov.in/") and video["access"]["src"].endswith(".mp4")
    r = client.get(f"{D}/resources/{PDF_NCND}", headers=users["priya"], params={"within": ACCOUNTANCY})
    assert r.status_code == 404 and "DIKSHA" not in r.json()["detail"]
    empty = client.get(f"{D}/textbooks/{KA_BOOK_EMPTY}", headers=users["priya"]).json()
    assert empty["resource_count"] == 0 and all(u["resource_count"] == 0 for u in empty["units"])
    assert client.get(f"{D}/textbooks/do_doesnotexist123", headers=users["priya"]).status_code == 404
    assert client.get(f"{D}/textbooks/not-an-id", headers=users["priya"]).status_code == 422


# ---------------------------------------------------------------- publishing & Student Library
def test_teacher_publish_student_access_and_unpublish(client, users, fake):
    p, k = users["priya"], users["kavya"]
    # a NonCommercial resource cannot be shown in-app (embedding not approved), so it cannot be published either
    r = client.post(f"{D}/publications", headers=p, json={"items": [{"source_id": PDF_NCND, "within": ACCOUNTANCY}],
                                                          "class_code": "Grade-9-B", "subject_code": "PHY101"})
    assert r.status_code == 422 and "cannot be shown inside the app" in r.json()["detail"] and "DIKSHA" not in r.json()["detail"]
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
    assert client.get(f"{D}/resources/{PDF_NCND}", headers=users["kabir"], params={"within": ACCOUNTANCY}).status_code == 404  # NC: hidden
    cc_pdf = client.get(f"{D}/resources/do_313068385239523328110421", headers=users["kabir"], params={"within": ACCOUNTANCY}).json()
    assert cc_pdf["access"]["viewer"] == "pdf" and cc_pdf["license"]["name"] == "CC BY 4.0"
    assert client.get(f"{D}/resources/{PDF_NCND}", headers=users["kabir"]).status_code == 404      # not published on its own
    assert client.get(f"{D}/resources/{MATH1}", headers=users["kabir"], params={"within": ACCOUNTANCY}).status_code == 404

    # teacher view + admin audit include DIKSHA items; unpublish removes from the Student Library
    mine = client.get(f"{L}/publications/mine", headers=p, params={"status": "published"}).json()["publications"]
    dk = [m for m in mine if m["source"] == "diksha"]
    assert {m["source_id"] for m in dk} == {ACCOUNTANCY, VIDEO_IN_BOOK} and all(m["can_unpublish"] for m in dk)
    assert all(m["source_name"] == "Catalogue" and m["hidden_from_students"] is False and "source_metadata" not in m for m in dk)
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


# ---------------------------------------------------------------- in-app only: content types, licences, wording
def test_content_type_selects_subjects_and_counts(client, users, fake):
    f = client.get(f"{D}/filters", headers=users["priya"], params={"content_type": "video", "class_number": 10}).json()
    assert f["content_type"] == "video"
    sent = next(r for r in reversed(fake.searches) if r["filters"].get("mimeType") == ["video/mp4", "video/webm", "video/x-youtube"])
    assert set(sent["filters"]["license"]) == {"CC BY 4.0", "CC BY-SA 4.0", "CC BY-ND 4.0", "Standard YouTube License"}
    assert sent["filters"]["se_gradeLevels"] == ["Class 10"] and "primaryCategory" not in sent["filters"]
    # only subjects that have videos (History has none and is filtered out)
    assert [s["value"] for s in f["subjects"]] == ["mathematics", "science"]
    assert {t["value"]: t["count"] for t in f["content_types"]} == {"textbook": 293, "video": 150, "document": 200, "interactive": 15, "audio": 0}
    assert [t["label"] for t in f["content_types"]] == ["Textbooks", "Videos", "Documents (PDF)", "Interactive", "Audio"]
    pdf = client.get(f"{D}/filters", headers=users["priya"], params={"content_type": "document"}).json()
    assert [s["value"] for s in pdf["subjects"]] == ["accountancy", "english"]
    # languages follow the chosen subject
    m = client.get(f"{D}/filters", headers=users["priya"], params={"content_type": "video", "subject": "science"}).json()
    assert m["mediums"] == [{"value": "english", "label": "English", "count": 90}]
    assert any(r["filters"].get("se_subjects") == ["science"] and r.get("facets") == ["se_mediums"] for r in fake.searches)
    # the search itself uses the same type + licence filters
    client.get(f"{D}/search", headers=users["priya"], params={"content_type": "video", "subject": "science"})
    sent = fake.searches[-1]
    assert sent["filters"]["mimeType"] == ["video/mp4", "video/webm", "video/x-youtube"] and sent["filters"]["se_subjects"] == ["science"]
    assert "CC BY-NC-SA 4.0" not in sent["filters"]["license"]
    assert client.get(f"{D}/filters", headers=users["priya"], params={"content_type": "Digital Textbook"}).status_code == 422
    assert client.get(f"{D}/filters", headers=users["rohan"]).status_code == 403
    meta = client.get(f"{D}/meta", headers=users["priya"]).json()
    assert "source" not in meta and [t["value"] for t in meta["content_types"]] == ["textbook", "video", "document", "interactive", "audio"]


def test_search_lists_only_items_that_open_in_app(client, users, fake, monkeypatch):
    r = client.get(f"{D}/search", headers=users["priya"], params={"content_type": "video"}).json()
    # NC (not approved), YouTube licence on an MP4, HLS-only and unlicensed items are dropped — never linked out
    assert [i["source_id"] for i in r["items"]] == ["do_1000000000001"]
    assert r["items"][0]["access"]["viewer"] == "video" and "official_url" not in r["items"][0]

    monkeypatch.setattr(get_settings(), "diksha_embed_noncommercial", True)
    r = client.get(f"{D}/search", headers=users["priya"], params={"content_type": "video"}).json()
    assert [i["source_id"] for i in r["items"]] == ["do_1000000000001", "do_1000000000002"]
    assert {"CC BY-NC 4.0", "CC BY-NC-SA 4.0", "CC BY-NC-ND 4.0"} <= set(fake.searches[-1]["filters"]["license"])
    t = client.get(f"{D}/textbooks/{ACCOUNTANCY}", headers=users["priya"]).json()
    assert PDF_NCND in _ids(t) and ECML_IN_BOOK not in _ids(t)                     # ECML still needs the source player
    pdf = client.get(f"{D}/resources/{PDF_NCND}", headers=users["priya"], params={"within": ACCOUNTANCY}).json()
    assert pdf["access"]["viewer"] == "pdf" and pdf["access"]["src"].startswith("https://obj.diksha.gov.in/")
    assert any("approved" in n for n in pdf["permissions"]["notes"])


def test_student_library_types_subjects_and_hidden_nc_items(client, users, fake, monkeypatch):
    p, kabir = users["priya"], users["kabir"]
    cc_pdf = "do_313068385239523328110421"                       # CC BY 4.0 PDF in the Accountancy book
    monkeypatch.setattr(get_settings(), "diksha_embed_noncommercial", True)
    body = {"items": [{"source_id": PDF_NCND, "within": ACCOUNTANCY}, {"source_id": cc_pdf, "within": ACCOUNTANCY},
                      {"source_id": VIDEO_IN_BOOK, "within": ACCOUNTANCY}], "class_code": "Grade-9-B", "subject_code": "PHY101"}
    assert client.post(f"{D}/publications", headers=p, json=body).status_code == 200
    lib = client.get(f"{L}/student/books", headers=kabir).json()
    assert {PDF_NCND, cc_pdf, VIDEO_IN_BOOK} <= {e["source_id"] for e in lib["external"]}

    monkeypatch.setattr(get_settings(), "diksha_embed_noncommercial", False)
    lib = client.get(f"{L}/student/books", headers=kabir).json()
    ids = {e["source_id"] for e in lib["external"]}
    assert PDF_NCND not in ids and {cc_pdf, VIDEO_IN_BOOK} <= ids                 # NC item hidden, not linked out
    assert all("official_url" not in e["metadata"] and "artifact_url" not in e["metadata"] for e in lib["external"])
    counts = {t["value"]: t["count"] for t in lib["types"]}
    assert counts["video"] >= 1 and counts["document"] >= 1
    videos = client.get(f"{L}/student/books", headers=kabir, params={"content_type": "video"}).json()
    assert {e["source_id"] for e in videos["external"]} == {VIDEO_IN_BOOK} and videos["books"] == []
    assert {"subject_code": "PHY101", "subject_name": "Physics"} in videos["subjects"]
    audio = client.get(f"{L}/student/books", headers=kabir, params={"content_type": "audio"}).json()
    assert audio["external"] == [] and audio["subjects"] == []                     # no subject offered without audio
    assert client.get(f"{L}/student/books", headers=kabir, params={"content_type": "ecml"}).status_code == 422
    # the teacher sees that the NC publication is currently hidden from students
    mine = client.get(f"{L}/publications/mine", headers=p, params={"status": "published"}).json()["publications"]
    flags = {m["source_id"]: m["hidden_from_students"] for m in mine if m["source"] == "diksha"}
    assert flags[PDF_NCND] is True and flags[cc_pdf] is False


def test_user_facing_messages_never_name_the_source():
    for kind in DikshaError.MESSAGES:
        assert "diksha" not in str(DikshaError(kind)).lower()
    assert "diksha" not in str(DikshaError("something-else")).lower()
    for lic in ("CC BY 4.0", "CC BY-NC-SA 4.0", "CC BY-ND 4.0", "Standard YouTube License", None):
        perms = acc.permissions(_res(lic, "youtube" if lic and "YouTube" in lic else "pdf"))
        assert not any("diksha" in n.lower() for n in perms["notes"])
        assert "diksha" not in (acc.viewer(_res(lic)).get("reason") or "").lower()
