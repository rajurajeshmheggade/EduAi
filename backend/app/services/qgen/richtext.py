"""Rich text for questions: an allow-list HTML sanitiser, plain-text extraction and LaTeX → print HTML.

Question text, options, statements and model answers are stored as a small HTML subset produced by the editor:
b/strong/i/em/u/sub/sup/br/p/div/ul/ol/li and `<span class="math" data-latex="…">` for equations (rendered with
KaTeX in the browser, and as text with super/subscripts in exports). Everything else is rebuilt away here — no
attribute but data-latex survives, so no handler, style, href or src can get through. AI output goes through the
same function, so model text is never trusted as HTML.
"""
from __future__ import annotations

import html
import re
from html.parser import HTMLParser

ALLOWED = {"b", "strong", "i", "em", "u", "sub", "sup", "br", "p", "div", "ul", "ol", "li", "span"}
DROP = {"script", "style", "iframe", "frame", "frameset", "object", "embed", "noscript", "template", "svg", "math",
        "head", "title", "textarea", "select", "option", "button", "input", "link", "meta", "base", "canvas",
        "audio", "video", "img", "picture", "form"}
VOID = {"br"}
MAX_LATEX = 1000


class _Sanitiser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stack: list[str] = []      # tags we emitted (or "" for unwrapped ones)
        self.drop_depth = 0
        self.math_depth = 0             # inside a math span: its text content is replaced by the latex

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.drop_depth:
            if tag not in VOID:
                self.drop_depth += 1
            return
        if tag in DROP:
            if tag not in VOID and tag != "img":
                self.drop_depth = 1
            return
        if self.math_depth:
            if tag not in VOID:
                self.math_depth += 1
            return
        if tag == "span":
            a = dict(attrs)
            latex = (a.get("data-latex") or "").strip()
            if "math" in (a.get("class") or "").split() and latex:
                latex = latex[:MAX_LATEX]
                disp = ' data-display="block"' if a.get("data-display") == "block" else ""
                self.out.append(f'<span class="math" data-latex="{html.escape(latex, quote=True)}"{disp}>'
                                f'{html.escape(latex, quote=False)}</span>')
                self.math_depth = 1
                return
            self.stack.append("")
            return
        if tag not in ALLOWED:
            if tag not in VOID:
                self.stack.append("")
            return
        if tag in VOID:
            self.out.append("<br>")
            return
        self.out.append(f"<{tag}>")
        self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        if tag.lower() == "br" and not self.drop_depth and not self.math_depth:
            self.out.append("<br>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.drop_depth:
            if tag not in VOID:
                self.drop_depth -= 1
            return
        if self.math_depth:
            if tag not in VOID:
                self.math_depth -= 1
            return
        if tag in VOID or not self.stack:
            return
        # close up to the matching open tag (tolerates sloppy nesting)
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i] == tag or (tag not in ALLOWED and self.stack[i] == ""):
                while len(self.stack) > i:
                    t = self.stack.pop()
                    if t:
                        self.out.append(f"</{t}>")
                return

    def handle_data(self, data):
        if not self.drop_depth and not self.math_depth:
            self.out.append(html.escape(data, quote=False))

    def result(self) -> str:
        while self.stack:
            t = self.stack.pop()
            if t:
                self.out.append(f"</{t}>")
        return "".join(self.out)


_EMPTY_EDGE = re.compile(r"^(?:\s|<br>|<p>(?:\s|<br>)*</p>|<div>(?:\s|<br>)*</div>)+|(?:\s|<br>|<p>(?:\s|<br>)*</p>|<div>(?:\s|<br>)*</div>)+$")


def sanitize(value: object) -> str:
    """Rebuild `value` keeping only the allowed formatting; plain text comes back escaped."""
    src = value if isinstance(value, str) else "" if value is None else str(value)
    if not src.strip():
        return ""
    if "<" not in src and "&" not in src:
        return html.escape(src.strip(), quote=False)
    p = _Sanitiser()
    p.feed(src)
    p.close()
    return _EMPTY_EDGE.sub("", p.result()).strip()


_MATH = re.compile(r'<span class="math" data-latex="([^"]*)"[^>]*>.*?</span>', re.S)
_BLOCK_END = re.compile(r"</(p|div|li)>|<br>", re.I)
_TAG = re.compile(r"<[^>]+>")


def plain(value: str | None, math: str = "latex") -> str:
    """Visible text of stored rich text. Equations become `$latex$` (math="latex") or readable text (math="text")."""
    if not value:
        return ""

    def _m(m: re.Match) -> str:
        latex = html.unescape(m.group(1))
        return f" ${latex}$ " if math == "latex" else " " + latex_to_text(latex) + " "

    s = _MATH.sub(_m, value)
    s = _BLOCK_END.sub("\n", s)
    s = html.unescape(_TAG.sub("", s))
    s = re.sub(r"[ \t ]+", " ", s)
    return re.sub(r"\s*\n\s*", "\n", s).strip()


def plain_len(value: str | None) -> int:
    return len(plain(value))


def from_plain(text: str | None) -> str:
    """Model or user plain text → stored rich text: escaped, line breaks kept, $…$ becomes an equation span."""
    if not text:
        return ""
    out = []
    for i, part in enumerate(re.split(r"(?<!\\)\$([^$\n]{1,%d})\$" % MAX_LATEX, str(text))):
        if i % 2:
            out.append(f'<span class="math" data-latex="{html.escape(part.strip(), quote=True)}">'
                       f'{html.escape(part.strip(), quote=False)}</span>')
        else:
            out.append(html.escape(part, quote=False).replace("\n", "<br>"))
    return "".join(out).strip()


# ════════════════════════════════════════════════════════════ LaTeX → readable text / print HTML
_SYMBOLS = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε", "zeta": "ζ", "eta": "η",
    "theta": "θ", "vartheta": "ϑ", "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ",
    "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ", "upsilon": "υ", "phi": "φ", "varphi": "φ", "chi": "χ",
    "psi": "ψ", "omega": "ω", "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π",
    "Sigma": "Σ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω", "times": "×", "div": "÷", "pm": "±", "mp": "∓",
    "cdot": "·", "cdots": "⋯", "ldots": "…", "dots": "…", "leq": "≤", "le": "≤", "geq": "≥", "ge": "≥",
    "neq": "≠", "ne": "≠", "approx": "≈", "equiv": "≡", "sim": "∼", "propto": "∝", "infty": "∞",
    "rightarrow": "→", "to": "→", "leftarrow": "←", "Rightarrow": "⇒", "Leftarrow": "⇐", "leftrightarrow": "↔",
    "Leftrightarrow": "⇔", "rightleftharpoons": "⇌", "uparrow": "↑", "downarrow": "↓", "degree": "°", "circ": "°",
    "angle": "∠", "triangle": "△", "perp": "⊥", "parallel": "∥", "sum": "∑", "prod": "∏", "int": "∫",
    "oint": "∮", "partial": "∂", "nabla": "∇", "in": "∈", "notin": "∉", "subset": "⊂", "subseteq": "⊆",
    "supset": "⊃", "cup": "∪", "cap": "∩", "emptyset": "∅", "forall": "∀", "exists": "∃", "therefore": "∴",
    "because": "∵", "hbar": "ℏ", "ell": "ℓ", "prime": "′", "%": "%", "{": "{", "}": "}", ",": " ", ";": " ",
    "quad": " ", "qquad": "  ", " ": " ", "!": "", "|": "‖", "AA": "Å", "Omega_": "Ω", "log": "log", "ln": "ln",
    "sin": "sin", "cos": "cos", "tan": "tan", "cot": "cot", "sec": "sec", "csc": "cosec", "lim": "lim",
    "max": "max", "min": "min", "exp": "exp", "det": "det", "langle": "⟨", "rangle": "⟩", "lfloor": "⌊",
    "rfloor": "⌋", "lceil": "⌈", "rceil": "⌉", "neg": "¬", "land": "∧", "lor": "∨", "oplus": "⊕",
}
_UNWRAP = {"text", "mathrm", "mathbf", "mathit", "textbf", "textit", "operatorname", "mathsf", "boldsymbol", "mathcal",
           "displaystyle", "left", "right", "big", "Big", "bigg", "Bigg", "limits", "ce", "mathbb", "rm", "bf"}


class _Tex:
    """A tiny recursive reader for school-level LaTeX: groups, ^, _, \\frac, \\sqrt, \\vec, symbols."""

    def __init__(self, src: str, html_out: bool) -> None:
        self.s, self.i, self.html = src, 0, html_out

    def esc(self, t: str) -> str:
        return html.escape(t, quote=False) if self.html else t

    def group(self) -> str:
        """One argument: {…} or a single token."""
        self.skip_ws()
        if self.i >= len(self.s):
            return ""
        if self.s[self.i] == "{":
            self.i += 1
            out = self.seq("}")
            self.i += 1
            return out
        return self.atom()

    def skip_ws(self) -> None:
        while self.i < len(self.s) and self.s[self.i] == " ":
            self.i += 1

    def atom(self) -> str:
        c = self.s[self.i]
        if c == "\\":
            m = re.match(r"\\([A-Za-z]+|.)", self.s[self.i:])
            name = m.group(1) if m else ""
            self.i += len(m.group(0)) if m else 1
            return self.command(name)
        if c == "^" or c == "_":
            self.i += 1
            arg = self.group()
            if arg in ("°", "′", "″"):
                return arg
            if self.html:
                return f"<sup>{arg}</sup>" if c == "^" else f"<sub>{arg}</sub>"
            return _script(arg, sup=(c == "^"))
        if c == "{":
            return self.group()
        self.i += 1
        if c == "~":
            return " "
        return self.esc(c)

    def command(self, name: str) -> str:
        if name in ("frac", "dfrac", "tfrac"):
            num, den = self.group(), self.group()
            wrap = lambda x: x if re.fullmatch(r"[\w.]+|<su[bp]>.*</su[bp]>", re.sub(r"<[^>]+>", "", x) or x) else f"({x})"  # noqa: E731
            return f"{wrap(num)}/{wrap(den)}"
        if name == "sqrt":
            self.skip_ws()
            index = ""
            if self.i < len(self.s) and self.s[self.i] == "[":
                j = self.s.find("]", self.i)
                index, self.i = self.s[self.i + 1:j], j + 1
            body = self.group()
            root = {"3": "∛", "4": "∜"}.get(index.strip(), "√")
            return f"{root}({body})" if len(re.sub(r'<[^>]+>', '', body)) > 1 else f"{root}{body}"
        if name in ("vec", "overrightarrow"):
            return self.group() + "⃗"
        if name in ("bar", "overline"):
            return self.group() + "̅"
        if name in ("hat", "widehat"):
            return self.group() + "̂"
        if name == "dot":
            return self.group() + "̇"
        if name in _UNWRAP:
            self.skip_ws()
            if self.i < len(self.s) and self.s[self.i] == "{":
                return self.group()
            return ""
        if name in _SYMBOLS:
            return self.esc(_SYMBOLS[name])
        return self.esc(name)

    def seq(self, until: str | None = None) -> str:
        out = []
        while self.i < len(self.s) and (until is None or self.s[self.i] != until):
            out.append(self.atom())
        return "".join(out)


_SUP = str.maketrans("0123456789+-=()nix", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱˣ")
_SUB = str.maketrans("0123456789+-=()aeoxhklmnpst", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ")


def _script(arg: str, sup: bool) -> str:
    if arg in ("°", "′", "″", "*", "∗", "†"):
        return arg
    table = _SUP if sup else _SUB
    conv = arg.translate(table)
    if all(ch != o or ch.isspace() for ch, o in zip(conv, arg)) or (len(arg) == 1 and conv != arg):
        return conv
    return ("^" if sup else "_") + (arg if len(arg) == 1 else f"({arg})")


def latex_to_text(latex: str) -> str:
    """Readable Unicode for plain-text contexts (e.g. x^2 → x², \\frac{a}{b} → a/b)."""
    try:
        return re.sub(r"\s+", " ", _Tex(latex or "", html_out=False).seq()).strip()
    except Exception:  # noqa: BLE001 — never fail an export over an equation
        return latex


def latex_to_html(latex: str) -> str:
    """Print HTML for the PDF: <sup>/<sub> for scripts, Unicode symbols, a/b fractions, √ roots."""
    try:
        return re.sub(r"\s+", " ", _Tex(latex or "", html_out=True).seq()).strip()
    except Exception:  # noqa: BLE001
        return html.escape(latex or "", quote=False)


def to_print_html(value: str | None) -> str:
    """Stored rich text → HTML for the PDF renderer (equations rendered as print HTML in italics)."""
    if not value:
        return ""
    return _MATH.sub(lambda m: f'<i class="eq">{latex_to_html(html.unescape(m.group(1)))}</i>', value)
