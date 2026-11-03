import { cn } from '@/lib/utils'

export interface HBarItem { label: string; value: number; note?: string }

/** Horizontal bar list (single series): label above, bar from a shared zero baseline, value at the tip.
    The bars are drawn in one hue; names and values stay in text tokens. */
export function HBarList({ items, label, barClass, unit, empty }: {
  items: HBarItem[]
  /** Accessible chart name, e.g. "Stress triggers". */
  label: string
  barClass: string
  /** Singular unit for the summary, e.g. "mention". */
  unit: string
  empty: string
}) {
  if (!items.length) return <p className="py-6 text-center text-sm text-ink-500">{empty}</p>
  const max = Math.max(1, ...items.map((i) => i.value))
  const summary = `${label}: ` + items.map((i) => `${i.label} ${i.value} ${unit}${i.value === 1 ? '' : 's'}${i.note ? ` (${i.note})` : ''}`).join(', ')

  return (
    <div role="img" aria-label={summary}>
      <ul className="space-y-2.5">
        {items.map((i) => {
          const pct = (i.value / max) * 100
          return (
            <li key={i.label} title={`${i.label}: ${i.value} ${unit}${i.value === 1 ? '' : 's'}${i.note ? ` · ${i.note}` : ''}`}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-ink-300">{i.label}</span>
                {i.note && <span className="shrink-0 text-[11px] text-ink-500">{i.note}</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 flex-1">
                  <div className={cn('h-full rounded-r min-w-1 transition-[width] duration-500', barClass)} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-fg">{i.value}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
