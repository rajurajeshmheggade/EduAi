"""AI Classroom's chapter-library reader: answers questions about, and explains, the PDF page a student currently
has open (backend/nlp/<class>/<subject>/<chapter>/*.pdf). Same LLM pattern as the Virtual Lab assistant
(`services/virtual_labs/worksheet.assist`) — a direct chat call grounded in the page's extracted text, not a
vectorised RAG pipeline (these are ad-hoc chapter PDFs, not indexed textbooks)."""
from __future__ import annotations

import logging

from ..providers import get_tutor_llm

log = logging.getLogger("eduai.ai_classroom")

MAX_PAGE_CHARS = 6000

ASK_SYSTEM = """You are a patient AI classroom tutor helping a student in Class {grade}, studying "{chapter}" ({subject}).
The student is on page {page} of the chapter PDF right now. Its text (for context only — do not just repeat it back):

{page_text}

Answer the student's question using this page (and ordinary subject knowledge if the page doesn't cover it). Keep the
answer short, clear and age-appropriate. If the question is unrelated to this subject, gently redirect them to it."""

EXPLAIN_SYSTEM = """You are an AI classroom tutor. Explain page {page} of "{chapter}" ({subject}) to a Class {grade}
student in 3-5 short, simple sentences, as if reading over their shoulder. Call out the key idea(s) on this page.
Page text:

{page_text}"""


def _offline(reason: str) -> tuple[str, str]:
    return reason, "offline"


def ask(*, class_label: str, subject: str, chapter: str, grade: int | None, page: int, page_text: str,
        question: str, history: list[dict]) -> tuple[str, str]:
    llm = get_tutor_llm()
    if llm.name.startswith("mock"):
        return _offline("The AI classroom assistant is not switched on for this school yet. Meanwhile, re-read this "
                        "page carefully and note down any words or ideas you don't recognise.")
    system = ASK_SYSTEM.format(grade=grade or class_label, chapter=chapter, subject=subject, page=page, page_text=page_text[:MAX_PAGE_CHARS])
    msgs = [{"role": m["role"], "content": m["content"][:1500]} for m in history[-6:] if m.get("role") in ("user", "assistant")]
    msgs.append({"role": "user", "content": question})
    try:
        return llm.chat(system, msgs, temperature=0.4).strip()[:2000], llm.name
    except Exception as e:  # noqa: BLE001
        log.warning("ai classroom ask failed for %s/%s/%s p%s: %s", class_label, subject, chapter, page, type(e).__name__)
        return "Sorry, the AI classroom assistant could not answer just now. Please try again in a moment.", "offline-fallback"


def explain(*, class_label: str, subject: str, chapter: str, grade: int | None, page: int, page_text: str) -> tuple[str, str]:
    llm = get_tutor_llm()
    if not page_text.strip():
        return _offline("This page has no readable text to explain.")
    if llm.name.startswith("mock"):
        return _offline(page_text.strip()[:400] or "This page has no readable text to explain.")
    system = EXPLAIN_SYSTEM.format(grade=grade or class_label, chapter=chapter, subject=subject, page=page, page_text=page_text[:MAX_PAGE_CHARS])
    try:
        return llm.chat(system, [{"role": "user", "content": "Explain this page."}], temperature=0.3).strip()[:1500], llm.name
    except Exception as e:  # noqa: BLE001
        log.warning("ai classroom explain failed for %s/%s/%s p%s: %s", class_label, subject, chapter, page, type(e).__name__)
        return "Sorry, the AI could not explain this page just now. Please try again in a moment.", "offline-fallback"
