/* The chat pipeline's generated sections → (1) the EXACT plan JSON the Lesson Plan View reads, so a chat-saved
   plan renders like a creator-made one, and (2) a styled self-contained HTML document for the PDF / Word exports.
   Ported from Rapid's ChatBotScreen (buildToolPlan, lpEsc, lessonPlanToHtml, downloadHtmlWord). */
import type { FiveEDesign, PlanAssessmentBlock, PlanAssessmentItem, PlanContent, PlanStep } from '@/types/lessonPlan'
import { BOARD, fmtDuration } from './text'
import type { PlanParts } from './types'

const eloIdOf = (id: string, i: number) => id || `Elo-${i + 1}`

/** Rapid's tool-plan shape: "topic" (not "chapter"); ELO-keyed assessment with options as {a,b,c,d}; 5E content in
    fiveEDesign.generatedContentData["<eloText>_<stepId>"]["Learning Activity"], eloSteps[].elo = an elos[].text. */
export function buildToolPlan({ inputs, cos, elos, assessment, assignments, fiveE }: PlanParts): PlanContent {
  const optsToObj = (opts: string[]) => Object.fromEntries(opts.map((v, k) => [String.fromCharCode(97 + k), v]))
  const elosOut = elos.map((e, i) => ({ id: eloIdOf(e.Elo_id, i), text: e.elo }))
  const byId = new Map(assessment.map((a) => [a.id, a]))
  const assessmentOut: PlanAssessmentBlock[] = elos.map((e, i) => {
    const id = eloIdOf(e.Elo_id, i)
    const items = (byId.get(id)?.items ?? []).map((it): PlanAssessmentItem => {
      const hasOpts = it.options.length > 0
      const item: PlanAssessmentItem = {
        answer: it.answer, options: hasOpts ? optsToObj(it.options) : null,
        itemType: it.itemType || (hasOpts ? 'MCQ' : 'Open Ended'), question: it.question, bloomsLevel: e.bloom_level,
      }
      if (it.context) item.context = it.context
      return item
    })
    return { id, name: `ELO ${i + 1}`, items, fullText: e.elo, bloomLevel: e.bloom_level }
  })
  const RES = 'Learning Activity'
  const eloSteps: FiveEDesign['eloSteps'] = []
  const generatedContentData: FiveEDesign['generatedContentData'] = {}
  ;(fiveE?.eloSteps ?? []).forEach((es, i) => {
    const eloText = elosOut[i]?.text || es.elo
    const steps = es.steps.map((s, k): PlanStep => {
      const stepId = `s${k + 1}`
      if (s.description) generatedContentData[`${eloText}_${stepId}`] = { [RES]: s.description }
      return { id: stepId, name: s.name, stepTime: s.stepTime, resources: s.description ? [RES] : [], resourceTimeAllocations: {} }
    })
    eloSteps.push({ elo: eloText, steps })
  })
  return {
    elos: elosOut, board: BOARD, fiveE: [], grade: inputs.class_name, topic: inputs.chapter_name,
    subject: inputs.subject_name, duration: String(inputs.duration_mins || 45),
    assessment: assessmentOut,
    assignments: assignments.map((a) => ({ title: a.title || 'Assignment', purpose: a.purpose, instructions: a.instructions, submission: a.submission })),
    fiveEDesign: { eloSteps, generatedContentData },
    coreObjectives: cos.map((c) => ({ text: c.co_description || c.co_title || '', factor: c.factor || c.co_title || '' })),
    intelligenceTypes: [], pedagogicalApproaches: [],
  }
}

export const lpEsc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** "VI" / "10" → "Class VI" / "Class 10"; a descriptive class name ("NEET Batch A") is shown as-is. */
export const classLabel = (name: string) => (/^([ivx]{1,4}|\d{1,2})$/i.test(name.trim()) ? `Class ${name.trim()}` : name)

/** The complete plan as a styled HTML block (banner, section accents, tinted cards, page-break-safe classes). */
export function lessonPlanToHtml({ inputs, cos, elos, assessment, assignments, fiveE }: PlanParts): string {
  const H: string[] = []
  const sec = (t: string, color: string) => `<h2 class="section-header" style="font-size:16px;font-weight:700;color:${color};margin:22px 0 10px;padding-bottom:6px;border-bottom:2px solid ${color}40;">${lpEsc(t)}</h2>`
  const pill = (t: string, bg: string, fg: string) => `<span style="display:inline-block;font-size:11px;font-weight:600;color:${fg};background:${bg};padding:2px 9px;border-radius:10px;margin-top:6px;">${lpEsc(t)}</span>`
  const card = (bg: string, border: string, body: string, pad = '12px 14px', mb = '8px') =>
    `<div class="break-inside-avoid" style="background:${bg};border:1px solid ${border};border-radius:8px;padding:${pad};margin-bottom:${mb};">${body}</div>`
  H.push('<div style="font-family:Arial,\'Segoe UI\',sans-serif;color:#1a1a1a;font-size:13px;line-height:1.5;">')
  H.push('<div style="background:#0d55b4;color:#ffffff;padding:22px 24px;border-radius:10px;margin-bottom:6px;">'
    + '<div style="font-size:12px;letter-spacing:1.5px;opacity:.85;">UNIT PLAN</div>'
    + `<div style="font-size:24px;font-weight:700;margin-top:2px;">${lpEsc(inputs.chapter_name)}</div>`
    + `<div style="font-size:13px;margin-top:8px;">${lpEsc(classLabel(inputs.class_name))} &nbsp;•&nbsp; ${lpEsc(inputs.subject_name)} &nbsp;•&nbsp; Duration: ${lpEsc(fmtDuration(inputs.duration_mins))}</div>`
    + '</div>')
  H.push(sec('Course Outcomes', '#B45309'))
  cos.forEach((c, i) => H.push(card('#FEF9EC', '#FDE9C8',
    `<div style="font-weight:700;color:#92400E;">${lpEsc(c.co_id || `CO${i + 1}`)}. ${lpEsc(c.co_title)}</div>`
    + `<div style="margin-top:4px;">${lpEsc(c.co_description)}</div>`
    + (c.factor ? pill(c.factor, '#FDE9C8', '#92400E') : ''))))
  H.push(sec('Expected Learning Outcomes', '#047857'))
  elos.forEach((e, i) => H.push(card('#ECFDF5', '#C6F0DC',
    `<div><b style="color:#065F46;">${lpEsc(eloIdOf(e.Elo_id, i))}</b>: ${lpEsc(e.elo)}</div>`
    + (e.bloom_level ? pill(`Bloom's: ${e.bloom_level}`, '#C6F0DC', '#065F46') : ''))))
  H.push(sec('Assessment', '#1D4ED8'))
  assessment.forEach((a) => {
    H.push(`<div style="font-weight:700;color:#1E40AF;margin:12px 0 6px;">${lpEsc(a.id)}`
      + (a.items.length ? ` <span style="font-weight:500;color:#2563EB;font-size:11px;">(${a.items.length} items)</span>` : '') + '</div>')
    a.items.forEach((it, ii) => {
      let b = it.context ? `<div style="margin-bottom:6px;color:#334155;"><b>Context:</b> ${lpEsc(it.context)}</div>` : ''
      b += `<div style="font-weight:600;">Q${ii + 1}. ${lpEsc(it.question)}</div>`
      if (it.options.length) b += `<div style="margin-top:6px;">${it.options.map((o, oi) => `<div>${String.fromCharCode(65 + oi)}. ${lpEsc(o)}</div>`).join('')}</div>`
      b += `<div style="margin-top:8px;background:#F0FDF4;border:1px solid #DCFCE7;border-radius:6px;padding:6px 10px;color:#15803D;"><b>Answer:</b> ${lpEsc(it.answer || '—')}</div>`
      H.push(card('#F8FAFF', '#DBEAFE', b))
    })
  })
  if (assignments.length) {
    H.push(sec('Assignments', '#6D28D9'))
    assignments.forEach((a, i) => H.push(card('#FAF5FF', '#EAD9FB',
      `<div style="font-weight:700;color:#6B21A8;">${i + 1}. ${lpEsc(a.title)}</div>`
      + (a.purpose ? `<div style="margin-top:4px;"><b>Purpose:</b> ${lpEsc(a.purpose)}</div>` : '')
      + (a.instructions ? `<div style="margin-top:4px;"><b>Instructions:</b> ${lpEsc(a.instructions)}</div>` : ''))))
  }
  if (fiveE?.eloSteps.length) {
    H.push(sec('5E Learning Experience', '#0E7490'))
    fiveE.eloSteps.forEach((es) => {
      H.push(`<div style="font-weight:700;color:#155E75;margin:12px 0 6px;">${lpEsc(es.elo)}</div>`)
      es.steps.forEach((s) => H.push(card('#ECFEFF', '#C7EEF3',
        `<b style="color:#155E75;">${lpEsc(s.name)}</b> <span style="color:#0891B2;font-size:11px;">(${lpEsc(s.stepTime)} min)</span><div style="margin-top:3px;">${lpEsc(s.description)}</div>`,
        '10px 14px', '6px')))
    })
  }
  H.push('</div>')
  return H.join('')
}

/** "<chapter> Unit Plan" — the document / file title. */
export const planFileTitle = (p: PlanParts) => `${p.inputs.chapter_name || 'Lesson'} Unit Plan`

const PRINT_CSS = '@page{size:A4;margin:14mm}html,body{background:#fff}body{margin:0;padding:8px;'
  + '-webkit-print-color-adjust:exact;print-color-adjust:exact}.break-inside-avoid{break-inside:avoid;page-break-inside:avoid}'
  + '.section-header{break-after:avoid;page-break-after:avoid}'

/** PDF: open the styled document in a print window ("Save as PDF"). false when the popup was blocked. */
export function printHtml(html: string, title: string): boolean {
  const w = window.open('', '_blank', 'width=960,height=1100')
  if (!w) return false
  const d = w.document
  d.title = title
  const meta = d.createElement('meta')
  meta.setAttribute('charset', 'utf-8')
  const style = d.createElement('style')
  style.textContent = PRINT_CSS
  d.head.append(meta, style)
  d.body.innerHTML = html
  w.focus()
  window.setTimeout(() => { try { w.print() } catch { /* the window was closed */ } }, 350)
  return true
}

/** Word: wrap the styled HTML in a Word document (.doc), which Word opens with the layout intact. */
export function downloadWordDoc(html: string, title: string): void {
  const doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" '
    + `xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${lpEsc(title)}</title></head><body>${html}</body></html>`
  const blob = new Blob(['﻿' + doc], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, '').trim().replace(/\s+/g, '_') || 'Unit_Plan'}.doc`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}
