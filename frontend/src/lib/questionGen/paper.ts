/* Question-paper model rules — numbering, sections, Assertion–Reason grouping, labels, the answer key, editor list
   operations, factories and client-side validation. Mirrors backend/app/services/qgen/{paper,schema}.py so the
   on-screen preview, the Word export, print and the server PDF number and label a paper identically. */

import type {
  Bloom, CompositeData, Difficulty, Lang, PaperItem, Question, QType, Section,
} from '@/types/questionGen'
import { COMPOSITE_TYPES, HIGHER_ORDER } from '@/types/questionGen'
import { escapeHtml, plainLength, plainText, renderRich } from './richText'

export const ALPHA = 'abcdefghijklmnopqrstuvwxyz'
export const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']
export const AR_LETTERS = ['A', 'B', 'C', 'D'] as const

export const LIMITS = { question: 2000, short_question: 3000, passage: 8000, answer: 2000, long_answer: 6000, essay_answer: 8000, option: 500, statement: 1000, hint: 300, alternate: 100, title: 200, point: 300, explanation: 3000 }

export const isComposite = (t: QType) => COMPOSITE_TYPES.includes(t)

let seq = 0
export function newId(prefix = 'q'): string {
  seq = (seq + 1) % 1e6
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12)
  return `${prefix}${rnd}${seq.toString(36)}`.slice(0, 40)
}

/* ───────────────────────────── paper chrome in the app's languages (backend paper.py LABELS) */
type LabelKey = 'time' | 'max_marks' | 'class' | 'subject' | 'year' | 'date' | 'instructions' | 'section' | 'answer_key' | 'marks' | 'mark'
  | 'page' | 'minutes' | 'hour' | 'hours' | 'answer' | 'explanation' | 'roll' | 'name' | 'column1' | 'column2' | 'assertion' | 'reason'
  | 'word_bank' | 'draft' | 'true' | 'false' | 'total' | 'key_points' | 'marking' | 'diagram' | 'order' | 'q'
export const LABELS: Record<Lang, Record<LabelKey, string>> = {
  en: { time: 'Time', max_marks: 'Maximum Marks', class: 'Class', subject: 'Subject', year: 'Academic Year', date: 'Date', instructions: 'General Instructions', section: 'Section', answer_key: 'ANSWER KEY', marks: 'marks', mark: 'mark', page: 'Page {n} of {N}', minutes: 'minutes', hour: 'hour', hours: 'hours', answer: 'Answer', explanation: 'Explanation', roll: 'Roll No.', name: 'Name', column1: 'Column I', column2: 'Column II', assertion: 'Assertion (A)', reason: 'Reason (R)', word_bank: 'Word bank', draft: 'DRAFT', true: 'True', false: 'False', total: 'Total', key_points: 'Key points', marking: 'Marking scheme', diagram: 'Diagram', order: 'Correct order', q: 'Q.' },
  hi: { time: 'समय', max_marks: 'अधिकतम अंक', class: 'कक्षा', subject: 'विषय', year: 'शैक्षणिक वर्ष', date: 'दिनांक', instructions: 'सामान्य निर्देश', section: 'खंड', answer_key: 'उत्तर कुंजी', marks: 'अंक', mark: 'अंक', page: 'पृष्ठ {n} / {N}', minutes: 'मिनट', hour: 'घंटा', hours: 'घंटे', answer: 'उत्तर', explanation: 'व्याख्या', roll: 'अनुक्रमांक', name: 'नाम', column1: 'स्तंभ I', column2: 'स्तंभ II', assertion: 'अभिकथन (A)', reason: 'कारण (R)', word_bank: 'शब्द बैंक', draft: 'प्रारूप', true: 'सत्य', false: 'असत्य', total: 'कुल', key_points: 'मुख्य बिंदु', marking: 'अंक योजना', diagram: 'चित्र', order: 'सही क्रम', q: 'प्र.' },
  kn: { time: 'ಸಮಯ', max_marks: 'ಗರಿಷ್ಠ ಅಂಕಗಳು', class: 'ತರಗತಿ', subject: 'ವಿಷಯ', year: 'ಶೈಕ್ಷಣಿಕ ವರ್ಷ', date: 'ದಿನಾಂಕ', instructions: 'ಸಾಮಾನ್ಯ ಸೂಚನೆಗಳು', section: 'ವಿಭಾಗ', answer_key: 'ಉತ್ತರ ಸೂಚಿ', marks: 'ಅಂಕಗಳು', mark: 'ಅಂಕ', page: 'ಪುಟ {n} / {N}', minutes: 'ನಿಮಿಷಗಳು', hour: 'ಗಂಟೆ', hours: 'ಗಂಟೆಗಳು', answer: 'ಉತ್ತರ', explanation: 'ವಿವರಣೆ', roll: 'ನೋಂದಣಿ ಸಂಖ್ಯೆ', name: 'ಹೆಸರು', column1: 'ಕಾಲಂ I', column2: 'ಕಾಲಂ II', assertion: 'ಪ್ರತಿಪಾದನೆ (A)', reason: 'ಕಾರಣ (R)', word_bank: 'ಪದ ಬ್ಯಾಂಕ್', draft: 'ಕರಡು', true: 'ಸರಿ', false: 'ತಪ್ಪು', total: 'ಒಟ್ಟು', key_points: 'ಮುಖ್ಯ ಅಂಶಗಳು', marking: 'ಅಂಕ ಯೋಜನೆ', diagram: 'ಚಿತ್ರ', order: 'ಸರಿಯಾದ ಕ್ರಮ', q: 'ಪ್ರ.' },
  ta: { time: 'நேரம்', max_marks: 'அதிகபட்ச மதிப்பெண்கள்', class: 'வகுப்பு', subject: 'பாடம்', year: 'கல்வி ஆண்டு', date: 'தேதி', instructions: 'பொது அறிவுரைகள்', section: 'பிரிவு', answer_key: 'விடைக் குறிப்பு', marks: 'மதிப்பெண்கள்', mark: 'மதிப்பெண்', page: 'பக்கம் {n} / {N}', minutes: 'நிமிடங்கள்', hour: 'மணி நேரம்', hours: 'மணி நேரம்', answer: 'விடை', explanation: 'விளக்கம்', roll: 'பதிவு எண்', name: 'பெயர்', column1: 'நெடுவரிசை I', column2: 'நெடுவரிசை II', assertion: 'கூற்று (A)', reason: 'காரணம் (R)', word_bank: 'சொல் வங்கி', draft: 'வரைவு', true: 'சரி', false: 'தவறு', total: 'மொத்தம்', key_points: 'முக்கியக் குறிப்புகள்', marking: 'மதிப்பீட்டுத் திட்டம்', diagram: 'படம்', order: 'சரியான வரிசை', q: 'வி.' },
}
export const labels = (lang: Lang | string | undefined) => LABELS[(lang as Lang) in LABELS ? (lang as Lang) : 'en']

export const fmtMarks = (m: number) => String(Math.round(m * 100) / 100)

export function durationText(minutes: number | null | undefined, lang: Lang): string {
  if (!minutes) return ''
  const L = labels(lang)
  const h = Math.floor(minutes / 60), m = minutes % 60
  const hours = `${h} ${h === 1 ? L.hour : L.hours}`
  if (h && m) return `${hours} ${m} ${L.minutes}`
  return h ? hours : `${m} ${L.minutes}`
}

export const subLabel = (i: number, numbering: 'alpha' | 'roman' = 'alpha') => `(${numbering === 'roman' && i < ROMAN.length ? ROMAN[i] : ALPHA[i % 26]})`

/* ───────────────────────────── numbering + grouping */
export interface NumberedRow { number: number; index: number; item: PaperItem }
export interface NumberedSection { section: Section; rows: NumberedRow[] }

/** Continuous numbering across sections; items whose section no longer exists belong to the first section. */
export function numberPaper(sections: Section[], items: PaperItem[], { keepEmpty = false } = {}): NumberedSection[] {
  const secs = sections.length ? sections : [{ id: 'A', title: '', instructions: '' }]
  const ids = new Set(secs.map((s) => s.id))
  const groups = new Map<string, { item: PaperItem; index: number }[]>(secs.map((s) => [s.id, []]))
  items.forEach((item, index) => groups.get(ids.has(item.section_id) ? item.section_id : secs[0].id)!.push({ item, index }))
  let n = 0
  const out: NumberedSection[] = []
  for (const s of secs) {
    const rows = groups.get(s.id)!.map(({ item, index }) => ({ number: ++n, index, item }))
    if (rows.length || keepEmpty) out.push({ section: s, rows })
  }
  return out
}

/** Consecutive Assertion–Reason questions share one directions block. */
export function arGroups(rows: NumberedRow[]): { isAr: boolean; rows: NumberedRow[] }[] {
  const out: { isAr: boolean; rows: NumberedRow[] }[] = []
  for (const r of rows) {
    const isAr = r.item.question.type === 'ASSERTION_REASON'
    const last = out[out.length - 1]
    if (last && last.isAr && isAr) last.rows.push(r)
    else out.push({ isAr, rows: [r] })
  }
  return out
}

export const totalMarks = (items: PaperItem[]) => Math.round(items.reduce((s, i) => s + (Number(i.question.marks) || 0), 0) * 100) / 100

/** Paper items in print order (section by section) — the order numbering follows. */
export function printOrder(sections: Section[], items: PaperItem[]): PaperItem[] {
  return numberPaper(sections, items).flatMap((s) => s.rows.map((r) => r.item))
}

/* ───────────────────────────── type helpers */
const BLANK = /\[([^[\]\n]{1,100})\]/g

export function blanksOf(textHtml: string): string[] {
  const noMath = textHtml.replace(/<span class="math"[^>]*>[\s\S]*?<\/span>/g, ' ')
  return [...plainText(noMath).matchAll(BLANK)].map((m) => m[1].trim())
}
export const renderBlanks = (html: string) => html.replace(/\[[^[\]\n]{1,100}\]/g, '__________')

export function matchColumns(q: Question & { type: 'MATCH' }) {
  const byId = new Map(q.data.pairs.map((p) => [p.id, p]))
  const right = q.data.right_order.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
  const shown = right.length === q.data.pairs.length ? right : q.data.pairs
  return { left: q.data.pairs, right: shown.map((p, i) => ({ letter: ALPHA[i], pair: p })) }
}

export function orderingDisplay(q: Question & { type: 'ORDERING' }) {
  const byId = new Map(q.data.items.map((i) => [i.id, i]))
  const shown = q.data.display_order.map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => !!i)
  return (shown.length === q.data.items.length ? shown : q.data.items).map((it, k) => ({ letter: String.fromCharCode(65 + k), item: it }))
}

/** Deterministic shuffle where (when possible) nothing keeps its place (Column II, arrange-in-order). */
export function derangement(ids: string[], seed: string): string[] {
  if (ids.length < 2) return [...ids]
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^= h >>> 16) >>> 0) / 4294967296 }
  for (let attempt = 0; attempt < 50; attempt++) {
    const out = [...ids]
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
    if (out.every((x, i) => x !== ids[i])) return out
  }
  return [...ids.slice(1), ids[0]]
}

export function shareMarks(total: number, count: number): number[] {
  if (count <= 1) return [Math.round(total * 100) / 100]
  const each = Math.round((total / count) * 100) / 100
  const out = Array.from({ length: count }, () => each)
  out[0] = Math.round((total - each * (count - 1)) * 100) / 100
  return out
}

/** MRQ partial credit: max(0, (right − wrong) / totalCorrect) × marks. */
export const mrqScore = (marks: number, right: number, wrong: number, totalCorrect: number) =>
  totalCorrect <= 0 ? 0 : Math.round(Math.max(0, (right - wrong) / totalCorrect) * marks * 100) / 100

/* ───────────────────────────── answer key (backend paper.py answer_key) */
export interface KeyLine { label: string; html: string }

/** `rich` renders every rich field: KaTeX HTML for the screen (default); the Word export passes `sanitizeRich` to get
 *  the stored HTML (with equation spans) back and builds runs / Word equations from it. */
export function answerKey(q: Question, arCodes: string[], lang: Lang = 'en', rich: (html: string) => string = (h) => renderRich(h)): KeyLine[] {
  const L = labels(lang)
  const rt = rich
  const esc = escapeHtml
  const out: KeyLine[] = []
  switch (q.type) {
    case 'MCQ': {
      const i = Math.max(0, q.data.options.findIndex((o) => o.id === q.data.correct))
      out.push({ label: L.answer, html: `(${ALPHA[i]}) ${rt(q.data.options[i]?.text ?? '')}` })
      break
    }
    case 'MRQ':
      out.push({ label: L.answer, html: q.data.options.map((o, k) => (o.correct ? `(${ALPHA[k]}) ${rt(o.text)}` : '')).filter(Boolean).join('; ') })
      break
    case 'TRUE_FALSE':
      out.push({ label: L.answer, html: q.data.statements.map((s, k) => `(${ROMAN[k]}) ${s.answer ? L.true : L.false}`).join('; ') })
      break
    case 'FILL_BLANK':
      out.push({ label: L.answer, html: blanksOf(q.text).map((a, k) => {
        const rule = q.data.blanks[k]
        const alts = rule?.alternates?.length ? ` (also: ${rule.alternates.map(esc).join(', ')})` : ''
        return `(${k + 1}) ${esc(a)}${alts}${rule?.case_sensitive ? ' [case-sensitive]' : ''}`
      }).join('; ') })
      break
    case 'MATCH': {
      const { left, right } = matchColumns(q)
      const letter = new Map(right.map((r) => [r.pair.id, r.letter]))
      out.push({ label: L.answer, html: left.map((p, k) => `${k + 1} → (${letter.get(p.id)})`).join(', ') })
      break
    }
    case 'ONE_WORD':
      out.push({ label: L.answer, html: esc(q.data.answer) + (q.data.alternates.length ? ` (also: ${q.data.alternates.map(esc).join(', ')})` : '') })
      break
    case 'SHORT_ANSWER':
    case 'HOTS':
      out.push({ label: L.answer, html: rt(q.data.model_answer) })
      if (q.data.key_points.length) out.push({ label: L.key_points, html: q.data.key_points.map(esc).join('; ') })
      break
    case 'LONG_ANSWER':
      out.push({ label: L.answer, html: rt(q.data.model_answer) })
      if (q.data.marking_points.length) out.push({ label: L.marking, html: q.data.marking_points.map((p) => `${esc(p.text)} (${fmtMarks(p.marks)})`).join('; ') })
      break
    case 'ESSAY':
      out.push({ label: L.answer, html: rt(q.data.model_answer) })
      if (q.data.rubric.length) out.push({ label: L.marking, html: q.data.rubric.map((p) => `${esc(p.text)} (${fmtMarks(p.marks)})`).join('; ') })
      break
    case 'ASSERTION_REASON': {
      const idx = Math.max(0, AR_LETTERS.indexOf(q.data.answer))
      out.push({ label: L.answer, html: `(${q.data.answer}) ${esc(arCodes[idx] ?? '')}` })
      break
    }
    case 'DIAGRAM':
      if (q.data.diagram_description) out.push({ label: L.diagram, html: esc(q.data.diagram_description) })
      out.push({ label: L.answer, html: rt(q.data.model_answer) })
      if (q.data.key_points.length) out.push({ label: L.key_points, html: q.data.key_points.map(esc).join('; ') })
      break
    case 'NUMERICAL':
      out.push({ label: L.answer, html: `${fmtMarks(q.data.answer)} ${esc(q.data.unit)}${q.data.tolerance ? ` (± ${fmtMarks(q.data.tolerance)})` : ''}`.trim() })
      if (q.data.solution) out.push({ label: '', html: rt(q.data.solution) })
      break
    case 'ORDERING': {
      const pos = new Map(orderingDisplay(q).map((d) => [d.item.id, d.letter]))
      out.push({ label: L.order, html: q.data.items.map((i) => pos.get(i.id) ?? '?').join(' → ') })
      break
    }
    default:
      break
  }
  if (q.explanation) out.push({ label: L.explanation, html: rt(q.explanation) })
  return out
}

/* ───────────────────────────── editor list operations (pure) */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list
  const out = [...list]
  const [x] = out.splice(from, 1)
  out.splice(Math.max(0, Math.min(to, out.length)), 0, x)
  return out
}

/** Move an item one place up/down in PRINT order (within or across a section boundary). */
export function nudge(sections: Section[], items: PaperItem[], index: number, dir: -1 | 1): PaperItem[] {
  const groups = numberPaper(sections, items, { keepEmpty: true })
  const flat = groups.flatMap((g) => g.rows.map((r) => ({ idx: r.index, section: g.section.id })))
  const pos = flat.findIndex((f) => f.idx === index)
  const target = pos + dir
  if (pos < 0 || target < 0 || target >= flat.length) return items
  const other = flat[target]
  const out = [...items]
  if (other.section !== flat[pos].section) {
    out[index] = { ...out[index], section_id: other.section }
    return out
  }
  return moveItem(out, index, other.idx)
}

/** A deep copy with fresh question / sub-question ids, marked as a manual question. */
export function cloneQuestion(q: Question): Question {
  const copy = JSON.parse(JSON.stringify(q)) as Question
  copy.id = newId()
  copy.origin = 'MANUAL'
  copy.bank_id = null
  if (isComposite(copy.type)) {
    const d = copy.data as CompositeData
    d.sub_questions = d.sub_questions.map((s) => ({ ...s, id: newId() }))
  }
  return copy
}

export function duplicateAt(items: PaperItem[], index: number): PaperItem[] {
  if (index < 0 || index >= items.length) return items
  const out = [...items]
  out.splice(index + 1, 0, { item_id: null, section_id: items[index].section_id, question: cloneQuestion(items[index].question) })
  return out
}

export const removeAt = (items: PaperItem[], index: number) => items.filter((_, i) => i !== index)

/* ───────────────────────────── factories */
const opt = (text = '') => ({ id: newId('o'), text })

export function blankQuestion(type: QType, init: { difficulty?: Difficulty; bloom?: Bloom; marks?: number; topic?: string } = {}): Question {
  const base = { id: newId(), text: '', marks: init.marks ?? 1, difficulty: init.difficulty ?? 'MEDIUM', bloom: init.bloom ?? 'UNDERSTAND',
    topic: init.topic ?? '', hint: '', explanation: '', media: [], source_refs: [], origin: 'MANUAL' as const, bank_id: null }
  switch (type) {
    case 'MCQ': { const o = [opt(), opt(), opt(), opt()]; return { ...base, type, data: { options: o, correct: o[0].id, layout: 'list' } } }
    case 'MRQ': return { ...base, type, marks: init.marks ?? 2, data: { options: [0, 1, 2, 3].map((i) => ({ ...opt(), correct: i < 2 })), partial_credit: true } }
    case 'TRUE_FALSE': return { ...base, type, text: 'State whether the following statement is True or False.', data: { statements: [{ id: newId('s'), text: '', answer: true }] } }
    case 'FILL_BLANK': return { ...base, type, data: { blanks: [], word_bank: false, distractors: [] } }
    case 'MATCH': {
      const pairs = [0, 1, 2, 3].map(() => ({ id: newId('p'), left: '', right: '' }))
      return { ...base, type, marks: init.marks ?? 4, text: 'Match the items in Column I with those in Column II.', data: { pairs, right_order: derangement(pairs.map((p) => p.id), pairs[0].id), per_pair_marks: true, left_title: 'Column I', right_title: 'Column II' } }
    }
    case 'ONE_WORD': return { ...base, type, data: { answer: '', alternates: [] } }
    case 'SHORT_ANSWER': return { ...base, type, marks: init.marks ?? 2, data: { model_answer: '', key_points: [] } }
    case 'HOTS': return { ...base, type, marks: init.marks ?? 4, bloom: HIGHER_ORDER.includes(base.bloom) ? base.bloom : 'ANALYZE', data: { model_answer: '', key_points: [] } }
    case 'LONG_ANSWER': return { ...base, type, marks: init.marks ?? 5, data: { model_answer: '', marking_points: [] } }
    case 'ESSAY': return { ...base, type, marks: init.marks ?? 10, data: { model_answer: '', rubric: [], word_limit: 300 } }
    case 'ASSERTION_REASON': return { ...base, type, text: 'Assertion–Reason', data: { assertion: '', reason: '', answer: 'A' } }
    case 'DIAGRAM': return { ...base, type, marks: init.marks ?? 3, data: { diagram_description: '', labels: [], model_answer: '', key_points: [] } }
    case 'NUMERICAL': return { ...base, type, marks: init.marks ?? 2, data: { answer: 0, unit: '', tolerance: 0, solution: '' } }
    case 'ORDERING': {
      const items = [opt(), opt(), opt()]
      return { ...base, type, marks: init.marks ?? 2, text: 'Arrange the following in the correct order.', data: { items, display_order: derangement(items.map((i) => i.id), items[0].id) } }
    }
    case 'CASE_BASED':
    case 'SCENARIO_BASED':
    case 'PASSAGE': {
      const intro = { CASE_BASED: 'Read the following case and answer the questions that follow.', SCENARIO_BASED: 'Read the following situation and answer the questions that follow.', PASSAGE: 'Read the passage given below and answer the questions that follow.' }[type]
      const subs = [blankQuestion('MCQ'), blankQuestion('SHORT_ANSWER')]
      return { ...base, type, text: intro, marks: subs.reduce((s, x) => s + x.marks, 0), data: { passage: '', passage_title: '', sub_questions: subs, numbering: type === 'PASSAGE' ? 'roman' : 'alpha' } }
    }
  }
}

/* ───────────────────────────── client-side validation (backend schema.py rules) */
function need(errors: string[], html: string, what: string, limit: number, required = true) {
  const n = plainLength(html)
  if (required && n === 0) errors.push(`${what} is required`)
  if (n > limit) errors.push(`${what} is too long (${n}/${limit} characters)`)
}

export function validateQuestion(q: Question, path = ''): string[] {
  const e: string[] = []
  const p = (s: string) => (path ? `${path}: ${s}` : s)
  if (!(q.marks > 0) || q.marks > 100) e.push('Marks must be more than 0 and at most 100')
  if (!['TRUE_FALSE', 'MATCH', 'ASSERTION_REASON', 'ORDERING'].includes(q.type)) need(e, q.text, 'Question text', q.type === 'SHORT_ANSWER' ? LIMITS.short_question : LIMITS.question)
  if (q.hint.length > LIMITS.hint) e.push(`Hint is too long (at most ${LIMITS.hint} characters)`)
  need(e, q.explanation, 'Explanation', LIMITS.explanation, false)
  switch (q.type) {
    case 'MCQ':
      if (q.data.options.length < 2 || q.data.options.length > 8) e.push('A multiple-choice question needs 2 to 8 options')
      q.data.options.forEach((o, i) => need(e, o.text, `Option ${ALPHA[i]}`, LIMITS.option))
      if (!q.data.options.some((o) => o.id === q.data.correct)) e.push('Choose the correct option')
      break
    case 'MRQ': {
      if (q.data.options.length < 4 || q.data.options.length > 8) e.push('A multiple-response question needs 4 to 8 options')
      q.data.options.forEach((o, i) => need(e, o.text, `Option ${ALPHA[i]}`, LIMITS.option))
      const n = q.data.options.filter((o) => o.correct).length
      if (n < 2) e.push('Mark at least two correct options')
      if (n === q.data.options.length) e.push('At least one option must be incorrect')
      break
    }
    case 'TRUE_FALSE':
      if (!q.data.statements.length) e.push('Add at least one statement')
      q.data.statements.forEach((s, i) => need(e, s.text, `Statement ${i + 1}`, LIMITS.statement))
      break
    case 'FILL_BLANK': {
      const b = blanksOf(q.text)
      if (!b.length) e.push('Write each blank’s answer in square brackets, e.g. “Water boils at [100] °C”')
      if (b.length > 10) e.push('At most 10 blanks per question')
      break
    }
    case 'MATCH':
      if (q.data.pairs.length < 2 || q.data.pairs.length > 10) e.push('Match the following needs 2 to 10 pairs')
      q.data.pairs.forEach((x, i) => { need(e, x.left, `Pair ${i + 1} (Column I)`, LIMITS.option); need(e, x.right, `Pair ${i + 1} (Column II)`, LIMITS.option) })
      break
    case 'ONE_WORD':
      if (!q.data.answer.trim()) e.push('Answer is required')
      if (q.data.answer.length > LIMITS.alternate) e.push('The answer should be one word or a short term')
      break
    case 'SHORT_ANSWER':
    case 'HOTS':
      need(e, q.data.model_answer, 'Model answer', q.type === 'HOTS' ? 4000 : LIMITS.answer)
      if (q.type === 'HOTS' && !HIGHER_ORDER.includes(q.bloom)) e.push('A HOTS question must be at Bloom level Analyze, Evaluate or Create')
      break
    case 'LONG_ANSWER':
      need(e, q.data.model_answer, 'Model answer', LIMITS.long_answer)
      break
    case 'ESSAY':
      need(e, q.data.model_answer, 'Model answer', LIMITS.essay_answer)
      if (q.data.word_limit != null && (q.data.word_limit < 20 || q.data.word_limit > 3000)) e.push('Word limit must be between 20 and 3000')
      break
    case 'ASSERTION_REASON':
      need(e, q.data.assertion, 'Assertion', LIMITS.statement)
      need(e, q.data.reason, 'Reason', LIMITS.statement)
      break
    case 'DIAGRAM':
      need(e, q.data.model_answer, 'Model answer', 3000)
      if (!q.media.length && !q.data.diagram_description.trim()) e.push('Upload the diagram or describe the diagram to draw')
      break
    case 'NUMERICAL':
      if (!Number.isFinite(q.data.answer)) e.push('The answer must be a number')
      if (q.data.tolerance < 0) e.push('Tolerance cannot be negative')
      break
    case 'ORDERING':
      if (q.data.items.length < 3 || q.data.items.length > 10) e.push('Arrange in order needs 3 to 10 items')
      q.data.items.forEach((it, i) => need(e, it.text, `Item ${i + 1}`, LIMITS.option))
      break
    case 'CASE_BASED':
    case 'SCENARIO_BASED':
    case 'PASSAGE':
      need(e, q.data.passage, 'Passage / case text', LIMITS.passage)
      if (!q.data.sub_questions.length) e.push('Add at least one sub-question')
      if (q.data.sub_questions.length > 8) e.push('At most 8 sub-questions')
      q.data.sub_questions.forEach((s, i) => e.push(...validateQuestion(s, `Sub-question ${subLabel(i, q.data.numbering)}`)))
      break
  }
  return e.map(p)
}

/** Composite marks always equal the sum of their sub-questions (as the backend enforces). */
export function normaliseMarks(q: Question): Question {
  if (!isComposite(q.type)) return q
  const d = q.data as CompositeData
  const total = Math.round(d.sub_questions.reduce((s, x) => s + (Number(x.marks) || 0), 0) * 100) / 100
  return total > 0 ? { ...q, marks: total } as Question : q
}

export function paperFileBase(title: string): string {
  return title.replace(/[^A-Za-z0-9ऀ-ൿ _-]+/g, '').trim().slice(0, 80) || 'question-paper'
}
