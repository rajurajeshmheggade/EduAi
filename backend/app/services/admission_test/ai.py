"""One AI step = one JSON call with schema validation, a 45 s budget and one retry; on failure the caller falls back
to a deterministic result marked ai_source "fallback" (spec §7)."""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Callable, TypeVar

from ...providers import get_admission_llm

log = logging.getLogger("eduai.admission_test")
T = TypeVar("T")
BUDGET_S = 45.0
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="adm-ai")


def run(kind: str, system: str, user: str, validate: Callable[[dict], T], *, temperature: float = 0.2,
        budget_s: float = BUDGET_S) -> tuple[T | None, str]:
    """(validated result, source). source = the model name, or "fallback" when both attempts failed."""
    llm = get_admission_llm()
    deadline = time.monotonic() + budget_s
    for attempt in (1, 2):
        left = deadline - time.monotonic()
        if left <= 1:
            break
        future = _pool.submit(llm.chat, f"[TASK:ADM:{kind}]\n{system}", [{"role": "user", "content": user}],
                              json_mode=True, temperature=temperature)
        try:
            raw = future.result(timeout=left)
            return validate(json.loads(raw)), llm.name
        except FutureTimeout:
            log.warning("admission AI %s timed out (attempt %s)", kind, attempt)
            break
        except Exception as e:  # noqa: BLE001 — invalid JSON / schema / provider error: retry once, then fall back
            log.warning("admission AI %s failed (attempt %s): %s", kind, attempt, type(e).__name__)
    return None, "fallback"


def engine_name() -> str:
    return get_admission_llm().name
