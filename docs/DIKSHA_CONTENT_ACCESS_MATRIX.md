# DIKSHA content access matrix

Verified on **26 October 2026** with real items (HTTP `Range: bytes=0-0` probes — no files were downloaded) and
counts from `POST /api/content/v1/search` for **NCERT + CBSE + State (Karnataka), Classes 5–12, status Live**.
"In-app" never means a copy: the browser loads the file straight from DIKSHA's host.

**Since November 2026 nothing links or redirects to DIKSHA** (product rule, see `DIKSHA_LICENSE_AND_ATTRIBUTION.md`):
a resource that cannot be shown in-app is **hidden** — not offered as an official link. The "What the LMS does" column
below reflects that. Search filters by `mimeType` (in-app formats) and `license` (licences the settings allow) so
counts and facets only include showable items.

## Per resource type

| Type (mimeType) | Live items* | Sample verified | File host & headers | What the LMS does |
|---|---|---|---|---|
| Digital textbook (`application/vnd.ekstep.content-collection`, primaryCategory *Digital Textbook*) | 2,080 | `do_31307360979353600012111` *Science Textbook for Class X* | Metadata + tree via public API. Player page `/play/collection/{id}` refuses framing (`frame-ancestors` limited to DIKSHA domains) | Cover, metadata and chapter tree inside the LMS, with only the resources that open in-app; the whole-book player is not used |
| PDF (`application/pdf`) | 31,283 | `do_431359533151554764811286` (NCERT chapter, CC BY-NC-ND 4.0) | `obj.diksha.gov.in`, 206 range OK, `ACAO: https://diksha.gov.in` only, no `X-Frame-Options` | If licence allows display: browser PDF view of the source file (iframe). Otherwise hidden |
| Video (`video/mp4`) | 25,212 | `do_31310415723157913612322` (CC BY-SA 4.0) | `obj.diksha.gov.in` mp4, 206 range OK; HLS `master.m3u8` on OCI API gateway (`ACAO: *`, `X-Frame-Options: sameorigin`) | If licence allows: our HTML5 `<video>` player with the mp4 from DIKSHA's host (HLS not used — browsers can't play it natively). Otherwise hidden. In Virtual Labs the player also records the parts really watched (Submit unlocks at the end) |
| Video (`video/webm`) | 29 | `do_3136512822933995521607` (CC BY 4.0) | `obj.diksha.gov.in`, 206 | Same as mp4 |
| YouTube (`video/x-youtube`) | 6,923 | `do_31427212938730700815172` (`artifactUrl: https://youtu.be/jEbA7ZVKAz0`) | YouTube | YouTube's own embedded player (`youtube-nocookie.com/embed/{id}`, IFrame Player API in Virtual Labs to see playback state) when the id validates; otherwise hidden |
| Audio (`audio/mp3`) | 821 | `do_3143874764587335681681` (CC BY-NC-SA 4.0) | `files.odev.oci.diksha.gov.in`, 206, `ACAO: *` | If licence allows: HTML5 `<audio>`. Otherwise hidden |
| Interactive ECML (`application/vnd.ekstep.ecml-archive`) | 18,275 | `do_313068382451924992110420` | `.zip` package; `…/ecml/{id}-latest` → 404 at root (player loads internals) | **Hidden** (needs DIKSHA's player, which refuses framing) |
| HTML package (`application/vnd.ekstep.html-archive`) | 5,220 | `do_3145416794728529921607`; OLabs simulation `do_313971924960796672189` | `.zip`; `…/html/{id}-latest` → 404 at the folder root, but `…/html/{id}-latest/index.html` → 200 `text/html` from `obj.diksha.gov.in` with no `X-Frame-Options` / CSP (verified 2026-10-28; this is the page DIKSHA's own player loads) | If licence allows: the package's `index.html` from DIKSHA's host in a sandboxed `<iframe>` (Virtual Labs simulations, library "Interactive"). Otherwise hidden |
| H5P (`application/vnd.ekstep.h5p-archive`) | 978 | `do_314541677530398720145775` | `.zip`; `…/h5p/{id}-latest` → 404 at root | **Hidden** (needs DIKSHA's player) |
| EPUB (`application/epub`) | 7 | `do_3129846791692124161175` (CC BY-SA 4.0) | `obj.diksha.gov.in`, `application/octet-stream` | **Hidden** — an in-app EPUB reader would have to download the file cross-origin (CORS allows only `diksha.gov.in`), i.e. a proxy or copy |
| Offline package (`downloadUrl` `.ecar`) | — | every item | DIKSHA app package | Never used |

\* `mimeType` facet counts for the three boards, Classes 5–12, on 26-10-2026 (91,192 items in total).

## Metadata vs. links vs. files

| Category | Available to the LMS | Used |
|---|---|---|
| Public metadata (title, board, class, subject, medium, licence, author, attributions, copyright, organisation, cover) | Yes, anonymous API | Displayed, and stored for published items only |
| Official links (`/play/collection/{id}`, `/play/content/{id}`) | Yes | **Not used** (no links out); kept only in stored metadata, never sent to the browser |
| Embedded / streamed files | Technically reachable on DIKSHA's hosts | Only when the per-resource licence allows (see licence doc) and the host is on `DIKSHA_ASSET_HOSTS` |
| Direct downloads | `artifactUrl` is publicly reachable | No "Open file" link any more; the file is only shown in the in-app viewer. The LMS never hosts a copy |
| Content requiring authentication | Library UI, player pages, `/api/collection/v1/hierarchy` (401) | Not accessed |
| Unknown / missing licence | Possible in metadata | Hidden, cannot be published (*needs review*) |

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
and Equations* (53 resources) split into 18 in-app videos, 6 in-app PDFs and 29 items that could not be shown in-app
(NonCommercial licences and interactive content) — since November 2026 those 29 are hidden instead of linked. The PDF *Chemical Reactions and Equations* (Learning Resource, CC BY 4.0) rendered
in the LMS straight from `obj.diksha.gov.in`.

## Observed after the in-app-only change (2 November 2026)

Live `filters` for NCERT, Class 10 with the default settings counted 63 textbooks, 2,092 videos, 705 PDFs, 30 interactive
HTML packages and no audio; choosing *Audio* therefore offers no subjects. Class 10 Mathematics *Interactive* returned 4
HTML packages (*Focus Spot* series, CC BY 4.0) that run in the sandboxed frame. Virtual Labs: the Class 10 Science Lab
Manual shows no experiments while NonCommercial display is not approved (all its resources are NC); the Class 11 Physics
Lab Manual shows 12 experiments with CC BY / BY-SA resources. A 5 min 15 s lab video (CC BY-SA 4.0) played in the in-app
player: seeking to the end left it at 2 % and Submit hidden; playing it through at 2x unlocked Submit after ~160 s.
