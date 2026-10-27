/* Token protocol, copy and defensive parsing of model output for the Lesson Plan Assistant (ported from Rapid's
   ChatBotScreen). Everything the model writes is untrusted: it is parsed here, never rendered raw. */
import { cleanAiText, looksLikeSerialized } from '@/lib/lessonPlan/normalize'
import type { CourseOutcome, GeneratedElo } from '@/types/lessonPlan'
import type { AssessItem, AssessKey, AssessReqs, Assignment, LessonInputs, Stage } from './types'

// ───────────────────────────── copy
export const TITLE = 'Lesson Plan Assistant'
export const SUBTITLE = 'AI-powered lesson-planning assistant'
export const GREETING = "Hi, I'm the **EduAI Lesson Plan Assistant** 👋\n\nI'll help you build a complete, ready-to-teach unit plan — course outcomes, learning objectives, a 5E design and assessments.\n\nTo get started, **which class** is this lesson plan for?"
export const NO_CLASSES = "You haven't been assigned to any classes yet, so lesson plans can't be generated. Please contact your school admin."
export const BOARD = 'CBSE'
export const DEFAULT_ATTITUDES = ['Respect', 'Integrity', 'Empathy']

// ───────────────────────────── trigger tokens
/** Strip trigger tokens AND the (possibly nested) balanced {…} JSON that follows each one. */
export function stripTokens(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const m = s.slice(i).match(/^\[[A-Z_]+\]/)
    if (m) {
      i += m[0].length
      while (i < s.length && /\s/.test(s[i])) i += 1
      if (s[i] === '{') {
        let depth = 0
        for (; i < s.length; i += 1) {
          if (s[i] === '{') depth += 1
          else if (s[i] === '}') { depth -= 1; if (depth === 0) { i += 1; break } }
        }
      }
      continue
    }
    out += s[i]
    i += 1
  }
  return out
}

/** The model's reply minus chain-of-thought and tokens; '' when only stray braces / punctuation remain. */
export function cleanReply(s: unknown): string {
  const t = stripTokens(String(s ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')).trim()
  return /^[\s{}[\],]*$/.test(t) ? '' : t
}

/** The balanced (string-aware) {…} JSON that follows `tok` in `reply`, or null. */
export function jsonAfter(reply: string, tok: string): string | null {
  const at = reply.indexOf(tok)
  if (at < 0) return null
  const b = reply.indexOf('{', at + tok.length)
  if (b < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = b; i < reply.length; i += 1) {
    const c = reply[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) return reply.slice(b, i + 1) }
  }
  return null
}

/* Deterministic pipeline advancement WITHOUT the model: once the pipeline runs, the stage is known, so a "Yes" maps
   straight to the next trigger token (no replay of the huge generated transcript). */
export const AFFIRM_RE = /\b(yes|yeah|yep|yup|ok|okay|sure|proceed|continue|go\s?ahead|generate|create|next|do it|looks good|good|fine|perfect|great)\b/i

export const ASSESS_KEYS: AssessKey[] = ['mcq', 'true_false', 'short_answer', 'long_answer', 'case_study']
/** What each mix key asks the item generator for. */
export const ITEM_LABEL: Record<AssessKey, string> = {
  mcq: 'MCQ', true_false: 'True/False', short_answer: 'Short Answer', long_answer: 'Long Answer', case_study: 'Case Study',
}
const MAX_PER_TYPE = 20
export const emptyReqs = (): AssessReqs => ({ mcq: 0, true_false: 0, short_answer: 0, long_answer: 0, case_study: 0 })

const MIX_MAP: [RegExp, AssessKey][] = [
  [/case.?study|case/i, 'case_study'],
  [/true.?false|t\s*\/?\s*f/i, 'true_false'],
  [/long.?answer|long|essay|\bla\b/i, 'long_answer'],
  [/short.?answer|short|\bsa\b/i, 'short_answer'],
  [/mcq|multiple.?choice|objective/i, 'mcq'],
]
/** Local fallback reading of "MCQ: 5, Short Answer: 3" when the AI interpreter gives nothing usable. */
export function parseAssessmentMix(text: string): AssessReqs {
  const reqs = emptyReqs()
  String(text || '').split(/[,;\n+&]+|\band\b/i).forEach((p) => {
    const num = (p.match(/(\d+)/) || [])[1]
    if (!num) return
    for (const [re, key] of MIX_MAP) { if (re.test(p)) { reqs[key] = clamp(Number(num), 0, MAX_PER_TYPE); return } }
  })
  if (ASSESS_KEYS.every((k) => !reqs[k])) reqs.mcq = 2   // default when no parseable mix was given
  return reqs
}
/** {mcq:N,…} from the model → validated counts, or null when nothing positive is in it. */
export function sanitizeReqs(v: unknown): AssessReqs | null {
  if (!isObj(v)) return null
  const reqs = emptyReqs()
  ASSESS_KEYS.forEach((k) => { reqs[k] = clamp(toInt(v[k], 0), 0, MAX_PER_TYPE) })
  return ASSESS_KEYS.some((k) => reqs[k] > 0) ? reqs : null
}

export function lessonLocalToken(stage: Stage, text: string): string | null {
  const t = String(text || '').trim()
  if (stage === 'awaiting_assessment_input') return '[PROCEED_TO_ASSESSMENT] ' + JSON.stringify({ assessment_requirements: parseAssessmentMix(t) })
  if (stage === 'complete') {
    if (/\bsave\b/i.test(t)) return '[SAVE_LESSON_PLAN]'
    if (AFFIRM_RE.test(t)) return '[PROCEED_TO_COMPLETE_PLAN]'
    return null
  }
  if (!AFFIRM_RE.test(t)) return null   // not an affirmation (e.g. "change CO2…") → the model handles it
  const next: Partial<Record<Stage, string>> = {
    cos: '[PROCEED_TO_SKILLS]', elos: '[PROCEED_TO_ASSESSMENT]', assessment_question: '[ASK_ASSESSMENT_DETAILS]', fivee: '[PROCEED_TO_FIVEE]',
  }
  return next[stage] ?? null
}

// ───────────────────────────── untrusted values
export type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
export const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
export const toInt = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? Math.round(n) : fallback
}
const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}
export const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)))
export const fmtDuration = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`

/** AI-authored text → validated prose through the shared chokepoint ('' when it cannot be validated). Plain strings
    pass as-is unless they look like serialized data, so maths such as "{1, 2, 3}" survives. */
export function aiText(v: unknown, surface: string): string {
  if (v == null) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const ctx = { surface: `lessonplan.assistant.${surface}` }
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return ''
    return looksLikeSerialized(s) ? cleanAiText(s, ctx) : s
  }
  return cleanAiText(v, ctx)
}
export const aiList = (v: unknown, surface: string): string[] =>
  Array.isArray(v) ? v.map((x) => aiText(x, surface)).filter(Boolean) : []

export function parseObj(raw: string | null): Obj | null {
  if (!raw) return null
  try { const v: unknown = JSON.parse(raw); return isObj(v) ? v : null } catch { return null }
}

/** [START_LESSON_PIPELINE] {…} → validated inputs, or null when class / subject / chapter is missing. */
export function parseInputs(raw: string | null): LessonInputs | null {
  const o = parseObj(raw)
  if (!o) return null
  const class_name = str(o.class_name) || str(o.class) || str(o.grade)
  const subject_name = str(o.subject_name) || str(o.subject)
  const chapter_name = str(o.chapter_name) || str(o.chapter)
  if (!class_name || !subject_name || !chapter_name) return null
  const co = toInt(o.co_count, 3)
  const mins = Math.round(toNum(o.duration_hours) * 60 + toNum(o.duration_minutes))
  const blooms: Record<string, number> = {}
  if (isObj(o.blooms_counts)) {
    for (const [k, v] of Object.entries(o.blooms_counts)) {
      const n = clamp(toInt(v, 0), 0, 10)
      if (k.trim() && n > 0) blooms[k.trim()] = n
    }
  }
  const attitudes = Array.isArray(o.attitudes) ? o.attitudes.map(str).filter(Boolean).slice(0, 10) : []
  return {
    class_name, subject_name, chapter_name,
    co_count: co >= 1 ? Math.min(co, 5) : 3,
    duration_mins: clamp(mins, 0, 24 * 60) || 45,
    blooms_counts: Object.keys(blooms).length ? blooms : { Apply: 2 },
    attitudes: attitudes.length ? attitudes : DEFAULT_ATTITUDES,
  }
}

export function parseCos(v: unknown): CourseOutcome[] {
  if (!Array.isArray(v)) return []
  return v.filter(isObj).map((c, i) => ({
    co_id: str(c.co_id) || `CO${i + 1}`,
    co_title: aiText(c.co_title, 'co'),
    co_description: aiText(c.co_description, 'co'),
    factor: aiText(c.factor, 'co'),
    skills: aiList(c.skills, 'skill'),
    competencies: aiList(c.competencies, 'competency'),
  })).filter((c) => c.co_title || c.co_description)
}

/** The /elos reply (COs each carrying their ELOs) → one flat, validated ELO list. */
export function parseElos(d: unknown): GeneratedElo[] {
  const out: GeneratedElo[] = []
  ;(Array.isArray(d) ? d : []).filter(isObj).forEach((g) => {
    ;(Array.isArray(g.elos) ? g.elos : []).filter(isObj).forEach((e) => {
      const elo = aiText(e.elo, 'elo')
      if (!elo) return
      out.push({
        elo, Elo_id: str(e.Elo_id) || `Elo-${out.length + 1}`,
        bloom_level: str(e.bloom_level) || str(e.blooms_taxonomy), co_id: str(e.co_id) || str(g.co_id),
        skills: aiList(e.skills, 'skill'), competencies: aiList(e.competencies, 'competency'),
      })
    })
  })
  return out
}

/** /assessment-items reply (`{"0":{assessment:[…]}}`, or a bare list / {assessment_items}) → validated items. */
export function parseItems(d: unknown): AssessItem[] {
  let raw: unknown = []
  if (Array.isArray(d)) raw = d
  else if (isObj(d)) {
    const first = isObj(d['0']) ? d['0'] : null
    raw = d.assessment_items ?? d.assessment ?? first?.assessment ?? []
  }
  if (!Array.isArray(raw)) return []
  return raw.filter(isObj).map((it) => {
    const o = it.options
    const options = Array.isArray(o) ? aiList(o, 'option') : isObj(o) ? Object.values(o).map((x) => aiText(x, 'option')).filter(Boolean) : []
    return {
      question: aiText(it.question, 'question'), options, answer: aiText(it.answer, 'answer'),
      itemType: str(it.itemType) || str(it.item_type) || str(it.type) || str(it.assessmentType),
      context: aiText(it.context, 'context'),
    }
  }).filter((it) => it.question)
}

/** /assignments reply (array, {assignments:[…]}, or raw JSON text) → validated assignments. */
export function parseAssignments(v: unknown): Assignment[] {
  let x: unknown = v
  if (typeof x === 'string') {
    const m = x.match(/\[[\s\S]*\]/)
    try { x = m ? JSON.parse(m[0]) : null } catch { x = null }
  }
  if (isObj(x) && Array.isArray(x.assignments)) x = x.assignments
  if (!Array.isArray(x)) return []
  return x.filter(isObj).map((a) => ({
    title: aiText(a.title, 'assignment') || aiText(a.assignment_title, 'assignment') || 'Assignment',
    purpose: aiText(a.purpose, 'assignment') || aiText(a.description, 'assignment'),
    instructions: aiText(a.instructions, 'assignment') || aiText(a.instruction, 'assignment'),
    submission: aiText(a.submission, 'assignment') || aiText(a.submission_details, 'assignment') || aiText(a.deliverable, 'assignment'),
  })).slice(0, 10)
}
