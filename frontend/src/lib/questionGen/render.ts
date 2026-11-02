/* Question / paper → HTML, shared by the editor cards, the full-paper preview and the print document. Everything
   variable goes through renderRich (sanitised; equations rendered by KaTeX) or escapeHtml, so no stored or
   model-generated value is ever interpolated raw. */

import type { CompositeData, Lang, MediaInfo, Paper, QgenMeta, Question } from '@/types/questionGen'
import {
  ALPHA, ROMAN, answerKey, arGroups, blanksOf, durationText, fmtMarks, isComposite, labels, matchColumns,
  numberPaper, orderingDisplay, renderBlanks, subLabel, totalMarks,
} from './paper'
import { escapeHtml as esc, renderRich } from './richText'

export interface RenderCtx {
  media: Record<string, MediaInfo>
  arCodes: string[]
  arInstruction: string
  lang: Lang
  showMarks?: boolean
  /** KaTeX output: html (screen, needs katex.css) or mathml (print popup, no fonts needed). */
  math?: 'html' | 'mathml'
}

/** The render context for the generator screens (A/R codes from the institution's settings). */
export function renderCtx(meta: QgenMeta | undefined, lang: Lang, media: Record<string, MediaInfo> = {}): RenderCtx {
  return { media, arCodes: meta?.settings.ar_codes ?? [], arInstruction: meta?.settings.ar_instruction ?? '', lang }
}

const rich = (h: string, ctx: RenderCtx) => renderRich(h, { output: ctx.math ?? 'html' })

function optionsHtml(cells: string[], layout: string): string {
  const cols = layout === 'four' ? 4 : layout === 'two' ? 2 : 1
  const items = cells.map((c, i) => `<div class="qg-opt"><span class="qg-ol">(${ALPHA[i]})</span> ${c}</div>`).join('')
  return `<div class="qg-opts qg-cols-${cols}">${items}</div>`
}

function mediaHtml(q: Question, ctx: RenderCtx): string {
  return q.media.map((m) => {
    const info = ctx.media[m.media_id]
    if (!info) return ''
    const w = Math.min(info.width, 320)
    return `<figure class="qg-fig"><img src="${esc(info.url)}" alt="${esc(m.caption || 'Diagram')}" width="${w}" />${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ''}</figure>`
  }).join('')
}

/** The printed body of one (non-numbered) question. */
export function questionBodyHtml(q: Question, ctx: RenderCtx): string {
  const L = labels(ctx.lang)
  const parts: string[] = []
  if (q.type !== 'ASSERTION_REASON') parts.push(`<div class="qg-text">${rich(q.type === 'FILL_BLANK' ? renderBlanks(q.text) : q.text, ctx)}</div>`)
  parts.push(mediaHtml(q, ctx))
  switch (q.type) {
    case 'MCQ': parts.push(optionsHtml(q.data.options.map((o) => rich(o.text, ctx)), q.data.layout)); break
    case 'MRQ': parts.push(optionsHtml(q.data.options.map((o) => rich(o.text, ctx)), 'list')); break
    case 'TRUE_FALSE': parts.push(q.data.statements.map((s, i) => `<div class="qg-opt"><span class="qg-ol">(${ROMAN[i]})</span> ${rich(s.text, ctx)}</div>`).join('')); break
    case 'FILL_BLANK':
      if (q.data.word_bank) {
        const words = [...new Set([...blanksOf(q.text), ...q.data.distractors])].sort((a, b) => a.localeCompare(b))
        parts.push(`<div class="qg-box"><b>${esc(L.word_bank)}:</b> ${words.map(esc).join(' · ')}</div>`)
      }
      break
    case 'MATCH': {
      const { left, right } = matchColumns(q)
      const rows = left.map((p, i) => `<tr><td>${i + 1}. ${rich(p.left, ctx)}</td><td>(${right[i]?.letter ?? ''}) ${right[i] ? rich(right[i].pair.right, ctx) : ''}</td></tr>`).join('')
      parts.push(`<table class="qg-match"><thead><tr><th>${esc(q.data.left_title || L.column1)}</th><th>${esc(q.data.right_title || L.column2)}</th></tr></thead><tbody>${rows}</tbody></table>`)
      break
    }
    case 'ASSERTION_REASON':
      parts.push(`<div class="qg-text"><b>${esc(L.assertion)}:</b> ${rich(q.data.assertion, ctx)}</div><div class="qg-text"><b>${esc(L.reason)}:</b> ${rich(q.data.reason, ctx)}</div>`)
      break
    case 'ORDERING':
      parts.push(orderingDisplay(q).map((d) => `<div class="qg-opt"><span class="qg-ol">(${d.letter})</span> ${rich(d.item.text, ctx)}</div>`).join(''))
      break
    case 'CASE_BASED':
    case 'SCENARIO_BASED':
    case 'PASSAGE': {
      const d = q.data as CompositeData
      if (d.passage_title) parts.push(`<div class="qg-text"><b>${esc(d.passage_title)}</b></div>`)
      parts.push(`<div class="qg-box">${rich(d.passage, ctx)}</div>`)
      parts.push(d.sub_questions.map((s, i) => row(subLabel(i, d.numbering), questionBodyHtml(s, ctx), s.marks, ctx, 'qg-sub')).join(''))
      break
    }
    default: break
  }
  return parts.join('')
}

function row(num: string, body: string, marks: number, ctx: RenderCtx, cls = 'qg-q'): string {
  const m = ctx.showMarks === false ? '' : `[${fmtMarks(marks)}]`
  return `<div class="${cls}"><div class="qg-num">${esc(num)}</div><div class="qg-body">${body}</div><div class="qg-marks">${m}</div></div>`
}

function keyHtml(q: Question, ctx: RenderCtx): string {
  return answerKey(q, ctx.arCodes, ctx.lang).map((k) => `<div class="qg-key">${k.label ? `<b>${esc(k.label)}:</b> ` : ''}${k.html}</div>`).join('')
}

/** Answer-key entry for one question (sub-questions listed with their own keys). */
export function questionKeyHtml(q: Question, ctx: RenderCtx): string {
  if (!isComposite(q.type)) return keyHtml(q, ctx)
  const d = q.data as CompositeData
  const expl = q.explanation ? `<div class="qg-key"><b>${esc(labels(ctx.lang).explanation)}:</b> ${rich(q.explanation, ctx)}</div>` : ''
  return d.sub_questions.map((s, i) => row(subLabel(i, d.numbering), keyHtml(s, ctx), s.marks, ctx, 'qg-sub')).join('') + expl
}

/** A numbered question card (paper look), optionally followed by its answer key. */
export function questionHtml(num: string, q: Question, ctx: RenderCtx, { withKey = false } = {}): string {
  return row(`${num}.`, questionBodyHtml(q, ctx) + (withKey ? `<div class="qg-keybox">${questionKeyHtml(q, ctx)}</div>` : ''), q.marks, ctx)
}

function headerHtml(p: Paper, ctx: RenderCtx, answerKeyMode: boolean): string {
  const L = labels(ctx.lang)
  const h = p.header
  const logo = h.logo_media_id && ctx.media[h.logo_media_id] ? `<img class="qg-logo" src="${esc(ctx.media[h.logo_media_id].url)}" alt="Logo" />` : ''
  const left: [string, string][] = [[L.class, p.class_name], [L.subject, p.subject_name]]
  if (h.academic_year) left.push([L.year, h.academic_year])
  const right: [string, string][] = []
  if (h.duration_minutes) right.push([L.time, durationText(h.duration_minutes, ctx.lang)])
  right.push([L.max_marks, fmtMarks(totalMarks(p.items))])
  if (h.exam_date) right.push([L.date, h.exam_date])
  const n = Math.max(left.length, right.length)
  const meta = Array.from({ length: n }, (_, i) => `<tr><td>${left[i] ? `<b>${esc(left[i][0])}:</b> ${esc(left[i][1])}` : ''}</td><td class="qg-r">${right[i] ? `<b>${esc(right[i][0])}:</b> ${esc(right[i][1])}` : ''}</td></tr>`).join('')
  const roll = h.show_roll_no && !answerKeyMode ? `<tr><td><b>${esc(L.name)}:</b> ____________________________</td><td class="qg-r"><b>${esc(L.roll)}:</b> ____________</td></tr>` : ''
  const gi = h.general_instructions.length && !answerKeyMode
    ? `<div class="qg-gi"><b>${esc(L.instructions)}:</b><ol>${h.general_instructions.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''
  return `<header class="qg-head">${logo}<div class="qg-inst">${esc(h.institution_name || p.institution_name)}</div><div class="qg-exam">${esc(h.exam_title || p.title)}</div>${answerKeyMode ? `<div class="qg-kind">${esc(L.answer_key)}</div>` : ''}</header><table class="qg-meta">${meta}${roll}</table><hr class="qg-rule" />${gi}`
}

/** The whole paper (or its answer key) as HTML inside `<div class="qg-paper">`. */
export function paperHtml(p: Paper, ctx: RenderCtx, { answerKey: answerKeyMode = false } = {}): string {
  const L = labels(ctx.lang)
  const c = { ...ctx, showMarks: p.header.show_marks }
  const out = [headerHtml(p, c, answerKeyMode)]
  for (const g of numberPaper(p.sections, p.items)) {
    if (g.section.title) out.push(`<h3 class="qg-sec">${esc(g.section.title)}</h3>`)
    if (g.section.instructions && !answerKeyMode) out.push(`<p class="qg-sec-i">${esc(g.section.instructions)}</p>`)
    for (const grp of arGroups(g.rows)) {
      if (grp.isAr && !answerKeyMode) {
        const nums = grp.rows.length > 1 ? `${grp.rows[0].number}–${grp.rows[grp.rows.length - 1].number}` : `${grp.rows[0].number}`
        out.push(`<div class="qg-dir"><b>${esc(L.q)} ${nums}:</b> ${esc(ctx.arInstruction)}<ol class="qg-codes">${ctx.arCodes.map((t, i) => `<li><span>(${'ABCD'[i]})</span> ${esc(t)}</li>`).join('')}</ol></div>`)
      }
      for (const r of grp.rows) {
        const q = r.item.question
        out.push(answerKeyMode ? row(`${r.number}.`, `<div class="qg-stem">${esc(stemText(q))}</div>${questionKeyHtml(q, c)}`, q.marks, c) : questionHtml(String(r.number), q, c))
      }
    }
  }
  return `<div class="qg-paper" lang="${esc(ctx.lang)}">${out.join('')}</div>`
}

function stemText(q: Question): string {
  const t = q.type === 'ASSERTION_REASON' ? q.data.assertion : q.type === 'FILL_BLANK' ? renderBlanks(q.text) : q.text
  const s = t.replace(/<span class="math" data-latex="([^"]*)"[^>]*>[\s\S]*?<\/span>/g, ' $1 ').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  return s.length > 160 ? `${s.slice(0, 160).replace(/\s+\S*$/, '')} …` : s
}

/** Paper typography. Scoped to .qg-paper so it can sit inside the app and also style the print document. */
export const PAPER_CSS = `
.qg-paper { font-family: 'Noto Serif', 'Times New Roman', Georgia, serif; color: #111; background: #fff; font-size: 14px; line-height: 1.5; }
.qg-paper .qg-head { text-align: center; position: relative; min-height: 48px; }
.qg-paper .qg-logo { position: absolute; left: 0; top: 0; max-width: 90px; max-height: 64px; }
.qg-paper .qg-inst { font-size: 20px; font-weight: 700; }
.qg-paper .qg-exam { font-size: 16px; font-weight: 700; margin-top: 2px; }
.qg-paper .qg-kind { font-size: 13px; font-weight: 700; color: #444; letter-spacing: .05em; margin-top: 2px; }
.qg-paper .qg-meta { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
.qg-paper .qg-meta td { padding: 1px 0; }
.qg-paper .qg-r { text-align: right; }
.qg-paper .qg-rule { border: 0; border-top: 1.5px solid #222; margin: 6px 0 8px; }
.qg-paper .qg-gi { font-size: 13px; margin-bottom: 8px; }
.qg-paper .qg-gi ol { margin: 2px 0 0 18px; padding: 0; }
.qg-paper .qg-sec { font-family: inherit; letter-spacing: 0; text-align: center; font-size: 15px; font-weight: 700; margin: 14px 0 2px; }
.qg-paper .qg-sec-i { text-align: center; font-style: italic; font-size: 12.5px; color: #333; margin: 0 0 6px; }
.qg-paper .qg-q, .qg-paper .qg-sub { display: flex; gap: 8px; margin: 0 0 10px; break-inside: avoid; }
.qg-paper .qg-sub { margin: 6px 0 4px; }
.qg-paper .qg-num { min-width: 34px; font-weight: 700; }
.qg-paper .qg-body { flex: 1; min-width: 0; }
.qg-paper .qg-marks { min-width: 40px; text-align: right; font-size: 12.5px; white-space: nowrap; }
.qg-paper .qg-text { margin: 0 0 4px; }
.qg-paper .qg-opts { display: grid; gap: 2px 18px; margin: 2px 0 4px; }
.qg-paper .qg-cols-1 { grid-template-columns: 1fr; }
.qg-paper .qg-cols-2 { grid-template-columns: 1fr 1fr; }
.qg-paper .qg-cols-4 { grid-template-columns: repeat(4, 1fr); }
.qg-paper .qg-ol { font-weight: 600; margin-right: 2px; }
.qg-paper .qg-box { border: 1px solid #666; padding: 6px 8px; margin: 4px 0 6px; }
.qg-paper .qg-match { border-collapse: collapse; margin: 4px 0; width: 100%; font-size: 13.5px; }
.qg-paper .qg-match th, .qg-paper .qg-match td { border: 1px solid #888; padding: 3px 6px; text-align: left; vertical-align: top; }
.qg-paper .qg-match th { width: 40%; }
.qg-paper .qg-dir { font-size: 13px; margin: 6px 0 6px; }
.qg-paper .qg-codes { list-style: none; margin: 2px 0 0; padding: 0; }
.qg-paper .qg-codes span { display: inline-block; min-width: 26px; }
.qg-paper .qg-key { color: #0b5d3b; margin: 1px 0; }
.qg-paper .qg-keybox { border-left: 3px solid #0b5d3b; padding-left: 8px; margin-top: 4px; }
.qg-paper .qg-stem { font-size: 12.5px; color: #444; }
.qg-paper .qg-fig { margin: 4px 0; text-align: center; }
.qg-paper .qg-fig img { max-width: 100%; height: auto; }
.qg-paper .qg-fig figcaption { font-size: 12px; color: #444; }
.qg-paper sub, .qg-paper sup { font-size: 75%; }
`
