# DIKSHA API discovery

Investigation date: **26 October 2026**. Host: `https://diksha.gov.in`. Every endpoint below was called from this
project's backend (Python `httpx`, no browser, no credentials) unless marked otherwise. Nothing here is assumed from
memory; anything not verified is listed under [Not verified](#13-endpoints-that-could-not-be-verified).

## 1. How the investigation was done

| Step | What was done | Result |
|---|---|---|
| Reference page | Opened the reference URL (`/search/Library/1?se_boards=CBSE&se_mediums=english&primaryCategory=digital textbook…`) in headless Chromium and recorded all `/api/` traffic | **302 → DIKSHA login** (`/auth/realms/sunbird/protocol/openid-connect/auth`). The library search UI requires sign-in. |
| Guest UI | Opened `https://diksha.gov.in/` anonymously, clicked **View All Textbooks** | Home page loads anonymously (it calls `POST /api/content/v1/search`). **View All Textbooks** redirects to `/resources?id=ekstep_ncert_k-12&board=NCERT&medium=English&selectedTab=textbook` → login. |
| Logged-in UI | Tried the account supplied by the product owner | DIKSHA answered *“Invalid Email Address/Mobile Number or password”* twice (once with typed keystrokes). Stopped to avoid locking the account. **The signed-in library UI could not be inspected.** |
| Player pages | `GET /play/collection/{id}` and `/play/content/{id}` | HTTP 200 HTML; anonymous browser sessions are routed back to the home page. Responses carry `Content-Security-Policy: frame-ancestors 'self' … *.diksha.gov.in …` → **cannot be framed by our LMS**. |
| Official docs | Sunbird Knowlg docs (`knowlg.sunbird.org`), Sunbird ED docs (`ed.sunbird.org`), DIKSHA Terms of Use / Content Policy (`diksha.gov.in/term-of-use.html`, versions dated 07-07-2025) | See §11 and `DIKSHA_LICENSE_AND_ATTRIBUTION.md`. |
| APIs | Called each candidate endpoint directly (below) | Three anonymous endpoints are used by the integration. |

The reference URL's own `searchFilters` parameter names the facet set the DIKSHA library uses:
`["se_boards","se_gradeLevels","se_subjects","se_mediums","primaryCategory","additionalCategories"]`.

## 2. Endpoints used by the integration

| # | Endpoint | Auth | Documented? | Purpose |
|---|---|---|---|---|
| 1 | `POST /api/content/v1/search` | none | **Yes** — Sunbird Knowlg docs show `POST …/api/content/v1/search` with `request.filters` (Composite Search API; Postman reference `documenter.getpostman.com/view/25463377/2s8ZDa3MP7`) | Catalog search, facets, pagination |
| 2 | `GET /api/content/v1/read/{id}` | none | Partly — Knowlg documents the *Read Content API* as `/content/v2/read/{id}`; DIKSHA serves both `/api/content/v1/read` and `/api/content/v2/read` (both 200) | Metadata + licence of one item |
| 3 | `GET /api/course/v1/hierarchy/{id}` | none | **Not found in the public docs reviewed** — observed working, public | Full textbook tree (chapters → units → resources) |

Not used: `GET /api/collection/v1/hierarchy/{id}` → **401** (needs auth); `GET /api/questionset/v1/hierarchy/{id}` → **401**;
`GET /action/content/v3/hierarchy/{id}` → 200 but `/action/*` is the internal editor/back-office gateway, so it is not
relied on. `POST /api/org/v1/search` (200) is not needed.

## 3. Request and response examples

### 3.1 Search (`POST /api/content/v1/search?orgdetails=orgName&licenseDetails=name,url,description`)

Request (the same filters as the reference URL; this is what our adapter sends):

```json
{"request": {
  "filters": {"status": ["Live"], "se_boards": ["CBSE"], "se_mediums": ["English"], "primaryCategory": ["Digital Textbook"],
              "se_gradeLevels": ["Class 5", "Class 6", "Class 7", "Class 8", "Class 9", "Class 10", "Class 11", "Class 12"]},
  "limit": 24, "offset": 0, "sort_by": {"name": "asc"},
  "fields": ["identifier", "name", "appIcon", "mimeType", "primaryCategory", "se_boards", "se_gradeLevels", "se_subjects",
             "se_mediums", "license", "author", "creator", "attributions", "copyright", "organisation", "leafNodesCount", "…"],
  "facets": ["se_boards", "se_gradeLevels", "se_subjects", "se_mediums", "primaryCategory"]}}
```

Headers: `Content-Type: application/json`, `Accept: application/json`. No API key, cookie or token is needed.
(The DIKSHA web app additionally sends `X-App-Id: prod.diksha.portal`, `X-Device-Id`, `X-Session-Id`, … — not required.)

Response (trimmed, real values from 26-10-2026):

```json
{"id": "api.content.search", "ver": "1.0", "params": {"status": "successful", "err": null, "errmsg": null},
 "responseCode": "OK",
 "result": {"count": 293,
   "content": [{"identifier": "do_3137971439485173761413", "name": " Math 1", "mimeType": "application/vnd.ekstep.content-collection",
     "primaryCategory": "Digital Textbook", "contentType": "TextBook", "se_boards": ["CBSE"], "se_gradeLevels": ["Class 1"],
     "se_subjects": ["Mathematics"], "se_mediums": ["English"], "license": "CC BY-NC-SA 4.0", "author": "Toondemy",
     "creator": "CBSESkill", "copyright": "Creative Edtech Pvt Ltd", "copyrightYear": 2023, "organisation": ["CBSE"],
     "leafNodesCount": 6, "appIcon": "https://files.odev.oci.diksha.gov.in/…/thumbnail-square-1.thumb.png",
     "orgDetails": {"orgName": "CBSE", "email": null},
     "licenseDetails": {"name": "CC BY-NC-SA 4.0", "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode"}}],
   "facets": [{"name": "se_gradeLevels", "values": [{"name": "class 10", "count": 53}, {"name": "class 12", "count": 54}, "…"]},
              {"name": "se_subjects", "values": [{"name": "mathematics", "count": 40}, "…"]}]}}
```

Facet values are returned **lower-case** (`"state (karnataka)"`); filter matching is case-insensitive (verified).

### 3.2 Read (`GET /api/content/v1/read/{id}?licenseDetails=name,url,description`)

```json
{"responseCode": "OK", "result": {"content": {
  "identifier": "do_3137489904471326721346", "name": "ಓದು ಕರ್ನಾಟಕ - ಸರಳ ಕನ್ನಡ - …", "mimeType": "video/mp4",
  "primaryCategory": "Explanation Content", "license": "CC BY 4.0", "author": "DSERT eContent", "attributions": ["Odu Karnataka"],
  "copyright": "DSERT eContent", "copyrightYear": 2023, "organisation": ["Karnataka"], "size": 24971686,
  "artifactUrl": "https://obj.diksha.gov.in/ntp-content-production/content/assets/do_3137489904471326721346/….mp4",
  "streamingUrl": "https://…apigateway.ap-mumbai-1.oci.customer-oci.com/…/master.m3u8",
  "licenseDetails": {"name": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/legalcode"}}}}
```

Unknown id → **404** `{"params": {"status": "failed", "err": "NOT_FOUND"}, "responseCode": …}`.

### 3.3 Hierarchy (`GET /api/course/v1/hierarchy/{id}`)

`result.content` is the textbook with nested `children`. Each node has `identifier`, `name`, `mimeType`, `contentType`,
`primaryCategory`, `index` (order among siblings), `depth`, `parent`, and leaves carry `artifactUrl` / `streamingUrl`
/ `previewUrl` / `license` / `author` / `attributions` / `copyright`. Unknown id → **404** `RESOURCE_NOT_FOUND`.

## 4. Required parameters and headers

* Search: body `{"request": {...}}` is mandatory — a malformed body gives **400** `ERR_CONTENT_SEARCH_FIELDS_MISSING`.
  `filters.status: ["Live"]` keeps only published content. Composite search defaults to `status=Live`, `visibility=Default`
  and `limit=100` (Knowlg docs).
* Read: `licenseDetails=name,url,description` adds the licence legal URL.
* Content ids match `do_[0-9a-zA-Z_]+`; our adapter rejects anything else before calling DIKSHA.

## 5. Pagination

`limit` + `offset`. Verified limits: `limit=1000` works; offsets past `count` return 200 with no items;
**`offset + limit > 10000` returns HTTP 500 `ERR_SYSTEM_EXCEPTION`** (Elasticsearch *“Result window is too large … 10000”*).
The adapter never sends a request beyond that window and tells the user to narrow the filters. Text search uses
`request.query` (relevance order); without a query we sort by `name` ascending (verified working).

## 6. Content metadata fields used

`identifier, name, description, appIcon/posterImage, mimeType, primaryCategory, contentType, se_boards, se_gradeLevels,
se_subjects, se_mediums (fallbacks: board, gradeLevel, subject, medium), license, licenseDetails, author, creator,
attributions, copyright, copyrightYear, organisation, orgDetails.orgName, leafNodesCount, size, pkgVersion,
lastPublishedOn, status, artifactUrl, previewUrl, streamingUrl`.

## 7. Textbook hierarchy and chapter relationships

`TextBook` (collection) → chapters (`contentType: TextBookUnit`, ordered by `index`) → optional sub-units (e.g.
*e-Textbook, Text Content, Video Content, Audio Content, Practice Set, Teacher Resource*) → resources. Observed
variations, all handled:

* NCERT/CBSE books: chapter → section units → resources (e.g. *Science Textbook for Class X*: 13 chapters, 452 unique
  resources — matches `leafNodesCount` — and 5 units without resources).
* Karnataka books: chapters with **no linked resources at all** (`leafNodesCount: 0`, e.g. *2025-26 Marusinchana_8_English SAB*,
  52 empty units) and books where every chapter has exactly one resource.
* The same resource can be linked under more than one unit.

## 8. Resource and file references

`artifactUrl` (original file), `previewUrl`, `streamingUrl` (HLS `master.m3u8` for videos), `downloadUrl` (`.ecar`
offline package for DIKSHA apps — **not used**). Hosts observed: `obj.diksha.gov.in`, `files.odev.oci.diksha.gov.in`,
`*.apigateway.ap-mumbai-1.oci.customer-oci.com` (video streaming), `youtu.be` (YouTube resources). Per-type access is in
`DIKSHA_CONTENT_ACCESS_MATRIX.md`.

## 9. Authentication and access restrictions

The three endpoints above work without authentication. The DIKSHA web UI for browsing the library and the player
pages require a DIKSHA login. The integration never uses personal credentials: a school LMS must not log in to DIKSHA
on behalf of users.

## 10. CORS and backend mediation

API responses send `Access-Control-Allow-Origin: *`, but the LMS still calls DIKSHA **from the backend** so it can
throttle, cache, validate ids, hide DIKSHA's internal error details (its 500 messages expose internal Elasticsearch
hosts) and enforce class-based access. Files on `obj.diksha.gov.in` allow CORS only for `https://diksha.gov.in`, so
in-app viewing uses plain `<video>`, `<audio>`, `<img>` and the browser's PDF view, which load the file straight
from DIKSHA (no proxy, no copy).

## 11. API stability and versioning risks

* `/api/content/v1/search` is documented by Sunbird; `/api/course/v1/hierarchy` is **undocumented** in the sources reviewed
  and could change. Both are isolated in `backend/app/services/diksha/client.py`.
* Facet names (`se_*`) and values are DIKSHA framework data and can change; filter options are always read live.
* DIKSHA's Terms of Use contain no API clause (neither permission nor prohibition). Before a production launch, obtain
  written confirmation from DIKSHA/NCERT (contact listed on the Terms page: diksha17[at]ncert[dot]nic[dot]in).

## 12. Rate limits and throttling

Responses carry `x-ratelimit-limit-hour: 500000` and `x-ratelimit-remaining-hour` (scope not documented) and are
served through a Zenedge CDN/WAF with response caching (`x-proxy-cache: HIT/MISS`). The adapter throttles itself to
`DIKSHA_REQUEST_RATE_LIMIT` requests/second per API process (default 5), caches responses for
`LIBRARY_CACHE_TTL_SECONDS` (default 900 s), retries once on 429/503 honouring `Retry-After` (max 3 s) and times out
after `DIKSHA_API_TIMEOUT_SECONDS` (default 15 s).

## 13. Endpoints that could not be verified

* The **signed-in library page** (the reference URL) and **player pages** — login failed with the supplied account.
* Any official DIKSHA (rather than Sunbird) API terms or partner programme — none found.
* `contentId` deep-link parameters for opening one resource inside the textbook player — not used; resources open at
  `https://diksha.gov.in/play/content/{id}`.
* QR/DIAL-code (`dialcodes`) linked content and teacher courses — not in scope; courses need DIKSHA enrolment.

## 14. Bulk synchronisation

No documented bulk export or catalog-sync API was found, and the search window stops at 10,000 results. The
integration therefore **does not mirror the catalog**: it searches on demand (cached), and stores metadata only for
items a teacher publishes (refreshable via `POST /ICMELive/api/v1/library/diksha/refresh`). Coverage observed on
26-10-2026: 11,498 live digital textbooks across all boards; for NCERT + CBSE + State (Karnataka), Classes 5–12:
91,192 live items (2,080 digital textbooks — NCERT 947, CBSE 374, Karnataka 759).
