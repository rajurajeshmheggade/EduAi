import { Fragment, type ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i} className="text-fg">{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>,
  )
}

/** Tiny safe Markdown renderer (headings, bullets, bold) — no HTML injection, no dependencies. */
export function Markdown({ source }: { source: string }) {
  const out: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) { out.push(<ul key={`u${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = [] }
  }
  source.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd()
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    const li = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (li) { list.push(li[1]); return }
    flush()
    if (h) {
      const Tag = (`h${h[1].length}`) as 'h1' | 'h2' | 'h3'
      out.push(<Tag key={i}>{inline(h[2])}</Tag>)
    } else if (line.trim()) out.push(<p key={i}>{inline(line)}</p>)
  })
  flush()
  return <div className="prose-edu text-sm text-ink-100">{out}</div>
}
