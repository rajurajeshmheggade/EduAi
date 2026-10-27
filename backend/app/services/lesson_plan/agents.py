"""Session content agents — Current Affairs / Video References / Images / Educational Documents.

Port of Rapid's SessionContentAgents (.NET), which itself replaced the Python reference agents
(google_affairs_agent, google_resources_agent, LessonPlanApi.search_images). Contract kept by every path:

* it never raises and never runs past `session_agents_timeout_seconds` — a dead agent degrades ONE block of the
  session to an explicit "unavailable" and the session still generates and saves;
* each agent walks an ordered chain of real providers and the FIRST one that answers with relevant items wins;
* queries are pinned to the syllabus ("NCERT Class 6 Maths Fractions …"), never the bare chapter title;
* every result set is reviewed by the AI for relevance to the class / subject / chapter (fails OPEN);
* answers are cached per (agent, class, subject, chapter) so re-generating does not re-spend metered searches.

Chains (first that answers wins):
  Images          SerpAPI google_images → Wikimedia Commons → Openverse
  Video refs      YouTube Data API v3 → SerpAPI youtube
  Current affairs SerpAPI google_news → Wikinews   (+ retry on the chapter's real-world theme)
  Documents       SerpAPI google + filetype:pdf|doc|docx, official NCERT / DIKSHA hosts
"""
from __future__ import annotations

import html
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Callable
from urllib.parse import quote, urlparse

import httpx

from ...config import get_settings
from . import ai

log = logging.getLogger("eduai.session_agents")

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
CURRENT_AFFAIRS, VIDEOS, IMAGES, DOCUMENTS = "current_affairs", "videos", "images", "documents"
LABEL = {CURRENT_AFFAIRS: "current affairs", VIDEOS: "YouTube", IMAGES: "image", DOCUMENTS: "study material"}


@dataclass
class AgentItem:
    title: str
    url: str
    snippet: str | None = None
    source: str | None = None
    date: str | None = None
    thumbnail: str | None = None
    videoId: str | None = None
    width: int | None = None
    height: int | None = None


@dataclass
class AgentResult:
    status: str                    # ok | empty | unavailable | not_configured
    provider: str
    items: list[AgentItem] = field(default_factory=list)
    message: str | None = None

    @staticmethod
    def ok(provider: str, items: list[AgentItem]) -> "AgentResult":
        return AgentResult("ok" if items else "empty", provider, list(items))

    @staticmethod
    def unavailable(provider: str, message: str) -> "AgentResult":
        return AgentResult("unavailable", provider, [], message)

    def status_dict(self) -> dict:
        return {"status": self.status, "provider": self.provider, "count": len(self.items), "message": self.message}

    def items_list(self) -> list[dict]:
        return [asdict(x) for x in self.items]


class _Timeout(Exception):
    pass


# ─────────────────────────────────────────────────────────────── cache
_cache: dict[str, tuple[float, AgentResult]] = {}
_cache_lock = threading.Lock()


def _cache_get(key: str) -> AgentResult | None:
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        _cache.pop(key, None)
        return None


def _cache_put(key: str, res: AgentResult, minutes: int) -> None:
    with _cache_lock:
        _cache[key] = (time.monotonic() + minutes * 60, res)


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


# ─────────────────────────────────────────────────────────────── helpers
def _first(e: dict, *keys: str) -> str:
    for k in keys:
        v = e.get(k) if isinstance(e, dict) else None
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _int(e: dict, key: str) -> int | None:
    v = e.get(key) if isinstance(e, dict) else None
    return v if isinstance(v, int) else None


def _blank(s: str | None) -> str | None:
    return s if s and s.strip() else None


def _https(url: str) -> str:
    return "https://" + url[7:] if url.lower().startswith("http://") else url


def _youtube_id(url: str) -> str | None:
    if not url or ("youtube.com" not in url.lower() and "youtu.be" not in url.lower()):
        return None
    m = re.search(r"(?:v=|youtu\.be/|embed/)([a-zA-Z0-9_-]{11})", url)
    return m.group(1) if m else None


def _source_from_url(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
        return host[4:] if host.lower().startswith("www.") else host
    except ValueError:
        return ""


_ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"]


def grade_number(grade: str | None) -> int | None:
    if not grade or not grade.strip():
        return None
    s = grade.lower()
    m = re.search(r"\d+", s)
    if m and 1 <= int(m.group()) <= 12:
        return int(m.group())
    words = [w for w in re.split(r"[^a-z]+", s) if w]
    for i in range(len(_ROMAN) - 1, -1, -1):
        if _ROMAN[i] in words:
            return i + 1
    return None


def build_query(kind: str, grade: str, subject: str, topic: str) -> str:
    """Pinned to the Indian school syllabus so results land at the right level."""
    g = grade_number(grade)
    class_text = f"Class {g}" if g else (f"Class {grade.strip()}" if grade and grade.strip() else "")
    syllabus = f"NCERT {class_text}" if class_text else "NCERT"
    subj = (subject or "").strip()
    if kind == IMAGES:
        q = f"{syllabus} {subj} {topic} chapter illustration for students"
    elif kind == VIDEOS:
        q = f"{topic} {subj} {class_text} NCERT explanation for students -exercise -solution -quiz"
    elif kind == DOCUMENTS:
        q = f"{syllabus} {subj} {topic} worksheet OR notes OR chapter (filetype:pdf OR filetype:doc OR filetype:docx)"
    else:
        q = f"{topic} {subj} current affairs India school students {class_text}"
    return re.sub(r"\s+", " ", q).strip()


def _topic_query(subject: str, topic: str) -> str:
    return topic.strip() if not (subject or "").strip() else f"{topic.strip()} {subject.strip()}"


def _parse_date(s: str | None) -> datetime | None:
    """ISO dates (what SerpAPI's iso_date / YouTube / Wikinews give) or US-style m/d/Y; None when unknown."""
    if not s or not s.strip():
        return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        try:
            return datetime(int(m.group(3)), int(m.group(1)), int(m.group(2)), tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def rank_by_recency(items: list[AgentItem], max_n: int, fresh_months: int = 18) -> list[AgentItem]:
    """Newest first; anything older than 18 months is dropped while at least 3 recent items remain."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=fresh_months * 30)
    floor = datetime.min.replace(tzinfo=timezone.utc)
    sorted_items = sorted(items, key=lambda x: _parse_date(x.date) or floor, reverse=True)
    fresh = [x for x in sorted_items if (_parse_date(x.date) or floor) >= cutoff]
    return (fresh if len(fresh) >= min(max_n, 3) else sorted_items)[:max_n]


# ─────────────────────────────────────────────────────────────── agent runner
class SessionContentAgents:
    def __init__(self) -> None:
        self.s = get_settings()

    # ---- public ----
    def run(self, kind: str, grade: str, subject: str, topic: str, max_results: int) -> AgentResult:
        """Never raises; never exceeds the configured budget."""
        max_results = max(1, min(10, max_results))
        if not (topic or "").strip():
            return AgentResult.ok("none", [])
        key = f"agent::{kind}::{grade}|{subject}|{topic}|{max_results}".lower()
        if self.s.session_agents_cache_minutes > 0:
            hit = _cache_get(key)
            if hit is not None:
                return hit
        deadline = time.monotonic() + max(2, min(120, self.s.session_agents_timeout_seconds))
        try:
            res = self._run_uncached(kind, grade, subject, topic, max_results, deadline)
        except _Timeout:
            res = AgentResult.unavailable("timeout", f"The {LABEL[kind]} search did not respond within "
                                                     f"{self.s.session_agents_timeout_seconds}s.")
        except Exception as e:  # noqa: BLE001 — contract: never raise
            log.warning("Session agent %s failed: %s", kind, e)
            res = AgentResult.unavailable("none", f"No source could supply {LABEL[kind]}.")
        if self.s.session_agents_cache_minutes > 0 and res.status == "ok":
            _cache_put(key, res, self.s.session_agents_cache_minutes)
        return res

    # ---- chain ----
    def _run_uncached(self, kind: str, grade: str, subject: str, topic: str, max_n: int, deadline: float) -> AgentResult:
        direct = self._run_chain(kind, grade, subject, topic, max_n, deadline)
        if direct.items or kind != CURRENT_AFFAIRS:
            return direct
        # A chapter title is not always searchable news ("Badal and Moti"); search its real-world theme instead.
        theme = self._broaden_topic(grade, subject, topic)
        if not theme or theme.lower() == topic.lower():
            return direct
        log.info("%s: nothing for %r — retrying on its theme %r", kind, topic, theme)
        broadened = self._run_chain(kind, grade, subject, theme, max_n, deadline)
        return replace(broadened, message=f"Related to the chapter’s theme: {theme}") if broadened.items else direct

    def _chain(self, kind: str) -> list[tuple[str, Callable]]:
        s = self.s
        chain: list[tuple[str, Callable]] = []
        explicit = {CURRENT_AFFAIRS: s.session_agents_current_affairs_url, VIDEOS: s.session_agents_videos_url,
                    IMAGES: s.session_agents_images_url, DOCUMENTS: s.session_agents_documents_url}[kind].strip()
        if explicit:
            chain.append(("configured", lambda g, sub, t, m, dl: self._from_configured(explicit, kind, g, sub, t, m, dl)))
        if kind == IMAGES and s.session_agents_prefer_free_sources:
            chain += [("wikimedia-commons", self._from_wikimedia), ("openverse", self._from_openverse)]
        if kind == VIDEOS and s.youtube_api_key:
            chain.append(("youtube-data-api", self._from_youtube))
        if s.serpapi_api_key:
            chain.append(("serpapi", lambda g, sub, t, m, dl: self._from_serpapi(kind, g, sub, t, m, dl)))
        if kind == IMAGES and not s.session_agents_prefer_free_sources:
            chain += [("wikimedia-commons", self._from_wikimedia), ("openverse", self._from_openverse)]
        if kind == CURRENT_AFFAIRS:
            chain.append(("wikinews", self._from_wikinews))
        base = s.session_agents_base_url.strip().rstrip("/")
        if kind == IMAGES and base and not explicit:
            url = base + "/ExcelSchoolAI/LessonPlan/search-images"
            chain.append(("python-agent", lambda g, sub, t, m, dl: self._from_configured(url, kind, g, sub, t, m, dl)))
        if s.session_agents_enable_web_fallback and kind != DOCUMENTS:
            chain.append(("duckduckgo", lambda g, sub, t, m, dl: self._from_duckduckgo(kind, g, sub, t, m, dl)))
        return chain

    def _run_chain(self, kind: str, grade: str, subject: str, topic: str, max_n: int, deadline: float) -> AgentResult:
        chain = self._chain(kind)
        if not chain:
            return AgentResult("not_configured", "none", [],
                               f"No source is configured for {LABEL[kind]} — set SERPAPI_API_KEY (or a per-agent URL).")
        last: AgentResult | None = None
        first_empty: AgentResult | None = None
        for provider, run in chain:
            if time.monotonic() >= deadline:
                raise _Timeout()
            try:
                res = run(grade, subject, topic, max_n, deadline)
            except _Timeout:
                raise
            except Exception as e:  # noqa: BLE001
                log.warning("Session agent %s failed on %s: %s", kind, provider, e)
                last = AgentResult.unavailable(provider, f"{provider} could not be reached: {e}")
                continue
            if res.status == "unavailable":
                log.info("%s: %s unavailable (%s) — trying the next source", kind, provider, res.message)
                last = res
                continue
            if not res.items:
                first_empty = first_empty or res
                continue
            kept = self._validate(kind, grade, subject, topic, res.items)
            if not kept:
                log.info("%s: all %d results from %s judged off-topic for %s %s %r — next source",
                         kind, len(res.items), provider, grade, subject, topic)
                first_empty = first_empty or AgentResult.ok(provider, [])
                continue
            return AgentResult.ok(provider, kept)
        return first_empty or last or AgentResult.unavailable("none", f"No source could supply {LABEL[kind]}.")

    # ---- AI: theme + relevance review ----
    def _broaden_topic(self, grade: str, subject: str, topic: str) -> str:
        prompt = f"""A teacher is preparing a lesson for {grade} {subject} on the chapter "{topic}" (Indian NCERT curriculum).

The chapter's own title returns no news results, because it is a chapter title rather than a real-world subject.

Identify the real-world THEME of this chapter — the thing it is actually about — phrased as a short search
phrase (2-5 words) that would find current, age-appropriate news or articles a teacher could discuss with
{grade} students. Do not repeat the chapter title. Do not name characters.

Return ONLY: {{ "theme": "..." }}"""
        try:
            v = ai.loads(ai.complete_json_object("theme", prompt), {})
            theme = str(v.get("theme") or "").strip() if isinstance(v, dict) else ""
            return theme if 2 < len(theme) < 80 else ""
        except Exception as e:  # noqa: BLE001
            log.warning("Could not derive a theme for %r: %s", topic, e)
            return ""

    def _validate(self, kind: str, grade: str, subject: str, topic: str, items: list[AgentItem]) -> list[AgentItem]:
        """One batched relevance review on EduAI's provider. Fails OPEN — a validator outage must not blank a block."""
        if not items or not self.s.session_agents_validate:
            return items
        what = {IMAGES: "images a teacher could display on the board",
                VIDEOS: "videos a teacher could play in class",
                DOCUMENTS: "printable study documents (worksheets, notes, chapter PDFs) a teacher could hand out"}.get(
            kind, "current-affairs articles a teacher could discuss in class")
        lines = []
        for i, x in enumerate(items):
            bits = [f"[{i}] {x.title}"]
            if x.source:
                bits.append(f"source: {x.source}")
            if x.snippet:
                bits.append(f"about: {x.snippet[:220]}")
            lines.append(" | ".join(bits))
        prompt = f"""You are a strict school-content reviewer for the Indian NCERT curriculum.

A teacher is preparing a session and the platform has fetched candidate {what}.

- Class/Grade: {grade}
- Subject: {subject}
- Chapter / topic: "{topic}"

Candidates:
{chr(10).join(lines)}

Keep ONLY the candidates that are genuinely about THIS chapter/topic for THIS subject, and are pitched at
{grade} level. Reject anything that merely shares a word with the chapter title but is about something
else (a person, place, band or product with a similar name), anything for a much older or younger
audience, anything off-syllabus, and anything not usable in a classroom.
If NONE of them are suitable, return an empty list — that is a valid and expected answer.

Return ONLY this JSON object:
{{ "keep": [ {{ "i": 0, "why": "one short sentence on how this helps teach the chapter at this level" }} ] }}"""
        try:
            v = ai.loads(ai.complete_json_object("validate", prompt), None)
            keep = v.get("keep") if isinstance(v, dict) else None
            if not isinstance(keep, list):
                return items
            out, seen = [], set()
            for k in keep:
                if not isinstance(k, dict) or not isinstance(k.get("i"), int):
                    continue
                i = k["i"]
                if i < 0 or i >= len(items) or i in seen:
                    continue
                seen.add(i)
                why = k.get("why") if isinstance(k.get("why"), str) else None
                out.append(replace(items[i], snippet=why) if kind == CURRENT_AFFAIRS and why and why.strip() else items[i])
            return out
        except Exception as e:  # noqa: BLE001
            log.warning("Relevance review failed for %s; returning the unreviewed results: %s", kind, e)
            return items

    # ---- HTTP ----
    def _get(self, url: str, deadline: float, ua: str = BROWSER_UA) -> httpx.Response:
        remaining = deadline - time.monotonic()
        if remaining <= 0.5:
            raise _Timeout()
        try:
            return httpx.get(url, headers={"User-Agent": ua, "Accept": "*/*"}, timeout=min(remaining, 25.0),
                             follow_redirects=True)
        except httpx.TimeoutException as e:
            if time.monotonic() >= deadline - 0.5:
                raise _Timeout() from e
            raise

    # ---- SerpAPI (google_news / google_images / youtube / google) ----
    def _from_serpapi(self, kind: str, grade: str, subject: str, topic: str, max_n: int, deadline: float) -> AgentResult:
        q = build_query(kind, grade, subject, topic)
        engine, qkey, rkey = {IMAGES: ("google_images", "q", "images_results"),
                              VIDEOS: ("youtube", "search_query", "video_results"),
                              DOCUMENTS: ("google", "q", "organic_results")}.get(kind, ("google_news", "q", "news_results"))
        url = (f"https://serpapi.com/search.json?engine={engine}&{qkey}={quote(q)}&hl=en"
               f"&api_key={quote(self.s.serpapi_api_key)}")
        res = self._get(url, deadline)

        def no_results(why: str | None) -> bool:
            w = (why or "").lower()
            return "hasn't returned any results" in w or "has not returned any results" in w or "no results" in w

        try:
            body = res.json()
        except ValueError:
            body = {}
        err = body.get("error") if isinstance(body, dict) else None
        if res.status_code >= 400 or isinstance(err, str):
            why = err if isinstance(err, str) else f"HTTP {res.status_code}"
            return AgentResult.ok("serpapi", []) if no_results(why) else AgentResult.unavailable("serpapi", f"SerpAPI: {why}")
        rows = body.get(rkey) if isinstance(body, dict) else None
        if not isinstance(rows, list):
            return AgentResult.ok("serpapi", [])
        is_article = kind == CURRENT_AFFAIRS
        cap = 40 if is_article else max_n
        reader = {IMAGES: _serp_image, VIDEOS: _serp_video, DOCUMENTS: _serp_document}.get(kind, _serp_news)
        items: list[AgentItem] = []
        for e in rows:
            if isinstance(e, dict):
                item = reader(e)
                if item:
                    items.append(item)
            if len(items) >= cap:
                break
        return AgentResult.ok("serpapi", rank_by_recency(items, max_n) if is_article else items)

    # ---- YouTube Data API v3 ----
    def _from_youtube(self, grade: str, subject: str, topic: str, max_n: int, deadline: float) -> AgentResult:
        q = build_query(VIDEOS, grade, subject, topic)
        url = ("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video"
               f"&maxResults={max(1, min(25, max_n))}&safeSearch=strict&relevanceLanguage=en"
               f"&q={quote(q)}&key={quote(self.s.youtube_api_key)}")
        res = self._get(url, deadline)
        try:
            body = res.json()
        except ValueError:
            body = {}
        if res.status_code >= 400:
            why = (body.get("error") or {}).get("message") if isinstance(body, dict) else None
            return AgentResult.unavailable("youtube-data-api", f"YouTube Data API: {why or f'HTTP {res.status_code}'}")
        items: list[AgentItem] = []
        for e in body.get("items") or []:
            vid = _first(e.get("id") or {}, "videoId") if isinstance(e, dict) else ""
            sn = e.get("snippet") if isinstance(e, dict) else None
            if not vid or not isinstance(sn, dict):
                continue
            hi = ((sn.get("thumbnails") or {}).get("high") or {})
            thumb = _first(hi, "url") or f"https://img.youtube.com/vi/{vid}/hqdefault.jpg"
            pub = _first(sn, "publishedAt")
            items.append(AgentItem(
                title=html.unescape(_first(sn, "title") or "Educational Video"),
                url=f"https://www.youtube.com/watch?v={vid}",
                snippet=_blank(html.unescape(_first(sn, "description"))),
                source=_blank(_first(sn, "channelTitle")) or "YouTube",
                date=_blank(pub[:10] if len(pub) >= 10 else pub), thumbnail=_https(thumb), videoId=vid))
            if len(items) >= max_n:
                break
        return AgentResult.ok("youtube-data-api", items)

    # ---- Wikimedia Commons / Wikinews / Openverse (free, keyless) ----
    def _from_wikimedia(self, grade: str, subject: str, topic: str, max_n: int, deadline: float) -> AgentResult:
        q = _topic_query(subject, topic)
        url = ("https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2"
               f"&generator=search&gsrnamespace=6&gsrlimit={max(4, min(30, max_n * 2))}"
               f"&gsrsearch={quote(q + ' filetype:bitmap|drawing')}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=800")
        res = self._get(url, deadline, ua=self.s.wikimedia_user_agent)
        if res.status_code >= 400:
            return AgentResult.unavailable("wikimedia-commons", f"Wikimedia Commons: HTTP {res.status_code}")
        pages = ((res.json().get("query") or {}).get("pages")) or []
        items: list[AgentItem] = []
        for page in pages:
            infos = page.get("imageinfo") if isinstance(page, dict) else None
            info = infos[0] if isinstance(infos, list) and infos else None
            if not isinstance(info, dict):
                continue
            full = _https(_first(info, "url"))
            if not full or re.search(r"\.(pdf|tif|tiff|webm|ogv|ogg|djvu|xcf)$", full, re.I):
                continue
            title = re.sub(r"^File:", "", _first(page, "title"), flags=re.I)
            title = re.sub(r"\.[a-z0-9]{3,4}$", "", title, flags=re.I).replace("_", " ").strip()
            items.append(AgentItem(title=title or topic, url=full, source="Wikimedia Commons",
                                   thumbnail=_blank(_https(_first(info, "thumburl"))) or full,
                                   width=_int(info, "thumbwidth") or _int(info, "width"),
                                   height=_int(info, "thumbheight") or _int(info, "height")))
            if len(items) >= max_n:
                break
        return AgentResult.ok("wikimedia-commons", items)

    def _from_wikinews(self, grade: str, subject: str, topic: str, max_n: int, deadline: float) -> AgentResult:
        url = ("https://en.wikinews.org/w/api.php?action=query&format=json&formatversion=2"
               f"&generator=search&gsrnamespace=0&gsrlimit={max(6, min(30, max_n * 3))}"
               f"&gsrsearch={quote(_topic_query(subject, topic))}"
               "&prop=extracts|info|pageimages|revisions&exintro=1&explaintext=1&exchars=320"
               "&inprop=url&piprop=thumbnail&pithumbsize=400&rvprop=timestamp")
        res = self._get(url, deadline, ua=self.s.wikimedia_user_agent)
        if res.status_code >= 400:
            return AgentResult.unavailable("wikinews", f"Wikinews: HTTP {res.status_code}")
        pages = ((res.json().get("query") or {}).get("pages")) or []
        items: list[AgentItem] = []
        for page in pages:
            if not isinstance(page, dict):
                continue
            link, title = _https(_first(page, "fullurl", "canonicalurl")), _first(page, "title")
            if not link or not title:
                continue
            extract = _first(page, "extract")
            date = None
            m = re.match(r"^\s*(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})", extract)
            if m:
                try:
                    date = datetime.strptime(m.group(1), "%B %d, %Y").strftime("%Y-%m-%d")
                except ValueError:
                    date = None
                extract = extract[m.end():].strip()
            revs = page.get("revisions")
            if date is None and isinstance(revs, list) and revs:
                ts = _first(revs[0], "timestamp")
                date = ts[:10] if len(ts) >= 10 else None
            thumb = _first(page.get("thumbnail") or {}, "source")
            items.append(AgentItem(title=title, url=link, snippet=_blank(extract[:260].rstrip() + "…" if len(extract) > 260 else extract),
                                   source="Wikinews", date=date, thumbnail=_blank(_https(thumb))))
        return AgentResult.ok("wikinews", rank_by_recency(items, max_n))

    def _from_openverse(self, grade: str, subject: str, topic: str, max_n: int, deadline: float) -> AgentResult:
        url = (f"https://api.openverse.org/v1/images/?page_size={max(1, min(20, max_n))}&mature=false&license_type=all"
               f"&q={quote(_topic_query(subject, topic))}")
        res = self._get(url, deadline)
        if res.status_code >= 400:
            return AgentResult.unavailable("openverse", f"Openverse: HTTP {res.status_code}")
        items: list[AgentItem] = []
        for e in res.json().get("results") or []:
            full = _https(_first(e, "url"))
            if not full:
                continue
            items.append(AgentItem(title=_blank(_first(e, "title")) or topic, url=full,
                                   source=_blank(_first(e, "source", "provider")) or "Openverse",
                                   thumbnail=_blank(_https(_first(e, "thumbnail"))) or full,
                                   width=_int(e, "width"), height=_int(e, "height")))
            if len(items) >= max_n:
                break
        return AgentResult.ok("openverse", items)

    # ---- reuse: a configured external agent (tolerant reader) ----
    def _from_configured(self, url: str, kind: str, grade: str, subject: str, topic: str, max_n: int,
                         deadline: float) -> AgentResult:
        sep = "&" if "?" in url else "?"
        q = (f"{url}{sep}topic={quote(topic)}&subject={quote(subject or '')}&grade={quote(grade or '')}"
             f"&max_results={max_n}&kind={kind}")
        res = self._get(q, deadline)
        if res.status_code >= 400:
            return AgentResult.unavailable("configured", f"The {LABEL[kind]} agent returned HTTP {res.status_code}.")
        root = res.json()
        arr = root if isinstance(root, list) else next(
            (root[k] for k in ("results", "items", "data", "articles", "videos", "images")
             if isinstance(root, dict) and isinstance(root.get(k), list)), None)
        if not isinstance(arr, list):
            return AgentResult.ok("configured", [])
        items: list[AgentItem] = []
        for e in arr:
            if not isinstance(e, dict):
                continue
            link, title = _first(e, "url", "image", "link", "href", "content"), _first(e, "title", "name", "heading")
            if not link and not title:
                continue
            items.append(AgentItem(title=title or topic, url=_https(link),
                                   snippet=_blank(_first(e, "summary", "snippet", "excerpt", "description")),
                                   source=_blank(_first(e, "source", "publisher", "domain")),
                                   date=_blank(_first(e, "date", "published", "publish_date")),
                                   thumbnail=_blank(_https(_first(e, "thumbnail", "thumb", "image"))),
                                   videoId=_blank(_first(e, "video_id", "videoId")) or _youtube_id(link),
                                   width=_int(e, "width"), height=_int(e, "height")))
            if len(items) >= max_n:
                break
        return AgentResult.ok("configured", items)

    # ---- last resort: DuckDuckGo (off by default — 403 on many networks) ----
    def _from_duckduckgo(self, kind: str, grade: str, subject: str, topic: str, max_n: int, deadline: float) -> AgentResult:
        query = build_query(kind, grade, subject, topic)
        page = self._get("https://duckduckgo.com/?q=" + quote(query), deadline)
        m = re.search(r"vqd=[\"']?([-0-9a-zA-Z]{8,})[\"'&]", page.text) if page.status_code < 400 else None
        if not m:
            return AgentResult.unavailable("duckduckgo", "Could not obtain a search token from DuckDuckGo.")
        endpoint = {IMAGES: "i.js", VIDEOS: "v.js"}.get(kind, "news.js")
        res = self._get(f"https://duckduckgo.com/{endpoint}?l=us-en&o=json&q={quote(query)}&vqd={quote(m.group(1))}&f=,,,&p=1",
                        deadline)
        if res.status_code >= 400 or "ratelimit" in res.text.lower():
            return AgentResult.unavailable("duckduckgo", "DuckDuckGo rate limit reached. Please wait and try again.")
        items: list[AgentItem] = []
        for e in (res.json().get("results") or []):
            if not isinstance(e, dict):
                continue
            if kind == IMAGES:
                url = _https(_first(e, "image", "thumbnail"))
                item = AgentItem(title=_first(e, "title") or f"{topic} {subject} educational image", url=url,
                                 source=_blank(_first(e, "source")) or "DuckDuckGo",
                                 thumbnail=_blank(_https(_first(e, "thumbnail"))) or url,
                                 width=_int(e, "width") or 300, height=_int(e, "height") or 200) if url else None
            elif kind == VIDEOS:
                url = _https(_first(e, "content", "url"))
                vid = _youtube_id(url)
                item = AgentItem(title=_blank(_first(e, "title")) or "Educational Video", url=url,
                                 snippet=_blank(_first(e, "description")),
                                 source=_blank(_first(e, "publisher", "uploader")) or "Unknown source",
                                 date=_blank(_first(e, "published")),
                                 thumbnail=f"https://img.youtube.com/vi/{vid}/hqdefault.jpg" if vid else
                                 _blank(_https(_first(e.get("images") or {}, "medium"))), videoId=vid) if url else None
            else:
                url = _https(_first(e, "url"))
                date = None
                if isinstance(e.get("date"), int):
                    date = datetime.fromtimestamp(e["date"], tz=timezone.utc).strftime("%Y-%m-%d")
                item = AgentItem(title=_blank(_first(e, "title")) or "Article", url=url,
                                 snippet=_blank(_first(e, "excerpt", "body")),
                                 source=_blank(_first(e, "source")) or _source_from_url(url), date=date,
                                 thumbnail=_blank(_https(_first(e, "image")))) if url else None
            if item:
                items.append(item)
            if len(items) >= max_n:
                break
        return AgentResult.ok("duckduckgo", items)


# ─────────────────────────────────────────────────────────────── SerpAPI readers
def _serp_document(e: dict) -> AgentItem | None:
    url, title = _https(_first(e, "link")), _first(e, "title")
    if not url or not title:
        return None
    m = re.search(r"\.(pdf|docx?|pptx?|odt)(\?|#|$)", url, re.I)
    official = any(h in url.lower() for h in ("ncert.nic.in", "ncert.gov.in", "epathshala", "diksha.gov.in"))
    if not m and not official:
        return None
    ext = m.group(1).upper() if m else "WEB"
    return AgentItem(title=title, url=url, snippet=_blank(_first(e, "snippet")),
                     source=f"{ext} · {_source_from_url(url)}".strip(" ·"), date=_blank(_first(e, "date")))


def _serp_news(e: dict) -> AgentItem | None:
    url, title = _https(_first(e, "link")), _first(e, "title")
    if not url or not title:
        return None
    src = e.get("source")
    source = _first(src, "name") if isinstance(src, dict) else _first(e, "source")
    iso = _first(e, "iso_date")
    return AgentItem(title=title, url=url, snippet=_blank(_first(e, "snippet")),
                     source=_blank(source) or _source_from_url(url),
                     date=_blank(iso[:10] if len(iso) >= 10 else _first(e, "date")),
                     thumbnail=_blank(_https(_first(e, "thumbnail", "thumbnail_small"))))


def _serp_image(e: dict) -> AgentItem | None:
    full = _https(_first(e, "original", "thumbnail"))
    if not full:
        return None
    return AgentItem(title=_blank(_first(e, "title")) or "Image", url=full, source=_blank(_first(e, "source")),
                     thumbnail=_blank(_https(_first(e, "thumbnail"))) or full,
                     width=_int(e, "original_width"), height=_int(e, "original_height"))


def _serp_video(e: dict) -> AgentItem | None:
    url = _https(_first(e, "link"))
    if not url:
        return None
    vid = _blank(_first(e, "video_id")) or _youtube_id(url)
    ch = e.get("channel")
    channel = _first(ch, "name") if isinstance(ch, dict) else ""
    th = e.get("thumbnail")
    thumb = _first(th, "static") if isinstance(th, dict) else _first(e, "thumbnail")
    length, pub = _first(e, "length"), _first(e, "published_date")
    return AgentItem(title=_blank(_first(e, "title")) or "Educational Video", url=url,
                     snippet=_blank(_first(e, "description")), source=_blank(channel) or "YouTube",
                     date=_blank(f"{pub} · {length}".strip(" ·") if length else pub),
                     thumbnail=_blank(_https(thumb)) or (f"https://img.youtube.com/vi/{vid}/hqdefault.jpg" if vid else None),
                     videoId=vid)


# ─────────────────────────────────────────────────────────────── the four blocks, in parallel
AGENT_BLOCKS = (("currentAffairs", CURRENT_AFFAIRS, 5), ("educationalVideos", VIDEOS, 6),
                ("images", IMAGES, 5), ("educationalDocuments", DOCUMENTS, 6))


def run_all(grade: str, subject: str, topic: str) -> tuple[dict, dict]:
    """Run the four agents in parallel. Returns (content_by_key, status_by_key). Never raises."""
    agents = SessionContentAgents()
    budget = max(2, min(120, agents.s.session_agents_timeout_seconds)) + 5
    content: dict = {}
    status: dict = {}
    pool = ThreadPoolExecutor(max_workers=len(AGENT_BLOCKS), thread_name_prefix="session-agent")
    try:
        futures = {key: pool.submit(agents.run, kind, grade, subject, topic, take) for key, kind, take in AGENT_BLOCKS}
        started = time.monotonic()
        for key, kind, _ in AGENT_BLOCKS:
            try:
                res = futures[key].result(timeout=max(0.1, budget - (time.monotonic() - started)))
            except FutureTimeout:
                res = AgentResult.unavailable("timeout", f"The {LABEL[kind]} search did not respond in time.")
            except Exception as e:  # noqa: BLE001
                res = AgentResult.unavailable("none", str(e))
            content[key] = res.items_list()
            status[key] = res.status_dict()
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return content, status


def json_dump(v: object) -> str:
    return json.dumps(v, ensure_ascii=False)
