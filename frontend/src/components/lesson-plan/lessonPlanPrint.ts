/* Lesson Plan → printable document ("Download PDF").

   Rapid printed the plan by handing the live card to a headless-Chromium print service, with an html2canvas
   screenshot as the fallback. Neither exists in EduAI, and cloning the screen into a popup is what Rapid's
   own Session Plan learned not to do: grid / flex / aspect-ratio layouts do not survive a print context,
   cards tear across page breaks, and the browser drops every background colour by default.

   So the document is BUILT from the plan data, not cloned. Same visual language as the screen — banner,
   meta grid, tinted section cards, pills, the 5E design by ELO — expressed in print-safe CSS: tables for
   the banner and meta grid, inline-block option cells, `print-color-adjust: exact` so the colours come out,
   and page-break rules so a card never splits. It is printed from a popup; the browser's "Save as PDF"
   destination produces the file.

   Everything is escaped — the content is model-generated and goes into a document we hand to the browser,
   so no value is ever interpolated raw.

   This module also owns the defensive plan READER (`readPlan`) shared by the Lesson Plan View, the Word
   export and this document, so all three narrow the untrusted plan JSON the same way. It is kept here (not
   in lessonPlanWord.ts) because the Word module is lazy-loaded with `docx`; the view imports this one
   statically so the print popup can open synchronously inside the click. */

import { looksLikeSerialized, normalizeResource, unescapeLiterals } from '@/lib/lessonPlan/normalize'
import type { PlanContent } from '@/types/lessonPlan'

/* ───────────────────────────── shared: the signed-in context every export prints */

export interface LessonPlanExportMeta {
  schoolName: string
  teacherName: string
  academicYear: string
  /** Optional school logo (http(s) or data:image URL). EduAI has none today → the initials badge is used. */
  logoUrl?: string
}

/* ───────────────────────────── shared: defensive coercion */

type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Anything → a trimmed display string. Objects fall back to their common text-bearing fields so a shape
 *  change can never put "[object Object]" into a teacher's document. */
export function str(v: unknown, depth = 0): string {
  if (v == null || depth > 4) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map((x) => str(x, depth + 1)).filter(Boolean).join(', ')
  if (isObj(v)) return str(v.text ?? v.name ?? v.title ?? v.fullText ?? v.value ?? '', depth + 1)
  return ''
}

/** A value used as a lookup key: the exact string (untrimmed), so `${elo}_${stepId}` matches what was saved. */
const keyStr = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/** School initials for the banner tile when there is no logo. */
export const schoolInitials = (name: string): string =>
  (name.match(/\b\w/g) ?? []).join('').slice(0, 4).toUpperCase() || 'SCH'

/* ───────────────────────────── shared: legacy HTML + serialized-payload healing */

// Rapid's RichEditor stored HTML; EduAI edits plain text. Only REAL markup counts as HTML — editor output always
// carries a closing tag (or a void <br>/<hr>/<img src>), while a science plan's "a<b and c>d" never does, so the
// maths is not mistaken for a tag and swallowed.
const CLOSING_TAG = /<\/(?:p|div|b|strong|i|em|u|s|strike|span|font|a|ul|ol|li|h[1-6]|table|thead|tbody|tfoot|tr|td|th|sup|sub|blockquote|pre|code|section|article)\s*>/i
const VOID_TAG = /<(?:br|hr)\s*\/?>|<img\s[^>]*\bsrc\s*=/i
export const hasHtml = (s: unknown): s is string => typeof s === 'string' && (CLOSING_TAG.test(s) || VOID_TAG.test(s))

const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'blockquote', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const textCache = new Map<string, string>()

/** Legacy editor HTML → plain text with its line structure (paragraphs, line breaks, list markers, table cells).
 *  Parsed with DOMParser, whose documents are inert: no script runs and nothing is fetched. The result is TEXT —
 *  callers render it with `white-space: pre-wrap` (screen) or escape it (print), never as markup. */
export function htmlToText(html: string): string {
  const hit = textCache.get(html)
  if (hit !== undefined) return hit
  let out: string
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const parts: string[] = []
    const walk = (node: Node, list: { ordered: boolean; n: number } | null) => {
      if (node.nodeType === 3) { parts.push((node.nodeValue ?? '').replace(/\s+/g, ' ')); return }
      if (node.nodeType !== 1) return
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'noscript') return
      if (tag === 'br') { parts.push('\n'); return }
      const kids = (l: { ordered: boolean; n: number } | null) => el.childNodes.forEach((c) => walk(c, l))
      if (tag === 'ul' || tag === 'ol') { parts.push('\n'); kids({ ordered: tag === 'ol', n: 0 }); parts.push('\n'); return }
      if (tag === 'li') {
        parts.push('\n' + (list?.ordered ? `${(list.n += 1)}. ` : '• '))
        kids(list)
        return
      }
      if (tag === 'td' || tag === 'th') { kids(list); parts.push(' | '); return }
      const block = BLOCK_TAGS.has(tag)
      if (block) parts.push('\n')
      kids(list)
      if (block) parts.push('\n')
    }
    walk(doc.body, null)
    out = parts.join('')
      .replace(/ \| (?=\n|$)/g, '')
      .replace(/(^|\n)(•|\d+\.) \s*\n+/g, '$1$2 ')            // <li><p>…</p></li>: keep the marker on the text's line
      .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  } catch {
    out = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  if (textCache.size > 500) textCache.clear()
  textCache.set(html, out)
  return out
}

/** Plain-text field (objective, ELO, question, assignment block…) → display text. HTML from an old plan is
 *  reduced to its text; anything else is shown as stored. */
export const plainText = (v: unknown): string => (hasHtml(v) ? htmlToText(v) : str(v))

export const RICH_FALLBACK = 'This resource couldn’t be loaded.'

/** Generated 5E body → Markdown text, healing legacy double-encoded payloads through the shared chokepoint
 *  exactly like `renderRich` does, so the screen, the PDF and the .docx agree for old plans too. */
export function healRich(raw: unknown): { text: string; fallback: false } | { text: ''; fallback: true } {
  if (isObj(raw)) {
    const res = normalizeResource(raw)
    return res.ok ? { text: (res.data.title ? `${res.data.title}\n\n` : '') + res.data.body, fallback: false } : { text: '', fallback: true }
  }
  const src = typeof raw === 'string' ? raw : str(raw)
  const braceAt = src.search(/[{[]/)
  if (braceAt >= 0 && looksLikeSerialized(src.slice(braceAt))) {
    const res = normalizeResource(src.slice(braceAt))
    return res.ok ? { text: (res.data.title ? `${res.data.title}\n\n` : '') + res.data.body, fallback: false } : { text: '', fallback: true }
  }
  if (looksLikeSerialized(src)) return { text: unescapeLiterals(src), fallback: false }
  return { text: src, fallback: false }
}

/* ───────────────────────────── shared: the item-type vocabulary the card shows */

/** Item-type abbreviations (Rapid's TYPE_LABEL), keyed by the normalised type (lower-case, spaces → '-'),
 *  so both the kebab-case ids and EduAI's labels ("Fill in the blank", "Open Ended") resolve. */
export const TYPE_LABEL: Record<string, string> = {
  mcq: 'MCQ', 'multiple-choice': 'MCQ', 'fill-blank': 'FIB', 'fill-blanks': 'FIB', 'fill-in-the-blank': 'FIB',
  'fill-in-the-blanks': 'FIB', 'short-description': 'SA', 'short-answer': 'SA', 'long-description': 'LA', 'long-answer': 'LA',
  'open-ended': 'OE', 'case-study': 'CS', 'true-false': 'TF', 'true-or-false': 'TF',
}
/** Open-response types never show an answer box (Rapid's NO_ANSWER). */
export const NO_ANSWER = ['short-description', 'long-description', 'open-ended', 'case-study', 'short-answer', 'long-answer']
const typeKey = (v: unknown): string => str(v).toLowerCase().replace(/[\s_]+/g, '-')

/* ───────────────────────────── shared: the plan model */

export interface PlanOption { key: string; letter: string; text: string }
export interface PlanItemModel {
  /** Index in the stored `items` array (edits patch by it). */
  index: number
  typeLabel: string
  bloom: string
  question: string
  isMcq: boolean
  options: PlanOption[]
  answer: string
  /** Answer-bearing type (not an open response) — whether an answer box belongs to it at all. */
  answerable: boolean
}
export interface PlanOutcomeModel {
  /** Index in the stored `assessment` (or, for the fallback, `elos`) array. */
  index: number
  /** 'elos' = no assessment blocks were saved, so the outcomes are read (read-only) from `plan.elos`. */
  source: 'assessment' | 'elos'
  key: string
  label: string
  name: string
  fullText: string
  bloom: string
  items: PlanItemModel[]
}
export interface PlanCoreModel { index: number; text: string; factor: string }
export type AssignmentKey = 'purpose' | 'instructions' | 'submission'
export interface PlanAssignmentModel { index: number; title: string; purpose: string; instructions: string; submission: string }
export interface PlanPhaseModel { index: number; phase: string; color: string; activities: { index: number; title: string; description: string }[] }
export interface PlanResourceModel { name: string; key: string; content: unknown }
export interface PlanStepModel { index: number; name: string; stepTime: string; contentKey: string; resources: PlanResourceModel[] }
export interface PlanEloBlockModel { index: number; label: string; steps: PlanStepModel[] }
export interface LessonPlanModel {
  grade: string
  subject: string
  topic: string
  duration: string
  executionPeriod: string
  plannedDate: string
  coreObjectives: PlanCoreModel[]
  outcomes: PlanOutcomeModel[]
  /** Outcomes that carry assessment items (the Assessment section). */
  assessed: PlanOutcomeModel[]
  assignments: PlanAssignmentModel[]
  fiveE: PlanPhaseModel[]
  design: PlanEloBlockModel[]
}

export const ASSIGNMENT_BLOCKS: { key: AssignmentKey; label: string }[] = [
  { key: 'purpose', label: 'Purpose' },
  { key: 'instructions', label: 'Instructions' },
  { key: 'submission', label: 'Submission Details' },
]

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i
const DEFAULT_PHASE_COLOR = '#0F172A'

function optionsOf(v: unknown): PlanOption[] {
  const entries: [string, unknown][] = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : isObj(v) ? Object.entries(v) : []
  return entries.map(([key, val], i) => ({ key, letter: String.fromCharCode(65 + i), text: str(val) }))
}

/**
 * Read an untrusted plan object into a fully-typed model. Never throws: anything of the wrong shape is
 * skipped, so a partial plan renders / exports what it has. Entries are NOT filtered for emptiness (the view
 * edits them in place — clearing a field must not unmount its editor); the exporters skip empty ones.
 * Every list entry keeps its index in the stored array so the view can patch the original JSON.
 */
export function readPlan(plan: unknown): LessonPlanModel {
  const p: Obj = isObj(plan) ? plan : {}

  const coreObjectives: PlanCoreModel[] = []
  arr(p.coreObjectives).forEach((o, index) => {
    if (typeof o === 'string') coreObjectives.push({ index, text: plainText(o), factor: '' })
    else if (isObj(o)) coreObjectives.push({ index, text: plainText(o.text), factor: str(o.factor) })
  })

  const elos = arr(p.elos).map((e) => (typeof e === 'string' ? e.trim() : isObj(e) ? str(e.text) : ''))

  const outcomes: PlanOutcomeModel[] = []
  arr(p.assessment).forEach((a, index) => {
    if (!isObj(a)) return
    const n = outcomes.length + 1
    const items: PlanItemModel[] = []
    arr(a.items).forEach((it, ii) => {
      if (!isObj(it)) return
      const type = typeKey(it.itemType)
      items.push({
        index: ii,
        typeLabel: TYPE_LABEL[type] ?? str(it.itemType),
        bloom: str(it.bloomsLevel),
        question: plainText(it.question),
        isMcq: type === 'mcq' || type === 'multiple-choice',
        options: optionsOf(it.options),
        answer: str(it.answer),
        answerable: !NO_ANSWER.includes(type),
      })
    })
    outcomes.push({
      index, source: 'assessment', key: str(a.id) || `a${index}`,
      label: str(a.name) || `ELO ${n}`, name: str(a.name), fullText: plainText(a.fullText),
      bloom: str(a.bloomLevel), items,
    })
  })
  // No assessment blocks saved (assessment skipped) — the outcomes still exist on the plan; show them.
  if (outcomes.length === 0) {
    elos.forEach((text, index) => {
      if (!text) return
      outcomes.push({ index, source: 'elos', key: `e${index}`, label: `ELO ${outcomes.length + 1}`, name: '', fullText: plainText(text), bloom: '', items: [] })
    })
  }

  const assignments: PlanAssignmentModel[] = []
  arr(p.assignments).forEach((a, index) => {
    if (!isObj(a)) return
    assignments.push({ index, title: str(a.title), purpose: plainText(a.purpose), instructions: plainText(a.instructions), submission: plainText(a.submission) })
  })

  const fiveE: PlanPhaseModel[] = []
  arr(p.fiveE).forEach((ph, index) => {
    if (!isObj(ph)) return
    const color = str(ph.color)
    const activities: PlanPhaseModel['activities'] = []
    arr(ph.activities).forEach((act, ai) => {
      if (isObj(act)) activities.push({ index: ai, title: str(act.title), description: plainText(act.description) })
      else if (typeof act === 'string') activities.push({ index: ai, title: '', description: plainText(act) })
    })
    fiveE.push({ index, phase: str(ph.phase), color: HEX_COLOR.test(color) ? color : DEFAULT_PHASE_COLOR, activities })
  })

  const design: PlanEloBlockModel[] = []
  const fd = isObj(p.fiveEDesign) ? p.fiveEDesign : null
  if (fd) {
    const generated = isObj(fd.generatedContentData) ? fd.generatedContentData : {}
    arr(fd.eloSteps).forEach((block, index) => {
      if (!isObj(block)) return
      const eloRaw = keyStr(block.elo)
      const eloNum = elos.findIndex((t) => t !== '' && t === eloRaw.trim())
      const steps: PlanStepModel[] = []
      arr(block.steps).forEach((step, si) => {
        if (!isObj(step)) return
        const canonical = `${eloRaw}_${keyStr(step.id)}`
        const trimmed = `${eloRaw.trim()}_${keyStr(step.id).trim()}`
        // The key the content was saved under (exact first, then a whitespace-tolerant match).
        const contentKey = isObj(generated[canonical]) ? canonical : isObj(generated[trimmed]) ? trimmed : canonical
        const bag = isObj(generated[contentKey]) ? generated[contentKey] : {}
        const resources: PlanResourceModel[] = []
        arr(step.resources).forEach((r) => {
          const key = keyStr(r)
          if (key.trim()) resources.push({ name: key.trim(), key, content: bag[key] ?? bag[key.trim()] ?? '' })
        })
        steps.push({ index: si, name: str(step.name), stepTime: str(step.stepTime), contentKey, resources })
      })
      design.push({ index, label: eloNum !== -1 ? `ELO ${eloNum + 1}` : 'ELO', steps })
    })
  }

  return {
    grade: str(p.grade), subject: str(p.subject), topic: str(p.topic), duration: str(p.duration),
    executionPeriod: str(p.executionPeriod), plannedDate: str(p.plannedDate),
    coreObjectives, outcomes, assessed: outcomes.filter((o) => o.items.length > 0), assignments, fiveE, design,
  }
}

/* ───────────────────────────── print document */

const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Only http(s) and inline raster images reach a src. */
const safeImg = (u: unknown): string => {
  const s = String(u ?? '').trim()
  return /^https?:\/\//i.test(s) || /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(s) ? s : ''
}

const dash = (v: string) => v || '—'

/** `**bold**` → <b>, everything else escaped (mirrors mdInline). */
const mdInline = (text: string): string => String(text).split(/(\*\*[^*]+\*\*)/g)
  .map((part) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? `<b>${esc(part.slice(2, -2))}</b>` : esc(part)))
  .join('')

/** Markdown → escaped HTML. Same subset and branches as renderRich: table, bullets, numbered, heading, paragraph. */
function mdToHtml(text: string): string {
  const lines = String(text).replace(/\r/g, '').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t) { i++; continue }
    if (t.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|')) {
      const rows: string[] = []
      while (i < lines.length && lines[i].includes('|')) { rows.push(lines[i]); i++ }
      const cells = rows.map((rw) => rw.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()))
        .filter((cols) => !cols.every((c) => /^:?-{2,}:?$/.test(c) || c === ''))
      if (cells.length) {
        out.push(`<table class="md"><tbody>${cells.map((cols, ri) => `<tr>${cols.map((c) => (ri === 0
          ? `<th>${mdInline(c)}</th>` : `<td>${mdInline(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table>`)
      }
      continue
    }
    if (/^\s*[-*•]\s+/.test(lines[i])) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].trim().replace(/^[-*•]\s+/, '')); i++ }
      out.push(`<ul class="md">${items.map((it) => `<li>${mdInline(it)}</li>`).join('')}</ul>`)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(lines[i])) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].trim().replace(/^\d+[.)]\s+/, '')); i++ }
      out.push(`<ol class="md">${items.map((it) => `<li>${mdInline(it)}</li>`).join('')}</ol>`)
      continue
    }
    if (/^#{1,6}\s+/.test(t)) { out.push(`<div class="mdH">${mdInline(t.replace(/^#{1,6}\s+/, ''))}</div>`); i++; continue }
    out.push(`<p class="md">${mdInline(t)}</p>`)
    i++
  }
  return out.join('')
}

/** A generated 5E body → escaped HTML ('' when there is nothing to show). */
function richHtml(content: unknown): string {
  const healed = healRich(content)
  if (healed.fallback) return `<p class="muted it">${esc(RICH_FALLBACK)}</p>`
  if (!healed.text.trim()) return ''
  return hasHtml(healed.text) ? `<div class="pre">${esc(htmlToText(healed.text))}</div>` : mdToHtml(healed.text)
}

/** Plain text that keeps its line breaks (rendered with white-space: pre-wrap). */
const pre = (v: string, cls = '') => `<div class="pre${cls ? ' ' + cls : ''}">${esc(v)}</div>`
const pill = (text: string, cls: string) => `<span class="pill ${cls}">${esc(text)}</span>`
const sectionHead = (title: string) => `<h2 class="secTitle">${esc(title)}</h2>`

/**
 * The full printable document, built from the plan data.
 * @param plan  the plan as the Lesson Plan View displays it (saved JSON + the row's class / subject / topic frame)
 * @param meta  signed-in school / teacher / academic year
 * @param title document title — Chrome's "Save as PDF" uses it as the default file name
 */
export function buildLessonPlanHtml(plan: Partial<PlanContent> | null | undefined, meta: LessonPlanExportMeta, title?: string): string {
  const m = readPlan(plan)
  const schoolName = str(meta.schoolName)
  const logo = safeImg(meta.logoUrl)
  const docTitle = str(title) || `${m.topic || m.subject || 'Lesson'} — Unit Plan`

  const metaField = (label: string, value: string) =>
    `<div class="mf"><div class="mfLabel">${esc(label)}</div><div class="mfValue">${esc(dash(value))}</div></div>`

  const parts: string[] = []

  /* Core Objectives — amber cards, factor pill */
  const core = m.coreObjectives.filter((o) => o.text || o.factor)
  if (core.length) {
    parts.push(`<section class="sec">${sectionHead('Core Objectives')}<ul class="dots">${core.map((o) => `
      <li class="card amber">${o.text ? pre(o.text, 'body') : ''}${o.factor ? `<div class="pills">${pill(o.factor, 'pAmber')}</div>` : ''}</li>`).join('')}
    </ul></section>`)
  }

  /* Expected Learning Outcomes — emerald cards, ELO + Bloom pills */
  const outcomes = m.outcomes.filter((o) => o.fullText || o.name)
  if (outcomes.length) {
    parts.push(`<section class="sec">${sectionHead('Expected Learning Outcomes')}<ul class="dots">${outcomes.map((o) => `
      <li class="card emerald">${pre(o.fullText || o.name, 'body')}<div class="pills">${pill(o.label, 'pEmerald')}${o.bloom ? pill(`Bloom's Level: ${o.bloom}`, 'pAmber') : ''}</div></li>`).join('')}
    </ul></section>`)
  }

  /* Assessment — blue cards, per-item pills, MCQ option grid, answer box */
  if (m.assessed.length) {
    parts.push(`<section class="sec">${sectionHead('Assessment')}${m.assessed.map((a) => `
      <div class="assess">
        <table class="row"><tr>
          <td><h3 class="aTitle">${esc(a.name || a.label)}</h3>${a.bloom ? `<div class="pills tight">${pill(a.bloom, 'pBlueSoft')}</div>` : ''}</td>
          <td class="right">${pill(`${a.items.length} Items`, 'pBlueSoft2')}</td>
        </tr></table>
        ${a.items.map((it) => `
        <div class="item">
          <div class="pills tight">${pill(it.typeLabel || 'Item', 'pPurple')}${it.bloom ? pill(it.bloom, 'pBlue') : ''}</div>
          ${it.question ? pre(it.question, 'q') : ''}
          ${it.isMcq && it.options.length ? `<div class="optsLabel">Options:</div><div class="opts">${it.options.map((o) => `
            <div class="opt"><span class="optL">${esc(o.letter)}.</span> <span class="optT">${esc(o.text)}</span></div>`).join('')}</div>` : ''}
          ${it.answer && it.answerable ? `<div class="answer"><b>Answer:</b> ${esc(it.answer)}</div>` : ''}
        </div>`).join('')}
      </div>`).join('')}</section>`)
  }

  /* Assignments — header strip + Purpose / Instructions / Submission tinted blocks */
  const assigns = m.assignments.filter((a) => a.title || a.purpose || a.instructions || a.submission)
  if (assigns.length) {
    const tint: Record<AssignmentKey, string> = { purpose: 'indigo', instructions: 'purple', submission: 'rose' }
    parts.push(`<section class="sec">${sectionHead('Assignments')}${assigns.map((a) => `
      <div class="assign">
        <div class="assignHead"><h3>${esc(dash(a.title))}</h3></div>
        <div class="assignBody">${ASSIGNMENT_BLOCKS.filter((b) => a[b.key]).map((b) => `
          <div class="block ${tint[b.key]}"><h4>${esc(b.label)}</h4>${pre(a[b.key], 'body')}</div>`).join('')}
        </div>
      </div>`).join('')}</section>`)
  }

  /* Learning Experience — the older per-phase activity list */
  const phases = m.fiveE.filter((ph) => ph.phase || ph.activities.some((x) => x.title || x.description))
  if (phases.length) {
    parts.push(`<section class="sec">${sectionHead('Learning Experience')}${phases.map((ph) => `
      <div class="phase">
        <div class="phaseHead"><span class="badge" style="background:${esc(ph.color)}">${esc(ph.phase.charAt(0) || '•')}</span>${esc(ph.phase)}</div>
        ${ph.activities.filter((x) => x.title || x.description).map((x) => `
        <div class="activity">${x.title ? `<div class="actTitle">${esc(x.title)}</div>` : ''}${x.description ? pre(x.description, 'body') : ''}</div>`).join('')}
      </div>`).join('')}</section>`)
  }

  /* 5E Design Model — by ELO, each step's selected resources with the generated content */
  if (m.design.length) {
    parts.push(`<section class="sec">${sectionHead('5E Design Model')}<div class="fed">
      <h3 class="fedTitle">5E Design Phase Model (by ELO)</h3>
      ${m.design.map((b) => `
      <div class="eloBlock">
        <table class="eloRule"><tr><td><span class="line"></span></td><td class="eloPillCell"><span class="eloPill">${esc(b.label)}</span></td><td><span class="line"></span></td></tr></table>
        ${b.steps.map((s) => `
        <div class="step">
          <table class="row stepHead"><tr>
            <td class="stepName">${esc(dash(s.name))}</td>
            <td class="right stepTime">${s.stepTime ? `<b>Step Time:</b> ${esc(s.stepTime)}` : ''}</td>
          </tr></table>
          ${s.resources.length ? s.resources.map((r) => {
            const body = richHtml(r.content)
            return `<div class="res"><div class="resName">${esc(r.name)}</div>${body || '<p class="muted it small">No content generated yet.</p>'}</div>`
          }).join('') : '<p class="muted it small">No resources selected for this phase.</p>'}
        </div>`).join('')}
      </div>`).join('')}
    </div></section>`)
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(docTitle)}</title>
<style>
  /* Colours are part of the document, not decoration — force the browser to print them. */
  *,*::before,*::after{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{size:A4;margin:12mm 12mm 15mm}
  html,body{margin:0;background:#fff}
  body{color:#0F172A;font-family:Inter,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:10.5pt;line-height:1.55}
  h1,h2,h3,h4{margin:0;font-weight:700;color:#1F2937}
  p{margin:0 0 6px}
  table{border-collapse:collapse;width:100%}
  td{vertical-align:top;padding:0}
  .sheet{max-width:820px;margin:0 auto}
  .pre{white-space:pre-wrap;word-wrap:break-word}
  .muted{color:#64748B}.it{font-style:italic}.small{font-size:9pt}
  .right{text-align:right}

  /* PAGE BREAKS. Big containers (a section, an assessment card, a 5E step) may flow across pages; the SMALL
     units inside them are held together — an objective, an item, an option, an assignment block, a resource.
     Headings are pinned to what follows so a title never sits alone at the foot of a page. */
  .sec,.assess,.assign,.phase,.fed,.eloBlock,.step{break-inside:auto;page-break-inside:auto}
  .card,.item,.opt,.answer,.block,.activity,.res,.mf,tr,li{break-inside:avoid;page-break-inside:avoid}
  h2,h3,h4,.secTitle,.stepHead,.eloRule,.assignHead,.phaseHead,.resName,.mdH{break-after:avoid;page-break-after:avoid}
  p,li,.pre{orphans:3;widows:3}

  /* Toolbar — screen only. */
  .toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;
           padding:10px 16px;margin:0 0 16px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;font-size:10pt;color:#475569}
  .toolbar button{font:inherit;font-weight:600;color:#fff;background:#4F46E5;border:0;border-radius:8px;padding:7px 14px;cursor:pointer}
  @media print{.toolbar{display:none}}

  /* Banner */
  .banner{background:#EDEEF1;border:1px solid #E2E8F0;border-radius:10px 10px 0 0;padding:18px 20px}
  .banner td{vertical-align:middle}
  .logoCell{width:76px;padding-right:16px}
  .logo{width:64px;height:64px;border-radius:12px;background:#0F172A;color:#fff;font-weight:700;font-size:15pt;
        text-align:center;line-height:64px;overflow:hidden}
  .logo.img{background:#fff;border:1px solid #E2E8F0;line-height:0}
  .logo img{width:100%;height:100%;object-fit:contain}
  .schoolName{font-size:17pt;font-weight:700;color:#0F172A;line-height:1.25;margin-bottom:2px}
  .unit{font-size:13pt;font-weight:600;color:#0F172A;letter-spacing:.08em}
  .year{width:160px;color:#64748B}
  .year div{font-size:9.5pt}.year b{font-size:11pt}

  /* Meta grid */
  .meta{background:#FAFBFC;border:1px solid #E2E8F0;border-top:0;border-radius:0 0 10px 10px;padding:16px 20px;margin-bottom:8px}
  .meta td{width:33.33%;padding-right:14px}
  .mf{margin-bottom:12px}.mf:last-child{margin-bottom:0}
  .mfLabel{font-size:8.5pt;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:.05em}
  .mfValue{font-size:12pt;font-weight:600;color:#0F172A;word-wrap:break-word}

  /* Sections */
  .sec{margin-top:22px}
  .secTitle{font-size:16pt;color:#1F2937;letter-spacing:-.01em;padding-bottom:6px;margin-bottom:14px;border-bottom:1px solid #E2E8F0}
  ul.dots{margin:0;padding:0 0 0 18px;list-style:disc}
  ul.dots>li{margin:0 0 10px}
  .card{border-radius:10px;padding:12px 14px}
  .card .body{color:#374151;line-height:1.55}
  .amber{background:#FFFDF5;border:1px solid #FEF3C7}
  .emerald{background:#F8FFFB;border:1px solid #D1FAE5}
  .pills{margin-top:7px}.pills.tight{margin:0 0 4px}
  .pill{display:inline-block;margin:0 6px 4px 0;padding:2px 10px;border-radius:999px;font-size:8.5pt;font-weight:500;line-height:1.5}
  .pAmber{background:#FEF3C7;color:#92400E}
  .pEmerald{background:#D1FAE5;color:#065F46}
  .pPurple{background:#F3E8FF;color:#6B21A8}
  .pBlue{background:#DBEAFE;color:#1E40AF}
  .pBlueSoft{background:#EFF6FF;color:#2563EB}
  .pBlueSoft2{background:#EFF6FF;color:#1D4ED8;white-space:nowrap}

  /* Assessment */
  .assess{border:1px solid #DBEAFE;border-radius:10px;padding:14px 16px;margin-bottom:12px;background:#fff}
  .assess>.row{margin-bottom:10px}
  .aTitle{font-size:12.5pt;font-weight:600;color:#1E40AF;margin-bottom:4px}
  .item{background:#F9FAFB;border:1px solid #F3F4F6;border-left:3px solid #3B82F6;border-radius:8px;padding:9px 11px;margin-bottom:8px}
  .item:last-child{margin-bottom:0}
  .q{color:#4B5563;margin-top:2px}
  .optsLabel{font-size:9.5pt;font-weight:600;color:#4B5563;margin:7px 0 4px}
  .opts{font-size:0}
  .opt{display:inline-block;vertical-align:top;width:49%;margin:0 2% 5px 0;padding:6px 8px;border-radius:6px;background:#F3F4F6;font-size:10pt}
  .opt:nth-child(2n){margin-right:0}
  .optL{font-weight:600;color:#2563EB}.optT{color:#374151;white-space:pre-wrap}
  .answer{margin-top:7px;padding:6px 9px;background:#F0FDF4;border:1px solid #DCFCE7;border-radius:6px;color:#15803D;font-size:10pt}
  .answer b{font-weight:600}

  /* Assignments */
  .assign{border:1px solid #F3F4F6;border-radius:8px;margin-bottom:14px;overflow:hidden}
  .assignHead{background:#F9FAFB;border-bottom:1px solid #F3F4F6;padding:9px 16px}
  .assignHead h3{font-size:12.5pt;font-weight:600;color:#1F2937}
  .assignBody{padding:12px 16px}
  .block{border-radius:8px;padding:10px 12px;margin-bottom:9px}
  .block:last-child{margin-bottom:0}
  .block h4{font-size:11pt;font-weight:600;margin-bottom:4px}
  .block .body{color:#374151}
  .indigo{background:#EEF2FF}.indigo h4{color:#3730A3}
  .purple{background:#FAF5FF}.purple h4{color:#6B21A8}
  .rose{background:#FFF1F2}.rose h4{color:#9F1239}

  /* Learning Experience */
  .phase{border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;margin-bottom:12px}
  .phaseHead{font-size:12.5pt;font-weight:600;color:#1F2937;margin-bottom:8px}
  .badge{display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:6px;color:#fff;
         font-size:10.5pt;font-weight:700;margin-right:8px;vertical-align:middle}
  .activity{background:#F9FAFB;border:1px solid #F3F4F6;border-radius:8px;padding:10px 12px;margin-bottom:8px}
  .activity:last-child{margin-bottom:0}
  .actTitle{font-weight:600;color:#1F2937;margin-bottom:3px}

  /* 5E Design Model */
  .fed{border:2px solid #C7DDFB;border-radius:12px;padding:18px 18px 6px;background:#FAFCFF}
  .fedTitle{font-size:15pt;font-weight:700;color:#2563EB;margin-bottom:12px}
  .eloBlock{margin-bottom:16px}
  .eloRule{margin:4px 0 12px}
  .eloRule td{vertical-align:middle}
  .eloRule .line{display:block;height:1px;background:#BFDBFE}
  .eloPillCell{width:1%;white-space:nowrap;padding:0 12px}
  .eloPill{display:inline-block;padding:5px 14px;border:1px solid #BFDBFE;border-radius:999px;background:#fff;font-size:11pt;font-weight:700;color:#0F172A}
  .step{border:1px solid #E2E8F0;border-left:4px solid #93C5FD;border-radius:8px;background:#F5F9FF;padding:12px 14px;margin-bottom:12px}
  .stepHead{margin-bottom:6px}
  .stepHead td{vertical-align:middle}
  .stepName{font-size:11.5pt;font-weight:600;color:#0F172A}
  .stepTime{font-size:10.5pt;font-weight:600;color:#1E40AF;white-space:nowrap;padding-left:10px}
  .res{border:1px solid #E9EDF2;border-radius:8px;background:#fff;padding:10px 12px;margin-top:9px}
  .resName{font-size:10pt;font-weight:600;color:#0F172A;margin-bottom:3px}
  .res .pre{color:#111827}

  /* Markdown bodies (the renderRich subset) */
  p.md{margin:5px 0;color:#475569}
  ul.md,ol.md{margin:5px 0;padding-left:20px;color:#475569}
  ul.md li,ol.md li{margin:2px 0}
  .mdH{font-weight:700;color:#111827;margin:9px 0 3px}
  table.md{margin:7px 0;font-size:9.5pt}
  table.md th,table.md td{border:1px solid #E5E7EB;padding:5px 7px;text-align:left;vertical-align:top}
  table.md th{background:#F3F4F6;font-weight:600;color:#374151}
  table.md td{color:#475569}
  b{font-weight:600;color:#0F172A}
</style></head><body>
  <div class="toolbar"><span>Choose “Save as PDF” as the destination in the print dialog to download this plan.</span><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
  <main class="sheet">
    <div class="banner"><table><tr>
      <td class="logoCell">${logo
        ? `<div class="logo img"><img src="${esc(logo)}" alt="School logo" referrerpolicy="no-referrer"></div>`
        : `<div class="logo">${esc(schoolInitials(schoolName))}</div>`}</td>
      <td><div class="schoolName">${esc(dash(schoolName))}</div><div class="unit">UNIT PLAN</div></td>
      <td class="year right"><div>Academic Year</div><b>${esc(dash(str(meta.academicYear)))}</b></td>
    </tr></table></div>
    <div class="meta"><table><tr>
      <td>${metaField('Class', m.grade)}${metaField('Duration(mins)', m.duration)}${metaField('Execution Period', m.executionPeriod)}</td>
      <td>${metaField('Subject', m.subject)}${metaField("Teacher's Name", str(meta.teacherName))}</td>
      <td>${metaField('Topic', m.topic)}${metaField('Planned Date', m.plannedDate)}</td>
    </tr></table></div>
    ${parts.join('')}
  </main>
</body></html>`
}

/**
 * Open the print document in a popup and print it once its images have settled.
 * @returns false when the browser blocked the popup (the caller tells the teacher to allow pop-ups).
 */
export function printLessonPlan(plan: Partial<PlanContent> | null | undefined, meta: LessonPlanExportMeta, title: string): boolean {
  // Opened synchronously inside the click so a popup blocker sees the user gesture.
  const w = window.open('', 'lesson_plan_pdf', 'popup=yes,width=1000,height=920,scrollbars=yes,resizable=yes')
  if (!w || w.closed) return false
  w.document.open()
  w.document.write(buildLessonPlanHtml(plan, meta, title))
  w.document.close()

  // Print only once every image (a school logo) has settled — printing early leaves blank cells and shifts the
  // layout mid-render; a hard cap means a slow remote image cannot hang the dialog.
  let fired = false
  const go = () => {
    if (fired) return
    fired = true
    try { w.focus(); w.print() } catch { /* the teacher closed the window */ }
  }
  const whenReady = () => {
    const imgs = Array.from(w.document.images)
    let pending = imgs.filter((img) => !img.complete).length
    if (pending === 0) { window.setTimeout(go, 120); return }
    const settle = () => { pending -= 1; if (pending <= 0) window.setTimeout(go, 120) }
    imgs.forEach((img) => {
      if (img.complete) return
      img.addEventListener('load', settle, { once: true })
      img.addEventListener('error', settle, { once: true })
    })
    window.setTimeout(go, 6000)
  }
  if (w.document.readyState === 'complete') whenReady()
  else w.addEventListener('load', whenReady, { once: true })
  return true
}
