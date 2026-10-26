/** Splits an AI answer into text and `[Page N]` citation segments (FR-S2-03 / FR-S2-04). */
export type Segment = { type: 'text'; text: string } | { type: 'cite'; page: number; raw: string }

const CITE = /\[Page\s+(\d+)(?:\s*,[^\]]*)?\]/gi

export function parseCitations(answer: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of answer.matchAll(CITE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ type: 'text', text: answer.slice(last, idx) })
    out.push({ type: 'cite', page: Number(m[1]), raw: m[0] })
    last = idx + m[0].length
  }
  if (last < answer.length) out.push({ type: 'text', text: answer.slice(last) })
  return out
}

export function citedPages(answer: string): number[] {
  return [...new Set(parseCitations(answer).flatMap((s) => (s.type === 'cite' ? [s.page] : [])))].sort((a, b) => a - b)
}
