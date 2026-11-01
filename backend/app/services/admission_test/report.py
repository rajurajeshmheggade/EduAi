"""Post-submit pipeline (background job "admission_report"): score -> AI-grade -> HQ -> integrity -> compose.

Numbers are computed here, deterministically; the AI only grades subjective answers against their rubric, scores HQ
written evidence and writes narrative. Every AI step validates its JSON, has a 45 s budget with one retry, and falls
back to a deterministic result marked ai_source "fallback". The report is cached in admission_reports.report_json.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import timedelta
from statistics import mean

from psycopg.types.json import Jsonb

from ... import db
from ...workers.tasks import enqueue
from . import ai, prompts, sessions
from . import config as cfg
from . import integrity as integ
from .scoring import HQ_TYPES, answered, objective_score, sjt_points

log = logging.getLogger("eduai.admission_test")
DIMENSIONS = ["IQ", "EQ", "SQ", "AQ", "CQ"]
HQ_DISCLAIMER = ("HQ is a developmental, indicative profile measured only from the candidate's written answers in the HQ section. "
                 "It is never inferred from camera, face, voice, name, gender, school or background, and it is not a clinical or "
                 "psychometric diagnosis.")
PROCTOR_LIMITS = [
    "Browser proctoring is best-effort: it cannot see a second device held outside the camera's view.",
    "It cannot reliably detect a virtual camera or injected video.",
    "It cannot block operating-system shortcuts such as Ctrl+Alt+Del; switching apps is still detected through focus and visibility.",
    "Heuristics such as developer-tools detection can misfire.",
    "Flags are indicators for the teacher to review, not proof of misconduct.",
]


def schedule(session_id) -> None:
    db.execute("INSERT INTO public.admission_reports (session_id, status) VALUES (%s, 'PENDING') "
               "ON CONFLICT (session_id) DO UPDATE SET status = 'PENDING', error = NULL", (session_id,))
    enqueue("admission_report", session_id=str(session_id))


def build(session_id: str) -> None:
    db.execute("UPDATE public.admission_reports SET status = 'RUNNING' WHERE session_id = %s", (session_id,))
    try:
        s = sessions.load(session_id)
        report, sources = compose(s)
        db.execute("UPDATE public.admission_reports SET status = 'READY', report_json = %s, ai_sources = %s, generated_at = NOW(), "
                   "version = version + 1, error = NULL WHERE session_id = %s", (Jsonb(json.loads(json.dumps(report, default=str))),
                                                                                  Jsonb(sources), session_id))
    except Exception as e:  # noqa: BLE001 — surfaced to the teacher, who can regenerate
        log.exception("admission report failed for %s", session_id)
        db.execute("UPDATE public.admission_reports SET status = 'FAILED', error = %s WHERE session_id = %s", (str(e)[:500], session_id))


# ---------------------------------------------------------------- subjective grading
def _fallback_grade(q: dict, text: str) -> dict:
    words = set(re.findall(r"[a-z0-9]+", text.lower()))
    rubric = q["rubric"] or [{"criterion": "Matches the model answer", "marks": float(q["marks"])}]
    out, total = [], 0.0
    for r in rubric:
        want = {w for w in re.findall(r"[a-z0-9]+", f"{r['criterion']} {q.get('model_answer') or ''}".lower()) if len(w) > 3}
        hit = len(words & want) / max(1, min(len(want), 6))
        mx = float(r["marks"])
        got = mx if hit >= 0.5 else round(mx / 2 * 2) / 2 if hit >= 0.25 else 0.0
        total += got
        out.append({"criterion": r["criterion"], "awarded": got, "max": mx, "evidence": ""})
    return {"score": min(float(q["marks"]), total), "rubric": out, "feedback": "Marked automatically by keyword match; please review.",
            "confidence": 0.3}


def grade_answer(q: dict, text: str, school: str, grade_applying: str, age: int, section_title: str) -> tuple[dict, str]:
    marks = float(q["marks"])
    rubric = q["rubric"] or [{"criterion": "Matches the model answer", "marks": marks}]

    def validate(d: dict) -> dict:
        items = []
        for r in d.get("rubric") or []:
            mx = float(r.get("max", 0) or 0)
            items.append({"criterion": str(r.get("criterion", ""))[:300], "awarded": max(0.0, min(mx, float(r.get("awarded", 0) or 0))),
                          "max": mx, "evidence": str(r.get("evidence") or "")[:200]})
        if not items:
            raise ValueError("no rubric")
        score = round(min(marks, sum(i["awarded"] for i in items)) * 2) / 2     # score = Σ awarded, clamped, 0.5 steps
        conf = float(d.get("confidence", 0.5))
        return {"score": score, "rubric": items, "feedback": str(d.get("feedback") or "")[:400], "confidence": max(0.0, min(1.0, conf))}

    user = prompts.GRADE_USER.format(marks=marks, section=section_title, topic=q.get("topic") or "general", question=q["prompt"],
                                     model_answer=q.get("model_answer") or "(not given)", rubric_json=json.dumps(rubric), answer=text, age=age)
    res, source = ai.run("grade", prompts.GRADE.format(school_name=school, grade_applying=grade_applying), user, validate)
    return (res, source) if res else (_fallback_grade(q, text), "fallback")


# ---------------------------------------------------------------- HQ
def _hq_band(v: float | None) -> str | None:
    if v is None:
        return None
    return "Strong" if v >= 80 else "Developing well" if v >= 60 else "Emerging" if v >= 40 else "Needs support"


def hq_profile(questions: list[dict], answers: dict, sections: dict, age: int, grade_applying: str) -> tuple[dict | None, str]:
    hq_qs = [q for q in questions if q["qtype"] in HQ_TYPES]
    aptitude = [q for q in questions if sections.get(q["section"], {}).get("kind") == "APTITUDE"]
    if not hq_qs and not aptitude:
        return None, "none"
    keyed: dict[str, float] = {}
    sjt: dict[str, list[int]] = {}
    for q in hq_qs:
        if q["qtype"] == "SJT":
            p = sjt_points(q, answers.get(str(q["question_id"])))
            sjt.setdefault(q["hq_dimension"], []).append(p or 0)
    for d, pts in sjt.items():
        keyed[d] = round(sum(pts) / (2 * len(pts)) * 100, 1)
    if aptitude:
        got = sum(objective_score(q, answers.get(str(q["question_id"]))) or 0 for q in aptitude)
        top = sum(float(q["marks"]) for q in aptitude)
        if top:
            keyed["IQ"] = round(got / top * 100, 1)
    reflective = [{"prompt": q["prompt"], "answer": (answers.get(str(q["question_id"])) or {}).get("text", "")}
                  for q in hq_qs if q["qtype"] == "REFLECTIVE"]
    ideas_q = next((q for q in hq_qs if q["qtype"] == "IDEAS"), None)
    ideas = {"prompt": ideas_q["prompt"], "answer": (answers.get(str(ideas_q["question_id"])) or {}).get("text", "")} if ideas_q else None
    if ideas and ideas["answer"].strip():
        n = len({x.strip().lower() for x in re.split(r"[\n,;•]+", ideas["answer"]) if x.strip()})
        keyed["CQ"] = float(min(100, n * 10))

    def validate(d: dict) -> dict:
        dims = {}
        for k in DIMENSIONS:
            v = (d.get("dimensions") or {}).get(k) or {}
            score = v.get("score")
            score = None if score is None or v.get("insufficient_evidence") else max(0.0, min(100.0, float(score)))
            dims[k] = {"score": score, "evidence": [str(x)[:160] for x in (v.get("evidence") or [])][:2],
                       "observation": str(v.get("observation") or "")[:240]}
        return {"dimensions": dims, "strengths": [str(x)[:120] for x in (d.get("strengths") or [])][:3],
                "growth_areas": [str(x)[:160] for x in (d.get("growth_areas") or [])][:3]}

    has_text = any(r["answer"].strip() for r in reflective) or (ideas and ideas["answer"].strip())
    res, source = (None, "none")
    if has_text:
        user = prompts.HQ_USER.format(sjt_json=json.dumps(keyed), reflective_json=json.dumps(reflective), ideas_json=json.dumps(ideas or {}))
        res, source = ai.run("hq", prompts.HQ.format(age=age, grade_applying=grade_applying), user, validate)
        if res is None:
            source = "fallback"
    dims = {}
    for k in DIMENSIONS:
        a = (res or {}).get("dimensions", {}).get(k, {}).get("score") if res else None
        kv = keyed.get(k)
        score = round(0.6 * kv + 0.4 * a, 1) if kv is not None and a is not None else kv if kv is not None else a
        dims[k] = {"score": score, "band": _hq_band(score), "keyed": kv, "ai": a,
                   "evidence": (res or {}).get("dimensions", {}).get(k, {}).get("evidence", []) if res else [],
                   "observation": ((res or {}).get("dimensions", {}).get(k, {}).get("observation") if res else None)
                   or ("Based on situational-judgement choices." if kv is not None else "Not enough evidence in the answers.")}
    present = [v["score"] for v in dims.values() if v["score"] is not None]
    composite = round(mean(present), 1) if present else None
    strengths = (res or {}).get("strengths") or [f"{k} {_hq_band(v['score']).lower()}" for k, v in dims.items()
                                                  if v["score"] is not None and v["score"] >= 60][:3]
    growth = (res or {}).get("growth_areas") or [f"Build {k} with guided practice" for k, v in dims.items()
                                                  if v["score"] is not None and v["score"] < 60][:3]
    return {"dimensions": dims, "composite": composite, "band": _hq_band(composite), "strengths": strengths, "growth_areas": growth,
            "disclaimer": HQ_DISCLAIMER, "age_typical": 60}, source


# ---------------------------------------------------------------- the report
def _answer_text(q: dict, a: dict | None) -> str:
    if not a:
        return ""
    if "option" in a:
        i = a["option"]
        return q["options"][i] if 0 <= i < len(q["options"]) else ""
    if "options" in a:
        return "; ".join(q["options"][i] for i in a["options"] if 0 <= i < len(q["options"]))
    return str(a.get("value") if "value" in a else a.get("text", ""))


def _correct_text(q: dict) -> str | None:
    k = q.get("answer_key") or {}
    if q["qtype"] == "MCQ" and k.get("option") is not None:
        return q["options"][k["option"]]
    if q["qtype"] == "MULTI":
        return "; ".join(q["options"][i] for i in k.get("options") or [])
    if q["qtype"] == "NUMERICAL" and k.get("value") is not None:
        return f"{k['value']} (± {k.get('tolerance', 0)})"
    if q["qtype"] == "SJT":
        pts = k.get("points") or []
        return q["options"][pts.index(2)] if 2 in pts else None
    return q.get("model_answer")


def recommendation(academic: float | None, hq: float | None, integrity_band: str, sc: dict) -> dict:
    w_a, w_h = float(sc.get("w_academic", 0.7)), float(sc.get("w_hq", 0.3))
    if academic is None and hq is None:
        comp = None
    elif hq is None:
        comp = academic
    elif academic is None:
        comp = hq
    else:
        comp = round((academic * w_a + hq * w_h) / ((w_a + w_h) or 1), 1)
    b = {**cfg.TUNABLES["bands"], **(sc.get("bands") or {})}
    if comp is None:
        label = "Not enough evidence"
    elif comp >= b["strong"]:
        label = "Strongly recommended"
    elif comp >= b["recommended"]:
        label = "Recommended"
    elif comp >= b["borderline"]:
        label = "Borderline"
    else:
        label = "Not recommended at this time"
    on_hold = integrity_band == "Low"
    return {"composite": comp, "band": label, "on_hold": on_hold, "label": "On hold – see integrity section" if on_hold else label,
            "weights": {"academic": w_a, "hq": w_h}, "cutoffs": b}


def compose(s: dict) -> tuple[dict, dict]:
    org = db.fetch_one("SELECT org_name FROM public.organizations WHERE org_code = %s", (s["org_code"],)) or {"org_name": s["org_code"]}
    school = org["org_name"]
    teacher = db.fetch_one("SELECT full_name FROM public.app_users WHERE user_code = %s", (s["launched_by"],))
    age = (s["started_at"] or sessions.now()).date().year - s["dob"].year - (
        ((s["started_at"] or sessions.now()).date().month, (s["started_at"] or sessions.now()).date().day) < (s["dob"].month, s["dob"].day))
    sections = {x["key"]: x for x in s["sections"]}
    order = [o["question_id"] for o in s["question_order"] or []]
    qrows = {str(q["question_id"]): q for q in db.fetch_all("SELECT * FROM public.admission_questions WHERE test_id = %s", (s["test_id"],))}
    questions = [qrows[q] for q in order if q in qrows]
    arows = {str(a["question_id"]): a for a in db.fetch_all("SELECT * FROM public.admission_answers WHERE session_id = %s", (s["session_id"],))}
    answers = {k: v["answer"] for k, v in arows.items()}
    grade_src = {"ai": 0, "fallback": 0, "deterministic": 0}

    # 1-2. objective + subjective scoring of academic questions
    review = []
    with db.connection() as conn:
        for n, q in enumerate(questions, 1):
            qid = str(q["question_id"])
            a = answers.get(qid)
            sec = sections.get(q["section"], {"title": q["section"], "kind": "ACADEMIC"})
            item = {"number": n, "question_id": qid, "section": sec["title"], "section_key": q["section"], "kind": sec["kind"],
                    "qtype": q["qtype"], "prompt": q["prompt"], "answer": _answer_text(q, a), "correct": _correct_text(q),
                    "marks": None, "max": None if q["qtype"] in HQ_TYPES else float(q["marks"]), "feedback": None, "confidence": None,
                    "low_confidence": False, "ai_source": None, "topic": q.get("topic"), "difficulty": q.get("difficulty"),
                    "source": q.get("source_label"), "time_s": round((arows.get(qid) or {}).get("time_spent_ms", 0) / 1000, 1),
                    "answered": answered(q, a)}
            if q["qtype"] in HQ_TYPES:
                if q["qtype"] == "SJT":
                    item["points"] = sjt_points(q, a)
                review.append(item)
                continue
            auto = objective_score(q, a)
            final, ai_result = auto, None
            if auto is None:
                text = item["answer"]
                if not text.strip():
                    final, item["ai_source"] = 0.0, "blank"
                else:
                    ai_result, src = grade_answer(q, text, school, s["grade_applying"], age, sec["title"])
                    final = ai_result["score"]
                    item.update(feedback=ai_result["feedback"], confidence=ai_result["confidence"], rubric=ai_result["rubric"],
                                low_confidence=ai_result["confidence"] < 0.5, ai_source=src)
                    grade_src["fallback" if src == "fallback" else "ai"] += 1
            else:
                grade_src["deterministic"] += 1
                item["ai_source"] = "deterministic"
            item["marks"] = final
            conn.execute(
                "INSERT INTO public.admission_answers (session_id, question_id, answer, auto_score, ai_score, ai_result, final_score) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (session_id, question_id) DO UPDATE SET auto_score = EXCLUDED.auto_score, "
                "ai_score = EXCLUDED.ai_score, ai_result = EXCLUDED.ai_result, final_score = EXCLUDED.final_score",
                (s["session_id"], q["question_id"], Jsonb(a) if a is not None else None, auto,
                 ai_result["score"] if ai_result else None, Jsonb(ai_result) if ai_result else None, final))
            review.append(item)

        # 3. implausibly fast answers (server-side TIME_ANOMALY, report only)
        if not conn.execute("SELECT 1 FROM public.admission_proctor_events WHERE session_id = %s AND code = 'TIME_ANOMALY' LIMIT 1",
                            (s["session_id"],)).fetchone():
            run = []
            for it in review:
                fast = it["answered"] and it["time_s"] < 3
                long_q = len(it["prompt"].split()) >= 40
                if fast and long_q:
                    sessions.insert_event(conn, s, "TIME_ANOMALY", details={"question": it["number"], "time_s": it["time_s"], "rule": "long question"},
                                          at=s["submitted_at"] or sessions.now())
                run = run + [it["number"]] if fast else []
                if len(run) == 5:
                    sessions.insert_event(conn, s, "TIME_ANOMALY", details={"questions": run, "rule": "5 fast answers in a row"},
                                          at=s["submitted_at"] or sessions.now())
        anomalies = {d for e in sessions.events_of(s["session_id"], conn) if e["code"] == "TIME_ANOMALY"
                     for d in ([e["details"].get("question")] + list(e["details"].get("questions") or [])) if d}
    for it in review:
        it["time_anomaly"] = it["number"] in anomalies

    # 4. academic sections, topics, difficulty
    academic = [it for it in review if it["kind"] != "HQ"]
    sec_rows = []
    for key, sec in sections.items():
        items = [it for it in academic if it["section_key"] == key]
        if not items:
            continue
        got, top = sum(it["marks"] or 0 for it in items), sum(it["max"] or 0 for it in items)
        sec_rows.append({"section": sec["title"], "kind": sec["kind"], "score": round(got, 2), "max": round(top, 2),
                         "pct": round(got / top * 100, 1) if top else None, "time_min": round(sum(it["time_s"] for it in items) / 60, 1),
                         "answered": sum(1 for it in items if it["answered"]), "questions": len(items)})
    total_got, total_max = sum(r["score"] for r in sec_rows), sum(r["max"] for r in sec_rows)
    academic_pct = round(total_got / total_max * 100, 1) if total_max else None

    def group(field: str, fallback: str) -> list[dict]:
        g: dict[str, dict] = {}
        for it in academic:
            k = it.get(field) or fallback
            r = g.setdefault(k, {field: k, "correct": 0, "total": 0, "score": 0.0, "max": 0.0})
            r["total"] += 1
            r["score"] += it["marks"] or 0
            r["max"] += it["max"] or 0
            r["correct"] += 1 if it["max"] and (it["marks"] or 0) >= it["max"] else 0
        return [{**r, "pct": round(r["score"] / r["max"] * 100, 1) if r["max"] else None} for r in g.values()]

    topics = group("topic", "General")
    difficulty = group("difficulty", "Not set")

    # 5. HQ
    hq, hq_source = hq_profile(questions, answers, sections, age, s["grade_applying"])

    # 6. integrity
    eff = sessions.eff(s)
    events = sessions.events_of(s["session_id"])
    ires = integ.evaluate(events, eff)
    flagged = [e for e in events if e["code"] not in cfg.NOT_FLAGS and e["code"] != "TIME_ANOMALY"]
    summary: dict[str, dict] = {}
    for e in flagged:
        f = cfg.FLAGS[e["code"]]
        r = summary.setdefault(e["code"], {"code": e["code"], "label": f.label, "severity": f.severity, "count": 0, "total_duration_s": 0.0,
                                           "max_confidence": None, "points": ires["deducted"].get(e["code"], 0), "calibration_only": True})
        r["count"] += 1
        r["total_duration_s"] = round(r["total_duration_s"] + (e["duration_ms"] or 0) / 1000, 1)
        if e["confidence"] is not None:
            r["max_confidence"] = max(float(e["confidence"]), r["max_confidence"] or 0)
        r["calibration_only"] = r["calibration_only"] and e["calibration"]
    started = s["started_at"]
    timeline = [{"event_id": e["event_id"], "t_offset_s": round((e["server_ts"] - started).total_seconds(), 1) if started else 0,
                 "code": e["code"], "label": cfg.FLAGS[e["code"]].label, "severity": e["severity"], "duration_s": round((e["duration_ms"] or 0) / 1000, 1),
                 "confidence": float(e["confidence"]) if e["confidence"] is not None else None, "calibration": e["calibration"],
                 "evidence": bool(e["evidence_key"]), "details": e["details"] or {}} for e in events if e["code"] != "PRESENCE_SNAPSHOT"]
    evidence = [{"event_id": e["event_id"], "code": e["code"], "label": cfg.FLAGS[e["code"]].label,
                 "t_offset_s": round((e["server_ts"] - started).total_seconds(), 1) if started else 0, "kind": (e["details"] or {}).get("evidence", "webcam")}
                for e in events if e["evidence_key"]]
    duration_min = round(((s["submitted_at"] or sessions.now()) - started).total_seconds() / 60, 1) if started else 0
    info = s["client_info"] or {}
    system = {"screens_extended": info.get("screens_extended"), "camera_label": info.get("camera_label"),
              "virtual_camera_suspected": info.get("virtual_camera_suspected"), "screen_surface": info.get("screen_surface"),
              "browser": info.get("browser"), "screen": info.get("screen"), "network_ms": info.get("network_ms")}

    def v_integrity(d: dict) -> dict:
        txt = str(d.get("summary") or "").strip()
        if not txt or re.search(r"\b(cheat|cheated|cheating|dishonest)\b", txt, re.I):
            raise ValueError("summary missing or not neutral")
        return {"summary": txt[:1200], "top_concerns": [str(x)[:120] for x in (d.get("top_concerns") or [])][:3],
                "clean_areas": [str(x)[:120] for x in (d.get("clean_areas") or [])][:3]}

    flags_list = sorted(summary.values(), key=lambda r: (-r["points"], -r["count"]))
    iuser = prompts.INTEGRITY_USER.format(
        score=ires["score"], band=ires["band"], submit_reason=s["submit_reason"], duration_min=duration_min,
        flags_json=json.dumps([{k: r[k] for k in ("code", "label", "count", "total_duration_s", "max_confidence", "severity")} for r in flags_list]),
        timeline_json=json.dumps([{k: t[k] for k in ("t_offset_s", "code", "duration_s", "confidence")} for t in timeline[:40]]),
        system_json=json.dumps({"screens": "extended" if system["screens_extended"] else "single", **system}))
    narrative_i, isource = ai.run("integrity", prompts.INTEGRITY, iuser, v_integrity)
    if not narrative_i:
        narrative_i = {"summary": (f"The system recorded {sum(r['count'] for r in flags_list)} proctoring flag(s) across {len(flags_list)} type(s). "
                                   f"The integrity score is {ires['score']}/100 ({ires['band']}). Flags are indicators for review, not proof.")
                       if flags_list else f"The system recorded no proctoring flags. The integrity score is {ires['score']}/100 ({ires['band']}).",
                       "top_concerns": [r["label"] for r in flags_list[:3]], "clean_areas": [] if flags_list else ["No flags recorded"]}
        isource = "fallback"

    # 7. composite + band
    rec = recommendation(academic_pct, hq["composite"] if hq else None, ires["band"], s["scoring_config"] or {})

    # 8. narrative
    def v_report(d: dict) -> dict:
        out = {}
        for k, n in (("executive_summary", 120), ("academic_commentary", 110), ("hq_commentary", 110), ("suggested_next_step", 40)):
            v = str(d.get(k) or "").strip()
            if not v:
                raise ValueError(f"missing {k}")
            out[k] = " ".join(v.split()[:n])
        out["strengths"] = [str(x)[:140] for x in (d.get("strengths") or [])][:3]
        out["development_areas"] = [str(x)[:140] for x in (d.get("development_areas") or [])][:3]
        return out

    ruser = prompts.REPORT_USER.format(
        first_name=s["full_name"].split()[0], age=age, grade_applying=s["grade_applying"], test_title=s["test_title"], time_used_min=duration_min,
        duration_min=s["duration_minutes"] + int((s["accommodations"] or {}).get("extra_time_minutes", 0) or 0), submit_reason=s["submit_reason"],
        sections_json=json.dumps([{k: r[k] for k in ("section", "score", "max", "pct", "time_min")} for r in sec_rows]),
        topics_json=json.dumps([{"topic": t["topic"], "correct": t["correct"], "total": t["total"]} for t in topics]),
        hq_json=json.dumps({k: hq[k] for k in ("composite", "band", "strengths", "growth_areas")} | {
            "dimensions": {d: v["score"] for d, v in hq["dimensions"].items()}} if hq else {}),
        integrity_json=json.dumps({"score": ires["score"], "band": ires["band"], "summary": narrative_i["summary"], "top_concerns": narrative_i["top_concerns"]}),
        composite_pct=rec["composite"], band_label=rec["label"])
    narrative, rsource = ai.run("report", prompts.REPORT, ruser, v_report, temperature=0.3)
    if not narrative:
        rsource = "fallback"
        best = max(sec_rows, key=lambda r: r["pct"] or 0)["section"] if sec_rows else None
        narrative = {"executive_summary": f"{s['full_name'].split()[0]} completed {s['test_title']}. Composite {rec['composite']} gives the band "
                                          f"“{rec['label']}”. See the sections below for the detail.",
                     "academic_commentary": f"Academic score {academic_pct}%." + (f" Strongest section: {best}." if best else ""),
                     "hq_commentary": f"HQ composite {hq['composite']} ({hq['band']})." if hq and hq["composite"] is not None else "No HQ evidence.",
                     "strengths": (hq or {}).get("strengths", [])[:3], "development_areas": (hq or {}).get("growth_areas", [])[:3],
                     "suggested_next_step": "Proceed to an interview with the teacher." if not rec["on_hold"] else "Review the integrity section before deciding."}

    retention_until = (s["submitted_at"] or sessions.now()) + timedelta(days=cfg.TUNABLES["evidence_retention_days"])
    report = {
        "report_id": f"ADM-{str(s['session_id'])[:8].upper()}", "generated_at": sessions.now(), "school": {"name": school},
        "candidate": {"name": s["full_name"], "first_name": s["full_name"].split()[0], "age": age, "grade_applying": s["grade_applying"],
                      "has_photo": bool(s["id_photo_key"])},
        "test": {"title": s["test_title"], "duration_min": s["duration_minutes"], "extra_time_min": int((s["accommodations"] or {}).get("extra_time_minutes", 0) or 0)},
        "session": {"session_id": s["session_id"], "started_at": s["started_at"], "submitted_at": s["submitted_at"], "time_used_min": duration_min,
                    "submit_reason": s["submit_reason"], "launched_by": teacher and teacher["full_name"], "consent_at": s["consent_at"],
                    "consent_version": s["consent_version"], "guardian_consent": s["guardian_consent"]},
        "scores": {**rec, "academic_pct": academic_pct, "academic_score": round(total_got, 2), "academic_max": round(total_max, 2),
                   "hq_composite": hq["composite"] if hq else None, "hq_band": hq["band"] if hq else None,
                   "integrity": ires["score"], "integrity_band": ires["band"], "flag_count": sum(r["count"] for r in flags_list if not r["calibration_only"])},
        "sections": sec_rows, "topics": topics, "difficulty": difficulty,
        "time_strip": [{"number": it["number"], "time_s": it["time_s"], "anomaly": it["time_anomaly"], "answered": it["answered"]} for it in review],
        "hq": hq,
        "integrity": {"score": ires["score"], "band": ires["band"], **narrative_i, "flags": flags_list, "timeline": timeline, "evidence": evidence,
                      "warnings": ires["warnings"], "critical": ires["critical"], "system": system, "preset": eff["preset"],
                      "duration_s": round(duration_min * 60)},
        "questions": review, "narrative": narrative,
        "methodology": {"integrity_formula": "integrity = max(0, 100 − Σ per flag type min(cap, Σ points)); 85–100 High · 60–84 Moderate · 0–59 Low",
                        "composite_formula": f"composite = academic % × {rec['weights']['academic']} + HQ composite × {rec['weights']['hq']}",
                        "bands": rec["cutoffs"], "hq": HQ_DISCLAIMER, "limits": PROCTOR_LIMITS,
                        "ai": "AI assisted with grading written answers against the teacher's rubric, scoring HQ written evidence and writing the "
                              "narrative. It never changes a number, grade, band or flag.",
                        "retention_until": retention_until, "deletion": "Ask the school (the teacher or an administrator) to delete the candidate's data."},
    }
    sources = {"grade": grade_src, "hq": hq_source, "integrity": isource, "report": rsource, "engine": ai.engine_name()}
    report["ai_sources"] = sources
    return report, sources
