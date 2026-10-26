import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatCard({ label, value, hint, icon: Icon, tone = 'text-fg' }: {
  label: string
  value: number | string
  hint?: string
  icon?: LucideIcon
  tone?: string
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-widest text-ink-500">{label}</div>
        {Icon && <Icon className="h-4 w-4 text-ink-500" />}
      </div>
      <div className={cn('mt-2 font-display text-3xl font-bold tabular-nums', tone)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </Card>
  )
}

/** Colour a percentage against the institution's threshold. */
export function pctTone(pct: number | null | undefined, threshold = 75) {
  if (pct == null) return 'text-ink-500'
  if (pct < threshold) return 'text-bad'
  if (pct < threshold + 10) return 'text-warn'
  return 'text-ok'
}

export const fmtPct = (pct: number | null | undefined) => (pct == null ? '—' : `${pct}%`)
