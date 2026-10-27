"""Unit / lesson plan generation — port of Rapid's LessonPlanController (itself a port of the Python
UnitPlanMain.py / LessonPlanMain.py prompts). Same prompts, same request / response shapes, so the wizard
steps (Course Outcomes → Skills → Competencies → ELOs → Assessment → 5E → Review) behave identically.
Runs on EduAI's configured provider (PROVIDER_MODE azure | openai | mock)."""
from __future__ import annotations

import json
from typing import Any

from . import ai

FACTORS = '"Conceptual Understanding", "Practical Application", "Analytical Skills", "Experimental Skills", "Problem Solving"'
FIVE_E_PHASES = ["Engage/Elicit", "Explore", "Explain", "Elaborate", "Evaluate"]


def _s(d: dict, k: str) -> str:
    v = d.get(k) if isinstance(d, dict) else None
    return v.strip() if isinstance(v, str) else ("" if v is None else str(v))


def _i(d: dict, k: str, default: int) -> int:
    v = d.get(k) if isinstance(d, dict) else None
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _a(d: dict, k: str) -> list[str]:
    v = d.get(k) if isinstance(d, dict) else None
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def _extra(text: str, what: str) -> str:
    return "" if not text.strip() else (
        f"\n\nTEACHER'S ADDITIONAL INSTRUCTIONS — you MUST follow these when {what}:\n\"\"\"\n{text}\n\"\"\"\n")


def _merge_co(co: dict, skills: list[str] | None = None, with_elos: bool = False) -> dict:
    d: dict[str, Any] = {
        "co_id": _s(co, "co_id"), "co_title": _s(co, "co_title"),
        "co_description": _s(co, "co_description"), "factor": _s(co, "factor"),
        "skills": skills if skills is not None else _a(co, "skills"),
        "competencies": _a(co, "competencies"),
    }
    if with_elos:
        d["elos"] = []
    return d


# ───────────────────────────────────────────────────────────── 1) Course Outcomes
def course_outcomes(r: dict) -> dict:
    board, grade, subject, chapter = _s(r, "board"), _s(r, "grade"), _s(r, "subject"), _s(r, "chapter")
    co_count = max(1, min(5, _i(r, "co_count", 3)))
    reference = _s(r, "reference_text")
    source = "" if not reference else (
        "\n\nBASE THE OUTCOMES ON THIS UPLOADED REFERENCE MATERIAL — use its facts, examples and terminology and stay "
        f"accurate to it:\n\"\"\"\n{reference[:12000]}\n\"\"\"\n")
    prompt = f"""You are a curriculum expert. Generate exactly {co_count} Course Outcomes (COs) for the chapter below.

Chapter: "{chapter}" | Subject: {subject} | Grade: {grade} | Board: {board}{source}

STRICT OUTPUT RULES:
- Respond with ONLY a valid JSON array. No text before or after.
- The array must contain EXACTLY {co_count} objects.
- Each object must have these 4 keys: "co_id", "co_title", "co_description", "factor"

KEY DEFINITIONS:
- "co_id": "CO1", "CO2", etc.
- "co_title": A specific 4-7 word title describing what students learn (NOT a generic term). Example: "Applying Ohm's Law to Circuits"
- "co_description": 1-2 sentences starting with "Students will..." describing the measurable outcome
- "factor": ONE of: {FACTORS}

Now generate {co_count} COs for the chapter "{chapter}". Output ONLY the JSON array."""
    cos = [c for c in ai.safe_array(ai.complete_json("co", prompt)) if isinstance(c, dict)]
    return {"board": board, "grade": grade, "subject": subject, "chapter": chapter,
            "total_outcomes": len(cos), "course_outcomes": cos}


def regenerate_course_outcome(r: dict) -> dict:
    board, grade, subject, chapter = _s(r, "board"), _s(r, "grade"), _s(r, "subject"), _s(r, "chapter")
    current, title, factor = _s(r, "course_outcome"), _s(r, "co_title"), _s(r, "factor")
    prompt = f"""You are a curriculum expert. Rewrite (regenerate) ONE Course Outcome (CO) for the chapter below as a fresh, improved alternative to the current one — same chapter/topic, but different wording and emphasis.

Chapter: "{chapter}" | Subject: {subject} | Grade: {grade} | Board: {board}
Current CO title: "{title}"
Current CO description: "{current}"
Current factor: "{factor}"{_extra(_s(r, "additional_instructions"), "rewriting")}

STRICT OUTPUT RULES:
- Respond with ONLY a valid JSON array containing EXACTLY 1 object. No text before or after.
- The object must have these 4 keys: "co_id", "co_title", "co_description", "factor"
- "co_title": a specific 4-7 word title (NOT generic)
- "co_description": 1-2 sentences starting with "Students will..."
- "factor": ONE of: {FACTORS}

Output ONLY the JSON array."""
    cos = [c for c in ai.safe_array(ai.complete_json("co_regen", prompt)) if isinstance(c, dict)]
    co = cos[0] if cos else {"co_id": _s(r, "co_id"), "co_title": title, "co_description": current, "factor": factor}
    return {"course_outcome": co}


# ───────────────────────────────────────────────────────────── 2) Skills / 3) Competencies per CO
def _cos(r: dict) -> list[dict]:
    v = r.get("course_outcomes")
    return [c for c in v if isinstance(c, dict)] if isinstance(v, list) else []


def skills_per_co(r: dict) -> dict:
    outcomes = []
    for co in _cos(r):
        prompt = f"""You are an expert curriculum designer. Generate EXACTLY 2 distinct skill keywords students will develop from this Course Outcome.
Rules: output EXACTLY 2; each 1-3 words; actionable/measurable; output ONLY a JSON array like ["Skill1","Skill2"].
Course Outcome: {_s(co, "co_title")} - {_s(co, "co_description")} (Factor: {_s(co, "factor")})"""
        skills = ai.safe_string_array(ai.complete_json("skills", prompt))
        if len(skills) != 2:
            skills = ["Analysis", "Application"]
        outcomes.append(_merge_co(co, skills=skills[:2]))
    return {"board": _s(r, "board"), "grade": _s(r, "grade"), "subject": _s(r, "subject"), "chapter": _s(r, "chapter"),
            "total_outcomes": _i(r, "total_outcomes", len(outcomes)), "course_outcomes": outcomes}


def competencies_per_co(r: dict) -> dict:
    outcomes = []
    for co in _cos(r):
        skills = _a(co, "skills")
        prompt = f"""You are an expert curriculum designer. Generate EXACTLY 2 distinct competency keywords for this Course Outcome.
Rules: EXACTLY 2; each 2-4 words; broader than skills; distinct from the listed skills; output ONLY a JSON array like ["Competency1","Competency2"].
Course Outcome: {_s(co, "co_title")} - {_s(co, "co_description")} (Factor: {_s(co, "factor")})
Related Skills: {", ".join(skills)}"""
        comps = ai.safe_string_array(ai.complete_json("comps", prompt))
        if len(comps) != 2:
            comps = ["Critical Thinking", "Problem Solving"]
        merged = _merge_co(co, skills=skills)
        merged["competencies"] = comps[:2]
        outcomes.append(merged)
    return {"board": _s(r, "board"), "grade": _s(r, "grade"), "subject": _s(r, "subject"), "chapter": _s(r, "chapter"),
            "total_outcomes": _i(r, "total_outcomes", len(outcomes)), "course_outcomes": outcomes}


# ───────────────────────────────────────────────────────────── 4) ELOs per Bloom level
def _elo_prompt(count: int, bloom: str, board: str, grade: str, subject: str, chapter: str, co_details: str,
                skills: list[str], comps: list[str], attitudes: list[str]) -> str:
    return f"""You are an expert in outcomes-based education and curriculum design, specialized in high-quality Expected Learning Outcomes (ELOs).

Educational Context:
- Board: {board}
- Grade: {grade}
- Subject: {subject}
- Chapter: '{chapter}'
- Bloom's Taxonomy Level: {bloom}

Learning outcomes use an action verb aligned to Bloom's level, are specific, measurable, learner-focused, and grade-appropriate.
Structure: [Action Verb] + [what students do/create/demonstrate] + [context/condition] + [optional quality standard].

Chapter's Core Objectives:
{co_details}

Key Skills (the teacher has curated these — base the ELOs ONLY on this list, do NOT introduce other skills): {", ".join(skills)}
Key Competencies (base the ELOs ONLY on this list): {", ".join(comps)}
Attitudes: {", ".join(attitudes)}

Task: Generate EXACTLY {count} distinct, high-quality ELOs for "{chapter}" at the {bloom} level. Each must be unique, match {bloom} cognitive demand and Grade {grade}, and develop ONLY the Key Skills and Key Competencies listed above.
Output: ONLY a valid JSON array of exactly {count} strings (each a complete ELO). No text before or after."""


def elos(r: dict) -> list[dict]:
    board, grade, subject, chapter = _s(r, "board"), _s(r, "grade"), _s(r, "subject"), _s(r, "chapter")
    cos = _cos(r)
    co_details = "\n".join(f"- {_s(c, 'co_id')}: {_s(c, 'co_title')} - {_s(c, 'co_description')} (Factor: {_s(c, 'factor')})"
                           for c in cos)
    skills, comps, attitudes = _a(r, "skills"), _a(r, "competencies"), _a(r, "attitudes")
    all_elos: list[tuple[str, str]] = []
    counts = r.get("blooms_elo_counts")
    if isinstance(counts, dict):
        for bloom, n in counts.items():
            try:
                count = int(n)
            except (TypeError, ValueError):
                continue
            if count <= 0:
                continue
            prompt = _elo_prompt(count, bloom, board, grade, subject, chapter, co_details, skills, comps, attitudes)
            for e in ai.safe_string_array(ai.complete_json("elo", prompt))[:count]:
                all_elos.append((e, bloom))
    # Round-robin the ELOs onto the COs (mirrors the Python / .NET).
    co_ids = [_s(c, "co_id") for c in cos]
    by_id = {_s(c, "co_id"): _merge_co(c, skills=_a(c, "skills"), with_elos=True) for c in cos}
    for i, (elo, bloom) in enumerate(all_elos):
        if not co_ids:
            break
        co_id = co_ids[i % len(co_ids)]
        by_id[co_id]["elos"].append({
            "elo": elo, "bloom_level": bloom, "co_id": co_id, "Elo_id": f"Elo-{i + 1}",
            # Only the teacher's RETAINED skills/competencies drive each ELO.
            "skills": skills, "competencies": comps,
        })
    return list(by_id.values())


def regenerate_elo(r: dict) -> dict:
    board, grade, subject, chapter = _s(r, "board"), _s(r, "grade"), _s(r, "subject"), _s(r, "chapter")
    current, bloom = _s(r, "elo"), _s(r, "bloom_level")
    prompt = f"""You are an expert in outcomes-based education. Rewrite (regenerate) ONE Expected Learning Outcome (ELO) as a fresh, improved alternative to the current one — same chapter and Bloom level, but different wording.

Board: {board} | Grade: {grade} | Subject: {subject} | Chapter: "{chapter}"
Bloom level: {bloom}
Skills: {", ".join(_a(r, "skills"))}
Competencies: {", ".join(_a(r, "competencies"))}
Current ELO: "{current}"{_extra(_s(r, "additional_instructions"), "rewriting")}

STRICT OUTPUT RULES:
- Respond with ONLY a valid JSON array containing EXACTLY 1 string. No text before or after.
- The string is the rewritten ELO: one measurable sentence starting with "Students will..." at the {bloom} Bloom level.

Output ONLY the JSON array."""
    arr = ai.safe_string_array(ai.complete_json("elo_regen", prompt))
    return {"elo": arr[0] if arr and arr[0].strip() else current}


# ───────────────────────────────────────────────────────────── 5) Pedagogical approaches
def pedagogical_approaches(r: dict) -> dict:
    out: list[str] = []
    for elo in _a(r, "elos"):
        prompt = f"""You are an expert curriculum designer. For this Expected Learning Outcome (ELO), generate exactly 2 distinct, research-based pedagogical approaches as short keywords/phrases (2-5 words each), e.g. Inquiry-based, Project-based, Collaborative, Experiential, Art Integrated.
Output ONLY a JSON array of exactly 2 strings. Do not repeat the ELO text.
ELO: "{elo}\""""
        out.extend(s for s in ai.safe_string_array(ai.complete_json("ped", prompt)) if s.strip())
    return {"approaches": out}


# ───────────────────────────────────────────────────────────── 6) Assessment items
def _assessment_items(raw: str) -> list:
    v = ai.loads(raw)
    if isinstance(v, list):
        return v
    if isinstance(v, dict) and isinstance(v.get("assessment_items"), list):
        return v["assessment_items"]
    return []


def assessment_items(r: dict) -> dict:
    grade, subject, topic, elo = _s(r, "grade"), _s(r, "subject"), _s(r, "topic"), _s(r, "elo")
    details = [d for d in (r.get("assessment_details") or []) if isinstance(d, dict)]
    structure = "\n".join(
        f'- {_i(d, "noOfItems", 1)} item(s) of type "{_s(d, "itemType")}", Bloom\'s level: {_s(d, "bloomsLevel") or _s(r, "Bloom_level")}.'
        for d in details)
    prompt = f"""You are an expert in educational assessment (Assessment for Learning). Generate assessment items.
- Grade: {grade}
- Subject: {subject}
- Topic: {topic}
- Expected Learning Outcome: "{elo}"

Required Assessment Structure:
{structure}{_extra(_s(r, "additional_instructions"), "generating the item(s)")}

Instructions:
1. Return a single valid JSON object with a key "assessment_items" containing a list.
2. Each item object: "question", "itemType", "answer" (mandatory, factually correct), "bloomsLevel" (a single level), "options" (list of 4 strings for mcq else null), "context" (detailed scenario for case-study else null).
3. For fill-blank items the "question" has 1-3 blanks. Respond ONLY with the JSON object."""
    items = _assessment_items(ai.complete_json_object("assess", prompt))
    return {"0": {"eloname": elo, "assessment": items}}


# ───────────────────────────────────────────────────────────── 7) Learning experience (5E)
def learning_experience(r: dict) -> dict:
    prompt = f"""You are an expert lesson designer. Create a detailed, practical 5E Model Learning Experience for teachers.
- Subject: {_s(r, "subject")}
- Grade: {_s(r, "grade")}
- Chapter: {_s(r, "chapter")}

Course Outcomes: {json.dumps(r.get("course_outcomes") or [])}
Expected Learning Outcomes: {json.dumps(_a(r, "elos"))}
Pedagogical Approaches: {", ".join(_a(r, "pedagogical_approaches"))}
Intelligence Types: {", ".join(_a(r, "intelligence_types"))}

For each 5E phase (Engage, Explore, Explain, Elaborate, Evaluate) design 1-2 activities. Each activity integrates at least one pedagogical approach and one intelligence type.
Output ONLY this JSON:
{{ "5E_Model": [ {{ "phase": "Engage", "activities": [ {{ "title":"...","description":"...","pedagogical_approach":"...","intelligence_types":["..."],"elos":["..."],"course_outcomes":["..."],"materials":["..."],"duration":"..." }} ] }} ] }}"""
    return {"learning_experience": ai.parse_or_raw(ai.complete_json("le", prompt))}


def five_e_model(r: dict) -> dict:
    grade, subject, chapter, elo = _s(r, "grade"), _s(r, "subject"), _s(r, "chapter"), _s(r, "elo")
    merged = [x for x in _a(r, "merged_elos") if x.strip() and x != elo]
    pedagogies, intel = _a(r, "pedagogical_approaches"), _a(r, "intelligence_types")
    res_map = r.get("phase_resources") if isinstance(r.get("phase_resources"), dict) else {}
    time_map = r.get("phase_times") if isinstance(r.get("phase_times"), dict) else {}
    img_map = r.get("phase_images") if isinstance(r.get("phase_images"), dict) else {}
    guide = []
    for p in FIVE_E_PHASES:
        res = [x for x in (res_map.get(p) or []) if isinstance(x, str) and x]
        t = str(time_map.get(p) or "").strip()
        img = str(img_map.get(p)).lower() == "true"
        res_txt = ", ".join(res) if res else "teacher's choice of suitable strategies"
        guide.append(f"- {p} ({t or '~15'} mins): build the activities around these resources/strategies → {res_txt}."
                     + (" Also suggest one image/visual prompt for this phase." if img else ""))
    outcome = f'"{elo}"' + (f"\nAlso address (merged): {'; '.join(chr(34) + m + chr(34) for m in merged)}" if merged else "")
    prompt = f"""You are an expert lesson designer. Design a detailed, classroom-ready 5E learning experience for the Expected Learning Outcome(s) below.
- Subject: {subject}
- Grade: {grade}
- Chapter: {chapter}
- Expected Learning Outcome(s): {outcome}
- Pedagogical approaches to weave in: {", ".join(pedagogies) if pedagogies else "teacher's choice"}
- Multiple-intelligence types to address: {", ".join(intel) if intel else "a balanced mix"}

For each 5E phase, honour the time and build the activities around the chosen resources/strategies:
{chr(10).join(guide)}

Design 1-2 concrete, specific activities per phase (real tasks, questions, examples tied to the ELO — no generic filler). Each activity should reference at least one chosen resource/strategy and one intelligence type.
Output ONLY this JSON:
{{ "5E_Model": [ {{ "phase": "Engage/Elicit", "activities": [ {{ "title":"...","description":"...","pedagogical_approach":"...","intelligence_types":["..."],"resources":["..."],"duration":"..." }} ] }} ] }}"""
    return {"five_e": ai.parse_or_raw(ai.complete_json("five_e", prompt)), "elo": elo}


def five_e_resource(r: dict) -> dict:
    grade, subject, chapter = _s(r, "grade"), _s(r, "subject"), _s(r, "chapter")
    elo, phase, resource, est, co = _s(r, "elo"), _s(r, "phase"), _s(r, "resource"), _s(r, "est_time"), _s(r, "course_outcome")
    gen_images = str(r.get("generate_images")).lower() == "true"
    pedagogies, intel = _a(r, "pedagogical_approaches"), _a(r, "intelligence_types")
    merged = [x for x in _a(r, "merged_elos") if x.strip() and x != elo]
    merged_line = ("\n- ALSO address these merged Learning Outcomes together in the same activity: "
                   + "; ".join(f'"{m}"' for m in merged)) if merged else ""
    co_line = f'- Course Outcome: "{co}"\n' if co else ""
    prompt = f"""You are an expert lesson designer. Design ONE concrete, classroom-ready 5E activity for a single teaching resource/strategy.
- Subject: {subject}
- Grade: {grade}
- Chapter: {chapter}
- Expected Learning Outcome: "{elo}"{merged_line}
{co_line}- 5E Phase: {phase}
- Resource / strategy to build the activity around: "{resource}"
- Estimated time: {est + " minutes" if est else "as suitable"}
- Pedagogical approaches to weave in: {", ".join(pedagogies) if pedagogies else "teacher's choice"}
- Multiple-intelligence types to address: {", ".join(intel) if intel else "a balanced mix"}

Write a specific, ready-to-run activity that USES the "{resource}" resource for the {phase} phase of this ELO — real tasks, questions, examples, sample text (not generic filler).{" Also suggest one image/visual prompt the teacher could generate for this activity." if gen_images else ""}
Return ONLY a JSON object:
{{ "title": "a short catchy activity title", "body": "the full activity in Markdown — you may use short **sub-headings**, numbered/bulleted steps, a Markdown table where helpful, and a **Teacher Instruction:** line." }}"""
    return {"block": ai.parse_or_error(ai.complete_json_object("five_e_resource", prompt)), "phase": phase,
            "resource": resource}


# ───────────────────────────────────────────────────────────── 8) Assignments
def assignments(r: dict) -> dict:
    elos_text = "\n".join("- " + e for e in _a(r, "elos"))
    prompt = f"""You are an expert curriculum designer. Generate exactly 3 meaningful assignments for this unit.
Subject: {_s(r, "subject")} | Grade: {_s(r, "grade")} | Chapter: {_s(r, "chapter")}
Expected Learning Outcomes:
{elos_text}

STRICT: Respond with ONLY a valid JSON array of EXACTLY 3 objects, each with keys "title" (5-8 words), "purpose" (1-2 sentences), "instructions" (2-4 sentences). Output ONLY the JSON array."""
    return {"assignments": ai.parse_or_raw(ai.complete_json("assignments", prompt))}


# ───────────────────────────────────────────────────────────── 9) Quick single-shot lesson plan
def quick_lesson_plan(r: dict) -> dict:
    title, subject, grade = _s(r, "lessonTitle"), _s(r, "subject"), _s(r, "grade")
    duration = _i(r, "duration", 40)
    vocab, materials, session = _s(r, "keyVocabulary"), _s(r, "supportingMaterials"), _s(r, "sessionInstructions")
    los = _a(r, "expectedLearningOutcomes")
    extra = "\n".join(x for x in [
        f"Key vocabulary to include and explain: {vocab}." if vocab else "",
        f"Incorporate these supporting materials: {materials}." if materials else "",
        f"Align all sections with these Expected Learning Outcomes: {'; '.join(los)}." if los else "",
        f"Teacher's session instruction: {session}." if session else "",
    ] if x)
    prompt = f"""You are a master teacher and expert lesson designer. Generate a highly engaging, age-appropriate, well-structured lesson plan as a SINGLE valid JSON object (no markdown, no text outside the JSON).

Create educational content for a {duration}-minute session on '{title}' for Grade {grade} {subject}.

JSON structure:
{{
  "title": "...",
  "metadata": {{ "grade": "{grade}", "subject": "{subject}", "duration": "{duration}" }},
  "learningObjectives": ["..."],
  "materials": [ {{ "name":"...", "quantity":"As needed", "notes":"..." }} ],
  "keyVocabulary": [ {{ "term":"...", "definition":"...", "example":"..." }} ],
  "lessonFlow": {{ "introduction": {{ "duration":"5-10 minutes", "hookActivity":"...", "priorKnowledgeConnection":"..." }},
    "activities": [ {{ "title":"...", "objective":"...", "duration":"X minutes", "materials":["..."], "steps":["..."], "grouping":"Individual/Pairs/Group", "teacherNotes":"..." }} ] }},
  "assessment": {{ "type":"Formative/Summative", "description":"...", "successCriteria":["..."] }},
  "differentiation": {{ "extensions":"...", "support":"..." }},
  "realWorldExamples": [ {{ "example":"...", "explanation":"..." }} ],
  "discussionQuestions": [ {{ "question":"...", "purpose":"..." }} ]
}}
{extra}
Only include the JSON object. Ensure it is valid."""
    return {"lessonPlan": ai.parse_or_raw(ai.complete_json_object("quick", prompt))}
