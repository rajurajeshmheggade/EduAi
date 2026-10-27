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

## Permission matrix used by the LMS

Implemented in `backend/app/services/diksha/access.py`.

| Permission | CC BY / CC BY-SA | CC BY-ND | CC BY-NC / NC-SA / NC-ND | YouTube licence | Missing / unknown |
|---|---|---|---|---|---|
| Discover metadata | Yes | Yes | Yes | Yes | Yes |
| Link to the official resource | Yes | Yes | Yes | Yes | Yes |
| Embed / stream in the LMS (from DIKSHA's host, unmodified) | **Yes** | **Yes** (unmodified only) | **No by default** — `DIKSHA_EMBED_NONCOMMERCIAL=true` only after review | Only via YouTube's embedded player | No |
| “Open file” link to the source PDF/EPUB | Yes | Yes | Only when embedding is enabled | No | No |
| Store a local copy | **No** | **No** | **No** | **No** | **No** |
| Redistribute (LMS re-hosting) | No | No | No | No | No |
| Modify / derivatives | Licence would allow; the LMS offers no editing | Not allowed | NC-ND: not allowed | Not allowed | Not allowed |
| Teacher may publish to students | Yes | Yes | Yes (as a link) | Yes | **No — needs review** |

### Why NonCommercial content is link-only by default

The NC licences allow sharing for non-commercial purposes. Schools using DIKSHA content for teaching is
non-commercial, but this LMS is a commercial product sold to institutions. Whether showing NC content *inside* a paid
platform counts as non-commercial use is a legal judgement, so the default is the conservative one: NC items open on
DIKSHA. An institution can set `DIKSHA_EMBED_NONCOMMERCIAL=true` after its own review.

### What is never done

* No bulk downloading, mirroring or scraping; files stay on DIKSHA's servers.
* No proxying of DIKSHA files through the LMS, and no workaround for CORS, sign-in or player-only content.
* No removal or hiding of licence, author, attribution or copyright notices.
* No use of personal DIKSHA credentials by the server.
* Unverified or unknown licences are never shown in-app and cannot be published.

## Attribution shown to users

Wherever a DIKSHA item appears (cards, textbook page, viewer), the LMS shows, **from the source metadata only**:

* Source: **DIKSHA**, linked to the official item page.
* Licence name linked to its legal code (`licenseDetails.url`, or the canonical Creative Commons legal-code URL for
  the stated licence; the YouTube Terms for the YouTube licence). Missing licence → *“Licence not stated — needs review”*.
* Author, creator, attributions, organisation, and copyright with year — whichever the source provides. Nothing is
  filled in when a field is empty.
* For resources published from a textbook, the textbook and chapter path it came from.

## Open items for the institution

1. Confirm with NCERT/DIKSHA (diksha17[at]ncert[dot]nic[dot]in) that a third-party LMS may call the public content
   APIs and stream files from DIKSHA's hosts. The Terms do not address this.
2. Decide whether NonCommercial content may be displayed in-app (`DIKSHA_EMBED_NONCOMMERCIAL`).
3. Review the “needs review” items (unknown licences) before asking teachers to rely on them.
