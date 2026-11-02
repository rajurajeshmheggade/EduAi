# DIKSHA licensing and attribution

This explains how the LMS decides what it may do with each DIKSHA resource. It is an engineering summary of the
sources below, **not legal advice** — have the institution's legal/compliance owner confirm the policy before launch.

## Sources (read 26 October 2026)

* **DIKSHA Content Policy** (last updated 07-07-2025), section *Open Licensing Policy – Creative Commons Framework*:
  *“Content must be made available under the Creative Commons Licence Framework … One condition of all Creative
  Commons licenses is attribution. DIKSHA permits the use of the following licences: CC BY 4.0, CC BY-SA 4.0,
  CC BY-NC 4.0, CC BY-NC-SA 4.0, CC BY-ND 4.0, CC BY-NC-ND 4.0, YouTube License.”*
* **DIKSHA Terms of Use** (last updated 07-07-2025): content published on DIKSHA *“will be accessed and used by any
  individual, institution or organisation through various platforms, portals and applications in accordance with
  license conditions.”* Prohibited for registered users, among others: using DIKSHA *“for any purpose other than
  learning and educational purposes”*; *“delete the copyright or other proprietary rights notices … on any licensed
  Content”*; *“remove, circumvent, disable … security-related features”*; *“modify, adapt, translate or create
  derivative works … except … to the extent expressly permitted by the license”*.
* The Terms contain **no clause about API use, scraping or bulk export** — neither a permission nor a prohibition.
* Creative Commons licence deeds: <https://creativecommons.org/licenses/> (all six licences allow copying and
  redistribution of the unmodified work with attribution; *NC* limits this to non-commercial purposes; *ND* forbids
  sharing adapted material).

Licences are recorded **per item** (`license`, plus `licenseDetails.url` on search/read), and items inside one
textbook often differ (see the access matrix). The LMS never assumes one licence for all of DIKSHA.

## Product rule (November 2026): everything opens inside the LMS

The product owner asked that the Digital Library and Virtual Labs never send users to DIKSHA and never show DIKSHA
branding: every resource opens inside the LMS. The LMS therefore has **no "open on DIKSHA" links, redirects or
link-only items any more**. A resource either opens in-app under the matrix below, or it is **not listed at all**
(search results, textbook chapters, Virtual Labs experiments, assignment pickers, the Student Library). Nothing about
copying, proxying or attribution changed: files still load straight from DIKSHA's own host, and every item still
carries its licence and copyright notice (see *Attribution shown to users*).

## Permission matrix used by the LMS

Implemented in `backend/app/services/diksha/access.py` (`permissions`, `viewer`, `visible`).

| Permission | CC BY / CC BY-SA | CC BY-ND | CC BY-NC / NC-SA / NC-ND | YouTube licence | Missing / unknown |
|---|---|---|---|---|---|
| Discover metadata (search, textbook chapter list) | Yes | Yes | Yes for textbooks; NC *resources* only when embedding is enabled | Yes | No (hidden) |
| Embed / stream in the LMS (from DIKSHA's host, unmodified) | **Yes** | **Yes** (unmodified only) | **Only with `DIKSHA_EMBED_NONCOMMERCIAL=true`** — otherwise **hidden** | Only via YouTube's embedded player | No — **hidden** |
| Link out to DIKSHA's player / file | **No** (product rule) | No | No | No | No |
| Store a local copy | **No** | **No** | **No** | **No** | **No** |
| Redistribute (LMS re-hosting) | No | No | No | No | No |
| Modify / derivatives | Licence would allow; the LMS offers no editing | Not allowed | NC-ND: not allowed | Not allowed | Not allowed |
| Teacher may publish to students | Yes | Yes | Only when embedding is enabled | Yes | **No — needs review** |

A **resource** is visible only when it can be shown in-app: an allowed licence *and* an in-app format — PDF (browser
PDF view), MP4/WebM video (HTML5 player), MP3 audio, YouTube (YouTube's embedded player) or an HTML5 package whose
`index.html` is served from DIKSHA's host (sandboxed frame). ECML and H5P packages and question sets need DIKSHA's own
player, an MP4 that only has an HLS stream cannot play natively, and EPUBs would need a cross-origin download (DIKSHA's
file host allows CORS only for `diksha.gov.in`) — these are hidden, not linked. A **textbook** is a collection: the LMS
shows its metadata (title, cover, chapter names — discovery, which every licence permits) when its licence is
recognised, and each resource inside is checked on its own, so an NC textbook shows only its non-NC (or approved)
resources. Search requests filter by these formats and licences (`mimeType`, `license`) so facet counts, subject lists
and pagination match what users can open; the server re-checks every item (`visible`) before returning it.

### Why NonCommercial content is hidden by default

The NC licences allow sharing for non-commercial purposes. Schools using DIKSHA content for teaching is
non-commercial, but this LMS is a commercial product sold to institutions. Whether showing NC content *inside* a paid
platform counts as non-commercial use is a legal judgement, so the default is the conservative one. Before the
November 2026 product rule such items opened on DIKSHA; since links out are no longer allowed, they are now **not shown
at all** while `DIKSHA_EMBED_NONCOMMERCIAL=false` (and items already published to a class disappear from the Student
Library; teachers and admins see them marked *Hidden from students*). An institution can set
`DIKSHA_EMBED_NONCOMMERCIAL=true` after its own review; NC items then open in-app like the rest, with a note that the
institution approved it. Note the impact: almost all Virtual Labs content (OLabs) is CC BY-NC-SA / BY-NC-ND, so with
the default most lab manuals show no experiments.

### What is never done

* No bulk downloading, mirroring or scraping; files stay on DIKSHA's servers and the browser loads them directly.
* No proxying of DIKSHA files through the LMS, and no workaround for CORS, sign-in or player-only content.
* No removal or hiding of licence, author, attribution or copyright notices.
* No use of personal DIKSHA credentials by the server.
* Unverified or unknown licences are never shown and cannot be published.

## Attribution shown to users

Wherever a DIKSHA item appears (cards, textbook page, viewer, Virtual Labs), the LMS shows a compact **Credits** line
built **from the source metadata only** (`frontend/src/components/library/diksha/Credits.tsx`), without DIKSHA branding
or logo:

* Copyright notice with year (`© 2020 NCERT`) — always visible.
* Licence name linked to its legal code (`licenseDetails.url`, or the canonical Creative Commons legal-code URL for
  the stated licence; the YouTube Terms for the YouTube licence) — always visible. Missing licence → *“Licence not
  stated — needs review”* (such items are not listed anyway).
* Author, creator, attributions and organisation — listed in full, or one click away in the compact card form.
  Nothing is filled in when a field is empty.
* Licence notes where they apply (*NoDerivatives: shown unmodified only*; *NonCommercial — shown in-app because your
  institution has approved it*).
* For resources published from a textbook, the textbook and chapter path it came from.

The credit no longer names DIKSHA or links to the item's DIKSHA page (product rule). CC BY 4.0 §3(a)(1)(A)(v) asks
for a URI or hyperlink to the licensed material *“to the extent reasonably practicable”*; the institution's legal
owner should confirm that omitting the link to the DIKSHA item page is acceptable (see open items).

## Open items for the institution

1. Confirm with NCERT/DIKSHA (diksha17[at]ncert[dot]nic[dot]in) that a third-party LMS may call the public content
   APIs and stream files from DIKSHA's hosts. The Terms do not address this.
2. Decide whether NonCommercial content may be displayed in-app (`DIKSHA_EMBED_NONCOMMERCIAL`). Until then NC items —
   including most Virtual Labs — are hidden.
3. Confirm that credits without a link to the source item page (and without naming DIKSHA) meet the CC attribution
   condition for your use; re-adding a source link is a one-line change in `Credits.tsx`.
4. Review the “needs review” items (unknown licences) before asking teachers to rely on them.
