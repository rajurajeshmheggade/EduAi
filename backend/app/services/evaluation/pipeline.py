"""Background evaluation job: for each matched script -> SL.No OCR -> grading -> results + totals (FR-EV-09/10).

Progress lives in public.pipeline_jobs, per-script status in evaluation_candidate_scripts, so the UI can poll and
a restart never loses finished work. A failure on one script never stops the others.
"""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from psycopg.types.json import Jsonb

from ... import db
from ...services.storage import get_storage
from . import grading, ocr

log = logging.getLogger("eduai.eval.pipeline")
CONCURRENCY = 3


def load_masters(test_id: UUID) -> list[dict]:
    rows = db.fetch_all(
        "SELECT master_q_id, sl_no, display_order, question_type, question_text, mcq_options, correct_option, max_marks, "
        "model_answer_text, key_rubric_points, model_answer_embedding::text AS emb FROM public.evaluation_master_questions "
        "WHERE eval_test_id = %s ORDER BY display_order", (test_id,))
    for r in rows:
        r["embedding"] = json.loads(r.pop("emb")) if r.get("emb") else None
        r["max_marks"] = float(r["max_marks"])
        r["key_rubric_points"] = list(r["key_rubric_points"] or [])
        r["mcq_options"] = list(r["mcq_options"] or [])
    return rows


def _job(job_id: UUID, status: str, progress: float, detail: dict | None = None, error: str | None = None) -> None:
    db.call_scalar("usp_update_job", job_id, status, progress, Jsonb(detail) if detail is not None else None, error,
                   casts=["uuid", None, "numeric", "jsonb", None])


def _set_script(script_id: UUID, status: str, error: str | None = None) -> None:
    db.execute("UPDATE public.evaluation_candidate_scripts SET processing_status = %s, error = %s WHERE script_id = %s",
               (status, error, script_id))


def evaluate_script(test: dict, masters: list[dict], script: dict) -> None:
    sid = script["script_id"]
    _set_script(sid, "OCR_IN_PROGRESS")
    if script.get("submission_mode") == "ONLINE_TEST_UI":  # typed answers from the test runner — no OCR
        answers = {str(k): str(v) for k, v in (script.get("answers_json") or {}).items() if str(v).strip()}
        read = ocr.ScriptOCR({k: ocr.SlnoAnswer(v, []) for k, v in answers.items()}, "typed", 0)
    else:
        read = ocr.read_script(get_storage().get(script["script_key"]), masters)
    results = []
    for m in masters:
        ans = read.answers.get(m["sl_no"])
        g = grading.grade(m, ans.text if ans else None)
        results.append({**g, "sl_no": m["sl_no"], "master_q_id": m["master_q_id"], "max_marks": m["max_marks"],
                        "text": ans.text if ans and g["is_attempted"] else None,
                        "pages": ans.pages if ans else []})
    obtained = sum(r["awarded_marks"] for r in results)
    summary = grading.overall_feedback(test["test_title"], results, obtained, float(test["total_max_marks"]))

    with db.connection() as conn:  # replace any earlier results atomically
        conn.execute("DELETE FROM public.evaluation_slno_results WHERE script_id = %s", (sid,))
        for r in results:
            conn.execute(
                "INSERT INTO public.evaluation_slno_results(script_id, eval_test_id, master_q_id, sl_no, is_attempted, "
                "student_ocr_text, page_numbers, semantic_similarity, ai_awarded_marks, awarded_marks, max_marks, "
                "why_marks_given, missing_points, feedback) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (sid, test["eval_test_id"], r["master_q_id"], r["sl_no"], r["is_attempted"], r["text"], r["pages"],
                 r["semantic_similarity"], r["awarded_marks"], r["awarded_marks"], r["max_marks"],
                 r["why_marks_given"], Jsonb(r["missing_points"]), r["feedback"]))
        conn.execute("UPDATE public.evaluation_candidate_scripts SET page_count = %s, ocr_method = %s, "
                     "overall_ai_feedback = %s, processing_status = 'EVALUATED', error = NULL, evaluated_at = NOW() "
                     "WHERE script_id = %s", (read.page_count, read.method, summary, sid))
        conn.execute("SELECT public.usp_eval_recompute_script(%s)", (sid,))


def evaluate_test(test_id: str, job_id: str, script_ids: list[str] | None = None) -> None:
    tid, jid = UUID(test_id), UUID(job_id)
    try:
        test = db.fetch_one("SELECT * FROM public.evaluation_tests WHERE eval_test_id = %s", (tid,))
        masters = load_masters(tid)
        if not test or not masters:
            raise ValueError("Test has no saved questions")
        ids = [UUID(x) for x in script_ids or []]
        scripts = db.fetch_all(
            "SELECT * FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s AND student_user_code IS NOT NULL "
            "AND (cardinality(%s::uuid[]) = 0 OR script_id = ANY(%s::uuid[])) "
            "AND (cardinality(%s::uuid[]) > 0 OR processing_status IN ('UPLOADED', 'QUEUED', 'FAILED')) "
            "ORDER BY uploaded_pdf_filename", (tid, ids, ids, ids))
        total = len(scripts)
        done = failed = 0
        _job(jid, "running", 1, {"stage": "evaluating", "done": 0, "failed": 0, "total": total})

        def run(script: dict) -> tuple[str, str | None]:
            try:
                evaluate_script(test, masters, script)
                return script["uploaded_pdf_filename"], None
            except Exception as exc:  # noqa: BLE001 — record per-script failure and continue
                log.exception("evaluation failed for %s", script["uploaded_pdf_filename"])
                _set_script(script["script_id"], "FAILED", str(exc)[:500])
                return script["uploaded_pdf_filename"], str(exc)[:200]

        errors = []
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            for name, err in pool.map(run, scripts):
                done += 1
                if err:
                    failed += 1
                    errors.append({"file": name, "error": err})
                _job(jid, "running", round(100 * done / max(total, 1), 1),
                     {"stage": "evaluating", "done": done, "failed": failed, "total": total, "errors": errors[-20:]})

        evaluated = db.fetch_one("SELECT COUNT(*) AS n FROM public.evaluation_candidate_scripts WHERE eval_test_id = %s "
                                 "AND processing_status IN ('EVALUATED', 'REVIEWED')", (tid,))["n"]
        # Keep PUBLISHED, and don't end a teacher's batch run that another job (a student submission) overlaps.
        db.execute("UPDATE public.evaluation_tests SET status = CASE WHEN status = 'PUBLISHED' THEN status "
                   "WHEN status = 'PROCESSING' AND last_job_id IS DISTINCT FROM %s THEN status "
                   "WHEN %s > 0 THEN 'EVALUATED' ELSE 'READY' END, updated_at = NOW() WHERE eval_test_id = %s",
                   (jid, evaluated, tid))
        _job(jid, "completed", 100, {"stage": "done", "done": done, "failed": failed, "total": total, "errors": errors})
    except Exception as exc:  # noqa: BLE001 — the job must record any failure
        log.exception("evaluate_test failed")
        db.execute("UPDATE public.evaluation_tests SET status = 'READY' WHERE eval_test_id = %s AND status = 'PROCESSING' "
                   "AND last_job_id = %s", (tid, jid))
        _job(jid, "failed", 0, None, str(exc)[:500])
