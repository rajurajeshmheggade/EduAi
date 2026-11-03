import { Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Helpline } from '@/types/wellness'

/** "14416 / 1800-891-4416" → one tel: link per number. */
function numbers(raw: string): { label: string; href: string }[] {
  return raw.split('/').map((s) => s.trim()).filter(Boolean).map((label) => ({ label, href: `tel:${label.replace(/[^\d+]/g, '')}` }))
}

/** Verified (groundtruth) helplines returned by the server with crisis guardrail replies and crisis journals. */
export function HelplineList({ helplines, compact = false, className }: {
  helplines: Record<string, Helpline>
  compact?: boolean
  className?: string
}) {
  const items = Object.entries(helplines)
  if (!items.length) return null
  return (
    <ul className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-2', className)} aria-label="Verified helplines">
      {items.map(([key, h]) => (
        <li key={key} className={cn('rounded-lg border border-rose-400/25 bg-ink-900', compact ? 'px-2.5 py-1.5' : 'px-3 py-2')}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Phone className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
            <span className={cn('font-semibold text-fg', compact ? 'text-xs' : 'text-sm')}>{h.name}</span>
            <span className="flex flex-wrap gap-x-1.5">
              {numbers(h.number).map((n, i) => (
                <span key={n.label}>
                  {i > 0 && <span className="text-ink-500" aria-hidden>/ </span>}
                  <a href={n.href} className={cn('font-semibold text-rose-400 underline-offset-2 hover:underline', compact ? 'text-xs' : 'text-sm')}>
                    {n.label}
                  </a>
                </span>
              ))}
            </span>
            {h.toll_free && <span className="rounded-full bg-ok/10 px-1.5 py-px text-[10px] font-medium text-ok">Toll-free</span>}
          </div>
          {!compact && <p className="mt-0.5 pl-5 text-xs leading-snug text-ink-500">{h.description}</p>}
        </li>
      ))}
    </ul>
  )
}
