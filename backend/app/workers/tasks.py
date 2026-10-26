"""Background tasks. Persistent state lives in PostgreSQL (pipeline_jobs, subject_textbooks.vector_status),
so progress survives API/worker restarts — replacing the volatile in-memory runtime_state.py queues."""
from __future__ import annotations

import logging
import threading
from typing import Callable
from uuid import UUID

from psycopg.types.json import Jsonb

from .. import db
from ..config import get_settings
from ..providers import get_embedder
from ..services.pdf_chunker import chunk_document, parse_pdf
from ..services.storage import get_storage

log = logging.getLogger("eduai.tasks")
EMBED_BATCH = 64


def _job(job_id: UUID, status: str, progress: float, detail: dict | None = None, error: str | None = None) -> None:
    db.call_scalar(
        "usp_update_job", job_id, status, progress, Jsonb(detail) if detail is not None else None, error,
        casts=["uuid", None, "numeric", "jsonb", None],
    )


def vectorize_textbook(textbook_id: str, job_id: str) -> None:
    """Stage 5: PDF parse -> semantic chunks -> embeddings -> pgvector (usp_insert_textbook_chunk)."""
    tb_id, jb_id = UUID(textbook_id), UUID(job_id)
    try:
        tb = db.call_row("usp_get_textbook", tb_id)
        if not tb:
            raise ValueError("Textbook not found")
        db.call_scalar("usp_update_textbook_status", tb_id, "processing", None)
        _job(jb_id, "running", 2, {"stage": "parsing"})

        data = get_storage().get(tb["blob_pdf_url"])
        parsed = parse_pdf(data)
        chapters, chunks = chunk_document(parsed, tb["title"])
        if not chunks:
            raise ValueError("No extractable text found (scanned PDF? enable Vision captioning)")

        db.call_scalar("usp_delete_textbook_chunks", tb_id)
        db.call_scalar("usp_update_textbook_status", tb_id, "processing", len(parsed.pages))
        embedder = get_embedder()
        total = len(chunks)
        for i in range(0, total, EMBED_BATCH):
            batch = chunks[i : i + EMBED_BATCH]
            vectors = embedder.embed([c.text for c in batch])
            with db.connection() as conn:
                for c, v in zip(batch, vectors):
                    conn.execute(
                        "SELECT public.usp_insert_textbook_chunk(%s,%s,%s,%s,%s,%s,%s,%s,%s::vector,%s)",
                        (tb_id, tb["subject_code"], c.chapter_number, c.chapter_title, c.page_number,
                         c.chunk_index, c.text, c.token_count, db.vec_literal(v), Jsonb(c.metadata)),
                    )
            pct = 10 + 88 * min(i + EMBED_BATCH, total) / total
            _job(jb_id, "running", round(pct, 1),
                 {"stage": "embedding", "chunks_done": min(i + EMBED_BATCH, total), "chunks_total": total})

        db.call_scalar("usp_update_textbook_status", tb_id, "indexed", len(parsed.pages))
        _job(jb_id, "completed", 100,
             {"stage": "done", "chunks": total, "chapters": len(chapters),
              "pages": len(parsed.pages), "scanned_pages": parsed.scanned_pages})
    except Exception as exc:  # noqa: BLE001 — job must record any failure
        log.exception("vectorize_textbook failed")
        try:
            db.call_scalar("usp_update_textbook_status", tb_id, "failed", None)
            _job(jb_id, "failed", 0, None, str(exc)[:500])
        except Exception:  # noqa: BLE001
            log.exception("could not record failure")


def evaluate_test(test_id: str, job_id: str, script_ids: list[str] | None = None) -> None:
    """AI evaluation of answer scripts (FR-EV-09/10)."""
    from ..services.evaluation.pipeline import evaluate_test as run

    run(test_id, job_id, script_ids)


TASKS: dict[str, Callable[..., None]] = {"vectorize_textbook": vectorize_textbook, "evaluate_test": evaluate_test}


def enqueue(task_name: str, **kwargs) -> None:
    """Celery+Redis when REDIS_URL is set; otherwise an in-process worker thread (local dev)."""
    if get_settings().redis_url:
        from .celery_app import celery_app

        celery_app.send_task(f"eduai.{task_name}", kwargs=kwargs)
    else:
        threading.Thread(target=TASKS[task_name], kwargs=kwargs, daemon=True, name=f"task-{task_name}").start()
