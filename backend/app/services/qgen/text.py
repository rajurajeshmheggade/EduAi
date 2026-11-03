"""Small, dependency-free text helpers shared by the content repository, the generators and de-duplication."""
from __future__ import annotations

import hashlib
import re
import unicodedata

# English function words. The NLP repository's text already had most of them stripped, so this list mainly keeps
# keyword ranking and grounding checks from counting glue words as subject terms.
STOPWORDS = frozenset("""
a about above after again against all also am an and any are as at be because been before being below between both
but by can could did do does doing down during each either else even ever every few for from further had has have
having he her here hers herself him himself his how however i if in into is it its itself just let like made make
many may me might more most much must my myself neither no nor not now of off often on once only or other our ours
ourselves out over own per same shall she should since so some such than that the their theirs them themselves then
there these they this those through thus to too under until up upon us use used using very was we were what when
where whether which while who whom whose why will with within without would yet you your yours yourself yourselves
one two three four five six seven eight nine ten first second third another called known given shown following figure
fig chapter activity example examples exercise exercises question questions answer answers page reprint table also
let us read write discuss find look see note notes teacher teachers student students class lesson unit section part
well way ways thing things lot lots get got take taken give gives come came go goes went way able need needs say said
""".split())

# Words of question wording rather than subject matter ("Choose the term that correctly completes …"); grounding
# checks ignore them.
QUESTION_WORDS = frozenset("""
choose chosen correct correctly incorrect complete completes completed statement statements term terms word words
explain explained describe described define definition state true false select apply applies applied following
missing value values using content topic diagram draw drawn label labels labelled labeled neat arrange arranged order
ordered match matches matching column columns item items analyse analyze analysing connected connection ideas essay
read passage given below questions follow follows situation case justify justification important importance example
show shows suggest demonstrate meaning meant name define related relation relationship between discuss compare
differentiate distinguish identify mention briefly detail details suitable points point practice practical support
critically evaluate evaluation role plan planning classmates covering main propose proposed improved improve
agree disagree reason reasons assertion option options mark marks answer answers write written find blank blanks fill
missing calculate solve solution prove reasoning approach method study studied learnt learned lesson unit chapter
""".split())

_WORD = re.compile(r"[^\W\d_][\w’'\-]*", re.UNICODE)
_SPACE = re.compile(r"\s+")


def squash(s: str) -> str:
    return _SPACE.sub(" ", s or "").strip()


def words(s: str) -> list[str]:
    return _WORD.findall(s or "")


def stem(w: str) -> str:
    """A deliberately tiny stemmer: enough to match 'currents'/'current', 'reflected'/'reflect' in grounding checks."""
    w = w.lower().strip("’'-")
    for suf in ("ations", "ation", "ings", "ing", "ies", "ied", "ers", "er", "es", "ed", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)] + ("y" if suf in ("ies", "ied") else "")
    return w


def content_words(s: str, min_len: int = 4) -> list[str]:
    return [w for w in (x.lower() for x in words(s)) if len(w) >= min_len and w not in STOPWORDS]


def normalise_for_hash(s: str) -> str:
    """Case-, accent-, punctuation- and whitespace-insensitive form used for exact de-duplication."""
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = re.sub(r"<[^>]*>", " ", s)
    s = re.sub(r"[^\w]+", " ", s, flags=re.UNICODE)
    return squash(s)


def text_hash(s: str) -> str:
    return hashlib.sha256(normalise_for_hash(s).encode("utf-8")).hexdigest()


def short_id(*parts: str, n: int = 12) -> str:
    return hashlib.sha1("\x1f".join(parts).encode("utf-8")).hexdigest()[:n]


def jaccard(a: str, b: str) -> float:
    sa, sb = {stem(w) for w in content_words(a, 3)}, {stem(w) for w in content_words(b, 3)}
    if not sa or not sb:
        return 1.0 if normalise_for_hash(a) == normalise_for_hash(b) else 0.0
    return len(sa & sb) / len(sa | sb)


_SENT = re.compile(r"(?<=[.!?])[\"”’)]*\s+(?=[\"“‘(]?[A-Z0-9])")


def sentences(text: str) -> list[str]:
    return [squash(s) for s in _SENT.split(squash(text)) if squash(s)]
