/* Question paper / answer key → print (the browser's print dialog; "Save as PDF" also works from there).

   Same approach as the lesson plan print (components/lesson-plan/lessonPlanPrint.ts): the document is BUILT from the
   paper data — paperHtml() from render.ts, the same HTML the in-app preview shows — not cloned from the screen, and
   printed from a popup opened synchronously inside the click so pop-up blockers see the user gesture. Equations are
   rendered by KaTeX as MathML, which every current browser draws natively, so the popup needs no KaTeX stylesheet
   or fonts. Every value goes through paperHtml's sanitising / escaping; the document carries no script. Page numbers
   ("Page n of N" in the paper's language) come from CSS page-margin boxes. */

import type { Paper } from '@/types/questionGen'
import { labels } from './paper'
import { PAPER_CSS, paperHtml, type RenderCtx } from './render'
import { escapeHtml } from './richText'

/** CSS string literal (for `content:`) — backslashes and quotes escaped. */
const cssString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`

/** `Page {n} of {N}` → `"Page " counter(page) " of " counter(pages)` (any language's template). */
export function pageCounterContent(template: string): string {
  return template.split(/(\{n\}|\{N\})/).filter(Boolean)
    .map((p) => (p === '{n}' ? 'counter(page)' : p === '{N}' ? 'counter(pages)' : cssString(p))).join(' ')
}

export function printDocumentHtml(paper: Paper, ctx: RenderCtx, opts: { answerKey: boolean }): string {
  const L = labels(ctx.lang)
  const draft = paper.status !== 'PUBLISHED' ? ` ${cssString(` · ${L.draft}`)}` : ''
  const title = `${paper.header.exam_title || paper.title}${opts.answerKey ? ` — ${L.answer_key}` : ''}`
  const base = typeof location !== 'undefined' ? location.origin : ''
  return `<!doctype html>
<html lang="${escapeHtml(ctx.lang)}">
<head>
<meta charset="utf-8" />
<base href="${escapeHtml(base)}/" />
<title>${escapeHtml(title)}</title>
<style>
${PAPER_CSS}
@page { size: A4; margin: 16mm 14mm 18mm; @bottom-center { content: ${pageCounterContent(L.page)}${draft}; font-size: 9pt; color: #555; } }
html, body { margin: 0; background: #fff; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.qg-paper { max-width: 182mm; margin: 0 auto; padding: 8mm 0; }
.qg-paper math { font-size: 1.05em; }
@media print { .qg-paper { padding: 0; max-width: none; } }
</style>
</head>
<body>
${paperHtml(paper, { ...ctx, math: 'mathml' }, { answerKey: opts.answerKey })}
</body>
</html>`
}

/**
 * Open the print document in a popup and print it once its images have settled.
 * @returns false when the browser blocked the popup (the caller tells the teacher to allow pop-ups).
 */
export function printPaper(paper: Paper, ctx: RenderCtx, opts: { answerKey: boolean }): boolean {
  // Opened synchronously inside the click so a popup blocker sees the user gesture.
  const w = window.open('', '_blank', 'popup=yes,width=1000,height=920,scrollbars=yes,resizable=yes')
  if (!w || w.closed) return false
  w.document.open()
  w.document.write(printDocumentHtml(paper, ctx, opts))
  w.document.close()

  // Print once every image (diagrams, the school logo) has settled; a hard cap means a slow image cannot hang it.
  let fired = false
  const go = () => {
    if (fired) return
    fired = true
    try { w.focus(); w.print() } catch { /* the teacher closed the window */ }
  }
  const imgs = Array.from(w.document.images)
  let pending = imgs.filter((img) => !img.complete).length
  if (pending === 0) window.setTimeout(go, 150)
  else {
    const settle = () => { pending -= 1; if (pending <= 0) window.setTimeout(go, 150) }
    imgs.forEach((img) => {
      if (img.complete) return
      img.addEventListener('load', settle, { once: true })
      img.addEventListener('error', settle, { once: true })
    })
  }
  window.setTimeout(go, 3000)
  return true
}
