/* Tolerant matching of the chat's free-text class / subject / chapter against the teacher's REAL scope and the
   indexed textbook chapters (ported from Rapid's ChatBotScreen: normChap, levenshtein, gradeOf, closestSubjectRow,
   resolveChapter, validateScope, validateClassEntry). */
import type { LpScope } from '@/types/lessonPlan'
import { NO_CLASSES } from './text'
import type { ScopeRow } from './types'

export const normChap = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i += 1) {
    const cur = [i]
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[n]
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 }
const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}
/** Grade number in a free-text class ("Class 3", "III", "Grade six", "10th", "6-A") — null when there is none. */
export function gradeOf(s: unknown): number | null {
  const raw = String(s ?? '').toLowerCase()
  const kw = raw.match(/\b(?:class|grade|std|standard)\s*[-:.]?\s*(\d{1,2}|[a-z]+)/)
  if (kw) {
    const tok = kw[1]
    const g = /^\d+$/.test(tok) ? Number(tok) : ROMAN[tok] ?? WORDS[tok]
    if (g != null) return g
  }
  const t = raw.replace(/class|grade|std|standard/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
  const nm = t.match(/(?:^|\D)(\d{1,2})(?!\d)/)
  if (nm) return Number(nm[1])
  const toks = t.split(/\s+/).filter(Boolean)
  // A lone "I" inside a sentence ("I teach …") is the pronoun, not Class I.
  const tok = toks.find((w) => ROMAN[w] && !(w === 'i' && toks.length > 1))
  return tok ? ROMAN[tok] : null
}

/** Does this message look like an answer to "which class?" (checked against the teacher's classes at entry). */
export const isClassLike = (t: string) =>
  gradeOf(t) != null || /\b(class|grade|std|standard|pre-?kg|lkg|ukg|nursery)\b/i.test(t)

export function flattenScope(scope: LpScope): ScopeRow[] {
  return (scope.classes ?? []).flatMap((c) => (c.subjects ?? []).map((s) => ({
    classCode: c.class_code, className: c.class_name, subjectCode: s.subject_code, subjectName: s.subject_name,
  })))
}

const pad = (s: string) => ` ${s} `
/** `a` contains `b` — as a substring when `b` is long enough to be meaningful, else as a whole word. */
const contains = (a: string, b: string) => (b.length >= 4 ? a.includes(b) : pad(a).includes(pad(b)))

/** The teacher's rows for a free-text class: exact name / code → the text names the class → same grade → partial. */
export function matchClassRows(rows: ScopeRow[], typed: string): ScopeRow[] {
  const t = normChap(typed)
  if (!t) return []
  const exact = rows.filter((r) => normChap(r.className) === t || normChap(r.classCode) === t)
  if (exact.length) return exact
  const named = rows.filter((r) => { const n = normChap(r.className); return n.length >= 2 && pad(t).includes(pad(n)) })
  if (named.length) {
    const longest = Math.max(...named.map((r) => normChap(r.className).length))
    return named.filter((r) => normChap(r.className).length === longest)
  }
  const g = gradeOf(typed)
  if (g != null) {
    const byGrade = rows.filter((r) => gradeOf(r.className) === g)
    if (byGrade.length) return byGrade
  }
  return t.length >= 2 ? rows.filter((r) => pad(normChap(r.className)).includes(pad(t))) : []
}

const SUBJECT_ALIASES: Record<string, string> = {
  maths: 'mathematics', math: 'mathematics', sci: 'science', evs: 'environmental studies', sst: 'social science',
  eng: 'english', cs: 'computer science', bio: 'biology', chem: 'chemistry', phy: 'physics', geo: 'geography',
}

/** Closest row whose subject is within a typo's distance (0.34 relative edit distance, as for chapters). */
function closestSubjectRow(rows: ScopeRow[], typed: string): ScopeRow | null {
  if (!typed) return null
  let best: ScopeRow | null = null
  let bestRel = 0.34
  rows.forEach((r) => {
    const n = normChap(r.subjectName)
    if (!n) return
    const rel = levenshtein(typed, n) / Math.max(typed.length, n.length)
    if (rel <= bestRel) { bestRel = rel; best = r }
  })
  return best
}

function matchSubjectRow(rows: ScopeRow[], typed: string): ScopeRow | null {
  const t0 = normChap(typed)
  if (!t0) return null
  const t = SUBJECT_ALIASES[t0] ?? t0
  const n = (r: ScopeRow) => normChap(r.subjectName)
  return rows.find((r) => n(r) === t || normChap(r.subjectCode) === t0)
    ?? rows.find((r) => !!n(r) && (contains(n(r), t) || contains(t, n(r))))
    ?? closestSubjectRow(rows, t)
}

/** Free-text class + subject → the teacher's own (class, subject) row, or null (with the rows of the class, if any). */
export function validateScope(rows: ScopeRow[], className: string, subjectName: string): { row: ScopeRow | null; classRows: ScopeRow[] } {
  const classRows = matchClassRows(rows, className)
  return { row: matchSubjectRow(classRows, subjectName), classRows }
}

/** The teacher's class names, sorted by grade then name. */
export function taughtClasses(rows: ScopeRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.className).filter(Boolean)))
    .sort((a, b) => ((gradeOf(a) ?? 99) - (gradeOf(b) ?? 99)) || a.localeCompare(b))
}

/** Is the class the teacher just typed one they are ASSIGNED to? Checked the moment it is entered. */
export function validateClassEntry(rows: ScopeRow[], cls: string): { ok: boolean; taught: string[] } {
  return { ok: matchClassRows(rows, cls).length > 0, taught: taughtClasses(rows) }
}

/** "You are not assigned to …" — lists what the teacher DOES teach, so they can pick again. */
export function notAssignedText(rows: ScopeRow[], typedClass: string, typedSubject: string, classRows: ScopeRow[]): string {
  if (!rows.length) return NO_CLASSES
  if (!classRows.length) {
    return `You are not assigned to **${typedClass || 'that class'}**. You have been assigned to these classes: **${taughtClasses(rows).join(', ')}**.\n\nWhich of these is this lesson plan for?`
  }
  const cls = classRows[0].className
  const subjects = Array.from(new Set(classRows.filter((r) => r.className === cls).map((r) => r.subjectName)))
  return `You are not assigned to **${typedSubject || 'that subject'}** in **${cls}**. For **${cls}** you teach: **${subjects.join(', ')}**.\n\nWhich of these is this lesson plan for?`
}

/** Best-matching chapter: exact → substring (ILIKE %term%) → small edit distance; null when nothing is close. */
export function resolveChapter<T extends { name: string }>(typed: string, chapters: T[]): T | null {
  const t = normChap(typed)
  if (!t || !chapters.length) return null
  let best: T | null = null
  let bestScore = Infinity
  for (const c of chapters) {
    const n = normChap(c.name)
    if (!n) continue
    if (n === t) return c
    let score: number
    if (n.includes(t) || t.includes(n)) score = 0.5
    else {
      const rel = levenshtein(t, n) / Math.max(t.length, n.length)
      if (rel > 0.34) continue
      score = 1 + rel
    }
    if (score < bestScore) { bestScore = score; best = c }
  }
  return best
}

/** Quick-start chips from the teacher's REAL classes + subjects (round-robin, so the first few differ by class). */
export function suggestionChips(rows: ScopeRow[], max = 3): { title: string; prompt: string }[] {
  const byClass = new Map<string, ScopeRow[]>()
  rows.forEach((r) => byClass.set(r.classCode, [...(byClass.get(r.classCode) ?? []), r]))
  const groups = [...byClass.values()]
  const out: { title: string; prompt: string }[] = []
  for (let j = 0; out.length < max && groups.some((g) => g.length > j); j += 1) {
    for (const g of groups) {
      if (out.length >= max) break
      const r = g[j]
      if (r) out.push({ title: `${r.className} · ${r.subjectName}`, prompt: `${r.className}, ${r.subjectName}` })
    }
  }
  return out
}
