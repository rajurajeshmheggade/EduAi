"""Background page pipeline: prepares the pages a reader is about to need while they listen to the current one.

* `SingleFlight` — per-key de-duplication of in-flight work: the first caller of a key computes it, concurrent
  callers of the same key wait for that result, and unrelated keys never block each other (no striped locks).
* `Pipeline` — a bounded pool of worker threads fed by one priority queue. Each reader has a *window*: an ordered
  list of steps (e.g. next page's script, its first audio part, the rest of this page's audio). A step's rank is its
  position in the window, so across readers everybody's most urgent step runs first, FIFO within a rank.
  - A step may name a step it `needs`; it waits while that one is queued or running (first audio part after the
    script, page N+1's lesson after page N's, for continuity).
  - `follow(reader, steps)` replaces the reader's window: queued steps nobody else wants are cancelled, running
    ones are told to stop at their next check (`cancelled()`), steps shared with other readers keep going.
  - A failing step is retried with exponential backoff, then reported as failed for `failed_ttl` seconds (so a
    status poll can show it) before it may be tried again.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import Future
from dataclasses import dataclass, field
from itertools import count
from typing import Callable, Hashable, Literal, TypeVar

log = logging.getLogger("eduai.pipeline")

T = TypeVar("T")
State = Literal["queued", "preparing", "failed"]


class SingleFlight:
    """Runs `fn` once per key at a time; concurrent callers of the same key share the result (or the error)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._calls: dict[str, Future] = {}

    def do(self, key: str, fn: Callable[[], T]) -> T:
        with self._lock:
            fut = self._calls.get(key)
            leader = fut is None
            if leader:
                fut = self._calls[key] = Future()
        if not leader:
            return fut.result()
        try:
            out = fn()
        except BaseException as e:
            fut.set_exception(e)
            raise
        else:
            fut.set_result(out)
            return out
        finally:
            with self._lock:
                self._calls.pop(key, None)

    def busy(self, key: str) -> bool:
        with self._lock:
            return key in self._calls


@dataclass
class Step:
    key: str
    run: Callable[[Callable[[], bool]], object]   # gets `cancelled()`; long steps check it between units of work
    needs: str | None = None


@dataclass
class _Task:
    step: Step
    seq: int
    readers: dict[Hashable, int] = field(default_factory=dict)   # reader -> rank in that reader's window
    pinned_rank: int | None = None                                 # one-off submit(): never cancelled by a reader
    state: Literal["queued", "running"] = "queued"
    attempts: int = 0
    not_before: float = 0.0
    cancelled: bool = False

    @property
    def rank(self) -> int:
        ranks = list(self.readers.values()) + ([self.pinned_rank] if self.pinned_rank is not None else [])
        return min(ranks) if ranks else 1 << 30


class Pipeline:
    def __init__(self, workers: int = 3, retries: int = 1, backoff: float = 0.5, failed_ttl: float = 120.0,
                 give_up: tuple[type[BaseException], ...] = (LookupError,), name: str = "pipeline") -> None:
        self.workers, self.retries, self.backoff, self.failed_ttl = max(1, workers), max(0, retries), backoff, failed_ttl
        self.give_up, self.name = give_up, name
        self._cv = threading.Condition()
        self._tasks: dict[str, _Task] = {}
        self._windows: dict[Hashable, list[str]] = {}
        self._failed: dict[str, float] = {}
        self._seq = count()
        self._threads: list[threading.Thread] = []
        self._closed = False

    # ------------------------------------------------------------ public
    def follow(self, reader: Hashable, steps: list[Step]) -> None:
        """Make `steps` (most urgent first) the reader's lookahead window, replacing the previous one."""
        with self._cv:
            wanted = {s.key for s in steps}
            for key in self._windows.get(reader, []):
                if key not in wanted:
                    self._release(key, reader)
            now = time.monotonic()
            for rank, step in enumerate(steps):
                if self._failed.get(step.key, 0) > now:
                    continue                          # failed recently: report it, do not hammer it
                t = self._tasks.get(step.key)
                if t is None:
                    t = self._tasks[step.key] = _Task(step, next(self._seq))
                t.readers[reader] = rank
                t.cancelled = False
            self._windows[reader] = [s.key for s in steps]
            self._start()
            self._cv.notify_all()

    def submit(self, step: Step, rank: int = 100) -> None:
        """One-off background step not tied to a reader (e.g. replacing a cached fallback); de-duplicated by key."""
        with self._cv:
            t = self._tasks.get(step.key)
            if t is None:
                t = self._tasks[step.key] = _Task(step, next(self._seq))
            t.pinned_rank = rank if t.pinned_rank is None else min(t.pinned_rank, rank)
            t.cancelled = False
            self._start()
            self._cv.notify_all()

    def forget(self, reader: Hashable) -> None:
        """The reader left: cancel whatever only they were waiting for."""
        with self._cv:
            for key in self._windows.pop(reader, []):
                self._release(key, reader)

    def state(self, key: str) -> State | None:
        with self._cv:
            t = self._tasks.get(key)
            if t is not None:
                return "preparing" if t.state == "running" else "queued"
            return "failed" if self._failed.get(key, 0) > time.monotonic() else None

    def wait_idle(self, timeout: float = 10.0) -> bool:
        """True once nothing is queued or running (tests / shutdown)."""
        end = time.monotonic() + timeout
        with self._cv:
            while self._tasks:
                left = end - time.monotonic()
                if left <= 0:
                    return False
                self._cv.wait(left)
            return True

    def shutdown(self) -> None:
        with self._cv:
            self._closed = True
            self._tasks.clear()
            self._cv.notify_all()

    # ------------------------------------------------------------ internals (hold self._cv)
    def _release(self, key: str, reader: Hashable) -> None:
        t = self._tasks.get(key)
        if t is None:
            return
        t.readers.pop(reader, None)
        if t.readers or t.pinned_rank is not None:
            return
        if t.state == "queued":
            del self._tasks[key]                     # never started: drop it
        else:
            t.cancelled = True                       # running: stop at its next cancelled() check

    def _start(self) -> None:
        while len(self._threads) < self.workers and not self._closed:
            th = threading.Thread(target=self._work, name=f"{self.name}-{len(self._threads)}", daemon=True)
            self._threads.append(th)
            th.start()

    def _pick(self) -> tuple[_Task | None, float | None]:
        now = time.monotonic()
        best: _Task | None = None
        wake: float | None = None
        for t in self._tasks.values():
            if t.state != "queued":
                continue
            if t.not_before > now:
                wake = min(wake or t.not_before, t.not_before)
                continue
            if t.step.needs and t.step.needs in self._tasks:
                continue                             # its prerequisite is still queued or running
            if best is None or (t.rank, t.seq) < (best.rank, best.seq):
                best = t
        return best, (None if wake is None else max(0.0, wake - now))

    def _work(self) -> None:
        while True:
            with self._cv:
                task = None
                while task is None:
                    if self._closed:
                        return
                    task, wait = self._pick()
                    if task is None:
                        self._cv.wait(wait)
                task.state = "running"
                task.attempts += 1
            error: BaseException | None = None
            try:
                task.step.run(lambda t=task: t.cancelled)
            except Exception as e:  # noqa: BLE001 — recorded below; background work never crashes the worker
                error = e
            with self._cv:
                if self._tasks.get(task.step.key) is not task:
                    pass                             # shut down / replaced meanwhile
                elif error is None or task.cancelled:
                    del self._tasks[task.step.key]
                    self._failed.pop(task.step.key, None)
                elif isinstance(error, self.give_up) or task.attempts > self.retries:
                    log.info("%s step %s failed after %s attempt(s): %s", self.name, task.step.key, task.attempts,
                             type(error).__name__)
                    del self._tasks[task.step.key]
                    self._failed[task.step.key] = time.monotonic() + self.failed_ttl
                else:
                    task.state = "queued"
                    task.not_before = time.monotonic() + self.backoff * (2 ** (task.attempts - 1))
                self._prune()
                self._cv.notify_all()

    def _prune(self) -> None:
        now = time.monotonic()
        for k in [k for k, until in self._failed.items() if until <= now]:
            del self._failed[k]
        for r in [r for r, keys in self._windows.items() if not any(k in self._tasks for k in keys)]:
            del self._windows[r]
