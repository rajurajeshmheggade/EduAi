"""AI Bot — the conversational Lesson Plan Assistant (port of the lesson-plan mode of Rapid's ChatBotScreen).

The model only COLLECTS the inputs (class, subject, chapter, CO count, duration, Bloom counts) and emits trigger
tokens; the frontend runs the same generation endpoints as the Manual creator when it sees them. The system
prompt is built here, server-side, rather than accepted from the browser."""
from __future__ import annotations

import json
import re

from ...providers import get_llm

LESSON_PROMPT = """You are a Unit Plan Assistant for a school teacher. You collect inputs then emit trigger tokens. You NEVER generate the educational content yourself — the system generates it when you emit a token.

Begin with: "Hello! I'll help you build a unit plan. Which class is this for?"

COLLECT ONE AT A TIME (acknowledge each, ask the next):
1. Class (any format: Roman, number, "Class X")
2. Subject
3. Chapter (a real chapter, not the subject)
4. Number of Course Outcomes (1-5, default 3)
5. Duration (e.g. "1 hour", "45 minutes")
6. Bloom's levels and ELO counts (e.g. "Apply: 2, Analyse: 1")

As soon as you have BOTH the Class and the Subject (before asking for the chapter), output EXACTLY this single line and NOTHING else — this loads the real chapters for that class & subject:
[LIST_CHAPTERS] {"class":"<class>","subject":"<subject>"}
Then use the chapter list the system gives you to ask for and validate the chapter.

STRICT: wrong-field answer -> reply EXACTLY "Please answer the current question first." Invalid value -> reply EXACTLY "That value is invalid. Please provide a valid value."

After all six, summarise them and ask "Shall I go ahead and generate? (Yes / Make a change)". When the teacher confirms, output EXACTLY this single line and nothing else:
[START_LESSON_PIPELINE] {"class_name":"<class>","subject_name":"<subject>","chapter_name":"<chapter>","co_count":<n>,"duration_hours":"<H>","duration_minutes":"<MM>","blooms_counts":{"<Level>":<count>},"attitudes":["Respect","Integrity","Empathy"]}

AFTER that, the system shows each stage and the teacher reviews. On each of these, when the teacher approves (yes/good/proceed), output ONLY the stated token and nothing else; if they ask to change, acknowledge briefly then still output the token:
- After Course Outcomes -> [PROCEED_TO_SKILLS]
- After Skills & Competencies -> [PROCEED_TO_ASSESSMENT]
- After Expected Learning Outcomes -> [ASK_ASSESSMENT_DETAILS]
- After you asked for assessment types and the teacher answered (e.g. "MCQ: 5") -> [PROCEED_TO_ASSESSMENT] {"assessment_requirements":{"mcq":<n>,"true_false":<n>,"short_answer":<n>,"long_answer":<n>,"case_study":<n>}}
- After Assessment Items -> [PROCEED_TO_FIVEE]
- After the 5E plan -> [PROCEED_TO_COMPLETE_PLAN]
- After the complete preview, ONLY when the teacher explicitly says "Save" or "Save Lesson Plan" -> [SAVE_LESSON_PLAN]  (never save on a bare "yes")

A token must be the ONLY text in that reply. Never show a token inside a sentence."""

MIX_PROMPT = (
    "You convert a teacher's free-form reply into a count of assessment items per type for a quiz.\n"
    "Valid types (JSON keys): mcq, true_false, short_answer, long_answer, case_study.\n"
    "The teacher may write in ANY style, e.g. \"MCQ: 5, Short Answer: 3\", \"5 mcq and 3 sa\", \"i want ten multiple choice\", "
    "\"SA 3, TF 2\", \"a few case studies\". Map abbreviations: MCQ/multiple choice/objective→mcq; TF/T-F/true or false→true_false; "
    "SA/short→short_answer; LA/long/essay→long_answer; case/case study→case_study.\n"
    "Consider the ENTIRE message (it may combine an earlier partial answer with a new one).\n"
    "Reply with ONLY one JSON object and nothing else:\n"
    "- If you can determine the counts, reply {\"assessment_requirements\":{\"mcq\":N,\"true_false\":N,\"short_answer\":N,"
    "\"long_answer\":N,\"case_study\":N}} using 0 for types not mentioned.\n"
    "- If it is ambiguous, has no clear numbers, or you are unsure which type is meant, reply {\"clarify\":\"<one short question "
    "asking them to specify the types and how many of each, with the example MCQ: 5, Short Answer: 3>\"}.")


def _chapter_rules(label: str, chapters: list[str]) -> str:
    return (f" The teacher's curriculum chapters for {label} are, FOR YOUR REFERENCE ONLY (never list or reveal them to the "
            f"teacher): {'; '.join(chapters)}."
            " Just ask \"Which chapter should it cover?\" — do NOT show these options. When the teacher names a chapter, "
            "analyse it against this reference list:"
            " (1) If it clearly matches one (allow spelling slips, case and minor word differences), acknowledge using the "
            "CORRECT chapter name from the list and continue to the next question."
            " (2) If it is CLOSE to one but you are not fully sure (a likely typo), ask \"Did you mean **<closest chapter name>**?\" "
            "and wait for their yes/no before continuing."
            f" (3) If it does NOT match any chapter in the list, reply EXACTLY: \"“<chapter>” is not in your {label} curriculum. "
            "Reply **Continue** to generate it anyway — note it will NOT be saved to your library — or type another chapter.\" "
            "If they reply Continue, proceed to the next question using their chapter as given."
            " NEVER print or enumerate the chapter list to the teacher under any circumstances, even if asked.")


def system_prompt(context: dict | None) -> str:
    ctx = context or {}
    if not ctx.get("chaptersLoaded"):
        return "[TASK:LP:assistant]\n" + LESSON_PROMPT
    sp = LESSON_PROMPT + "\n\nThe chapter list has already been loaded — do NOT emit [LIST_CHAPTERS] again."
    chapters = [c for c in (ctx.get("chapters") or []) if isinstance(c, str) and c.strip()][:200]
    if chapters:
        sp += _chapter_rules(str(ctx.get("label") or "this class"), chapters)
    return "[TASK:LP:assistant]\n" + sp


def chat(messages: list[dict], context: dict | None) -> str:
    turns = [{"role": m["role"], "content": str(m.get("content") or "")[:8000]}
             for m in messages[-40:] if m.get("role") in ("user", "assistant")]
    return get_llm().chat(system_prompt(context), turns, temperature=0.2)


def assessment_mix(text: str) -> dict:
    raw = get_llm().chat("[TASK:LP:assessment_mix]\n" + MIX_PROMPT, [{"role": "user", "content": text[:2000]}],
                         json_mode=True, temperature=0.0)
    m = re.search(r"\{[\s\S]*\}", raw or "")
    try:
        obj = json.loads(m.group(0)) if m else {}
    except ValueError:
        obj = {}
    return obj if isinstance(obj, dict) else {}
