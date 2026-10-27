"""Offline (PROVIDER_MODE=mock) answers for the Lesson Plan / Session Plan prompts.

Deterministic, chapter-aware content so the whole creator → session flow runs and is testable without AI keys.
Values are read back out of the real prompt text (chapter, subject, grade, counts, stages), so what the mock
returns has the same shape and is about the same chapter as what a real model would return."""
from __future__ import annotations

import json
import re

_BLOOM_VERB = {"apply": "apply", "analyse": "analyse", "analyze": "analyse", "evaluate": "evaluate", "create": "design",
               "understand": "explain", "remember": "recall", "remembering": "recall", "understanding": "explain",
               "applying": "apply", "analysing": "analyse", "evaluating": "evaluate", "creating": "design"}
_AFFIRM = re.compile(r"\b(yes|yeah|yep|ok|okay|sure|proceed|continue|go\s?ahead|generate|create|confirm|do it)\b", re.I)


def _grab(pattern: str, text: str, default: str = "") -> str:
    m = re.search(pattern, text, re.I | re.S)
    return m.group(1).strip() if m else default


def _ctx(p: str) -> tuple[str, str, str]:
    chapter = (_grab(r'Chapter:\s*"([^"]+)"', p) or _grab(r"Chapter:\s*'([^']+)'", p)
               or _grab(r"Chapter(?: / topic)?:\s*\"?([^\n|\"]+)", p) or _grab(r"Topic:\s*([^\n]+)", p) or "this chapter")
    subject = _grab(r"Subject:\s*([^\n|]+)", p, "the subject")
    grade = _grab(r"(?:Grade|Class/Grade):\s*([^\n|]+)", p, "the class")
    return chapter.strip(' "'), subject.strip(), grade.strip()


def _count(pattern: str, p: str, default: int) -> int:
    try:
        return int(_grab(pattern, p, str(default)))
    except ValueError:
        return default


def answer(kind: str, p: str, messages: list[dict] | None = None) -> str:
    chapter, subject, grade = _ctx(p)
    if kind in ("co", "co_regen"):
        n = 1 if kind == "co_regen" else max(1, min(5, _count(r"exactly (\d+) Course Outcomes", p, 3)))
        factors = ["Conceptual Understanding", "Practical Application", "Analytical Skills", "Problem Solving",
                   "Experimental Skills"]
        stems = [("Understanding the Core Ideas of", "explain the key ideas, terms and relationships in"),
                 ("Applying", "apply the concepts of {c} to solve everyday and textbook problems"),
                 ("Analysing Patterns in", "analyse examples and data to identify patterns related to"),
                 ("Solving Problems Using", "solve multi-step problems by reasoning with"),
                 ("Investigating", "plan and carry out a simple investigation about")]
        cos = []
        for i in range(n):
            title, desc = stems[(i + (1 if kind == "co_regen" else 0)) % len(stems)]
            desc = desc.format(c=chapter) if "{c}" in desc else f"{desc} {chapter}"
            cos.append({"co_id": f"CO{i + 1}", "co_title": f"{title} {chapter}",
                        "co_description": f"Students will {desc} at {grade} level.", "factor": factors[i % len(factors)]})
        return json.dumps(cos)
    if kind == "skills":
        t = _grab(r"Course Outcome:\s*([^\n-]+)", p, "")
        pool = ["Observation", "Reasoning", "Problem Solving", "Data Interpretation", "Communication", "Modelling",
                "Classification", "Estimation"]
        i = sum(map(ord, t)) % len(pool)
        return json.dumps([pool[i], pool[(i + 3) % len(pool)]])
    if kind == "comps":
        t = _grab(r"Course Outcome:\s*([^\n-]+)", p, "")
        pool = ["Critical Thinking", "Scientific Inquiry", "Collaborative Learning", "Mathematical Reasoning",
                "Effective Communication", "Creative Problem Solving"]
        i = sum(map(ord, t)) % len(pool)
        return json.dumps([pool[i], pool[(i + 2) % len(pool)]])
    if kind in ("elo", "elo_regen"):
        bloom = _grab(r"Bloom(?:'s Taxonomy)? [Ll]evel:\s*([A-Za-z]+)", p, "Apply")
        verb = _BLOOM_VERB.get(bloom.lower(), "apply")
        n = 1 if kind == "elo_regen" else max(1, _count(r"Generate EXACTLY (\d+) distinct", p, 1))
        tails = [f"the key ideas of {chapter} to explain a real-life situation",
                 f"two worked examples from {chapter} and justify each step",
                 f"a short task that uses {chapter} concepts accurately",
                 f"evidence from a given scenario using what they learnt in {chapter}"]
        off = 1 if kind == "elo_regen" else 0
        return json.dumps([f"Students will {verb} {tails[(i + off) % len(tails)]}." for i in range(n)])
    if kind == "ped":
        pool = ["Inquiry-based Learning", "Collaborative Learning", "Experiential Learning", "Project-based Learning",
                "Art Integrated Learning", "Flipped Classroom"]
        i = len(p) % len(pool)
        return json.dumps([pool[i], pool[(i + 1) % len(pool)]])
    if kind == "assess":
        elo = _grab(r'Expected Learning Outcome:\s*"([^"]+)"', p, chapter)
        items = []
        for n, itype, bloom in re.findall(r'-\s*(\d+) item\(s\) of type "([^"]*)", Bloom\'s level:\s*([^.\n]*)', p):
            for k in range(int(n)):
                t = itype.lower()
                q = {"itemType": itype or "MCQ", "bloomsLevel": bloom.strip() or "Apply", "options": None, "context": None}
                if "mcq" in t:
                    q.update(question=f"Which statement about {chapter} is correct? ({k + 1})",
                             options=[f"The main idea of {chapter} applies only in textbooks",
                                      f"{chapter} can be used to explain everyday situations",
                                      f"{chapter} has no connection to {subject}", "None of the above"],
                             answer="B")
                elif "fill" in t:
                    q.update(question=f"The key idea studied in this chapter is called ______ ({chapter}).", answer=chapter)
                elif "case" in t:
                    q.update(context=f"A class visit shows a real situation linked to {chapter}.",
                             question=f"Using the case above, explain how {chapter} helps you decide what to do.",
                             answer=f"A reasoned answer that applies {chapter} to the case.")
                else:
                    q.update(question=f"Explain, with an example, how {chapter} is used. ({k + 1})",
                             answer=f"An answer that {elo[:80].lower()}")
                items.append(q)
        return json.dumps({"assessment_items": items})
    if kind == "five_e_resource":
        phase = _grab(r"5E Phase:\s*([^\n]+)", p, "Engage")
        resource = _grab(r'Resource / strategy to build the activity around:\s*"([^"]+)"', p, "Activity")
        mins = _grab(r"Estimated time:\s*([^\n]+)", p, "10 minutes")
        body = (f"**Objective:** Use *{resource}* in the {phase} phase to build understanding of {chapter}.\n\n"
                f"**Steps ({mins}):**\n1. Introduce the {resource.lower()} and link it to {chapter}.\n"
                f"2. Students work in pairs and record two observations.\n3. Share findings with the class.\n\n"
                f"| Step | What students do |\n|---|---|\n| 1 | Observe and note |\n| 2 | Discuss and explain |\n\n"
                f"**Teacher Instruction:** Circulate, ask \"Why do you think so?\" and note misconceptions.")
        return json.dumps({"title": f"{resource}: {chapter} ({phase})", "body": body})
    if kind in ("five_e", "le"):
        phases = ["Engage/Elicit", "Explore", "Explain", "Elaborate", "Evaluate"] if kind == "five_e" else \
            ["Engage", "Explore", "Explain", "Elaborate", "Evaluate"]
        return json.dumps({"5E_Model": [{"phase": ph, "activities": [{
            "title": f"{ph} — {chapter}", "description": f"A {ph.lower()} activity on {chapter}.",
            "pedagogical_approach": "Inquiry-based", "intelligence_types": ["Logical-mathematical"],
            "resources": [], "duration": "10 minutes"}]} for ph in phases]})
    if kind == "assignments":
        return json.dumps([{"title": f"{chapter} in My Neighbourhood",
                            "purpose": f"Connect {chapter} to real situations students see every day.",
                            "instructions": f"Find two examples of {chapter} at home or school. Describe each and explain the idea behind it."},
                           {"title": f"Explain {chapter} to a Friend",
                            "purpose": "Build understanding by teaching the idea in simple words.",
                            "instructions": "Write a short explanation with one diagram and one example."},
                           {"title": f"{chapter} Quick Investigation",
                            "purpose": "Practise observing and recording carefully.",
                            "instructions": "Carry out the small task given in class, record observations in a table and write one conclusion."}])
    if kind == "quick":
        return json.dumps({"title": chapter, "learningObjectives": [f"Understand {chapter}"]})
    if kind == "theme":
        return json.dumps({"theme": f"{subject} in daily life"})
    if kind == "validate":
        n = len(re.findall(r"^\[\d+\]", p, re.M))
        return json.dumps({"keep": [{"i": i, "why": f"Helps students relate {chapter} to the real world."} for i in range(n)]})
    if kind == "session":
        return json.dumps(_session(p))
    if kind == "assessment_mix":
        return json.dumps({"assessment_requirements": _mix(p)})
    if kind == "assistant":
        return _assistant(p, messages or [])
    return "{}"


def _session(p: str) -> dict:
    chapter = _grab(r"- Chapter:\s*([^\n]+)", p, "this chapter")
    subject = _grab(r"- Subject:\s*([^\n]+)", p, "the subject")
    grade = _grab(r"- Class/Grade:\s*([^\n]+)", p, "the class")
    title = _grab(r"- Session title:\s*([^\n]+)", p, chapter)
    duration = _grab(r"- Total duration:\s*(\d+)", p, "40")
    stages = []
    for line in re.findall(r"^- ([^|\n]+) \| class setting:([^|]+)\|([^|]+)\| resources to build the activity around: ([^\n|]+)", p, re.M):
        name, setting, mins, res = (x.strip() for x in line)
        titles = re.findall(r'"([^"]+)"', res)
        stages.append({"stage": name, "classSetting": setting if setting in ("Individual", "Pair", "Group", "Whole Class") else "Whole Class",
                       "durationMins": int((re.search(r"\d+", mins) or [10])[0]) if re.search(r"\d+", mins) else 10,
                       "teacherNotes": f"Run the {name.lower()} stage around the picked resources for {chapter}.",
                       "steps": [f"Step 1: Introduce the purpose of this stage for {chapter}.",
                                 "Step 2: Students work with the resource and note one finding.",
                                 "Step 3: Share and summarise as a class."],
                       "questions": [f"What did you notice about {chapter} here?"],
                       "resources": [{"title": t, "howToUse": f"Use **{t}** to illustrate the main idea, then ask students to explain it back."} for t in titles]})
    if not stages:
        stages = [{"stage": "Opening", "classSetting": "Whole Class", "durationMins": 10,
                   "teacherNotes": f"Hook the class with a question about {chapter}.",
                   "steps": ["Step 1: Ask a hook question.", "Step 2: State the objectives."],
                   "questions": [f"Where do we see {chapter} around us?"], "resources": []},
                  {"stage": "Wrap Up", "classSetting": "Whole Class", "durationMins": 10,
                   "teacherNotes": "Summarise and check understanding.", "steps": ["Step 1: Three-point summary."],
                   "questions": ["What is one thing you learnt today?"], "resources": []}]
    return {
        "title": title, "overview": f"In this {duration}-minute session {grade} students explore {chapter} in {subject} "
                                    "through the stages and resources the teacher planned.",
        "metadata": {"grade": grade, "subject": subject, "chapter": chapter, "duration": duration},
        "prerequisiteKnowledge": f"Basic ideas from the previous chapter of {subject}.",
        "specificObjectives": [f"Explain the key idea of {chapter} in their own words.",
                               f"Apply {chapter} to one everyday example."],
        "keyVocabulary": [{"term": chapter, "definition": f"The central idea of this chapter in {subject}.",
                           "example": f"An everyday example of {chapter}."}],
        "materials": [{"name": "Whiteboard and markers", "quantity": "As needed", "notes": "For the summary"}],
        "stages": stages,
        "assessment": {"type": "Formative", "description": f"Exit ticket with two short questions on {chapter}.",
                       "successCriteria": ["States the main idea correctly", "Gives a relevant example"]},
        "differentiation": {"extensions": "Ask advanced learners to create their own example problem.",
                            "support": "Provide a worked example and sentence starters."},
        "realWorldExamples": [{"example": f"Seeing {chapter} at a local market", "explanation": "Links the idea to daily life."},
                              {"example": f"{chapter} at home", "explanation": "A familiar situation for students."},
                              {"example": f"{chapter} on the way to school", "explanation": "Something students notice daily."}],
        "discussionQuestions": [{"question": f"How would life be different without {chapter}?", "purpose": "Encourages reasoning."},
                                {"question": f"Where else could we use {chapter}?", "purpose": "Promotes transfer."},
                                {"question": f"What surprised you about {chapter}?", "purpose": "Reflection."},
                                {"question": f"How would you explain {chapter} to a younger student?", "purpose": "Consolidation."}],
        "homework": f"Find one example of {chapter} at home and describe it in three sentences.",
    }


def _mix(text: str) -> dict:
    reqs = {"mcq": 0, "true_false": 0, "short_answer": 0, "long_answer": 0, "case_study": 0}
    pats = [(r"case", "case_study"), (r"true.?false|t\s*/?\s*f\b", "true_false"), (r"long|essay|\bla\b", "long_answer"),
            (r"short|\bsa\b", "short_answer"), (r"mcq|multiple|objective", "mcq")]
    for part in re.split(r"[,;\n]+|\band\b", text, flags=re.I):
        num = re.search(r"\d+", part)
        if not num:
            continue
        for pat, key in pats:
            if re.search(pat, part, re.I):
                reqs[key] = int(num.group())
                break
    if not any(reqs.values()):
        reqs["mcq"] = 2
    return reqs


_QUESTIONS = ["Which class is this lesson plan for?", "Which subject?", "Which chapter should it cover?",
              "How many Course Outcomes would you like? (1-5, default 3)",
              "What is the duration? (e.g. 1 hour, 45 minutes)",
              "Which Bloom's levels and how many ELOs each? (e.g. Apply: 2, Analyse: 1)"]


def _assistant(system: str, messages: list[dict]) -> str:
    """Deterministic slot filling for the AI Bot: one answer per question, in order."""
    loaded = "chapter list has already been loaded" in system
    answers = [str(m.get("content") or "").strip() for m in messages if m.get("role") == "user"]
    replies = [str(m.get("content") or "") for m in messages if m.get("role") == "assistant"]
    if replies and "[START_LESSON_PIPELINE]" in replies[-1]:
        return "[PROCEED_TO_SKILLS]"
    slots: list[str] = []
    for a in answers:
        if len(slots) < 6:
            slots.append(a)
    awaiting_confirm = len(slots) == 6 and len(answers) > 6
    if len(slots) >= 2 and not loaded:
        return '[LIST_CHAPTERS] ' + json.dumps({"class": slots[0], "subject": slots[1]})
    if len(slots) < 6:
        return ("Got it. " if slots else "") + _QUESTIONS[len(slots)]
    cls, subj, chap, cos, dur, blooms = slots
    hours = re.search(r"(\d+)\s*h", dur, re.I)
    mins = re.search(r"(\d+)\s*m", dur, re.I)
    bl: dict[str, int] = {}
    for level, n in re.findall(r"(Apply|Analy[sz]e|Evaluate|Create|Understand|Remember)\w*\s*[:=-]?\s*(\d+)", blooms, re.I):
        bl[level.capitalize().replace("Analyze", "Analyse")] = int(n)
    if not bl:
        bl = {"Apply": 2}
    if awaiting_confirm and _AFFIRM.search(answers[-1]):
        return "[START_LESSON_PIPELINE] " + json.dumps({
            "class_name": cls, "subject_name": subj, "chapter_name": chap,
            "co_count": max(1, min(5, int((re.search(r"\d+", cos) or ["3"])[0]))),
            "duration_hours": hours.group(1) if hours else ("1" if "hour" in dur.lower() and not mins else "0"),
            "duration_minutes": mins.group(1) if mins else "00", "blooms_counts": bl,
            "attitudes": ["Respect", "Integrity", "Empathy"]})
    return (f"Here is your unit plan setup:\n- Class: {cls}\n- Subject: {subj}\n- Chapter: {chap}\n- Course Outcomes: {cos}\n"
            f"- Duration: {dur}\n- Bloom's levels: {blooms}\n\nShall I go ahead and generate? (Yes / Make a change)")
