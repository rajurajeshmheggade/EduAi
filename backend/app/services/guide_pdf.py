"""Export a teaching guide as PDF (FR-T2-04)."""
from __future__ import annotations

import io
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


def guide_to_pdf(guide: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"How to teach: {guide['chapter_title']}")
    st = getSampleStyleSheet()
    out = [
        Paragraph(escape(f"How to Teach: {guide['chapter_title']}"), st["Title"]),
        Paragraph(escape(f"Level: {guide['institution_level']}  |  Duration: {guide['duration_minutes']} min"), st["Normal"]),
        Spacer(1, 6 * mm),
    ]

    def h(t: str) -> None:
        out.extend([Spacer(1, 4 * mm), Paragraph(escape(t), st["Heading2"])])

    def p(t: str, style: str = "BodyText") -> None:
        out.append(Paragraph(escape(str(t)), st[style]))

    for line in guide["lesson_plan_markdown"].splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("#"):
            h(s.lstrip("# ").strip())
        else:
            p(s.replace("**", "").lstrip("-• ").strip() if s.startswith(("-", "•")) else s.replace("**", ""))

    hooks = guide["analogies_and_hooks"] or {}
    h("Opening Hook & Analogy")
    if hooks.get("opening_hook"):
        p(f"Hook: {hooks['opening_hook']}")
    if hooks.get("analogy"):
        p(f"Analogy: {hooks['analogy']}")

    h("Board Work Blueprint")
    for b in guide["board_work_blueprint"] or []:
        p(f"Step {b.get('step', '')}: {b.get('board', '')}")

    h("Common Misconceptions")
    for m in guide["common_misconceptions"] or []:
        p(f"{m.get('misconception', '')} -> {m.get('clarification', '')}")

    h("Formative Check Questions")
    for i, q in enumerate(guide["formative_questions"] or [], 1):
        p(f"{i}. {q.get('question', '')}  (Expected: {q.get('expected_answer', '')})")

    doc.build(out)
    return buf.getvalue()
