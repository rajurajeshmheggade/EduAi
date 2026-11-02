"""Question-paper layout rules shared by the PDF export and publishing: sections, numbering, Assertion–Reason
grouping, option / column labels and the answer key. The frontend mirrors these (lib/questionGen/paper.ts) for the
preview, Word export and print, so all outputs number and label a paper the same way."""
from __future__ import annotations

import html

from . import richtext
from .schema import COMPOSITE, blanks_of

ALPHA = "abcdefghijklmnopqrstuvwxyz"
ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"]

# Paper chrome in the app's languages (questions themselves are written in the paper's language by the teacher / AI).
LABELS = {
    "en": {"time": "Time", "max_marks": "Maximum Marks", "class": "Class", "subject": "Subject",
           "year": "Academic Year", "date": "Date", "instructions": "General Instructions", "section": "Section",
           "answer_key": "ANSWER KEY", "marks": "marks", "mark": "mark", "page": "Page {n} of {N}", "minutes": "minutes",
           "hour": "hour", "hours": "hours", "answer": "Answer", "explanation": "Explanation", "roll": "Roll No.", "name": "Name",
           "column1": "Column I", "column2": "Column II", "assertion": "Assertion (A)", "reason": "Reason (R)",
           "word_bank": "Word bank", "draft": "DRAFT", "true": "True", "false": "False", "total": "Total",
           "key_points": "Key points", "marking": "Marking scheme", "unit": "Unit", "tolerance": "Tolerance",
           "diagram": "Diagram", "order": "Correct order", "q": "Q."},
    "hi": {"time": "समय", "max_marks": "अधिकतम अंक", "class": "कक्षा", "subject": "विषय", "year": "शैक्षणिक वर्ष",
           "date": "दिनांक", "instructions": "सामान्य निर्देश", "section": "खंड", "answer_key": "उत्तर कुंजी",
           "marks": "अंक", "mark": "अंक", "page": "पृष्ठ {n} / {N}", "minutes": "मिनट", "hour": "घंटा", "hours": "घंटे",
           "answer": "उत्तर", "explanation": "व्याख्या", "roll": "अनुक्रमांक", "name": "नाम", "column1": "स्तंभ I",
           "column2": "स्तंभ II", "assertion": "अभिकथन (A)", "reason": "कारण (R)", "word_bank": "शब्द बैंक",
           "draft": "प्रारूप", "true": "सत्य", "false": "असत्य", "total": "कुल", "key_points": "मुख्य बिंदु",
           "marking": "अंक योजना", "unit": "इकाई", "tolerance": "सहनशीलता", "diagram": "चित्र",
           "order": "सही क्रम", "q": "प्र."},
    "kn": {"time": "ಸಮಯ", "max_marks": "ಗರಿಷ್ಠ ಅಂಕಗಳು", "class": "ತರಗತಿ", "subject": "ವಿಷಯ",
           "year": "ಶೈಕ್ಷಣಿಕ ವರ್ಷ", "date": "ದಿನಾಂಕ", "instructions": "ಸಾಮಾನ್ಯ ಸೂಚನೆಗಳು", "section": "ವಿಭಾಗ",
           "answer_key": "ಉತ್ತರ ಸೂಚಿ", "marks": "ಅಂಕಗಳು", "mark": "ಅಂಕ", "page": "ಪುಟ {n} / {N}",
           "minutes": "ನಿಮಿಷಗಳು", "hour": "ಗಂಟೆ", "hours": "ಗಂಟೆಗಳು", "answer": "ಉತ್ತರ", "explanation": "ವಿವರಣೆ",
           "roll": "ನೋಂದಣಿ ಸಂಖ್ಯೆ", "name": "ಹೆಸರು", "column1": "ಕಾಲಂ I", "column2": "ಕಾಲಂ II",
           "assertion": "ಪ್ರತಿಪಾದನೆ (A)", "reason": "ಕಾರಣ (R)", "word_bank": "ಪದ ಬ್ಯಾಂಕ್", "draft": "ಕರಡು",
           "true": "ಸರಿ", "false": "ತಪ್ಪು", "total": "ಒಟ್ಟು", "key_points": "ಮುಖ್ಯ ಅಂಶಗಳು",
           "marking": "ಅಂಕ ಯೋಜನೆ", "unit": "ಘಟಕ", "tolerance": "ಸಹಿಷ್ಣುತೆ", "diagram": "ಚಿತ್ರ",
           "order": "ಸರಿಯಾದ ಕ್ರಮ", "q": "ಪ್ರ."},
    "ta": {"time": "நேரம்", "max_marks": "அதிகபட்ச மதிப்பெண்கள்", "class": "வகுப்பு", "subject": "பாடம்",
           "year": "கல்வி ஆண்டு", "date": "தேதி", "instructions": "பொது அறிவுரைகள்", "section": "பிரிவு",
           "answer_key": "விடைக் குறிப்பு", "marks": "மதிப்பெண்கள்", "mark": "மதிப்பெண்",
           "page": "பக்கம் {n} / {N}", "minutes": "நிமிடங்கள்", "hour": "மணி நேரம்", "hours": "மணி நேரம்", "answer": "விடை",
           "explanation": "விளக்கம்", "roll": "பதிவு எண்", "name": "பெயர்", "column1": "நெடுவரிசை I",
           "column2": "நெடுவரிசை II", "assertion": "கூற்று (A)", "reason": "காரணம் (R)", "word_bank": "சொல் வங்கி",
           "draft": "வரைவு", "true": "சரி", "false": "தவறு", "total": "மொத்தம்", "key_points": "முக்கியக் குறிப்புகள்",
           "marking": "மதிப்பீட்டுத் திட்டம்", "unit": "அலகு", "tolerance": "சகிப்புத்தன்மை", "diagram": "படம்",
           "order": "சரியான வரிசை", "q": "வி."},
}


def labels(lang: str) -> dict:
    return LABELS.get(lang) or LABELS["en"]


def sub_label(i: int, numbering: str) -> str:
    return f"({ROMAN[i] if numbering == 'roman' and i < len(ROMAN) else ALPHA[i % 26]})"


def fmt_marks(m: float) -> str:
    return f"{m:g}"


def duration_text(minutes: int | None, lang: str) -> str:
    if not minutes:
        return ""
    L = labels(lang)
    h, m = divmod(int(minutes), 60)
    hours = f"{h} {L['hour'] if h == 1 else L['hours']}"
    if h and m:
        return f"{hours} {m} {L['minutes']}"
    return hours if h else f"{m} {L['minutes']}"


def sections_with_items(paper: dict) -> list[dict]:
    """[{section, items: [{number, item}]}] — numbering runs continuously across sections; items whose section no
    longer exists go to the first section; empty sections are dropped."""
    sections = paper.get("sections") or [{"id": "A", "title": "", "instructions": ""}]
    ids = [s["id"] for s in sections]
    groups: dict[str, list[dict]] = {i: [] for i in ids}
    for it in paper.get("items") or []:
        groups[it.get("section_id") if it.get("section_id") in groups else ids[0]].append(it)
    out, n = [], 0
    for s in sections:
        rows = []
        for it in groups[s["id"]]:
            n += 1
            rows.append({"number": n, "item": it})
        if rows:
            out.append({"section": s, "items": rows})
    return out


def ar_groups(rows: list[dict]) -> list[tuple[bool, list[dict]]]:
    """Consecutive Assertion–Reason questions are printed under one directions heading: [(is_ar_group, rows)]."""
    out: list[tuple[bool, list[dict]]] = []
    for r in rows:
        is_ar = r["item"]["question"]["type"] == "ASSERTION_REASON"
        if out and out[-1][0] and is_ar:
            out[-1][1].append(r)
        else:
            out.append((is_ar, [r]))
    return out


def total_marks(paper: dict) -> float:
    return round(sum(float(i["question"]["marks"]) for i in paper.get("items") or []), 2)


def render_blanks(text_html: str) -> str:
    """[answer] markers → a printed blank line."""
    import re
    return re.sub(r"\[[^\[\]\n]{1,100}\]", "__________", text_html or "")


def match_columns(q: dict) -> tuple[list[dict], list[tuple[str, dict]]]:
    """(Column I pairs in order, Column II as [(letter, pair)] in the printed shuffled order)."""
    d = q["data"]
    by_id = {p["id"]: p for p in d["pairs"]}
    right = [by_id[i] for i in d.get("right_order") or [] if i in by_id] or list(d["pairs"])
    return d["pairs"], [(ALPHA[i], p) for i, p in enumerate(right)]


def ordering_display(q: dict) -> list[tuple[str, dict]]:
    d = q["data"]
    by_id = {i["id"]: i for i in d["items"]}
    shown = [by_id[i] for i in d.get("display_order") or [] if i in by_id] or list(d["items"])
    return [(chr(65 + k), it) for k, it in enumerate(shown)]


def answer_key(q: dict, ar_codes: list[str], lang: str = "en") -> list[tuple[str, str]]:
    """[(label, html)] lines of the answer key for one question (sub-questions handled by the caller)."""
    L, d, t = labels(lang), q["data"], q["type"]
    rt = richtext.to_print_html
    out: list[tuple[str, str]] = []
    if t == "MCQ":
        i = next((k for k, o in enumerate(d["options"]) if o["id"] == d["correct"]), 0)
        out.append((L["answer"], f"({ALPHA[i]}) {rt(d['options'][i]['text'])}"))
    elif t == "MRQ":
        out.append((L["answer"], "; ".join(f"({ALPHA[k]}) {rt(o['text'])}" for k, o in enumerate(d["options"]) if o["correct"])))
    elif t == "TRUE_FALSE":
        out.append((L["answer"], "; ".join(f"({ROMAN[k]}) {L['true'] if s['answer'] else L['false']}"
                                          for k, s in enumerate(d["statements"]))))
    elif t == "FILL_BLANK":
        parts = []
        for k, a in enumerate(blanks_of(q["text"])):
            rule = d["blanks"][k] if k < len(d["blanks"]) else {}
            alts = rule.get("alternates") or []
            extra = f" (also: {', '.join(html.escape(x) for x in alts)})" if alts else ""
            cs = " [case-sensitive]" if rule.get("case_sensitive") else ""
            parts.append(f"({k + 1}) {html.escape(a)}{extra}{cs}")
        out.append((L["answer"], "; ".join(parts)))
    elif t == "MATCH":
        left, right = match_columns(q)
        letter = {p["id"]: lt for lt, p in right}
        out.append((L["answer"], ", ".join(f"{k + 1} → ({letter[p['id']]})" for k, p in enumerate(left))))
    elif t == "ONE_WORD":
        alts = d.get("alternates") or []
        out.append((L["answer"], html.escape(d["answer"]) + (f" (also: {', '.join(html.escape(x) for x in alts)})" if alts else "")))
    elif t in ("SHORT_ANSWER", "HOTS"):
        out.append((L["answer"], rt(d["model_answer"])))
        if d.get("key_points"):
            out.append((L["key_points"], "; ".join(html.escape(p) for p in d["key_points"])))
    elif t == "LONG_ANSWER":
        out.append((L["answer"], rt(d["model_answer"])))
        if d.get("marking_points"):
            out.append((L["marking"], "; ".join(f"{html.escape(p['text'])} ({fmt_marks(p['marks'])})" for p in d["marking_points"])))
    elif t == "ESSAY":
        out.append((L["answer"], rt(d["model_answer"])))
        if d.get("rubric"):
            out.append((L["marking"], "; ".join(f"{html.escape(p['text'])} ({fmt_marks(p['marks'])})" for p in d["rubric"])))
    elif t == "ASSERTION_REASON":
        code = d["answer"]
        idx = "ABCD".index(code) if code in "ABCD" else 0
        out.append((L["answer"], f"({code}) {html.escape(ar_codes[idx])}"))
    elif t == "DIAGRAM":
        if d.get("diagram_description"):
            out.append((L["diagram"], html.escape(d["diagram_description"])))
        out.append((L["answer"], rt(d["model_answer"])))
        if d.get("key_points"):
            out.append((L["key_points"], "; ".join(html.escape(p) for p in d["key_points"])))
    elif t == "NUMERICAL":
        tol = f" (± {d['tolerance']:g})" if d.get("tolerance") else ""
        out.append((L["answer"], f"{d['answer']:g} {html.escape(d.get('unit') or '')}{tol}".strip()))
        if d.get("solution"):
            out.append(("", rt(d["solution"])))
    elif t == "ORDERING":
        shown = {it["id"]: lt for lt, it in ordering_display(q)}
        out.append((L["order"], " → ".join(shown.get(i["id"], "?") for i in d["items"])))
    if q.get("explanation"):
        out.append((L["explanation"], rt(q["explanation"])))
    return out


def snapshot(paper: dict) -> dict:
    """What publishing freezes: the paper exactly as it is printed."""
    keep = ("title", "language", "header", "sections", "items", "class_code", "subject_code", "class_name",
            "subject_name", "nlp_class", "nlp_subject", "chapter", "version", "institution_name")
    return {k: paper.get(k) for k in keep} | {"total_marks": total_marks(paper)}


def is_composite(q: dict) -> bool:
    return q["type"] in COMPOSITE
