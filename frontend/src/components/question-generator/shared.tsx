import { useMemo, type ReactNode } from 'react'
import 'katex/dist/katex.min.css'
import { Badge } from '@/components/ui/badge'
import { PAPER_CSS, questionHtml, type RenderCtx } from '@/lib/questionGen/render'
import { cn } from '@/lib/utils'
import type { QgenMeta, Question } from '@/types/questionGen'

/* Shared bits of the AI Question Generator screens: paper typography, badges, and the question card that shows a
   question exactly as it prints. */

/** Paper typography, once per screen. */
export function PaperStyles() {
  return <style>{PAPER_CSS + `.qg-card .qg-paper{background:transparent;color:inherit;font-size:14px}.qg-card .qg-key{color:var(--color-ok,#0b5d3b)}`}</style>
}

const DIFF_TONE = { EASY: 'ok', MEDIUM: 'warn', HARD: 'bad' } as const
const ORIGIN_LABEL = { AI: 'AI', MANUAL: 'Manual', BANK: 'Bank' } as const

export function QuestionBadges({ q, meta }: { q: Question; meta?: QgenMeta }) {
  const type = meta?.types.find((t) => t.code === q.type)?.label ?? q.type
  const bloom = meta?.blooms.find((b) => b.code === q.bloom)?.label ?? q.bloom
  const diff = meta?.difficulties.find((d) => d.code === q.difficulty)?.label ?? q.difficulty
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone="brand">{type}</Badge>
      <Badge tone={DIFF_TONE[q.difficulty]}>{diff}</Badge>
      <Badge>{bloom}</Badge>
      <Badge tone="aqua">{q.marks} mark{q.marks === 1 ? '' : 's'}</Badge>
      <Badge>{ORIGIN_LABEL[q.origin]}</Badge>
    </div>
  )
}

/** A question rendered as it prints (sanitised; equations via KaTeX), optionally with its answer key. */
export function QuestionView({ q, number, ctx, withKey, className }: { q: Question; number: string; ctx: RenderCtx; withKey?: boolean; className?: string }) {
  const html = useMemo(() => questionHtml(number, q, ctx, { withKey }), [q, number, ctx, withKey])
  return <div className={cn('qg-card', className)}><div className="qg-paper" dangerouslySetInnerHTML={{ __html: html }} /></div>
}

export function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('glass rounded-2xl p-4 md:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-300">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
