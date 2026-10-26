"""Offline mock providers so the whole platform runs without Azure credentials.

* MockEmbeddings: deterministic hashed bag-of-words (+bigrams) in 1536 dims, L2-normalised.
  Cosine similarity reflects lexical overlap, so k=3 retrieval is meaningful in tests/demos.
* MockLLM: extractive, citation-bearing answers and templated teaching guides.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
from typing import Iterator

from ..config import get_settings

_STOP = set(
    "a an the of to in on for and or is are was were be been it its this that these those with as by at from "
    "what why how when which who whom do does did can could should would will you your i we they he she them "
    "about into than then so if not no yes also any all".split()
)
_WORD = re.compile(r"[a-z0-9]+")


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def _features(text: str) -> list[str]:
    toks = [_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1]
    return toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]


class MockEmbeddings:
    def __init__(self) -> None:
        self.dim = get_settings().embedding_dim

    def _one(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for f in _features(text):
            h = hashlib.md5(f.encode()).digest()
            idx = int.from_bytes(h[:4], "little") % self.dim
            v[idx] += 1.0 if h[4] & 1 else -1.0
            # second slot reduces collision noise
            idx2 = int.from_bytes(h[5:9], "little") % self.dim
            v[idx2] += 0.5 if h[9] & 1 else -0.5
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]


_SRC = re.compile(r"### Source \d+ — \[Page (\d+)\][^\n]*\n(.*?)(?=\n### Source|\Z)", re.S)
_SENT = re.compile(r"(?<=[.!?])\s+")


class MockLLM:
    name = "mock-llm"

    # -- chat ---------------------------------------------------------------
    def chat(self, system: str, messages: list[dict], *, json_mode: bool = False, temperature: float = 0.2) -> str:
        if "[TASK:GUIDE]" in system:
            return json.dumps(self._guide(system, messages[-1]["content"]))
        if "[TASK:RAG]" in system:
            return self._rag(system, messages[-1]["content"])
        return "Mock response."

    def chat_stream(self, system: str, messages: list[dict], *, temperature: float = 0.2) -> Iterator[str]:
        text = self.chat(system, messages)
        for tok in re.findall(r"\S+\s*", text):
            time.sleep(0.01)
            yield tok

    def transcribe(self, audio: bytes, filename: str) -> str:
        raise NotImplementedError("Voice transcription requires PROVIDER_MODE=azure or openai (Whisper).")

    def vision_json(self, system: str, text: str, images: list[bytes], *, temperature: float = 0.0) -> str:
        raise NotImplementedError("Handwriting OCR requires PROVIDER_MODE=azure or openai (GPT-4o vision).")

    # -- RAG ----------------------------------------------------------------
    def _rag(self, system: str, question: str) -> str:
        qf = set(_features(question))
        scored: list[tuple[float, str, str]] = []
        for page, body in _SRC.findall(system):
            for sent in _SENT.split(" ".join(body.split())):
                if len(sent) < 25:
                    continue
                sf = set(_features(sent))
                overlap = len(qf & sf)
                if overlap:
                    scored.append((overlap / math.sqrt(len(sf) + 1), page, sent.strip()))
        if not scored:
            return (
                "I couldn't find this in the textbook sections I retrieved for you. "
                "Try rephrasing the question or ask your teacher about it."
            )
        scored.sort(key=lambda t: -t[0])
        picked, seen = [], set()
        for _, page, sent in scored:
            if sent in seen:
                continue
            seen.add(sent)
            picked.append((page, sent))
            if len(picked) == 3:
                break
        lines = [f"- {sent} [Page {page}]" for page, sent in picked]
        pages = sorted({p for p, _ in picked}, key=int)
        refs = ", ".join(f"[Page {p}]" for p in pages)
        return "Here is what your textbook says:\n\n" + "\n".join(lines) + f"\n\nFor more detail, read {refs}."

    # -- Teaching guide -----------------------------------------------------
    def _guide(self, system: str, content: str) -> dict:
        level = (re.search(r"LEVEL:\s*(\w+)", system) or [None, "school"])[1]
        minutes = int((re.search(r"DURATION:\s*(\d+)", system) or [None, "45"])[1])
        title = (re.search(r"CHAPTER:\s*(.+)", content) or [None, "this chapter"])[1].strip()
        body = content.split("TEXT:", 1)[-1]
        sents = [s.strip() for s in _SENT.split(" ".join(body.split())) if len(s.strip()) > 30]
        key = sents[:12] or [f"Introduce the main ideas of {title}."]
        concepts = [s for s in key[:5]]
        audience = {"school": "students in a school classroom", "college": "undergraduates", "coaching": "exam-focused batch learners"}.get(level, "students")
        t1, t2, t3 = round(minutes * 0.15), round(minutes * 0.55), round(minutes * 0.2)
        script = [
            {"minutes": f"0-{t1}", "step": "Hook & recap", "script": f"Open with a quick question to {audience} that connects {title} to something familiar."},
            {"minutes": f"{t1}-{t1 + t2}", "step": "Concept delivery", "script": " ".join(concepts[:3])},
            {"minutes": f"{t1 + t2}-{t1 + t2 + t3}", "step": "Guided practice", "script": "Work one example on the board, then let pairs attempt a similar one."},
            {"minutes": f"{t1 + t2 + t3}-{minutes}", "step": "Wrap-up", "script": "Summarise in three bullets and preview the next session."},
        ]
        objectives = [f"Explain: {c.rstrip('.')}" for c in concepts[:3]] or [f"Understand {title}"]
        md = (
            f"# How to teach: {title}\n\n**Level:** {level} · **Duration:** {minutes} min\n\n"
            "## Learning objectives\n" + "\n".join(f"- {o}" for o in objectives) + "\n\n"
            "## Pacing plan\n" + "\n".join(f"- **{s['minutes']} min — {s['step']}:** {s['script']}" for s in script)
        )
        return {
            "lesson_plan_markdown": md,
            "analogies_and_hooks": {
                "opening_hook": f"Ask: where have you seen {title.lower()} in everyday life?",
                "analogy": f"Compare the core idea of {title} to a familiar everyday system, then map each part back to the textbook terms.",
                "learning_objectives": objectives,
                "delivery_script": script,
            },
            "board_work_blueprint": [
                {"step": 1, "board": f"Write the title '{title}' and the key term list."},
                {"step": 2, "board": "Draw the main diagram from the textbook and label each part."},
                {"step": 3, "board": "Box the definition and underline the formula/rule to remember."},
            ],
            "common_misconceptions": [
                {"misconception": "Students memorise definitions without understanding them.", "clarification": "Ask learners to restate each idea in their own words with an example."},
                {"misconception": "Students mix up closely related terms.", "clarification": "Contrast the terms side by side on the board."},
            ],
            "formative_questions": [
                {"question": f"In one sentence, what is the main idea of {title}?", "expected_answer": key[0]},
                {"question": "Give one real-life example of this concept.", "expected_answer": "Any relevant, correct example."},
                {"question": "What would change if one key condition were different?", "expected_answer": "Reasoned prediction tied to the textbook rule."},
            ],
        }
