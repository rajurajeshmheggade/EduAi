/* Question paper / answer key → Microsoft Word (.docx), built in the browser with `docx`.

   The layout is the server PDF's (backend/app/services/qgen/pdf.py): A4, institution + exam title header (logo on
   the left when there is one), a borderless Class / Subject / Year | Time / Maximum Marks / Date grid, Name / Roll
   No line, a rule, numbered General Instructions, then the sections in print order with every question as a
   borderless three-column row — number | body | [marks]. Assertion–Reason directions are printed once before each
   run of consecutive A/R questions; Column II of a match is printed shuffled; composite questions put their passage
   in a ruled box with sub-questions numbered (a)/(i). Numbering, labels and the answer key come from paper.ts, so
   the Word file, the preview, print and the PDF agree. The footer reads "Page n of N" in the paper's language.

   Rich text (the stored HTML subset) becomes real Word runs — bold / italic / underline / sub / superscript — and
   every equation becomes a real Word equation (OMML) from its LaTeX (latex.ts). Runs name Times New Roman for Latin
   and Nirmala UI for complex scripts, so Word shapes Hindi, Kannada and Tamil itself. Lazy-load this module: `docx`
   is large. */

import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, Math as DocxMath, MathFraction, MathRadical, MathRun,
  MathSubScript, MathSubSuperScript, MathSuperScript, Packer, PageNumber, Paragraph, Table, TableCell,
  TableLayoutType, TableRow, TextRun, WidthType,
  type IBorderOptions, type ITableBordersOptions, type MathComponent, type ParagraphChild,
} from 'docx'
import type { CompositeData, Lang, Paper, Question } from '@/types/questionGen'
import { downloadBlob } from '@/services/questionGenService'
import { latexToText, nodesToText, parseLatex, type LatexNode } from './latex'
import {
  ALPHA, ROMAN, answerKey, arGroups, blanksOf, durationText, fmtMarks, isComposite, labels, matchColumns, numberPaper,
  orderingDisplay, paperFileBase, renderBlanks, subLabel, totalMarks,
} from './paper'
import { decodeEntities, escapeHtml, plainText, sanitizeRich } from './richText'

export interface DocxImage { data: Uint8Array; type: 'png' | 'jpg'; width: number; height: number }
export interface DocxCtx { arCodes: string[]; arInstruction: string; lang: Lang; images: Record<string, DocxImage>; showMarks?: boolean }

/* ───────────────────────────── geometry + type scale */
const FONT = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Nirmala UI', eastAsia: 'Times New Roman' }
const PAGE_W = 11906
const PAGE_H = 16838
const MARGIN = 936                    // 0.65 in
const CONTENT = PAGE_W - 2 * MARGIN   // 10034 twips
const NUM_W = 620
const MARKS_W = 820
const BODY_W = CONTENT - NUM_W - MARKS_W
const CELL_PAD = 60
const SIZE = { body: 21, meta: 20, small: 18, inst: 32, exam: 26, kind: 21, sec: 23, footer: 17 }
const GREEN = '0B5D3B'
const GREY = '444444'

type Block = Paragraph | Table
interface RunStyle { bold?: boolean; italics?: boolean; underline?: boolean; superScript?: boolean; subScript?: boolean; size?: number; color?: string }

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const LINE: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: '888888' }
const NO_BORDERS: ITableBordersOptions = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE }
const LINES: ITableBordersOptions = { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE }

function run(text: string, st: RunStyle = {}): TextRun {
  const size = st.size ?? SIZE.body
  return new TextRun({
    text, font: FONT, size, sizeComplexScript: size, bold: st.bold, boldComplexScript: st.bold, italics: st.italics,
    italicsComplexScript: st.italics, underline: st.underline ? {} : undefined, superScript: st.superScript,
    subScript: st.subScript, color: st.color,
  })
}

/* ───────────────────────────── equations: LaTeX AST → OMML */
const nz = (a: MathComponent[]) => (a.length ? a : [new MathRun('​')])

function toMath(nodes: LatexNode[]): MathComponent[] {
  const out: MathComponent[] = []
  for (const n of nodes) {
    switch (n.kind) {
      case 'text': if (n.value) out.push(new MathRun(n.value)); break
      case 'group': out.push(...toMath(n.children)); break
      case 'frac': out.push(new MathFraction({ numerator: nz(toMath(n.num)), denominator: nz(toMath(n.den)) })); break
      case 'sqrt': out.push(new MathRadical({ children: nz(toMath(n.body)), degree: n.index ? nz(toMath(n.index)) : undefined })); break
      case 'accent': out.push(new MathRun(nodesToText([n]))); break
      case 'script': {
        const base = nz(toMath(n.base))
        if (n.sub && n.sup) out.push(new MathSubSuperScript({ children: base, subScript: nz(toMath(n.sub)), superScript: nz(toMath(n.sup)) }))
        else if (n.sup) out.push(new MathSuperScript({ children: base, superScript: nz(toMath(n.sup)) }))
        else out.push(new MathSubScript({ children: base, subScript: nz(toMath(n.sub ?? [])) }))
        break
      }
    }
  }
  return out
}

export function equation(latex: string): ParagraphChild {
  try {
    return new DocxMath({ children: nz(toMath(parseLatex(latex))) })
  } catch {
    return run(latex, { italics: true })
  }
}

/* ───────────────────────────── rich text (stored HTML subset) → lines of runs */
const BLOCK = new Set(['p', 'div'])

/** Lines (one per paragraph) of runs and equations. Entities are decoded by the parser. */
export function richLines(html: string, st: RunStyle = {}): ParagraphChild[][] {
  const lines: ParagraphChild[][] = [[]]
  const cur = () => lines[lines.length - 1]
  const breakLine = () => { if (cur().length) lines.push([]) }
  if (!html) return lines
  if (typeof DOMParser === 'undefined') return [[run(plainText(html, 'raw'), st)]]
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html')
  const walk = (node: Node, s: RunStyle) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ')
        if (t && !(t === ' ' && !cur().length)) cur().push(run(t, s))
        return
      }
      if (n.nodeType !== 1) return
      const el = n as Element
      const tag = el.tagName.toLowerCase()
      if (tag === 'span' && el.classList.contains('math')) { cur().push(equation(el.getAttribute('data-latex') ?? '')); return }
      if (tag === 'br') { lines.push([]); return }
      if (BLOCK.has(tag)) { breakLine(); walk(el, s); breakLine(); return }
      if (tag === 'ul' || tag === 'ol') {
        breakLine()
        let k = 0
        el.childNodes.forEach((li) => {
          if (li.nodeType !== 1 || (li as Element).tagName.toLowerCase() !== 'li') return
          k += 1
          breakLine()
          cur().push(run(tag === 'ol' ? `${k}. ` : '• ', s))
          walk(li, s)
          breakLine()
        })
        return
      }
      const ns = { ...s }
      if (tag === 'b' || tag === 'strong') ns.bold = true
      else if (tag === 'i' || tag === 'em') ns.italics = true
      else if (tag === 'u') ns.underline = true
      else if (tag === 'sub') ns.subScript = true
      else if (tag === 'sup') ns.superScript = true
      walk(el, ns)
    })
  }
  walk(doc.body, st)
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop()
  while (lines.length > 1 && !lines[0].length) lines.shift()
  return lines
}

interface ParaOpts { prefix?: ParagraphChild[]; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; indent?: number; style?: RunStyle }

function paras(html: string, o: ParaOpts = {}): Paragraph[] {
  const lines = richLines(html, o.style)
  return lines.map((children, i) => new Paragraph({
    children: i === 0 && o.prefix ? [...o.prefix, ...children] : children,
    alignment: o.align, spacing: { after: o.after ?? 40 }, indent: o.indent ? { left: o.indent } : undefined,
  }))
}

const text = (t: string, st: RunStyle = {}, o: Omit<ParaOpts, 'style' | 'prefix'> = {}) =>
  new Paragraph({ children: [run(t, st)], alignment: o.align, spacing: { after: o.after ?? 40 }, indent: o.indent ? { left: o.indent } : undefined })

/* ───────────────────────────── tables */
function cell(children: Block[], width: number, opts: { borders?: boolean } = {}): TableCell {
  const kids = children.length && children[children.length - 1] instanceof Paragraph ? children : [...children, new Paragraph({ children: [], spacing: { after: 0 } })]
  return new TableCell({
    width: { size: width, type: WidthType.DXA }, children: kids,
    margins: { top: 20, bottom: 20, left: CELL_PAD, right: CELL_PAD },
    borders: opts.borders ? { top: LINE, bottom: LINE, left: LINE, right: LINE } : { top: NONE, bottom: NONE, left: NONE, right: NONE },
  })
}

function table(rows: TableRow[], columnWidths: number[], bordered = false): Table {
  return new Table({
    width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, layout: TableLayoutType.FIXED,
    columnWidths, borders: bordered ? LINES : NO_BORDERS, rows,
  })
}

/* ───────────────────────────── images */
function imageRun(img: DocxImage | undefined, maxW: number, maxH: number): ImageRun | null {
  if (!img) return null
  const scale = Math.min(1, maxW / Math.max(1, img.width), maxH / Math.max(1, img.height))
  return new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.max(1, Math.round(img.width * scale)), height: Math.max(1, Math.round(img.height * scale)) } })
}

function mediaBlocks(q: Question, ctx: DocxCtx): Paragraph[] {
  const out: Paragraph[] = []
  for (const m of q.media) {
    const img = imageRun(ctx.images[m.media_id], 320, 240)
    if (!img) continue
    out.push(new Paragraph({ children: [img], alignment: AlignmentType.CENTER, spacing: { after: 20 } }))
    if (m.caption) out.push(text(m.caption, { size: SIZE.small, color: GREY }, { align: AlignmentType.CENTER }))
  }
  return out
}

/* ───────────────────────────── question body (paper) */
const label = (s: string): ParagraphChild[] => [run(`${s} `, { bold: true })]

function optionBlocks(cells: string[], layout: string, width: number): Block[] {
  const cols = layout === 'four' ? 4 : layout === 'two' ? 2 : 1
  if (cols === 1) return cells.flatMap((h, i) => paras(h, { prefix: label(`(${ALPHA[i]})`), indent: 120 }))
  const w = Math.floor(width / cols)
  const rows: TableRow[] = []
  for (let r = 0; r < cells.length; r += cols) {
    const slice = cells.slice(r, r + cols)
    rows.push(new TableRow({ children: Array.from({ length: cols }, (_, c) => cell(slice[c] !== undefined ? paras(slice[c], { prefix: label(`(${ALPHA[r + c]})`) }) : [], w)) }))
  }
  return [table(rows, Array.from({ length: cols }, () => w))]
}

function bodyBlocks(q: Question, width: number, ctx: DocxCtx): Block[] {
  const L = labels(ctx.lang)
  const out: Block[] = []
  if (q.type !== 'ASSERTION_REASON') out.push(...paras(q.type === 'FILL_BLANK' ? renderBlanks(q.text) : q.text))
  out.push(...mediaBlocks(q, ctx))
  switch (q.type) {
    case 'MCQ': out.push(...optionBlocks(q.data.options.map((o) => o.text), q.data.layout, width)); break
    case 'MRQ': out.push(...optionBlocks(q.data.options.map((o) => o.text), 'list', width)); break
    case 'TRUE_FALSE': q.data.statements.forEach((s, i) => out.push(...paras(s.text, { prefix: label(`(${ROMAN[i]})`), indent: 120 }))); break
    case 'FILL_BLANK':
      if (q.data.word_bank) {
        const words = [...new Set([...blanksOf(q.text), ...q.data.distractors])].sort((a, b) => a.localeCompare(b))
        out.push(table([new TableRow({ children: [cell([new Paragraph({ children: [run(`${L.word_bank}: `, { bold: true }), run(words.join(' · '))] })], width, { borders: true })] })], [width], true))
      }
      break
    case 'MATCH': {
      const { left, right } = matchColumns(q)
      const lw = Math.round(width * 0.4), rw = width - lw
      const ruled = { borders: true }
      const head = new TableRow({ tableHeader: true, children: [cell([text(q.data.left_title || L.column1, { bold: true })], lw, ruled), cell([text(q.data.right_title || L.column2, { bold: true })], rw, ruled)] })
      const rows = left.map((p, i) => new TableRow({ children: [
        cell(paras(p.left, { prefix: [run(`${i + 1}. `)] }), lw, ruled),
        cell(right[i] ? paras(right[i].pair.right, { prefix: [run(`(${right[i].letter}) `)] }) : [], rw, ruled),
      ] }))
      out.push(table([head, ...rows], [lw, rw], true))
      break
    }
    case 'ASSERTION_REASON':
      out.push(...paras(q.data.assertion, { prefix: label(`${L.assertion}:`) }))
      out.push(...paras(q.data.reason, { prefix: label(`${L.reason}:`) }))
      break
    case 'ORDERING':
      orderingDisplay(q).forEach((d) => out.push(...paras(d.item.text, { prefix: label(`(${d.letter})`), indent: 120 })))
      break
    case 'CASE_BASED':
    case 'SCENARIO_BASED':
    case 'PASSAGE': {
      const d = q.data as CompositeData
      if (d.passage_title) out.push(text(d.passage_title, { bold: true }))
      out.push(table([new TableRow({ children: [cell(paras(d.passage), width, { borders: true })] })], [width], true))
      out.push(...subRows(d, width, (s, w) => bodyBlocks(s, w, ctx), ctx.showMarks !== false))
      break
    }
    default: break
  }
  return out
}

function subRows(d: CompositeData, width: number, body: (s: Question, w: number) => Block[], showMarks = true): Block[] {
  const lw = 560, mw = 760, bw = width - lw - mw
  return [table(d.sub_questions.map((s, i) => new TableRow({ children: [
    cell([text(subLabel(i, d.numbering), { bold: true })], lw),
    cell(body(s, bw - 2 * CELL_PAD), bw),
    cell(showMarks ? [text(`[${fmtMarks(s.marks)}]`, { size: SIZE.small }, { align: AlignmentType.RIGHT })] : [], mw),
  ] })), [lw, bw, mw])]
}

function questionTable(num: string, body: Block[], marks: number, showMarks: boolean, keepTogether: boolean): Table {
  return table([new TableRow({ cantSplit: keepTogether, children: [
    cell([text(num, { bold: true })], NUM_W),
    cell(body, BODY_W),
    cell(showMarks ? [text(`[${fmtMarks(marks)}]`, { size: SIZE.small }, { align: AlignmentType.RIGHT })] : [], MARKS_W),
  ] })], [NUM_W, BODY_W, MARKS_W])
}

/* ───────────────────────────── answer key */
function keyLines(q: Question, ctx: DocxCtx): Paragraph[] {
  return answerKey(q, ctx.arCodes, ctx.lang, sanitizeRich).flatMap((k) =>
    paras(k.html, { prefix: k.label ? [run(`${k.label}: `, { bold: true, color: GREEN })] : undefined, style: { color: GREEN } }))
}

function stemText(q: Question): string {
  const h = q.type === 'ASSERTION_REASON' ? q.data.assertion : q.type === 'FILL_BLANK' ? renderBlanks(q.text) : q.text
  const readable = h.replace(/<span class="math" data-latex="([^"]*)"[^>]*>[\s\S]*?<\/span>/g, (_, l: string) => escapeHtml(latexToText(decodeEntities(l))))
  const s = plainText(readable, 'raw').replace(/\s+/g, ' ').trim()
  return s.length > 160 ? `${s.slice(0, 160).replace(/\s+\S*$/, '')} …` : s
}

function keyBlocks(q: Question, ctx: DocxCtx): Block[] {
  const stem = text(stemText(q), { size: SIZE.small, color: GREY })
  if (!isComposite(q.type)) return [stem, ...keyLines(q, ctx)]
  const d = q.data as CompositeData
  const L = labels(ctx.lang)
  const subs = subRows(d, BODY_W - 2 * CELL_PAD, (s) => [text(stemText(s), { size: SIZE.small, color: GREY }), ...keyLines(s, ctx)])
  const expl = q.explanation ? paras(sanitizeRich(q.explanation), { prefix: [run(`${L.explanation}: `, { bold: true, color: GREEN })], style: { color: GREEN } }) : []
  return [stem, ...subs, ...expl]
}

/* ───────────────────────────── header */
function headerBlocks(p: Paper, ctx: DocxCtx, answerKeyMode: boolean): Block[] {
  const L = labels(ctx.lang)
  const h = p.header
  const titleParas = [
    text(h.institution_name || p.institution_name || '', { bold: true, size: SIZE.inst }, { align: AlignmentType.CENTER, after: 20 }),
    text(h.exam_title || p.title, { bold: true, size: SIZE.exam }, { align: AlignmentType.CENTER, after: answerKeyMode ? 20 : 60 }),
    ...(answerKeyMode ? [text(L.answer_key, { bold: true, size: SIZE.kind, color: GREY }, { align: AlignmentType.CENTER, after: 60 })] : []),
  ]
  const out: Block[] = []
  const logo = h.logo_media_id ? imageRun(ctx.images[h.logo_media_id], 72, 64) : null
  if (logo) {
    const side = 1300
    out.push(table([new TableRow({ children: [
      cell([new Paragraph({ children: [logo] })], side), cell(titleParas, CONTENT - 2 * side), cell([], side),
    ] })], [side, CONTENT - 2 * side, side]))
  } else {
    out.push(...titleParas)
  }
  const left: [string, string][] = [[L.class, p.class_name], [L.subject, p.subject_name]]
  if (h.academic_year) left.push([L.year, h.academic_year])
  const right: [string, string][] = []
  if (h.duration_minutes) right.push([L.time, durationText(h.duration_minutes, ctx.lang)])
  right.push([L.max_marks, fmtMarks(totalMarks(p.items))])
  if (h.exam_date) right.push([L.date, h.exam_date])
  const half = CONTENT / 2
  const kv = (pair: [string, string] | undefined, align?: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    pair ? [new Paragraph({ alignment: align, spacing: { after: 10 }, children: [run(`${pair[0]}: `, { bold: true, size: SIZE.meta }), run(pair[1], { size: SIZE.meta })] })] : []
  const rows = Array.from({ length: Math.max(left.length, right.length) }, (_, i) =>
    new TableRow({ children: [cell(kv(left[i]), half), cell(kv(right[i], AlignmentType.RIGHT), half)] }))
  if (h.show_roll_no && !answerKeyMode) {
    rows.push(new TableRow({ children: [cell(kv([L.name, '______________________________']), half), cell(kv([L.roll, '______________'], AlignmentType.RIGHT), half)] }))
  }
  out.push(table(rows, [half, half]))
  out.push(new Paragraph({ children: [], spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '222222', space: 1 } } }))
  if (h.general_instructions.length && !answerKeyMode) {
    out.push(text(`${L.instructions}:`, { bold: true, size: SIZE.meta }, { after: 20 }))
    h.general_instructions.forEach((g, i) => out.push(text(`${i + 1}. ${g}`, { size: SIZE.meta }, { after: 10, indent: 200 })))
    out.push(new Paragraph({ children: [], spacing: { after: 80 } }))
  }
  return out
}

function footer(lang: Lang, draft: boolean): Footer {
  const L = labels(lang)
  const parts: (string | (typeof PageNumber)[keyof typeof PageNumber])[] = []
  for (const piece of L.page.split(/(\{n\}|\{N\})/)) {
    if (piece === '{n}') parts.push(PageNumber.CURRENT)
    else if (piece === '{N}') parts.push(PageNumber.TOTAL_PAGES)
    else if (piece) parts.push(piece)
  }
  if (draft) parts.push(` · ${L.draft}`)
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
    new TextRun({ children: parts, font: FONT, size: SIZE.footer, sizeComplexScript: SIZE.footer, color: '555555' }),
  ] })] })
}

/* ───────────────────────────── document */
export function paperBlocks(p: Paper, ctx: DocxCtx, answerKeyMode: boolean): Block[] {
  const L = labels(ctx.lang)
  const showMarks = p.header.show_marks !== false
  ctx = { ...ctx, showMarks: answerKeyMode || showMarks }
  const out: Block[] = headerBlocks(p, ctx, answerKeyMode)
  for (const g of numberPaper(p.sections, p.items)) {
    if (g.section.title) out.push(text(g.section.title, { bold: true, size: SIZE.sec }, { align: AlignmentType.CENTER, after: 20 }))
    if (g.section.instructions && !answerKeyMode) out.push(text(g.section.instructions, { italics: true, size: SIZE.small, color: '333333' }, { align: AlignmentType.CENTER, after: 80 }))
    for (const grp of arGroups(g.rows)) {
      if (grp.isAr && !answerKeyMode) {
        const nums = grp.rows.length > 1 ? `${grp.rows[0].number}–${grp.rows[grp.rows.length - 1].number}` : `${grp.rows[0].number}`
        out.push(new Paragraph({ spacing: { before: 60, after: 20 }, children: [run(`${L.q} ${nums}: `, { bold: true, size: SIZE.meta }), run(ctx.arInstruction, { size: SIZE.meta })] }))
        ctx.arCodes.forEach((c, i) => out.push(text(`(${'ABCD'[i]})  ${c}`, { size: SIZE.meta }, { after: 10, indent: 240 })))
      }
      for (const r of grp.rows) {
        const q = r.item.question
        const body = answerKeyMode ? keyBlocks(q, ctx) : bodyBlocks(q, BODY_W - 2 * CELL_PAD, ctx)
        out.push(questionTable(`${r.number}.`, body, q.marks, answerKeyMode || showMarks, !isComposite(q.type)))
        out.push(new Paragraph({ children: [], spacing: { after: 60 } }))
      }
    }
  }
  return out
}

export async function buildPaperDocx(paper: Paper, ctx: DocxCtx, opts: { answerKey: boolean }): Promise<Blob> {
  const L = labels(ctx.lang)
  const title = paper.header.exam_title || paper.title
  const doc = new Document({
    creator: 'EduAI Question Generator',
    title: opts.answerKey ? `${title} — ${L.answer_key}` : title,
    styles: { default: { document: { run: { font: FONT, size: SIZE.body } } } },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 900, bottom: 900, left: MARGIN, right: MARGIN, footer: 480 } } },
      footers: { default: footer(ctx.lang, paper.status !== 'PUBLISHED') },
      children: paperBlocks(paper, ctx, opts.answerKey),
    }],
  })
  return Packer.toBlob(doc)
}

/* ───────────────────────────── images: fetch + sniff */
/** PNG / JPEG type and pixel size read from the file's own header bytes (null for anything else). */
export function sniffImage(bytes: Uint8Array): { type: 'png' | 'jpg'; width: number; height: number } | null {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return { type: 'png', width: dv.getUint32(16), height: dv.getUint32(20) }
    }
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let off = 2
      while (off + 9 < bytes.length) {
        if (bytes[off] !== 0xff) { off++; continue }
        const marker = bytes[off + 1]
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue }
        const len = dv.getUint16(off + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { type: 'jpg', height: dv.getUint16(off + 5), width: dv.getUint16(off + 7) }
        }
        off += 2 + len
      }
    }
  } catch { /* corrupt header */ }
  return null
}

async function fetchImages(paper: Paper): Promise<Record<string, DocxImage>> {
  const out: Record<string, DocxImage> = {}
  await Promise.all(Object.entries(paper.media ?? {}).map(async ([id, info]) => {
    try {
      const res = await fetch(info.url)
      if (!res.ok) return
      const data = new Uint8Array(await res.arrayBuffer())
      const sniffed = sniffImage(data)
      if (!sniffed) return
      out[id] = { data, type: sniffed.type, width: sniffed.width || info.width, height: sniffed.height || info.height }
    } catch { /* an image that cannot be fetched is left out rather than failing the export */ }
  }))
  return out
}

export async function downloadPaperDocx(paper: Paper, ctx: { arCodes: string[]; arInstruction: string; lang: Lang }, opts: { answerKey: boolean }): Promise<void> {
  const images = await fetchImages(paper)
  const blob = await buildPaperDocx(paper, { ...ctx, images }, opts)
  downloadBlob(blob, `${paperFileBase(paper.header.exam_title || paper.title)}${opts.answerKey ? ' - Answer Key' : ''}.docx`)
}
