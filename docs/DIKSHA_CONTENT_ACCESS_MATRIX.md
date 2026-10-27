# DIKSHA content access matrix

Verified on **26 October 2026** with real items (HTTP `Range: bytes=0-0` probes — no files were downloaded) and
counts from `POST /api/content/v1/search` for **NCERT + CBSE + State (Karnataka), Classes 5–12, status Live**.
"In-app" never means a copy: the browser loads the file straight from DIKSHA's host.

## Per resource type

| Type (mimeType) | Live items* | Sample verified | File host & headers | What the LMS does |
|---|---|---|---|---|
| Digital textbook (`application/vnd.ekstep.content-collection`, primaryCategory *Digital Textbook*) | 2,080 | `do_31307360979353600012111` *Science Textbook for Class X* | Metadata + tree via public API. Player page `/play/collection/{id}` refuses framing (`frame-ancestors` limited to DIKSHA domains) | Cover, metadata, chapter tree and linked resources inside the LMS; whole book opens on DIKSHA |
| PDF (`application/pdf`) | 31,283 | `do_431359533151554764811286` (NCERT chapter, CC BY-NC-ND 4.0) | `obj.diksha.gov.in`, 206 range OK, `ACAO: https://diksha.gov.in` only, no `X-Frame-Options` | If licence allows display: browser PDF view of the source file (iframe). Otherwise official link |
| Video (`video/mp4`) | 25,212 | `do_31310415723157913612322` (CC BY-SA 4.0) | `obj.diksha.gov.in` mp4, 206 range OK; HLS `master.m3u8` on OCI API gateway (`ACAO: *`, `X-Frame-Options: sameorigin`) | If licence allows: HTML5 `<video>` with the mp4 from DIKSHA's host (HLS not used — browsers can't play it natively). Otherwise official link |
| Video (`video/webm`) | 29 | `do_3136512822933995521607` (CC BY 4.0) | `obj.diksha.gov.in`, 206 | Same as mp4 |
| YouTube (`video/x-youtube`) | 6,923 | `do_31427212938730700815172` (`artifactUrl: https://youtu.be/jEbA7ZVKAz0`) | YouTube | YouTube's own embedded player (`youtube-nocookie.com/embed/{id}`) when the id validates; otherwise official link |
| Audio (`audio/mp3`) | 821 | `do_3143874764587335681681` (CC BY-NC-SA 4.0) | `files.odev.oci.diksha.gov.in`, 206, `ACAO: *` | If licence allows: HTML5 `<audio>`. Otherwise official link |
| Interactive ECML (`application/vnd.ekstep.ecml-archive`) | 18,275 | `do_313068382451924992110420` | `.zip` package; `…/ecml/{id}-latest` → 404 at root (player loads internals) | **Official DIKSHA player only** |
| HTML package (`application/vnd.ekstep.html-archive`) | 5,220 | `do_3145416794728529921607` | `.zip`; `…/html/{id}-latest` → 404 at root | Official DIKSHA player only |
| H5P (`application/vnd.ekstep.h5p-archive`) | 978 | `do_314541677530398720145775` | `.zip`; `…/h5p/{id}-latest` → 404 at root | Official DIKSHA player only |
| EPUB (`application/epub`) | 7 | `do_3129846791692124161175` (CC BY-SA 4.0) | `obj.diksha.gov.in`, `application/octet-stream` | Official link (no EPUB reader in the LMS) |
| Offline package (`downloadUrl` `.ecar`) | — | every item | DIKSHA app package | Never used |

\* `mimeType` facet counts for the three boards, Classes 5–12, on 26-10-2026 (91,192 items in total).

## Metadata vs. links vs. files

| Category | Available to the LMS | Used |
|---|---|---|
| Public metadata (title, board, class, subject, medium, licence, author, attributions, copyright, organisation, cover) | Yes, anonymous API | Displayed, and stored for published items only |
| Official links (`/play/collection/{id}`, `/play/content/{id}`) | Yes | Always offered; open in a new tab (framing refused by DIKSHA). DIKSHA may ask the user to sign in |
| Embedded / streamed files | Technically reachable on DIKSHA's hosts | Only when the per-resource licence allows (see licence doc) and the host is on `DIKSHA_ASSET_HOSTS` |
| Direct downloads | `artifactUrl` is publicly reachable | "Open file" link to the **source** file for PDFs/EPUBs whose licence allows display; the LMS never hosts a copy |
| Content requiring authentication | Library UI, player pages, `/api/collection/v1/hierarchy` (401) | Not accessed |
| Unknown / missing licence | Possible in metadata | Official link only, marked *needs review*, cannot be published |

## Licences seen (same scope)

| Licence | Items |
|---|---|
| CC BY 4.0 | 50,593 |
| CC BY-NC-ND 4.0 | 13,064 |
| CC BY-SA 4.0 | 11,154 |
| CC BY-NC-SA 4.0 | 11,044 |
| Standard YouTube License | 3,748 |
| CC BY-ND 4.0 | 1,173 |
| CC BY-NC 4.0 | 416 |

Licences are set **per item**: one textbook (*(NEW) Accountancy Financial Accounting - I*, CC BY-SA 4.0) contains PDFs
under CC BY-NC-ND 4.0, videos under CC BY-SA 4.0 and practice sets under CC BY 4.0. The LMS therefore decides access
per resource, never per textbook.

## Observed in the live end-to-end test

*Science Textbook for Class X* (NCERT, book licence CC BY-NC-ND 4.0): 13 chapters, 452 unique resources (equal to
DIKSHA's `leafNodesCount`), 5 units without resources. With the default configuration, chapter 1 *Chemical Reactions
and Equations* (53 resources) split into 18 in-app videos, 6 in-app PDFs and 29 official-link items (NonCommercial
licences and interactive content). The PDF *Chemical Reactions and Equations* (Learning Resource, CC BY 4.0) rendered
in the LMS straight from `obj.diksha.gov.in`.
