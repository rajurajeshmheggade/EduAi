/* A small LaTeX reader for school-level maths — the same coverage as the backend's richtext.py `_Tex`: groups,
   ^ and _ (also both on one base), \frac / \dfrac / \tfrac, \sqrt and \sqrt[n], the \vec / \bar / \hat / \dot
   accents, \text / \mathrm / \left / \right … unwrapped, and the same symbol table. It produces an AST (used by the
   Word export to build real Word equations) and a Unicode linearisation (x^2 → x², \frac{a}{b} → a/b, H_2O → H₂O)
   for plain-text places. It never throws: anything it does not know is kept as text. */

export type LatexNode =
  | { kind: 'text'; value: string }
  | { kind: 'frac'; num: LatexNode[]; den: LatexNode[] }
  | { kind: 'sqrt'; body: LatexNode[]; index?: LatexNode[] }
  | { kind: 'script'; base: LatexNode[]; sup?: LatexNode[]; sub?: LatexNode[] }
  | { kind: 'accent'; accent: string; body: LatexNode[] }
  | { kind: 'group'; children: LatexNode[] }

export const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', times: '×', div: '÷', pm: '±', mp: '∓',
  cdot: '·', cdots: '⋯', ldots: '…', dots: '…', leq: '≤', le: '≤', geq: '≥', ge: '≥',
  neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞',
  rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
  Leftrightarrow: '⇔', rightleftharpoons: '⇌', uparrow: '↑', downarrow: '↓', degree: '°', circ: '°',
  angle: '∠', triangle: '△', perp: '⊥', parallel: '∥', sum: '∑', prod: '∏', int: '∫',
  oint: '∮', partial: '∂', nabla: '∇', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
  supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃', therefore: '∴',
  because: '∵', hbar: 'ℏ', ell: 'ℓ', prime: '′', '%': '%', '{': '{', '}': '}', ',': ' ', ';': ' ',
  quad: ' ', qquad: '  ', ' ': ' ', '!': '', '|': '‖', AA: 'Å', Omega_: 'Ω', log: 'log', ln: 'ln',
  sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'cosec', lim: 'lim',
  max: 'max', min: 'min', exp: 'exp', det: 'det', langle: '⟨', rangle: '⟩', lfloor: '⌊',
  rfloor: '⌋', lceil: '⌈', rceil: '⌉', neg: '¬', land: '∧', lor: '∨', oplus: '⊕',
}
const UNWRAP = new Set(['text', 'mathrm', 'mathbf', 'mathit', 'textbf', 'textit', 'operatorname', 'mathsf', 'boldsymbol', 'mathcal',
  'displaystyle', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'limits', 'ce', 'mathbb', 'rm', 'bf'])
const ACCENTS: Record<string, string> = { vec: '⃗', overrightarrow: '⃗', bar: '̅', overline: '̅', hat: '̂', widehat: '̂', dot: '̇' }
const PLAIN_SCRIPTS = new Set(['°', '′', '″', '*', '∗', '†'])
const MAX_DEPTH = 40

class Reader {
  i = 0
  depth = 0
  readonly s: string
  constructor(s: string) { this.s = s }

  skipWs() { while (this.s[this.i] === ' ') this.i++ }

  /** One argument: {…} or a single atom. */
  arg(): LatexNode[] {
    this.skipWs()
    if (this.i >= this.s.length) return []
    if (this.s[this.i] === '{') {
      this.i++
      const out = this.seq('}')
      if (this.s[this.i] === '}') this.i++
      return out
    }
    const a = this.atom()
    return a ? [a] : []
  }

  atom(): LatexNode | null {
    const c = this.s[this.i]
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(this.s.slice(this.i))
      const name = m ? m[1] : ''
      this.i += m ? m[0].length : 1
      return this.command(name)
    }
    if (c === '{') return { kind: 'group', children: this.arg() }
    this.i++
    return { kind: 'text', value: c === '~' ? ' ' : c }
  }

  command(name: string): LatexNode | null {
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') return { kind: 'frac', num: this.arg(), den: this.arg() }
    if (name === 'sqrt') {
      this.skipWs()
      let index: LatexNode[] | undefined
      if (this.s[this.i] === '[') {
        const j = this.s.indexOf(']', this.i)
        if (j > this.i) {
          index = new Reader(this.s.slice(this.i + 1, j)).seq()
          this.i = j + 1
        }
      }
      return { kind: 'sqrt', body: this.arg(), index }
    }
    if (name in ACCENTS) return { kind: 'accent', accent: ACCENTS[name], body: this.arg() }
    if (UNWRAP.has(name)) {
      this.skipWs()
      return this.s[this.i] === '{' ? { kind: 'group', children: this.arg() } : null
    }
    if (name in SYMBOLS) return { kind: 'text', value: SYMBOLS[name] }
    return { kind: 'text', value: name }
  }

  seq(until?: string): LatexNode[] {
    const out: LatexNode[] = []
    if (++this.depth > MAX_DEPTH) { this.i = this.s.length; return out }
    while (this.i < this.s.length && (until === undefined || this.s[this.i] !== until)) {
      const c = this.s[this.i]
      if (c === '^' || c === '_') {
        this.i++
        const argNodes = this.arg()
        const prev = out[out.length - 1]
        let target: Extract<LatexNode, { kind: 'script' }>
        if (prev && prev.kind === 'script' && !(c === '^' ? prev.sup : prev.sub)) target = prev
        else {
          const base = prev ? [out.pop() as LatexNode] : []
          target = { kind: 'script', base }
          out.push(target)
        }
        if (c === '^') target.sup = argNodes
        else target.sub = argNodes
        continue
      }
      const a = this.atom()
      if (a) out.push(a)
    }
    this.depth--
    return merge(out)
  }
}

/** Adjacent single-character text nodes → one run (but a script base keeps only its own last atom). */
function merge(nodes: LatexNode[]): LatexNode[] {
  const out: LatexNode[] = []
  for (const n of nodes) {
    const last = out[out.length - 1]
    if (n.kind === 'text' && last?.kind === 'text') out[out.length - 1] = { kind: 'text', value: last.value + n.value }
    else out.push(n)
  }
  return out
}

export function parseLatex(src: string): LatexNode[] {
  try {
    return new Reader(String(src ?? '')).seq()
  } catch {
    return [{ kind: 'text', value: String(src ?? '') }]
  }
}

/* ───────────────────────────── Unicode linearisation */
const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ' }
const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ' }

function script(arg: string, sup: boolean): string {
  if (PLAIN_SCRIPTS.has(arg)) return arg
  const table = sup ? SUP : SUB
  const chars = [...arg]
  if (chars.length && chars.every((ch) => ch in table || ch === ' ')) return chars.map((ch) => table[ch] ?? ch).join('')
  return (sup ? '^' : '_') + (chars.length === 1 ? arg : `(${arg})`)
}

const simple = (s: string) => /^[\p{L}\p{N}.]+$/u.test(s)

export function nodesToText(nodes: LatexNode[]): string {
  return nodes.map((n) => {
    switch (n.kind) {
      case 'text': return n.value
      case 'group': return nodesToText(n.children)
      case 'frac': {
        const num = nodesToText(n.num), den = nodesToText(n.den)
        const w = (x: string) => (simple(x) ? x : `(${x})`)
        return `${w(num)}/${w(den)}`
      }
      case 'sqrt': {
        const body = nodesToText(n.body)
        const idx = n.index ? nodesToText(n.index).trim() : ''
        const root = idx === '3' ? '∛' : idx === '4' ? '∜' : '√'
        return [...body].length > 1 ? `${root}(${body})` : `${root}${body}`
      }
      case 'accent': return nodesToText(n.body) + n.accent
      case 'script': {
        let out = nodesToText(n.base)
        if (n.sub) out += script(nodesToText(n.sub), false)
        if (n.sup) out += script(nodesToText(n.sup), true)
        return out
      }
    }
  }).join('')
}

/** Readable Unicode for plain-text contexts (never throws). */
export function latexToText(src: string): string {
  try {
    return nodesToText(parseLatex(src)).replace(/\s+/g, ' ').trim()
  } catch {
    return String(src ?? '')
  }
}
