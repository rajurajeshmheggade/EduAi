/* Lesson Plan → Microsoft Word (.docx). Port of Rapid's services/lessonPlanWord.js.

   GOAL: the .docx reads as the SAME DOCUMENT as "Download PDF" and the Lesson Plan View — same banner, same
   meta grid, the same section order, the same coloured cards and pills, and the same content down to the 5E
   generated resources. It is built from real Word content (not a picture of the screen): every heading, pill,
   table cell and paragraph is live text the teacher can edit, select and search.

   Word cannot reproduce rounded corners, box-shadows or gradients; they are approximated with square borders,
   no shadow, and the gradient's average flat fill. Everything that carries meaning — colour coding, hierarchy,
   order, content — is preserved. The palette is Rapid's: this is a document, not app UI.

   Defensive on shape: the plan is untrusted JSON assembled from AI output. It is read through the shared
   `readPlan` (lessonPlanPrint.ts) and the section builders skip anything empty, so a partial plan exports
   what it has rather than throwing. Lazy-loaded by the view (`docx` is large). */

import {
  AlignmentType, BorderStyle, Document, HeightRule, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, TextRun, VerticalAlignTable, WidthType,
  type IBorderOptions, type IBordersOptions, type IIndentAttributesProperties, type ITableBordersOptions,
} from 'docx'
import type { PlanContent } from '@/types/lessonPlan'
import {
  ASSIGNMENT_BLOCKS, RICH_FALLBACK, hasHtml, healRich, readPlan, schoolInitials, str, type LessonPlanExportMeta,
} from './lessonPlanPrint'

/* ── palette — Rapid's LessonPlanView constants, so the exports cannot drift ─────────────────────────── */
const PRIMARY = '0F172A'
const FG = '0F172A'
const MUTED_FG = '64748B'
const BORDER = 'E2E8F0'
const GRAY800 = '1F2937'
const GRAY700 = '374151'
const GRAY600 = '4B5563'
const GRAY500 = '6B7280'
const GRAY100 = 'F3F4F6'
const GRAY50 = 'F9FAFB'
const GRAY200 = 'E5E7EB'

// A .docx only NAMES a font — it does not carry it. Calibri ships with every Office install, so the document
// asks for a face that is actually present instead of letting Word guess.
const FONT = 'Calibri'

/* ── page geometry ─────────────────────────────────────────────────────────────────────────────────── */
// A4 is 11906 twips wide; with the 720-twip margins set on the section, 10466 twips of content remain. Every
// top-level table is pinned to exactly this with a FIXED layout so the banner and the meta grid line up.
const CONTENT_W = 10466
const BANNER_COLS = [1150, 7116, 2200]                  // logo tile | school + UNIT PLAN | academic year
const META_COLS = [3489, 3489, 3488]                    // the card's three equal meta columns

const fixed = (columnWidths: number[]) => ({
  width: { size: CONTENT_W, type: WidthType.DXA },
  layout: TableLayoutType.FIXED,
  columnWidths,
})

// The banner is a gradient over white; Word has no gradient fill, so use the midpoint as a flat shade.
const BANNER_BG = 'EDEEF1'
const META_BG = 'FAFBFC'

/** px (the UI's unit) → half-points (Word's unit). 16px ≈ 12pt ≈ 24 half-points. */
const sz = (px: number) => Math.round(px * 1.5)
const dash = (v: string) => v || '—'
/** '#abc' / '#aabbcc' / '#aabbccdd' → 'AABBCC' (Word fills take 6-digit hex; readPlan already validated the colour). */
const hex6 = (c: string) => {
  const h = c.replace('#', '')
  return (h.length === 3 || h.length === 4 ? h.slice(0, 3).split('').map((x) => x + x).join('') : h.slice(0, 6)).toUpperCase()
}

/* ── primitives ────────────────────────────────────────────────────────────────────────────────────── */

interface RunOpts { bold?: boolean; italic?: boolean; size?: number; color?: string; fill?: string }
type Align = (typeof AlignmentType)[keyof typeof AlignmentType]
interface ParaOpts extends RunOpts {
  before?: number
  after?: number
  line?: number
  align?: Align
  indent?: IIndentAttributesProperties
  border?: IBordersOptions
}
type Block = Paragraph | Table

const run = (text: string, o: RunOpts = {}) => new TextRun({
  text: String(text),
  bold: o.bold,
  italics: o.italic,
  size: o.size ?? sz(14),
  color: o.color ?? GRAY700,
  font: FONT,
  shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
})

/** Paragraph built from ready-made runs (pills sit inline beside text). */
const PR = (children: (TextRun | ImageRun)[], o: ParaOpts = {}) => new Paragraph({
  spacing: { before: o.before ?? 0, after: o.after ?? 90, line: o.line ?? 300 },
  alignment: o.align,
  indent: o.indent,
  border: o.border,
  children,
})

const P = (text: string, o: ParaOpts = {}) => PR(text === '' ? [] : [run(text, o)], o)

/** Multi-line plain text → one paragraph per line (Word ignores '\n' inside a run). */
const lines = (text: string, o: ParaOpts = {}): Paragraph[] => {
  const ls = String(text).replace(/\r/g, '').split('\n')
  return ls.map((l, i) => P(l, { ...o, after: i === ls.length - 1 ? o.after : 20 }))
}

/** The rounded chips in the UI: a shaded run padded with spaces — the colour coding survives. */
const pill = (text: string, fill: string, color: string) => run(` ${text} `, { size: sz(12), color, fill })

/** A section heading: 24px bold + the card's 1px bottom rule. */
const sectionHead = (title: string) => P(title, {
  size: sz(24), bold: true, color: GRAY800, before: 320, after: 200,
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 6 } },
})

const edge = (color: string, size = 6): IBorderOptions => ({ style: BorderStyle.SINGLE, size, color })
const noEdge: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const allBorders = (color: string, size = 6) => ({
  top: edge(color, size), bottom: edge(color, size), left: edge(color, size), right: edge(color, size),
})
const noBorders: ITableBordersOptions = {
  top: noEdge, bottom: noEdge, left: noEdge, right: noEdge, insideHorizontal: noEdge, insideVertical: noEdge,
}
const noCellBorders = { top: noEdge, bottom: noEdge, left: noEdge, right: noEdge }

/** One of the UI's rounded cards: a single-cell table with a coloured border and optional fill.
 *  Nested cards stay on Word's AUTOFIT layout with a percentage width (only Word knows the width at each
 *  depth). Top-level cards pass `w` — the outer width — and are indented by `pad` so the border sits on the
 *  margin, in line with the banner above it. */
const card = (children: Block[], { border = BORDER, fill, pad = 200, left, w }: {
  border?: string; fill?: string; pad?: number; left?: string; w?: number
} = {}) => new Table({
  width: w ? { size: w, type: WidthType.DXA } : { size: 100, type: WidthType.PERCENTAGE },
  ...(w ? { layout: TableLayoutType.FIXED, columnWidths: [w], indent: { size: pad, type: WidthType.DXA } } : {}),
  borders: {
    ...allBorders(border),
    // A thick coloured left edge reproduces the 5E step card's `border-left:4px solid`.
    ...(left ? { left: edge(left, 24) } : {}),
    insideHorizontal: noEdge, insideVertical: noEdge,
  },
  rows: [new TableRow({
    children: [new TableCell({
      width: { size: 100, type: WidthType.PERCENTAGE },
      shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
      margins: { top: pad, bottom: pad, left: pad, right: pad },
      children: children.length ? children : [P('')],
    })],
  })],
})

/** Vertical gap between cards — the UI's `gap:16px`. */
const gap = (after = 160) => new Paragraph({ spacing: { after }, children: [] })

/* ── rich text ─────────────────────────────────────────────────────────────────────────────────────── */

/** `**bold**` → runs, matching mdInline. */
const mdRuns = (text: string, o: RunOpts = {}) => String(text).split(/(\*\*[^*]+\*\*)/g).filter((s) => s !== '')
  .map((part) => (part.startsWith('**') && part.endsWith('**') && part.length > 4
    ? run(part.slice(2, -2), { ...o, bold: true })
    : run(part, o)))

/** A Markdown / HTML table → a bordered Word table, matching renderRich's table branch. */
const mdTable = (cells: string[][]) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: { ...allBorders(GRAY200, 4), insideHorizontal: edge(GRAY200, 4), insideVertical: edge(GRAY200, 4) },
  rows: cells.map((cols, ri) => new TableRow({
    tableHeader: ri === 0,
    children: (cols.length ? cols : ['']).map((c) => new TableCell({
      shading: ri === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: GRAY100 } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [PR(mdRuns(c, { size: sz(12.5), color: ri === 0 ? GRAY700 : '475569', bold: ri === 0 }), { after: 0 })],
    })),
  })),
})

/** Markdown → Word blocks. Mirrors renderRich's branches: table, bullets, numbered, heading, paragraph. */
function mdToBlocks(text: string, o: RunOpts = {}): Block[] {
  const size = o.size ?? sz(13)
  const color = o.color ?? '475569'
  const src = String(text).replace(/\r/g, '').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < src.length) {
    const t = src[i].trim()
    if (!t) { i++; continue }

    if (t.includes('|') && i + 1 < src.length && src[i + 1].includes('|')) {
      const rows: string[] = []
      while (i < src.length && src[i].includes('|')) { rows.push(src[i]); i++ }
      const cells = rows
        .map((rw) => rw.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()))
        .filter((cols) => !cols.every((c) => /^:?-{2,}:?$/.test(c) || c === ''))
      if (cells.length) { out.push(mdTable(cells)); out.push(gap(80)) }
      continue
    }
    if (/^\s*[-*•]\s+/.test(src[i])) {
      while (i < src.length && /^\s*[-*•]\s+/.test(src[i])) {
        // An explicit marker run, not docx's `bullet:`, which needs a numbering definition on the Document to
        // render at all — inside these nested card tables it silently produces no glyph.
        out.push(PR([run('• ', { size, color }), ...mdRuns(src[i].trim().replace(/^[-*•]\s+/, ''), { size, color })],
          { after: 40, indent: { left: 360, hanging: 180 } }))
        i++
      }
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(src[i])) {
      let n = 0
      while (i < src.length && /^\s*\d+[.)]\s+/.test(src[i])) {
        n += 1
        out.push(PR([run(`${n}. `, { size, color }), ...mdRuns(src[i].trim().replace(/^\d+[.)]\s+/, ''), { size, color })],
          { after: 40, indent: { left: 400, hanging: 200 } }))
        i++
      }
      continue
    }
    if (/^#{1,6}\s+/.test(t)) {
      out.push(PR(mdRuns(t.replace(/^#{1,6}\s+/, ''), { size: sz(13.5), color: '111827', bold: true }), { before: 120, after: 60 }))
      i++
      continue
    }
    out.push(PR(mdRuns(t, { size, color }), { after: 80 }))
    i++
  }
  return out
}

interface HtmlState { bold?: boolean; italic?: boolean; underline?: boolean; sup?: boolean; sub?: boolean; size?: number; color?: string }

/** Legacy editor HTML (an old Rapid plan) → Word blocks. Keeps bold / italic / underline / sup / sub, lists,
 *  headings and tables. Parsed with DOMParser — an inert document: nothing runs, nothing is fetched. */
function htmlToBlocks(html: string, o: RunOpts = {}): Block[] {
  const size = o.size ?? sz(13)
  const color = o.color ?? GRAY700
  const out: Block[] = []
  let runs: TextRun[] = []
  const stack: { type: 'ul' | 'ol'; n: number }[] = []

  const flush = (after = 60) => {
    if (!runs.length) return
    const depth = stack.length
    out.push(PR(runs, { after, indent: depth > 0 ? { left: 360 * depth, hanging: 180 } : undefined }))
    runs = []
  }

  const walk = (node: Node, state: HtmlState) => {
    if (node.nodeType === 3) {
      const t = node.nodeValue ?? ''
      if (t && t.replace(/\s+/g, ' ') !== ' ') {
        runs.push(new TextRun({
          text: t.replace(/\s+/g, ' '), bold: state.bold, italics: state.italic,
          underline: state.underline ? {} : undefined, superScript: state.sup, subScript: state.sub,
          size: state.size ?? size, color: state.color ?? color, font: FONT,
        }))
      }
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'noscript') return
    const next: HtmlState = { ...state }
    if (tag === 'strong' || tag === 'b') next.bold = true
    if (tag === 'em' || tag === 'i') next.italic = true
    if (tag === 'u') next.underline = true
    if (tag === 'sup') next.sup = true
    if (tag === 'sub') next.sub = true
    const kids = () => el.childNodes.forEach((c) => walk(c, next))

    if (tag === 'br') { flush(); return }
    if (tag === 'table') {
      flush()
      const cells = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((td) => (td.textContent ?? '').trim()))
      if (cells.length) { out.push(mdTable(cells)); out.push(gap(80)) }
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      flush()
      stack.push({ type: tag, n: 0 })
      kids()
      stack.pop()
      return
    }
    if (tag === 'li') {
      flush()
      const parent = stack[stack.length - 1]
      let marker = '• '
      if (parent && parent.type === 'ol') { parent.n += 1; marker = `${parent.n}. ` }
      runs.push(run(marker, { size: next.size ?? size, color: next.color ?? color }))
      kids()
      flush(40)
      return
    }
    if (/^h[1-6]$/.test(tag)) {
      flush()
      next.size = sz(13.5); next.bold = true; next.color = '111827'
      kids()
      flush(60)
      return
    }
    if (tag === 'p' || tag === 'div' || tag === 'blockquote') {
      flush()
      kids()
      flush(80)
      return
    }
    kids()
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.body.childNodes.forEach((c) => walk(c, {}))
  } catch {
    return [P(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), { size, color })]
  }
  flush(80)
  return out.length ? out : [P('', { after: 0 })]
}

/** Plain text (objective, ELO, question…) → paragraphs, one per line. */
const textBlocks = (text: string, o: ParaOpts): Paragraph[] => (text.trim() ? lines(text, o) : [])

/** Generated 5E body (Markdown, legacy HTML, or a double-encoded payload) → Word blocks. Same branch the view takes. */
function richToBlocks(content: unknown, o: RunOpts = {}): Block[] {
  const healed = healRich(content)
  if (healed.fallback) return [P(RICH_FALLBACK, { italic: true, size: sz(13), color: GRAY500 })]
  if (!healed.text.trim()) return []
  return hasHtml(healed.text) ? htmlToBlocks(healed.text, o) : mdToBlocks(healed.text, o)
}

/* ── logo ──────────────────────────────────────────────────────────────────────────────────────────── */
// Routed through a canvas so a CORS-blocked or broken logo degrades to the initials tile instead of failing.
const LOGO_BOX = 64   // pt — the banner's 80px tile, less its padding

async function logoBytes(src: string | undefined): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const url = String(src ?? '').trim()
  if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) return null
  try {
    const shot = await new Promise<{ url: string; w: number; h: number } | null>((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const c = document.createElement('canvas')
          c.width = img.naturalWidth
          c.height = img.naturalHeight
          const ctx = c.getContext('2d')
          if (!ctx) { resolve(null); return }
          ctx.drawImage(img, 0, 0)
          resolve({ url: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight })
        } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = url
    })
    if (!shot || !shot.w || !shot.h) return null
    const bin = atob(shot.url.split(',')[1] ?? '')
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    // Fit inside the box preserving aspect (the tile's `object-fit:contain`).
    const scale = Math.min(LOGO_BOX / shot.w, LOGO_BOX / shot.h)
    return { bytes, width: Math.max(1, Math.round(shot.w * scale)), height: Math.max(1, Math.round(shot.h * scale)) }
  } catch { return null }
}

/**
 * Build and download the plan as a .docx laid out like the PDF.
 * @param plan     the plan as the Lesson Plan View displays it (saved JSON + the row's class / subject / topic frame)
 * @param meta     signed-in school / teacher / academic year (and an optional logo URL)
 * @param filename without extension; whitespace becomes underscores
 */
export async function exportLessonPlanToWord(plan: Partial<PlanContent> | null | undefined, meta: LessonPlanExportMeta, filename = 'Lesson_plan'): Promise<void> {
  const m = readPlan(plan)
  const schoolName = str(meta.schoolName)
  const teacherName = str(meta.teacherName)
  const academicYear = str(meta.academicYear)
  const logo = await logoBytes(meta.logoUrl)
  const kids: Block[] = []

  /* ── banner: logo tile + school + "UNIT PLAN" | academic year ─────────────────────────────────────── */
  // The tile is a NESTED table so it stays the ~80px square the card draws instead of a full-height slab.
  const TILE = 900
  const logoTile = new Table({
    width: { size: TILE, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [TILE],
    borders: allBorders(logo ? BORDER : PRIMARY),
    rows: [new TableRow({
      height: { value: TILE, rule: HeightRule.ATLEAST },
      children: [new TableCell({
        width: { size: TILE, type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: logo ? 'FFFFFF' : PRIMARY },
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
        children: [logo
          ? new Paragraph({
            spacing: { after: 0 },
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ data: logo.bytes, type: 'png', transformation: { width: logo.width, height: logo.height } })],
          })
          : P(schoolInitials(schoolName), { bold: true, size: sz(15), color: 'FFFFFF', align: AlignmentType.CENTER, after: 0 })],
      })],
    })],
  })

  const bannerCell = (children: Block[], w: number, left = 200, right = 160) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    verticalAlign: VerticalAlignTable.CENTER,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: BANNER_BG },
    borders: noCellBorders,
    margins: { top: 200, bottom: 200, left, right },
    children,
  })

  kids.push(new Table({
    ...fixed(BANNER_COLS),
    borders: { ...noBorders, bottom: edge(BORDER) },
    rows: [new TableRow({
      children: [
        bannerCell([logoTile], BANNER_COLS[0], 120, 120),
        bannerCell([
          // 20px, not the card's 24px: the Word column is narrower than the card's flex row.
          P(dash(schoolName), { bold: true, size: sz(20), color: FG, after: 60, line: 260 }),
          // The UI letterspaces "UNIT PLAN"; spaced capitals are Word's equivalent.
          P('U N I T  P L A N', { bold: true, size: sz(17), color: PRIMARY, after: 0 }),
        ], BANNER_COLS[1]),
        bannerCell([
          P('Academic Year', { size: sz(13), color: MUTED_FG, align: AlignmentType.RIGHT, after: 40 }),
          P(dash(academicYear), { bold: true, size: sz(14), color: MUTED_FG, align: AlignmentType.RIGHT, after: 0 }),
        ], BANNER_COLS[2], 120, 200),
      ],
    })],
  }))

  /* ── meta grid: the same three columns, in the same order, as the card ────────────────────────────── */
  const metaCol = (pairs: [string, string][], w: number) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: META_BG },
    borders: noCellBorders,
    margins: { top: 200, bottom: 200, left: 180, right: 180 },
    children: pairs.flatMap(([label, v]) => [
      P(label.toUpperCase(), { size: sz(10.5), color: MUTED_FG, bold: true, after: 20, line: 240 }),
      P(dash(v), { size: sz(15), bold: true, color: FG, after: 140, line: 260 }),
    ]).concat([P('', { after: 0 })]),
  })

  kids.push(new Table({
    ...fixed(META_COLS),
    borders: { ...noBorders, bottom: edge(BORDER) },
    rows: [new TableRow({
      children: [
        metaCol([['Class', m.grade], ['Duration(mins)', m.duration], ['Execution Period', m.executionPeriod]], META_COLS[0]),
        metaCol([['Subject', m.subject], ["Teacher's Name", teacherName]], META_COLS[1]),
        metaCol([['Topic', m.topic], ['Planned Date', m.plannedDate]], META_COLS[2]),
      ],
    })],
  }))

  /* ── 1. Core Objectives — amber-bordered cards, factor chip underneath ───────────────────────────── */
  const core = m.coreObjectives.filter((o) => o.text || o.factor)
  if (core.length) {
    kids.push(sectionHead('Core Objectives'))
    core.forEach((o) => {
      const body: Block[] = textBlocks(o.text, { size: sz(14), color: GRAY700 })
      if (o.factor) body.push(PR([pill(o.factor, 'FEF3C7', '92400E')], { before: 60, after: 0 }))
      kids.push(card(body, { border: 'FEF3C7', w: CONTENT_W }))
      kids.push(gap())
    })
  }

  /* ── 2. Expected Learning Outcomes — green-bordered cards, ELO + Bloom chips ─────────────────────── */
  const outcomes = m.outcomes.filter((a) => a.fullText || a.name)
  if (outcomes.length) {
    kids.push(sectionHead('Expected Learning Outcomes'))
    outcomes.forEach((a) => {
      const body: Block[] = textBlocks(a.fullText || a.name, { size: sz(14), color: GRAY700 })
      const chips = [pill(a.label, 'D1FAE5', '065F46')]
      if (a.bloom) chips.push(run('  '), pill(`Bloom's Level: ${a.bloom}`, 'FEF3C7', '92400E'))
      body.push(PR(chips, { before: 60, after: 0 }))
      kids.push(card(body, { border: 'D1FAE5', w: CONTENT_W }))
      kids.push(gap())
    })
  }

  /* ── 3. Assessment — blue cards, per-item chips, MCQ option grid, answer box ─────────────────────── */
  if (m.assessed.length) {
    kids.push(sectionHead('Assessment'))
    m.assessed.forEach((a) => {
      const inner: Block[] = []

      // Title row: name + bloom chip on the left, "N Items" chip pushed right.
      inner.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders,
        rows: [new TableRow({
          children: [
            new TableCell({
              width: { size: 70, type: WidthType.PERCENTAGE }, borders: noCellBorders, margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [P(a.name || a.label, { size: sz(18), bold: true, color: '1E40AF', after: a.bloom ? 60 : 0 }) as Block]
                .concat(a.bloom ? [PR([pill(a.bloom, 'EFF6FF', '2563EB')], { after: 0 })] : []),
            }),
            new TableCell({
              width: { size: 30, type: WidthType.PERCENTAGE }, borders: noCellBorders, verticalAlign: VerticalAlignTable.CENTER,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [PR([pill(`${a.items.length} Items`, 'EFF6FF', '1D4ED8')], { align: AlignmentType.RIGHT, after: 0 })],
            }),
          ],
        })],
      }))
      inner.push(gap(120))

      a.items.forEach((it) => {
        const itemKids: Block[] = []

        const chips = [pill(it.typeLabel || 'Item', 'F3E8FF', '6B21A8')]
        if (it.bloom) chips.push(run('  '), pill(it.bloom, 'DBEAFE', '1E40AF'))
        itemKids.push(PR(chips, { after: 80 }))

        itemKids.push(...textBlocks(it.question, { size: sz(14), color: GRAY600 }))

        // MCQ options — the UI's two-column grid, lettered A/B/C/D.
        if (it.isMcq && it.options.length) {
          itemKids.push(P('Options:', { size: sz(14), bold: true, color: GRAY600, before: 60, after: 60 }))
          const optCell = (o: (typeof it.options)[number] | undefined) => new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            shading: o ? { type: ShadingType.CLEAR, color: 'auto', fill: GRAY50 } : undefined,
            borders: noCellBorders,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: o
              ? [PR([run(`${o.letter}. `, { bold: true, color: '2563EB', size: sz(13) }), run(o.text, { color: GRAY700, size: sz(13) })], { after: 0 })]
              : [P('', { after: 0 })],
          })
          const rows: TableRow[] = []
          for (let i = 0; i < it.options.length; i += 2) {
            rows.push(new TableRow({ children: [optCell(it.options[i]), optCell(it.options[i + 1])] }))
          }
          itemKids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows }))
          itemKids.push(gap(80))
        }

        // Answer box — same green panel, hidden for the same open-response types as the UI.
        if (it.answer && it.answerable) {
          itemKids.push(card([PR([run('Answer: ', { bold: true, color: '15803D', size: sz(14) }),
            run(it.answer, { color: '15803D', size: sz(14) })], { after: 0 })],
          { border: 'DCFCE7', fill: 'F0FDF4', pad: 120 }))
        }

        inner.push(card(itemKids, { border: GRAY100, fill: GRAY50, pad: 140 }))
        inner.push(gap(120))
      })

      kids.push(card(inner, { border: 'DBEAFE', w: CONTENT_W }))
      kids.push(gap())
    })
  }

  /* ── 4. Assignments — title header strip, then the three coloured panels ─────────────────────────── */
  const assigns = m.assignments.filter((a) => a.title || a.purpose || a.instructions || a.submission)
  if (assigns.length) {
    const tint = { purpose: ['EEF2FF', '3730A3'], instructions: ['FAF5FF', '6B21A8'], submission: ['FFF1F2', '9F1239'] } as const
    kids.push(sectionHead('Assignments'))
    assigns.forEach((as) => {
      const inner: Block[] = [P(dash(as.title), { size: sz(18), bold: true, color: GRAY800, after: 140 })]
      ASSIGNMENT_BLOCKS.forEach(({ key, label }) => {
        if (!as[key]) return
        const [bg, cl] = tint[key]
        inner.push(card([P(label, { size: sz(16), bold: true, color: cl, after: 80 }), ...textBlocks(as[key], { size: sz(14), color: GRAY700 })],
          { border: bg, fill: bg, pad: 160 }))
        inner.push(gap(120))
      })
      kids.push(card(inner, { border: GRAY100, w: CONTENT_W }))
      kids.push(gap())
    })
  }

  /* ── 5. Learning Experience (older 5E list) — phase badge + activity cards ───────────────────────── */
  const phases = m.fiveE.filter((ph) => ph.phase || ph.activities.some((x) => x.title || x.description))
  if (phases.length) {
    kids.push(sectionHead('Learning Experience'))
    phases.forEach((ph) => {
      const inner: Block[] = [PR([
        pill(ph.phase.charAt(0) || '•', hex6(ph.color), 'FFFFFF'),
        run(`  ${ph.phase}`, { size: sz(18), bold: true, color: GRAY800 }),
      ], { after: 140 })]
      ph.activities.forEach((act) => {
        const actKids: Block[] = []
        if (act.title) actKids.push(P(act.title, { bold: true, size: sz(15), color: GRAY800, after: 60 }))
        actKids.push(...textBlocks(act.description, { size: sz(14), color: GRAY700 }))
        if (actKids.length) { inner.push(card(actKids, { border: GRAY100, fill: GRAY50, pad: 160 })); inner.push(gap(120)) }
      })
      kids.push(card(inner, { border: 'CBD5E1', w: CONTENT_W }))
      kids.push(gap())
    })
  }

  /* ── 6. 5E Design Model — per-ELO blocks, steps, and the generated resource content ─────────────── */
  if (m.design.length) {
    kids.push(sectionHead('5E Design Model'))
    const inner: Block[] = [P('5E Design Phase Model (by ELO)', { size: sz(24), bold: true, color: '2563EB', after: 240 })]

    m.design.forEach((block) => {
      inner.push(P(block.label, {
        size: sz(16), bold: true, color: FG, align: AlignmentType.CENTER, before: 160, after: 160,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '93C5FD', space: 4 } },
      }))

      block.steps.forEach((step) => {
        const stepKids: Block[] = []
        // Step name left, "Step Time" right — the UI's justified header row.
        stepKids.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBorders,
          rows: [new TableRow({
            children: [
              new TableCell({
                width: { size: 60, type: WidthType.PERCENTAGE }, borders: noCellBorders, margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [P(dash(step.name), { size: sz(16), bold: true, color: FG, after: 0 })],
              }),
              new TableCell({
                width: { size: 40, type: WidthType.PERCENTAGE }, borders: noCellBorders, margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [step.stepTime
                  ? PR([run('Step Time: ', { bold: true, size: sz(15), color: '1E40AF' }), run(step.stepTime, { bold: true, size: sz(15), color: '1E40AF' })],
                    { align: AlignmentType.RIGHT, after: 0 })
                  : P('', { after: 0 })],
              }),
            ],
          })],
        }))

        if (step.resources.length) {
          stepKids.push(gap(120))
          step.resources.forEach((res) => {
            const body = richToBlocks(res.content, { size: sz(15), color: '111827' })
            stepKids.push(card([
              P(res.name, { size: sz(14), bold: true, color: FG, after: 60 }),
              ...(body.length ? body : [P('No content generated yet.', { italic: true, size: sz(12), color: MUTED_FG })]),
            ], { border: 'E9EDF2', pad: 160 }))
            stepKids.push(gap(120))
          })
        } else {
          stepKids.push(P('No resources selected for this phase.', { italic: true, size: sz(12), color: MUTED_FG, before: 80 }))
        }

        inner.push(card(stepKids, { border: 'CBD5E1', fill: 'EFF6FF', left: '93C5FD', pad: 200 }))
        inner.push(gap())
      })
    })

    kids.push(card(inner, { border: '93C5FD', pad: 240, w: CONTENT_W }))
  }

  const heading = m.topic || m.subject
  const doc = new Document({
    creator: teacherName || 'EduAI',
    title: heading || 'Unit Plan',
    description: 'Unit plan exported from EduAI',
    // Pin the default run font so anything Word inserts on its own behalf does not inherit the theme font.
    styles: { default: { document: { run: { font: FONT, size: sz(14), color: GRAY700 } } } },
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: kids,
    }],
  })

  // toBlob (not toBuffer): this runs in the browser, where Buffer does not exist.
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${String(filename).trim().replace(/\.docx$/i, '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_') || 'Lesson_plan'}.docx`
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke late: Safari cancels an in-flight download if the object URL is released immediately.
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
