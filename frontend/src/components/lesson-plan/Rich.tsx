import { Fragment, type ReactNode } from 'react'
import { looksLikeSerialized, normalizeResource, unescapeLiterals } from '@/lib/lessonPlan/normalize'

/* Minimal Markdown → JSX (bold, headings, bullet / numbered lists, tables) for AI activity bodies. Shared by the
   Lesson Plan Creator preview, the Lesson Plan View and the Session Plan so all three render identically.
   Layer-3 render guard: serialized model output can never reach the DOM raw. */

export const mdInline = (text: string): ReactNode[] =>
  String(text).split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <b key={i} className="font-semibold text-fg">{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>)

const FALLBACK = 'This resource couldn’t be loaded.'

function healForRender(raw: unknown): { text?: string; fallback?: boolean } {
  const src = String(raw ?? '')
  const braceAt = src.search(/[{[]/)
  if (braceAt >= 0 && looksLikeSerialized(src.slice(braceAt))) {
    const res = normalizeResource(src.slice(braceAt))
    if (res.ok) return { text: (res.data.title ? `${res.data.title}\n\n` : '') + res.data.body }
    return { fallback: true }
  }
  if (looksLikeSerialized(src)) return { text: unescapeLiterals(src) }
  return { text: src }
}

export function renderRich(text: unknown, size: 'sm' | 'base' = 'sm'): ReactNode[] {
  const healed = healForRender(text)
  if (healed.fallback) return [<p key="fb" className="my-1.5 text-[13px] italic text-ink-500">{FALLBACK}</p>]
  const fs = size === 'base' ? 'text-[15px]' : 'text-[13px]'
  const lines = String(healed.text ?? '').replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  const push = (el: ReactNode) => out.push(<Fragment key={k++}>{el}</Fragment>)
  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t) { i++; continue }
    if (t.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|')) {
      const rows: string[] = []
      while (i < lines.length && lines[i].includes('|')) { rows.push(lines[i]); i++ }
      const cells = rows.map((rw) => rw.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()))
        .filter((cols) => !cols.every((c) => /^:?-{2,}:?$/.test(c) || c === ''))
      if (cells.length) push(
        <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-[12.5px]"><tbody>
          {cells.map((cols, ri) => <tr key={ri}>{cols.map((c, ci) => ri === 0
            ? <th key={ci} className="border border-line bg-ink-800 px-2 py-1.5 text-left font-semibold text-ink-100">{mdInline(c)}</th>
            : <td key={ci} className="border border-line px-2 py-1.5 text-ink-300">{mdInline(c)}</td>)}</tr>)}
        </tbody></table></div>)
      continue
    }
    if (/^\s*[-*•]\s+/.test(lines[i])) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].trim().replace(/^[-*•]\s+/, '')); i++ }
      push(<ul className="my-1.5 list-disc pl-5">{items.map((it, ii) => <li key={ii} className={`${fs} my-0.5 leading-relaxed text-ink-300`}>{mdInline(it)}</li>)}</ul>)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(lines[i])) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].trim().replace(/^\d+[.)]\s+/, '')); i++ }
      push(<ol className="my-1.5 list-decimal pl-5">{items.map((it, ii) => <li key={ii} className={`${fs} my-0.5 leading-relaxed text-ink-300`}>{mdInline(it)}</li>)}</ol>)
      continue
    }
    if (/^#{1,6}\s+/.test(t)) { push(<div className="mb-1 mt-2.5 text-[13.5px] font-bold text-fg">{mdInline(t.replace(/^#{1,6}\s+/, ''))}</div>); i++; continue }
    push(<p className={`${fs} my-1.5 leading-relaxed text-ink-300`}>{mdInline(t)}</p>)
    i++
  }
  return out
}

export function Rich({ text, size }: { text: unknown; size?: 'sm' | 'base' }) {
  return <>{renderRich(text, size)}</>
}
