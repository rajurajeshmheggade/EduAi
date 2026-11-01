"""Offline answers for the admission AI steps ([TASK:ADM:<kind>]) so drafting, grading, HQ, integrity and the report
run fully with PROVIDER_MODE=mock (and in tests). Deterministic and schema-valid; simple lexical heuristics only."""
from __future__ import annotations

import json
import re

_WORD = re.compile(r"[a-z0-9]+")
_STOP = set("a an the of to in on for and or is are was were be it this that with as by at from i we you my me so".split())


def _words(s: str) -> set[str]:
    return {w for w in _WORD.findall((s or "").lower()) if w not in _STOP and len(w) > 2}


def _between(text: str, start: str, end: str = '"""') -> str:
    i = text.find(start)
    if i < 0:
        return ""
    i += len(start)
    j = text.find(end, i)
    return text[i:j if j >= 0 else None]


def _json_after(text: str, label: str):
    i = text.find(label)
    if i < 0:
        return None
    s = text[i + len(label):].lstrip()
    try:
        return json.JSONDecoder().raw_decode(s)[0]
    except ValueError:
        return None


def _quote(s: str, n: int = 12) -> str:
    return " ".join((s or "").split()[:n])


def _grade(user: str) -> dict:
    marks = float((re.search(r"Question \((\d+(?:\.\d+)?) marks", user) or [0, 1])[1])
    answer = _between(user, 'Candidate answer: """')
    model = _between(user, 'Model answer: """')
    rubric = _json_after(user, "Rubric (criterion → marks):") or [{"criterion": "Matches the model answer", "marks": marks}]
    got = _words(answer)
    out, total = [], 0.0
    for r in rubric:
        want = _words(f"{r.get('criterion', '')} {model}")
        ratio = len(got & want) / max(1, min(len(want), 8))
        mx = float(r.get("marks") or 0)
        awarded = mx if ratio >= 0.5 else mx / 2 if ratio >= 0.2 else 0.0
        awarded = min(mx, round(awarded * 2) / 2)
        total += awarded
        out.append({"criterion": r.get("criterion", ""), "awarded": awarded, "max": mx,
                    "evidence": _quote(answer, 10) if awarded else ""})
    fb = ("Good — your answer covers the key idea." if total >= marks * 0.75 else
          "You have part of the idea; add the missing steps from the question." if total > 0 else
          "Have another look at the main idea the question asks about.")
    return {"score": min(marks, total), "rubric": out, "feedback": fb, "confidence": 0.6}


def _hq(user: str) -> dict:
    reflective = _json_after(user, "Reflective answers:") or []
    ideas = _json_after(user, "Ideas item:") or {}
    dims: dict = {}
    texts = " ".join(r.get("answer", "") for r in reflective if isinstance(r, dict))
    n_words = len(texts.split())
    for d in ("EQ", "SQ", "AQ", "IQ"):
        if n_words < 15:
            dims[d] = {"score": None, "insufficient_evidence": True, "evidence": [], "observation": "Not enough written evidence."}
        else:
            bonus = 10 if d == "IQ" and re.search(r"\b(because|so|then|first|next)\b", texts, re.I) else 0
            dims[d] = {"score": min(90, 45 + n_words // 6 + bonus), "insufficient_evidence": False,
                       "evidence": [_quote(texts)], "observation": "Describes the situation and a sensible next step."}
    ideas_text = (ideas or {}).get("answer", "") if isinstance(ideas, dict) else ""
    n_ideas = len([x for x in re.split(r"[\n,;]+", ideas_text) if x.strip()])
    dims["CQ"] = ({"score": min(95, 30 + 8 * n_ideas), "insufficient_evidence": False, "evidence": [_quote(ideas_text)],
                   "observation": f"Suggested {n_ideas} different ideas."} if n_ideas else
                  {"score": None, "insufficient_evidence": True, "evidence": [], "observation": "No ideas were listed."})
    return {"dimensions": dims, "strengths": ["Writes about real experiences", "Thinks about next steps", "Engages with every task"],
            "growth_areas": ["Add more detail about feelings and choices"]}


def _integrity(user: str) -> dict:
    score = (re.search(r"Integrity score: (\d+)/100 \((\w+)\)", user) or [None, "100", "High"])
    flags = _json_after(user, "Flag summary:") or []
    if not flags:
        return {"summary": f"The system recorded no proctoring flags during the test. Integrity score {score[1]}/100 ({score[2]}).",
                "top_concerns": [], "clean_areas": ["No flags recorded"]}
    top = sorted(flags, key=lambda f: -float(f.get("count", 0)))[:3]
    parts = ", ".join(f"{f.get('label')} ({f.get('count')}×)" for f in top)
    return {"summary": f"The system recorded {sum(int(f.get('count', 0)) for f in flags)} flags across {len(flags)} types: {parts}. "
                       f"The integrity score is {score[1]}/100 ({score[2]}). Flags are indicators for the teacher to review, not proof.",
            "top_concerns": [str(f.get("label")) for f in top], "clean_areas": []}


def _report(user: str) -> dict:
    band = (re.search(r"Recommendation band: (.+)", user) or [None, "the recommended band"])[1].strip()
    name = (re.search(r"Candidate: ([^,]+)", user) or [None, "The candidate"])[1]
    return {"executive_summary": f"{name} completed the admission assessment. The computed results place the candidate in "
                                 f"the band \"{band}\". Section results, the HQ profile and the proctoring summary below give the detail.",
            "academic_commentary": "Performance is summarised by section and topic below; strongest and weakest topics are listed in the table.",
            "hq_commentary": "The HQ profile is indicative and based only on the candidate's written answers in the HQ section.",
            "strengths": ["Completed every section", "Clear written answers", "Steady pace through the test"],
            "development_areas": ["Revise the weakest topic", "Show working in longer answers", "Add detail in reflective answers"],
            "suggested_next_step": "Proceed to an interview with the teacher."}


def _draft(system: str, user: str) -> dict:
    if "Human Quotient" in user:
        n = int((re.search(r"Draft the Human Quotient \(HQ\) section: (\d+)", user) or [0, 4])[1])
        dims = ["EQ", "SQ", "AQ"]
        items = [{"qtype": "SJT", "hq_dimension": dims[i % 3],
                  "prompt": f"Scenario {i + 1}: your group project partner has not finished their part and the deadline is tomorrow. What would you do?",
                  "options": [f"Talk calmly to them and plan the work together ({i + 1})", f"Finish it all yourself without telling anyone ({i + 1})",
                              f"Tell the teacher that they did nothing ({i + 1})", f"Ignore it and hand in an incomplete project ({i + 1})"],
                  "answer_key": {"points": [2, 1, 0, 0]}} for i in range(n)]
        items += [{"qtype": "REFLECTIVE", "hq_dimension": "AQ", "prompt": "Tell us about a time something did not go to plan. What did you do next?",
                   "options": [], "answer_key": None},
                  {"qtype": "REFLECTIVE", "hq_dimension": "SQ", "prompt": "Describe a time you helped someone in your class. What happened?",
                   "options": [], "answer_key": None},
                  {"qtype": "IDEAS", "hq_dimension": "CQ", "prompt": "List as many uses of an empty plastic bottle as you can.",
                   "options": [], "answer_key": None}]
        return {"items": items}
    topic = (re.search(r'on the topic "([^"]+)"', user) or [None, "the topic"])[1]
    n = int((re.search(r"Draft (\d+) academic", user) or [0, 2])[1])
    items = []
    for i in range(n):
        if i % 2 == 0:
            items.append({"qtype": "MCQ", "prompt": f"Which statement about {topic} is correct? (draft {i + 1})",
                          "options": ["The correct statement", "A common misconception", "An unrelated fact", "An opposite claim"],
                          "answer_key": {"option": 0}, "marks": 1, "topic": topic, "difficulty": "EASY"})
        else:
            items.append({"qtype": "SHORT", "prompt": f"Explain one key idea of {topic} in two sentences. (draft {i + 1})",
                          "options": [], "answer_key": None, "model_answer": f"A clear explanation of a key idea of {topic}.",
                          "rubric": [{"criterion": "States the key idea", "marks": 1}, {"criterion": "Explains it correctly", "marks": 1}],
                          "marks": 2, "topic": topic, "difficulty": "MEDIUM"})
    return {"items": items}


def answer(kind: str, system: str, messages: list[dict]) -> str:
    user = messages[-1]["content"] if messages else ""
    handlers = {"grade": lambda: _grade(user), "hq": lambda: _hq(user), "integrity": lambda: _integrity(user),
                "report": lambda: _report(user), "draft": lambda: _draft(system, user)}
    return json.dumps(handlers.get(kind, lambda: {})())
