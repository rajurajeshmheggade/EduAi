"""Session Plan content generation — port of Rapid's SessionPlanController.GenerateContentAsync.

The flow is expressed as the eight Resource Categories the UI uses (Opening … Challenge the Students), and each
stage's activity is built AROUND the resources the teacher picked for it. The model is told NOT to emit the
current-affairs / video / image / document blocks — those are spliced in afterwards from the live agents."""
from __future__ import annotations

import html
import logging
import re

from . import ai

log = logging.getLogger("eduai.sessionplan")

STAGES = ["Opening", "Explore the Concept (Stage 1)", "Guided Learning (Stage 2)", "Independent Practice (Stage 3)",
          "Wrap Up", "Extended Activities", "Do It Yourself", "Challenge the Students"]
SETTINGS = ["Individual", "Group", "Whole Class", "Pair"]


def strip_html(h: str | None) -> str:
    if not h or not h.strip():
        return ""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", h))).strip()


def read_stages(node: object) -> list[dict]:
    """Normalise the client's stages payload (unknown / empty rows dropped, numbers clamped)."""
    out: list[dict] = []
    for i, s in enumerate(node if isinstance(node, list) else []):
        if not isinstance(s, dict):
            continue
        name = str(s.get("stage") or "").strip()
        if not name:
            continue
        res = []
        for j, x in enumerate(s.get("resources") if isinstance(s.get("resources"), list) else []):
            if not isinstance(x, dict):
                continue
            t = str(x.get("title") or "").strip()
            if not t:
                continue
            rid = x.get("resourceId")
            res.append({
                "resourceId": str(rid) if rid not in (None, "", 0, "0") else None,
                "sourceKind": str(x.get("sourceKind") or "resource")
                if str(x.get("sourceKind") or "resource") in ("resource", "textbook", "test", "question", "activity") else "resource",
                "title": t, "resourceType": str(x.get("resourceType") or ""), "url": str(x.get("url") or ""),
                "chapterName": str(x.get("chapterName") or x.get("chapter") or ""), "meta": str(x.get("meta") or ""),
                "sortOrder": _int(x.get("sortOrder"), j)})
        setting = str(s.get("classSetting") or "").strip()
        out.append({"stage": name[:100], "sortOrder": _int(s.get("sortOrder"), i),
                    "classSetting": setting if setting in SETTINGS else "",
                    "durationMins": max(0, min(100000, _int(s.get("durationMins"), 0))),
                    "description": str(s.get("description") or ""), "resources": res})
    return out


def _int(v: object, default: int) -> int:
    try:
        return int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def generate_content(plan: dict, title: str, duration: int, instructions: str, elos: list[dict],
                     stages: list[dict]) -> dict:
    cls, subj, chap = plan["class_name"], plan["subject_name"], plan["chapter_name"]
    elo_block = "\n".join(f"{i + 1}. {e['elo']}" + (f"  (Bloom: {e['bloomLevel']})" if e.get("bloomLevel") else "")
                          for i, e in enumerate(elos)) or "(none selected — design the session around the chapter itself)"
    used = [s for s in stages if s["resources"] or strip_html(s["description"])]
    if not used:
        stage_block = "(the teacher picked no resources — produce the stages you judge appropriate, with no resource references)"
    else:
        lines = []
        for s in used:
            res = "; ".join(f'"{x["title"]}" ({x["resourceType"] or "resource"})' for x in s["resources"]) or "no resources picked"
            note = strip_html(s["description"])
            lines.append(f"- {s['stage']} | class setting: {s['classSetting'] or 'teacher' + chr(39) + 's choice'}"
                         f" | {str(s['durationMins']) + ' min' if s['durationMins'] > 0 else 'time as suitable'}"
                         f" | resources to build the activity around: {res}" + (f" | teacher's note: {note}" if note else ""))
        stage_block = "\n".join(lines)
    instr = f'\nTeacher\'s session instructions — you MUST follow these:\n"""\n{instructions}\n"""\n' if instructions.strip() else ""
    prompt = f"""You are a master teacher and expert session designer. Produce ONE classroom-ready session plan as a SINGLE valid JSON object. No markdown, no prose outside the JSON.

Context
- Chapter: {chap}
- Subject: {subj}
- Class/Grade: {cls}
- Session title: {title.strip() or chap}
- Total duration: {str(duration) + " minutes" if duration > 0 else "as suitable"}

Expected Learning Outcomes this session must achieve (these come from the teacher's saved lesson plan — do not invent others, do not reword them):
{elo_block}
{instr}
Session stages the teacher configured, with the resources they picked for each. Build each stage's activity AROUND its listed resources — say concretely how each one is used, in order. Do NOT invent extra resources and do NOT reference a resource in a stage it was not picked for:
{stage_block}

Output ONLY this JSON object:
{{
  "title": "...",
  "overview": "2-3 sentences on what happens in this session and why",
  "metadata": {{ "grade": "{cls}", "subject": "{subj}", "chapter": "{chap}", "duration": "{duration}" }},
  "prerequisiteKnowledge": "what students must already know coming in",
  "specificObjectives": ["measurable objective tied to the outcomes above"],
  "keyVocabulary": [ {{ "term":"...", "definition":"...", "example":"..." }} ],
  "materials": [ {{ "name":"...", "quantity":"As needed", "notes":"how it is used" }} ],
  "stages": [ {{
      "stage": "the stage name exactly as given above",
      "classSetting": "Individual/Pair/Group/Whole Class",
      "durationMins": 10,
      "teacherNotes": "how to run this stage",
      "steps": ["Step 1: …", "Step 2: …"],
      "questions": ["a question to ask the class here"],
      "resources": [ {{ "title":"the picked resource's exact title", "howToUse":"1-2 sentences on exactly how this resource is used in this stage" }} ]
  }} ],
  "assessment": {{ "type":"Formative/Summative", "description":"...", "successCriteria":["..."] }},
  "differentiation": {{ "extensions":"for advanced students", "support":"for struggling students" }},
  "realWorldExamples": [ {{ "example":"a concrete everyday situation a {cls} student would recognise", "explanation":"how it shows this chapter's idea" }} ],
  "discussionQuestions": [ {{ "question":"an open question to put to the class", "purpose":"what it gets students thinking about" }} ],
  "homework": "a short follow-up task, or an empty string"
}}

Rules:
- Output the JSON object only. Ensure it is valid and every string is escaped.
- Give 3-5 "realWorldExamples" drawn from daily life in India that a {cls} student would
  actually recognise — not adult or abstract ones — and 4-6 "discussionQuestions" that are open
  (no yes/no answers) and answerable from the chapter.
- Do NOT include an "additionalSections", "currentAffairs", "educationalVideos", "images" or
  "educationalDocuments" key — those are filled in by the platform after you answer.
- Do NOT include any links or URLs anywhere in your output."""
    parsed = ai.loads(ai.complete_json_object("session", prompt), None)
    if not isinstance(parsed, dict) or not parsed:
        # Fail closed with a marker the UI's render guard understands — never raw model text.
        log.warning("Session plan generation returned unparseable content for plan %s", plan["lesson_plan_id"])
        parsed = {"error": "unparseable", "title": title}
    for k in ("additionalSections", "currentAffairs", "educationalVideos", "images", "educationalDocuments"):
        parsed.pop(k, None)
    parsed["learningOutcomes"] = [{"elo": e["elo"], "bloomLevel": e.get("bloomLevel"), "eloId": e.get("eloId")}
                                  for e in elos]
    return parsed
