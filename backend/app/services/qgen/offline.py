"""Deterministic, offline question generator — used in PROVIDER_MODE=mock and whenever the AI fails.

Every question is built only from sentences of the selected learning-content segments (extractive: blanking a key
term, corrupting a fact with another term from the same content for false statements, quoting sentences as model
answers), so it can never leave the syllabus. Choices are seeded from the selection and the request, so the same
request gives the same paper. Each question carries the ids of the segments it was built from (source_refs).
"""
from __future__ import annotations

import hashlib
import random
import re
from collections import Counter
from dataclasses import dataclass, field

from . import richtext
from .schema import AR_CODES_DEFAULT, COMPOSITE, HIGHER_ORDER, default_marks, new_id, share_marks
from .text import STOPWORDS, content_words, stem

_LATEX = re.compile(r"\$[^$]*\$")
_WORD_RE = r"(?<![\w$\\])({w})(?![\w$])"
_UNITS = (r"%|°C|°F|°|km/h|m/s²|m/s2|m/s|cm|mm|km|kg|mg|g|mL|ml|L|s|min|h|N|J|kJ|W|kW|kWh|V|A|mA|Ω|ohm|ohms|Hz|Pa|K|"
          r"mol|cal|kcal|years?|days?|hours?|minutes?|seconds?|metres?|meters?|kilometres?|litres?|grams?|kilograms?|"
          r"volts?|amperes?|watts?|joules?|newtons?|rupees?|Rs\.?|crore|lakh|million|billion")
_NUM = re.compile(r"(?<![\w.,/])(\d{1,7}(?:\.\d{1,4})?)\s?(" + _UNITS + r")(?![\w/])")

_STEMS = {
    "SHORT_ANSWER": {
        "REMEMBER": "What is meant by {k}?", "UNDERSTAND": "Explain {k} in your own words.",
        "APPLY": "Give an example that shows how {k} is applied.", "ANALYZE": "How is {k} related to {k2}?",
        "EVALUATE": "Why is {k} important? Justify your answer.", "CREATE": "Suggest a way to demonstrate {k}.",
    },
    "LONG_ANSWER": {
        "REMEMBER": "Describe {k} in detail.", "UNDERSTAND": "Explain {k} in detail, with suitable points.",
        "APPLY": "Explain {k} and show how it is applied in practice.",
        "ANALYZE": "Analyse {k} and its relationship with {k2} in detail.",
        "EVALUATE": "Critically evaluate the role of {k}. Support your answer with points from the topic.",
        "CREATE": "Plan an explanation of {k} for your classmates, covering its main ideas.",
    },
    "HOTS": {
        "ANALYZE": "Analyse how {k} and {k2} are connected. Use ideas from this topic.",
        "EVALUATE": "Evaluate the statement: “{s}” Do you agree? Justify your answer.",
        "CREATE": "Using what you have learnt about {k}, propose how {k2} could be explained or improved.",
    },
}


_ADJ = re.compile(r"(?:ly|ous|ful|less|ive|able|ible|ical|ic|ed|ing|est)$")


def noun_like(w: str) -> bool:
    """A crude part-of-speech guess: words with typical adjective / adverb / participle endings are not used as the
    subject of 'Explain …' / 'Draw a diagram of …' stems."""
    return not _ADJ.search(w)


@dataclass
class Source:
    """The selected learning content, prepared once per request."""
    segments: list[dict]
    topic_title: str = ""
    sentences: list[tuple[str, str]] = field(default_factory=list)   # usable (segment id, sentence)
    all_sentences: dict[str, list[str]] = field(default_factory=dict)  # segment id → every sentence, in order
    keywords: list[str] = field(default_factory=list)                # ranked
    used: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        tf: Counter = Counter()
        for seg in self.segments:
            sents = _split(_prep(seg["text"]))
            self.all_sentences[seg["id"]] = sents
            for s in sents:
                if _usable(s):
                    self.sentences.append((seg["id"], _cap(s)))
            tf.update(w for w in content_words(_LATEX.sub(" ", seg["text"]), 4) if w.isalpha() and "_" not in w)
        title = {stem(w) for w in content_words(self.topic_title, 4)}
        ranked = sorted(tf, key=lambda w: (-(tf[w] * (2 if stem(w) in title else 1)), w))
        seen: set[str] = set()
        for w in ranked:
            if stem(w) in seen or w in STOPWORDS:
                continue
            seen.add(stem(w))
            self.keywords.append(w)

    def vocabulary(self) -> set[str]:
        return {stem(w) for seg in self.segments for w in content_words(seg["text"], 3)}


_ABBREV = re.compile(r"\b(?:Fig|Figs|Eq|Eqs|No|Nos|e\.g|i\.e|etc|viz|vs|Dr|Mr|Mrs|Ms|St|approx|Ch|pp|cf)\.$", re.I)


def _prep(text: str) -> str:
    text = text.replace("\u2126", "Ω").replace("\u212b", "Å").replace("[", "(").replace("]", ")")
    text = re.sub(r"(?:(?<=[.!?:)]\s)|^)n\s+(?=[A-Za-z])|(?<=\s)n\s+(?=[A-Z])", "", text)  # PDF bullet glyph read as "n"
    return re.sub(r"\s+", " ", text).strip()


def _split(text: str) -> list[str]:
    """Sentences; the source dropped common words, so a sentence may start lower-case after the full stop."""
    out, cur = [], ""
    for part in re.split(r"(?<=[.!?])\s+", text):
        cur = f"{cur} {part}".strip() if cur else part
        if _ABBREV.search(cur) or re.search(r"\b\d{1,3}\.$", cur):
            continue  # "Fig. 11.2" / "Eq." / a section number — not a sentence end
        out.append(cur)
        cur = ""
    if cur:
        out.append(cur)
    return [x.strip() for x in out if x.strip()]


_NOISY = re.compile(r"\b(?:activity|fig\.?|figure|table|example|exercise|eq\.?|equation|page)\s*\(?\d", re.I)


def _usable(s: str) -> bool:
    toks = s.split()
    if not 6 <= len(toks) <= 45 or not s.rstrip("”\"')").endswith("."):
        return False
    if _NOISY.search(s) or "?" in s or re.search(r"\breprint\b", s, re.I):
        return False
    alpha = sum(1 for t in toks if re.fullmatch(r"[A-Za-z][A-Za-z’'\-,;:.()]*", t))
    return alpha / len(toks) >= 0.6 and len(content_words(s, 4)) >= 3


def _has_word(sentence: str, w: str) -> bool:
    return bool(re.search(_WORD_RE.format(w=re.escape(w)), sentence, re.I))


def _blank(sentence: str, w: str, repl: str = "______") -> str:
    return re.sub(_WORD_RE.format(w=re.escape(w)), lambda m: repl.replace("{}", m.group(1)), sentence, count=1, flags=re.I)


def _cap(w: str) -> str:
    return w[:1].upper() + w[1:]


def _short(s: str, n: int = 160) -> str:
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + " …"


class Builder:
    def __init__(self, src: Source, seed: str, ar_codes: list[str] | None = None) -> None:
        self.src = src
        self.rng = random.Random(int(hashlib.sha256(seed.encode()).hexdigest()[:12], 16))
        self.ar_codes = ar_codes or AR_CODES_DEFAULT

    # ------------------------------------------------------------ picking material
    def _kw_rank(self, difficulty: str) -> list[str]:
        kws = list(self.src.keywords)
        if difficulty == "HARD":   # rarer terms make harder questions
            kws = kws[len(kws) // 4:] + kws[:len(kws) // 4]
        return kws

    def pick(self, difficulty: str = "MEDIUM", need_kw: int = 1, avoid: set[str] | None = None) -> tuple[str, str, list[str]] | None:
        """An unused sentence with `need_kw` keywords in it → (segment id, sentence, keywords)."""
        order = list(range(len(self.src.sentences)))
        self.rng.shuffle(order)
        kws = self._kw_rank(difficulty)
        for prefer_unused in (True, False):
            for i in order:
                seg, s = self.src.sentences[i]
                if (prefer_unused and s in self.src.used) or (avoid and s in avoid):
                    continue
                found = [k for k in kws if _has_word(_LATEX.sub(" ", s), k)][:need_kw + 5]
                if len(found) >= need_kw:
                    if difficulty == "EASY" and len(s.split()) > 26 and prefer_unused:
                        continue
                    self.src.used.add(s)
                    return seg, s, found
        return None

    def distractors(self, answer: str, n: int, sentence: str = "") -> list[str]:
        pool = [k for k in self.src.keywords if stem(k) != stem(answer) and not _has_word(sentence, k)]
        same_suffix = [k for k in pool if k[-3:] == answer[-3:]]
        pool = same_suffix + [k for k in pool if k not in same_suffix]
        head = pool[:max(n * 3, 8)]
        self.rng.shuffle(head)
        return head[:n]

    def corrupt(self, sentence: str, kws: list[str]) -> tuple[str, str, str] | None:
        """A false version of the sentence: one of its key terms swapped for another term of the content."""
        for k in kws:
            d = self.distractors(k, 1, sentence)
            if d:
                return _blank(sentence, k, d[0]), k, d[0]
        return None

    def sentences_about(self, k: str, n: int, exclude: str = "") -> list[tuple[str, str]]:
        out = [(seg, s) for seg, s in self.src.sentences if s != exclude and _has_word(s, k)]
        return out[:n]

    # ------------------------------------------------------------ common shell
    def q(self, qtype: str, text: str, data: dict, *, marks: float, difficulty: str, bloom: str, refs: list[str],
          explanation: str = "", hint: str = "") -> dict:
        return {"id": new_id("q"), "type": qtype, "text": text, "marks": marks, "difficulty": difficulty,
                "bloom": bloom, "topic": self.src.topic_title, "hint": hint, "explanation": explanation,
                "media": [], "source_refs": sorted(set(refs)), "origin": "AI", "data": data}

    @staticmethod
    def esc(s: str) -> str:
        return richtext.from_plain(s)

    # ------------------------------------------------------------ objective types
    def mcq(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        got = self.pick(d)
        if not got:
            return None
        seg, s, kws = got
        k = kws[0]
        n = int(opts.get("option_count") or 4)
        wrong = self.distractors(k, n - 1, s)
        if len(wrong) < n - 1:
            return None
        texts = [k, *wrong]
        self.rng.shuffle(texts)
        options = [{"id": f"o{i + 1}", "text": self.esc(_cap(t))} for i, t in enumerate(texts)]
        correct = options[texts.index(k)]["id"]
        return self.q("MCQ", self.esc(f"Choose the term that correctly completes the statement: “{_blank(s, k)}”"),
                      {"options": options, "correct": correct, "layout": opts.get("layout") or "list"},
                      marks=marks or default_marks("MCQ", d), difficulty=d, bloom=b, refs=[seg],
                      explanation=self.esc(f"The content states: “{s}”"))

    def mrq(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        n = max(4, int(opts.get("option_count") or 5))
        n_true = min(max(2, int(opts.get("correct_count") or 2)), n - 1)
        trues, falses, refs, notes = [], [], [], []
        for _ in range(n_true):
            got = self.pick(d)
            if not got:
                return None
            trues.append(_short(got[1], 200))
            refs.append(got[0])
        while len(falses) < n - n_true:
            got = self.pick(d)
            if not got:
                return None
            bad = self.corrupt(got[1], got[2])
            if not bad:
                continue
            falses.append(_short(bad[0], 200))
            refs.append(got[0])
            notes.append(f"“{bad[2]}” should be “{bad[1]}”")
        allx = [(t, True) for t in trues] + [(f, False) for f in falses]
        self.rng.shuffle(allx)
        options = [{"id": f"o{i + 1}", "text": self.esc(t), "correct": c} for i, (t, c) in enumerate(allx)]
        return self.q("MRQ", self.esc("Which of the following statements are correct according to the topic? "
                                      "Select all that apply."),
                      {"options": options, "partial_credit": True},
                      marks=marks or default_marks("MRQ", d), difficulty=d, bloom=b, refs=refs,
                      explanation=self.esc("Incorrect statements: " + "; ".join(notes) + "."))

    def true_false(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        n = max(1, int(opts.get("statements") or 1))
        stmts, refs, notes = [], [], []
        for i in range(n):
            got = self.pick(d)
            if not got:
                return None
            seg, s, kws = got
            make_false = self.rng.random() < 0.5 if n == 1 else i % 2 == (1 if self.rng.random() < 0.5 else 0)
            bad = self.corrupt(s, kws) if make_false else None
            if bad:
                stmts.append({"id": f"s{i + 1}", "text": self.esc(_short(bad[0], 300)), "answer": False})
                notes.append(f"Statement {i + 1} is false: “{bad[2]}” should be “{bad[1]}”.")
            else:
                stmts.append({"id": f"s{i + 1}", "text": self.esc(_short(s, 300)), "answer": True})
                notes.append(f"Statement {i + 1} is true, as stated in the content.")
            refs.append(seg)
        return self.q("TRUE_FALSE", self.esc("State whether the following statement" + ("s are" if n > 1 else " is") +
                                             " True or False."), {"statements": stmts},
                      marks=marks or default_marks("TRUE_FALSE", d, n), difficulty=d, bloom=b, refs=refs,
                      explanation=self.esc(" ".join(notes)))

    def fill_blank(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        n = max(1, int(opts.get("blanks") or 1))
        got = self.pick(d, need_kw=n) or (self.pick(d, need_kw=1) if n > 1 else None)
        if not got:
            return None
        seg, s, kws = got
        chosen = kws[:n]
        text = s
        for k in chosen:
            text = _blank(text, k, "[{}]")
        bank = bool(opts.get("word_bank"))
        return self.q("FILL_BLANK", self.esc(f"Fill in the blank{'s' if len(chosen) > 1 else ''}: {text}"),
                      {"blanks": [{"alternates": [], "case_sensitive": False} for _ in chosen], "word_bank": bank,
                       "distractors": self.distractors(chosen[0], 2, s) if bank else []},
                      marks=marks or default_marks("FILL_BLANK", d, len(chosen)), difficulty=d, bloom=b, refs=[seg],
                      explanation=self.esc(f"The content states: “{s}”"))

    def match(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        n = max(2, int(opts.get("pairs") or 4))
        pairs, refs, used_kw = [], [], set()
        tries = 0
        while len(pairs) < n and tries < n * 6:
            tries += 1
            got = self.pick(d)
            if not got:
                break
            seg, s, kws = got
            k = next((x for x in kws if stem(x) not in used_kw), None)
            if not k:
                continue
            used_kw.add(stem(k))
            words = _blank(s, k).split()
            i = next((j for j, w in enumerate(words) if "______" in w), 0)
            clue = " ".join(words[max(0, i - 8): i + 9])
            pairs.append({"id": f"p{len(pairs) + 1}", "left": self.esc(_cap(k)), "right": self.esc(_short(clue, 140))})
            refs.append(seg)
        if len(pairs) < 2:
            return None
        return self.q("MATCH", self.esc("Match each term in Column I with the statement in Column II that it completes "
                                        "(______ marks the term)."),
                      {"pairs": pairs, "per_pair_marks": bool(opts.get("per_pair_marks", True))},
                      marks=marks or default_marks("MATCH", d, len(pairs)), difficulty=d, bloom=b, refs=refs)

    def one_word(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        got = self.pick(d)
        if not got:
            return None
        seg, s, kws = got
        return self.q("ONE_WORD", self.esc(f"Write the one word that completes the statement: “{_blank(s, kws[0])}”"),
                      {"answer": kws[0], "alternates": []}, marks=marks or default_marks("ONE_WORD", d),
                      difficulty=d, bloom=b, refs=[seg], explanation=self.esc(f"The content states: “{s}”"))

    def assertion_reason(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        a = self.pick(d)
        r = self.pick(d)
        if not a or not r:
            return None
        code = self.rng.choice(["B", "C", "D"])
        assertion, reason, note = a[1], r[1], ""
        if code == "C":
            bad = self.corrupt(r[1], r[2])
            if not bad:
                code = "B"
            else:
                reason, note = bad[0], f"R is false: “{bad[2]}” should be “{bad[1]}”."
        if code == "D":
            bad = self.corrupt(a[1], a[2])
            if not bad:
                code = "B"
            else:
                assertion, note = bad[0], f"A is false: “{bad[2]}” should be “{bad[1]}”."
        if code == "B":
            note = "Both statements are true (as stated in the content), but R describes a different idea, so it does not explain A."
        return self.q("ASSERTION_REASON", "Assertion–Reason",
                      {"assertion": self.esc(_short(assertion, 400)), "reason": self.esc(_short(reason, 400)), "answer": code},
                      marks=marks or default_marks("ASSERTION_REASON", d), difficulty=d, bloom=b, refs=[a[0], r[0]],
                      explanation=self.esc(f"Answer ({code}). {note}"))

    def numerical(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        cands = [(seg, s, m) for seg, s in self.src.sentences if s not in self.src.used for m in [_NUM.search(s)] if m]
        if not cands:
            cands = [(seg, s, m) for seg, s in self.src.sentences for m in [_NUM.search(s)] if m]
        if not cands:
            return None
        seg, s, m = cands[self.rng.randrange(len(cands))]
        self.src.used.add(s)
        value = float(m.group(1))
        unit = m.group(2).strip()
        tol = round(abs(value) * float(opts.get("tolerance_percent") or 0) / 100, 4)
        stem_ = s[:m.start()] + "____ " + unit + s[m.end():]
        return self.q("NUMERICAL", self.esc(f"Using the content, find the missing value (in {unit}): “{stem_}”"),
                      {"answer": value, "unit": unit, "tolerance": tol, "solution": self.esc(f"The content states: “{s}”")},
                      marks=marks or default_marks("NUMERICAL", d), difficulty=d, bloom=b, refs=[seg])

    def ordering(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        n = max(3, int(opts.get("items") or 4))
        by_seg: dict[str, list[str]] = {}
        for seg, s in self.src.sentences:
            if len(s.split()) <= 36:
                by_seg.setdefault(seg, []).append(s)
        runs = [(seg, ss) for seg, ss in by_seg.items() if len(ss) >= n]
        if not runs:
            return None
        seg, ss = runs[self.rng.randrange(len(runs))]
        start = self.rng.randrange(len(ss) - n + 1)
        chosen = ss[start:start + n]
        self.src.used.update(chosen)
        return self.q("ORDERING", self.esc("Arrange the following statements in the order in which they are "
                                           "explained in the topic."),
                      {"items": [{"id": f"i{i + 1}", "text": self.esc(_short(x, 240))} for i, x in enumerate(chosen)]},
                      marks=marks or default_marks("ORDERING", d), difficulty=d, bloom=b, refs=[seg])

    # ------------------------------------------------------------ subjective types
    def _about(self, d: str) -> tuple[str, str, str, list[tuple[str, str]], str] | None:
        got = self.pick(d)
        if not got:
            return None
        seg, s, kws = got
        nouns = [x for x in kws if noun_like(x)] or kws
        k = nouns[0]
        top = set(self.src.keywords[:20])
        k2 = next((x for x in nouns[1:] if stem(x) != stem(k) and x in top), None) or next(
            (x for x in self.src.keywords[:20] if stem(x) != stem(k) and noun_like(x)), k)
        return seg, s, k, [(seg, s)] + self.sentences_about(k, 6, exclude=s), k2

    def short_answer(self, d: str, b: str, marks: float | None, opts: dict, qtype: str = "SHORT_ANSWER") -> dict | None:
        got = self._about(d)
        if not got:
            return None
        seg, s, k, about, k2 = got
        n_pts = int(opts.get("key_points") or 3)
        stems = _STEMS["HOTS" if qtype == "HOTS" else "SHORT_ANSWER"]
        stem_ = stems.get(b) or stems.get("ANALYZE")
        answer = [x for _, x in about[:3]]
        for _, x in about[:3]:
            self.src.used.add(x)
        return self.q(qtype, self.esc(stem_.format(k=k, k2=k2, s=_short(s, 200))),
                      {"model_answer": self.esc(" ".join(answer)),
                       "key_points": [_short(x, 140) for x in answer][:n_pts]},
                      marks=marks or default_marks(qtype, d), difficulty=d, bloom=b, refs=[g for g, _ in about[:3]])

    def long_answer(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        got = self._about(d)
        if not got:
            return None
        seg, s, k, about, k2 = got
        more = [(g, x) for g, x in self.src.sentences if g == seg and x not in [y for _, y in about]][:4]
        body = (about + more)[:6]
        for _, x in body:
            self.src.used.add(x)
        total = marks or default_marks("LONG_ANSWER", d)
        n_pts = min(int(opts.get("marking_points") or 5), len(body)) or 1
        shares = share_marks(total, n_pts)
        return self.q("LONG_ANSWER", self.esc(_STEMS["LONG_ANSWER"].get(b, "Describe {k} in detail.").format(k=k, k2=k2)),
                      {"model_answer": self.esc(" ".join(x for _, x in body)),
                       "marking_points": [{"text": _short(x, 200), "marks": m} for (_, x), m in zip(body, shares)]},
                      marks=total, difficulty=d, bloom=b, refs=[g for g, _ in body])

    def essay(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        if len(self.src.sentences) < 3:
            return None
        self._essays = getattr(self, "_essays", 0) + 1
        nouns = [k for k in self.src.keywords if noun_like(k)] or self.src.keywords
        off = (self._essays - 1) * 2
        kws = (nouns[off:off + 4] or nouns[:4])
        dens = sorted(self.src.sentences, key=lambda gs: -sum(_has_word(gs[1], k) for k in kws))[:7]
        topic = self.src.topic_title if self._essays == 1 and self.src.topic_title else " and ".join(kws[:2])
        total = marks or default_marks("ESSAY", d)
        rubric = [("Understanding of the key ideas (" + ", ".join(kws[:3]) + ")", 0.4),
                  ("Accurate facts and terms from the topic", 0.3), ("Organisation and clarity", 0.2),
                  ("Introduction and conclusion", 0.1)]
        marks_r = [round(total * w, 2) for _, w in rubric]
        marks_r[0] = round(total - sum(marks_r[1:]), 2)
        wl = int(opts.get("word_limit") or 300)
        return self.q("ESSAY", self.esc(f"Write an essay of about {wl} words on “{topic}”, using the ideas of this topic."),
                      {"model_answer": self.esc(" ".join(x for _, x in dens)),
                       "rubric": [{"text": t, "marks": m} for (t, _), m in zip(rubric, marks_r)], "word_limit": wl},
                      marks=total, difficulty=d, bloom=b, refs=[g for g, _ in dens])

    def hots(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        return self.short_answer(d, b if b in HIGHER_ORDER else "ANALYZE", marks, opts, qtype="HOTS")

    def diagram(self, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        got = self._about(d)
        if not got:
            return None
        seg, s, k, about, k2 = got
        n = int(opts.get("labels") or 4)
        labels = []
        for _, x in about:
            for w in content_words(x, 4):
                if w.isalpha() and noun_like(w) and stem(w) != stem(k) and w in self.src.keywords[:25] and _cap(w) not in labels:
                    labels.append(_cap(w))
        labels = labels[:n]
        return self.q("DIAGRAM", self.esc(f"Draw a neat, labelled diagram to show {k}."
                                          + (f" Label: {', '.join(labels)}." if labels else "")),
                      {"diagram_description": f"A labelled diagram of {k}" + (f" showing {', '.join(labels)}." if labels else "."),
                       "labels": labels, "model_answer": self.esc(" ".join(x for _, x in about[:3])),
                       "key_points": [f"Correct shape of {k}"] + [f"{lab} labelled correctly" for lab in labels][:4]},
                      marks=marks or default_marks("DIAGRAM", d), difficulty=d, bloom=b, refs=[g for g, _ in about[:3]])

    # ------------------------------------------------------------ composite types
    def composite(self, qtype: str, d: str, b: str, marks: float | None, opts: dict) -> dict | None:
        """A passage of consecutive sentences from one segment (never overlapping an earlier passage by more than one
        sentence) and sub-questions built only from that passage."""
        window = 7 if qtype == "PASSAGE" else 5
        usable_by_seg: dict[str, list[str]] = {}
        for seg, s in self.src.sentences:
            usable_by_seg.setdefault(seg, []).append(s)
        order = [g for g, ss in usable_by_seg.items() if len(ss) >= 2]
        self.rng.shuffle(order)
        order.sort(key=lambda g: all(x in self.src.used for x in usable_by_seg[g]))   # fresh segments first
        self._passages = getattr(self, "_passages", {})   # segment id → sentence indexes already used in passages
        tries = 0
        for g in order:
            ss = [_cap(x) for x in self.src.all_sentences.get(g, [])]
            starts = [max(0, min(i, len(ss) - window)) for i, x in enumerate(ss) if x in usable_by_seg[g]]
            for start in dict.fromkeys(starts + list(range(0, max(1, len(ss) - window + 1), 2))):
                if len(set(range(start, start + window)) & self._passages.get(g, set())) > 1:
                    continue
                tries += 1
                if tries > 8:
                    return None
                q = self._composite_at(qtype, g, ss[start:start + window], d, b, marks, opts)
                if q:
                    self._passages.setdefault(g, set()).update(range(start, start + window))
                    return q
        return None

    def _composite_at(self, qtype: str, seg: str, window: list[str], d: str, b: str, marks: float | None,
                      opts: dict) -> dict | None:
        n_sub = max(2, int(opts.get("sub_questions") or 4))
        passage = [x for x in window if len(x.split()) <= 60] or window
        sub_src = Source([{"id": seg, "text": " ".join(passage)}], self.src.topic_title)
        if len(sub_src.sentences) < 2:
            return None
        sub = Builder(sub_src, f"{qtype}|{seg}|{passage[0][:40]}", self.ar_codes)
        sub.src.keywords = [k for k in self.src.keywords if any(_has_word(x, k) for x in passage)] or sub.src.keywords
        cycle = {"CASE_BASED": ["MCQ", "ONE_WORD", "TRUE_FALSE", "SHORT_ANSWER"],
                 "SCENARIO_BASED": ["MCQ", "SHORT_ANSWER", "TRUE_FALSE", "ONE_WORD"],
                 "PASSAGE": ["TRUE_FALSE", "FILL_BLANK", "ONE_WORD", "SHORT_ANSWER", "MCQ"]}[qtype]
        subs, seen = [], set()
        for i in range(n_sub * 3):
            if len(subs) == n_sub:
                break
            t = cycle[i % len(cycle)]
            sb = "APPLY" if qtype == "SCENARIO_BASED" and t == "SHORT_ANSWER" else ("UNDERSTAND" if t == "SHORT_ANSWER" else b)
            item = sub.make(t, d, sb, None, {"statements": 2} if t == "TRUE_FALSE" and qtype == "PASSAGE" else {})
            key = richtext.plain(item["text"]) + str(item["data"]) if item else ""
            if item and key not in seen:
                seen.add(key)
                subs.append(item)
        if len(subs) < 2:
            return None
        self.src.used.update(passage)
        total = marks or sum(x["marks"] for x in subs)
        for x, m in zip(subs, _scale([x["marks"] for x in subs], total)):
            x["marks"] = m
            x["source_refs"] = [seg]
        intro = {"CASE_BASED": "Read the following case and answer the questions that follow.",
                 "SCENARIO_BASED": "Read the following situation and answer the questions that follow.",
                 "PASSAGE": "Read the passage given below and answer the questions that follow."}[qtype]
        return self.q(qtype, self.esc(intro),
                      {"passage": self.esc(" ".join(passage)), "passage_title": "",
                       "sub_questions": subs, "numbering": opts.get("numbering") or ("roman" if qtype == "PASSAGE" else "alpha")},
                      marks=total, difficulty=d, bloom=b, refs=[seg])

    # ------------------------------------------------------------ dispatch
    def make(self, qtype: str, difficulty: str, bloom: str, marks: float | None, opts: dict) -> dict | None:
        if qtype in COMPOSITE:
            return self.composite(qtype, difficulty, bloom, marks, opts)
        fn = {"MCQ": self.mcq, "MRQ": self.mrq, "TRUE_FALSE": self.true_false, "FILL_BLANK": self.fill_blank,
              "MATCH": self.match, "ONE_WORD": self.one_word, "SHORT_ANSWER": self.short_answer,
              "LONG_ANSWER": self.long_answer, "ESSAY": self.essay, "ASSERTION_REASON": self.assertion_reason,
              "HOTS": self.hots, "DIAGRAM": self.diagram, "NUMERICAL": self.numerical, "ORDERING": self.ordering}[qtype]
        return fn(difficulty, bloom, marks, opts)


def _scale(parts: list[float], total: float) -> list[float]:
    """Scale sub-question marks to a total, in half marks, keeping their proportions and the exact sum."""
    s = sum(parts) or 1
    out = [max(0.5, round(p * total / s * 2) / 2) for p in parts]
    out[-1] = round(total - sum(out[:-1]), 2)
    if out[-1] <= 0:
        return share_marks(total, len(parts))
    return out
