"""Question paper and answer key → A4 PDF (a real file, generated on the server).

Rendered with MuPDF's HTML layout engine (PyMuPDF Story), which shapes complex scripts with HarfBuzz, so Hindi,
Kannada and Tamil papers come out with correct conjuncts and vowel signs (reportlab cannot shape Indic scripts). The
fonts are bundled (app/assets/fonts, SIL OFL: Noto Serif + Noto Serif Devanagari / Kannada / Tamil), so the output
is identical on Windows and Linux. Equations are printed from their LaTeX as text with super/subscripts and Unicode
symbols (richtext.latex_to_html); images (question diagrams, school logo) are embedded. Two layout passes: the first
counts the pages, the second draws every page with its "Page n of N" footer.
"""
from __future__ import annotations

import html
import io
import struct
from pathlib import Path

import pymupdf as fitz

from . import richtext, store
from .paper import (ALPHA, ROMAN, answer_key, ar_groups, duration_text, fmt_marks, labels, match_columns,
                    ordering_display, render_blanks, sections_with_items, sub_label, total_marks)
from .schema import COMPOSITE, blanks_of

FONTS = Path(__file__).resolve().parents[2] / "assets" / "fonts"
A4 = fitz.paper_rect("a4")
MARGIN = (48, 46, 48, 58)   # left, top, right, bottom (points)

CSS = """
@font-face { font-family: paper; src: url(NotoSerif-Regular.ttf); }
@font-face { font-family: paper; src: url(NotoSerif-Bold.ttf); font-weight: bold; }
@font-face { font-family: paper; src: url(NotoSerif-Italic.ttf); font-style: italic; }
@font-face { font-family: deva; src: url(NotoSerifDevanagari-Regular.ttf); }
@font-face { font-family: deva; src: url(NotoSerifDevanagari-Bold.ttf); font-weight: bold; }
@font-face { font-family: knda; src: url(NotoSerifKannada-Regular.ttf); }
@font-face { font-family: knda; src: url(NotoSerifKannada-Bold.ttf); font-weight: bold; }
@font-face { font-family: taml; src: url(NotoSerifTamil-Regular.ttf); }
@font-face { font-family: taml; src: url(NotoSerifTamil-Bold.ttf); font-weight: bold; }
body { font-family: paper, deva, knda, taml; font-size: 10.5pt; line-height: 1.35; color: #111; }
p { margin: 0 0 3pt 0; }
.inst { text-align: center; font-size: 15pt; font-weight: bold; margin: 0; }
.exam { text-align: center; font-size: 12.5pt; font-weight: bold; margin: 2pt 0 0 0; }
.kind { text-align: center; font-size: 10.5pt; font-weight: bold; color: #444; margin: 2pt 0 0 0; }
table { border-collapse: collapse; width: 100%; }
td { vertical-align: top; padding: 1pt 2pt; }
.meta td { font-size: 10pt; padding: 1pt 0; }
.rule { border-bottom: 1pt solid #222; margin: 4pt 0 6pt 0; }
.gi { font-size: 9.8pt; margin: 0 0 6pt 0; }
.gi-title { font-weight: bold; margin: 0 0 2pt 0; }
.sec { text-align: center; font-weight: bold; font-size: 11.5pt; margin: 8pt 0 1pt 0; }
.sec-i { text-align: center; font-style: italic; font-size: 9.5pt; margin: 0 0 4pt 0; color: #333; }
.qn { width: 30pt; font-weight: bold; }
.qm { width: 46pt; text-align: right; font-size: 9.5pt; color: #222; white-space: nowrap; }
.q { margin: 0 0 7pt 0; }
.opt td { padding: 0 6pt 1pt 0; }
.box { border: 0.8pt solid #555; padding: 4pt 6pt; margin: 2pt 0 4pt 0; }
.directions { font-size: 9.8pt; margin: 4pt 0 2pt 0; }
.codes td { font-size: 9.6pt; padding: 0 2pt; }
.match td { border: 0.6pt solid #888; padding: 2pt 4pt; }
.match th { border: 0.6pt solid #888; padding: 2pt 4pt; font-weight: bold; text-align: left; }
.key { color: #0b5d3b; }
.k-label { font-weight: bold; }
.small { font-size: 9pt; color: #444; }
.eq { font-style: italic; }
.fig { text-align: center; margin: 3pt 0; }
.cap { text-align: center; font-size: 9pt; color: #444; }
"""


def _e(s: str | None) -> str:
    return html.escape(s or "", quote=False)


def _rt(value: str | None) -> str:
    return richtext.to_print_html(value)


def _png_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) > 24:
        return struct.unpack(">II", data[16:24])
    return None


class _Media:
    """Images referenced by the paper, loaded from storage into the layout archive."""

    def __init__(self, org: str) -> None:
        self.org, self.files, self.sizes = org, {}, {}

    def img(self, media_id: str, max_w: float = 300, max_h: float = 220) -> str:
        name = f"m-{media_id}"
        if name not in self.files:
            got = store.media_bytes(self.org, media_id)
            if not got:
                return ""
            data, row = got
            name += ".png" if row["content_type"] == "image/png" else ".jpg"
            self.files[name], self.sizes[name] = data, (row["width"], row["height"])
        else:
            name = next(n for n in self.files if n.startswith(name))
        w, h = self.sizes[name]
        scale = min(1.0, max_w / max(w, 1), max_h / max(h, 1))
        return f'<img src="{name}" width="{int(w * scale)}" height="{int(h * scale)}"/>'


# ════════════════════════════════════════════════════════════ question body (paper)
def _options_html(texts: list[str], layout: str) -> str:
    cells = [f"({ALPHA[i]}) {t}" for i, t in enumerate(texts)]
    cols = {"two": 2, "four": 4}.get(layout, 1)
    if cols == 1:
        return "".join(f"<p>{c}</p>" for c in cells)
    rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
    width = 100 // cols
    return '<table class="opt">' + "".join(
        "<tr>" + "".join(f'<td width="{width}%">{c}</td>' for c in r) + "</tr>" for r in rows) + "</table>"


def _body(q: dict, L: dict, media: _Media) -> str:
    t, d = q["type"], q["data"]
    parts = []
    text = render_blanks(q["text"]) if t == "FILL_BLANK" else q["text"]
    if t != "ASSERTION_REASON":
        parts.append(f"<p>{_rt(text)}</p>")
    for m in q.get("media") or []:
        im = media.img(str(m["media_id"]))
        if im:
            parts.append(f'<div class="fig">{im}</div>' + (f'<p class="cap">{_e(m.get("caption"))}</p>' if m.get("caption") else ""))
    if t == "MCQ":
        parts.append(_options_html([_rt(o["text"]) for o in d["options"]], d.get("layout", "list")))
    elif t == "MRQ":
        parts.append(_options_html([_rt(o["text"]) for o in d["options"]], "list"))
    elif t == "TRUE_FALSE":
        parts += [f"<p>({ROMAN[i]}) {_rt(s['text'])}</p>" for i, s in enumerate(d["statements"])]
    elif t == "FILL_BLANK" and d.get("word_bank"):
        words = sorted({*blanks_of(q["text"]), *(d.get("distractors") or [])}, key=str.lower)
        parts.append(f'<div class="box"><span class="k-label">{_e(L["word_bank"])}:</span> {" · ".join(_e(w) for w in words)}</div>')
    elif t == "MATCH":
        left, right = match_columns(q)
        rows = "".join(f"<tr><td><p>{i + 1}. {_rt(p['left'])}</p></td><td><p>({lt}) {_rt(r['right'])}</p></td></tr>"
                       for i, (p, (lt, r)) in enumerate(zip(left, right)))
        parts.append(f'<table class="match"><tr><th width="38%">{_e(d.get("left_title") or L["column1"])}</th>'
                     f'<th>{_e(d.get("right_title") or L["column2"])}</th></tr>{rows}</table>')
    elif t == "ASSERTION_REASON":
        parts.append(f"<p><b>{_e(L['assertion'])}:</b> {_rt(d['assertion'])}</p>")
        parts.append(f"<p><b>{_e(L['reason'])}:</b> {_rt(d['reason'])}</p>")
    elif t == "ORDERING":
        parts += [f"<p>({lt}) {_rt(it['text'])}</p>" for lt, it in ordering_display(q)]
    return "".join(parts)


def _marks_cell(m: float, L: dict, show: bool) -> str:
    return f'<td class="qm">[{fmt_marks(m)}]</td>' if show else '<td class="qm"></td>'


def _question_html(number: str, q: dict, L: dict, media: _Media, show_marks: bool) -> str:
    if q["type"] in COMPOSITE:
        d = q["data"]
        subs = "".join(
            f'<table><tr><td class="qn">{sub_label(i, d.get("numbering", "alpha"))}</td><td>{_body(s, L, media)}</td>'
            f'{_marks_cell(s["marks"], L, show_marks)}</tr></table>' for i, s in enumerate(d["sub_questions"]))
        title = f"<p><b>{_e(d.get('passage_title'))}</b></p>" if d.get("passage_title") else ""
        figs = "".join(f'<div class="fig">{media.img(str(m["media_id"]))}</div>' for m in q.get("media") or [])
        inner = f"<p>{_rt(q['text'])}</p>{title}<div class=\"box\">{_rt(d['passage'])}</div>{figs}{subs}"
        return (f'<table class="q"><tr><td class="qn">{number}.</td><td>{inner}</td>'
                f'{_marks_cell(q["marks"], L, show_marks)}</tr></table>')
    return (f'<table class="q"><tr><td class="qn">{number}.</td><td>{_body(q, L, media)}</td>'
            f'{_marks_cell(q["marks"], L, show_marks)}</tr></table>')


# ════════════════════════════════════════════════════════════ answer key
def _key_lines(q: dict, ar_codes: list[str], lang: str) -> str:
    return "".join(f'<p class="key">{"<span class=k-label>" + _e(lab) + ":</span> " if lab else ""}{val}</p>'
                   for lab, val in answer_key(q, ar_codes, lang))


def _key_html(number: str, q: dict, L: dict, ar_codes: list[str], lang: str) -> str:
    stem = richtext.plain(render_blanks(q["text"]) if q["type"] == "FILL_BLANK" else
                          q["data"]["assertion"] if q["type"] == "ASSERTION_REASON" else q["text"], math="text")
    stem = stem if len(stem) <= 160 else stem[:160].rsplit(" ", 1)[0] + " …"
    if q["type"] in COMPOSITE:
        d = q["data"]
        body = "".join(
            f'<table><tr><td class="qn">{sub_label(i, d.get("numbering", "alpha"))}</td><td>'
            f'<p class="small">{_e(richtext.plain(s["text"], math="text")[:140])}</p>{_key_lines(s, ar_codes, lang)}</td>'
            f'<td class="qm">[{fmt_marks(s["marks"])}]</td></tr></table>' for i, s in enumerate(d["sub_questions"]))
        if q.get("explanation"):
            body += f'<p class="key"><span class="k-label">{_e(L["explanation"])}:</span> {_rt(q["explanation"])}</p>'
    else:
        body = _key_lines(q, ar_codes, lang)
    return (f'<table class="q"><tr><td class="qn">{number}.</td><td><p class="small">{_e(stem)}</p>{body}</td>'
            f'<td class="qm">[{fmt_marks(q["marks"])}]</td></tr></table>')


# ════════════════════════════════════════════════════════════ document
def _header_html(paper: dict, L: dict, media: _Media, answer_key_mode: bool) -> str:
    h = paper.get("header") or {}
    inst = h.get("institution_name") or paper.get("institution_name") or ""
    logo = media.img(str(h["logo_media_id"]), 72, 64) if h.get("logo_media_id") else ""
    title = h.get("exam_title") or paper.get("title") or ""
    top = (f'<table><tr><td width="80">{logo}</td><td><p class="inst">{_e(inst)}</p><p class="exam">{_e(title)}</p>'
           + (f'<p class="kind">{_e(L["answer_key"])}</p>' if answer_key_mode else "") + '</td><td width="80"></td></tr></table>'
           if logo else f'<p class="inst">{_e(inst)}</p><p class="exam">{_e(title)}</p>'
           + (f'<p class="kind">{_e(L["answer_key"])}</p>' if answer_key_mode else ""))
    left = [(L["class"], paper.get("class_name") or ""), (L["subject"], paper.get("subject_name") or "")]
    if h.get("academic_year"):
        left.append((L["year"], h["academic_year"]))
    right = []
    if h.get("duration_minutes"):
        right.append((L["time"], duration_text(h["duration_minutes"], paper.get("language", "en"))))
    right.append((L["max_marks"], fmt_marks(total_marks(paper))))
    if h.get("exam_date"):
        right.append((L["date"], h["exam_date"]))
    n = max(len(left), len(right))
    rows = "".join(
        "<tr>" + (f"<td><p><b>{_e(left[i][0])}:</b> {_e(left[i][1])}</p></td>" if i < len(left) else "<td></td>")
        + (f'<td><p style="text-align:right"><b>{_e(right[i][0])}:</b> {_e(right[i][1])}</p></td>' if i < len(right) else "<td></td>")
        + "</tr>" for i in range(n))
    roll = ""
    if h.get("show_roll_no", True) and not answer_key_mode:
        roll = (f'<table class="meta"><tr><td><p><b>{_e(L["name"])}:</b> ______________________________</p></td>'
                f'<td><p style="text-align:right"><b>{_e(L["roll"])}:</b> ______________</p></td></tr></table>')
    gi = ""
    if h.get("general_instructions") and not answer_key_mode:
        gi = (f'<div class="gi"><p class="gi-title">{_e(L["instructions"])}:</p>'
              + "".join(f"<p>{i + 1}. {_e(x)}</p>" for i, x in enumerate(h["general_instructions"])) + "</div>")
    return f'{top}<table class="meta">{rows}</table>{roll}<div class="rule"></div>{gi}'


def build_html(paper: dict, ar: dict, *, answer_key_mode: bool, media: _Media) -> str:
    lang = paper.get("language") or "en"
    L = labels(lang)
    show_marks = (paper.get("header") or {}).get("show_marks", True)
    out = [_header_html(paper, L, media, answer_key_mode)]
    for group in sections_with_items(paper):
        s = group["section"]
        if s.get("title"):
            out.append(f'<p class="sec">{_e(s["title"])}</p>')
        if s.get("instructions") and not answer_key_mode:
            out.append(f'<p class="sec-i">{_e(s["instructions"])}</p>')
        for is_ar, rows in ar_groups(group["items"]):
            if is_ar and not answer_key_mode:
                codes = "".join(f"<tr><td width=\"22\">({c})</td><td>{_e(t)}</td></tr>" for c, t in zip("ABCD", ar["ar_codes"]))
                nums = f"{rows[0]['number']}–{rows[-1]['number']}" if len(rows) > 1 else str(rows[0]["number"])
                out.append(f'<p class="directions"><b>{_e(L["q"])} {nums}:</b> {_e(ar["ar_instruction"])}</p>'
                           f'<table class="codes">{codes}</table>')
            for r in rows:
                q = r["item"]["question"]
                out.append(_key_html(str(r["number"]), q, L, ar["ar_codes"], lang) if answer_key_mode
                           else _question_html(str(r["number"]), q, L, media, show_marks))
    return "".join(out)


def _footer_html(L: dict, n: int, total: int, draft: bool) -> str:
    text = L["page"].format(n=n, N=total)
    note = f" · {L['draft']}" if draft else ""
    return f'<p style="text-align:center;font-size:8.5pt;color:#555">{_e(text + note)}</p>'


def render(paper: dict, ar: dict, *, answer_key_mode: bool = False) -> bytes:
    media = _Media(paper["org_code"])
    body = build_html(paper, ar, answer_key_mode=answer_key_mode, media=media)
    L = labels(paper.get("language") or "en")
    draft = paper.get("status") != "PUBLISHED"

    def archive() -> fitz.Archive:
        arch = fitz.Archive(str(FONTS))
        if media.files:
            arch.add([(data, name) for name, data in media.files.items()])
        return arch

    content = fitz.Rect(MARGIN[0], MARGIN[1], A4.width - MARGIN[2], A4.height - MARGIN[3])
    footer = fitz.Rect(MARGIN[0], A4.height - MARGIN[3] + 14, A4.width - MARGIN[2], A4.height - 12)

    def layout(total: int | None) -> tuple[bytes, int]:
        buf = io.BytesIO()
        writer = fitz.DocumentWriter(buf)
        story = fitz.Story(html=body, user_css=CSS, archive=archive())
        pages, more = 0, 1
        while more:
            pages += 1
            dev = writer.begin_page(A4)
            more, _ = story.place(content)
            story.draw(dev)
            if total is not None:
                f = fitz.Story(html=_footer_html(L, pages, total, draft), user_css=CSS, archive=archive())
                f.place(footer)
                f.draw(dev)
            writer.end_page()
            if pages > 300:
                break
        writer.close()
        return buf.getvalue(), pages

    _, n_pages = layout(None)
    data, _ = layout(n_pages)
    doc = fitz.open(stream=data, filetype="pdf")
    title = (paper.get("header") or {}).get("exam_title") or paper.get("title") or "Question paper"
    doc.set_metadata({"title": f"{title} — {L['answer_key']}" if answer_key_mode else title,
                      "subject": f"{paper.get('class_name', '')} · {paper.get('subject_name', '')}",
                      "creator": "EduAI Question Generator", "producer": "EduAI"})
    try:
        doc.subset_fonts()   # embed only the glyphs used (the bundled fonts are ~0.5 MB each)
    except Exception:  # noqa: BLE001 — a full font is still a correct PDF
        pass
    out = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    return out
