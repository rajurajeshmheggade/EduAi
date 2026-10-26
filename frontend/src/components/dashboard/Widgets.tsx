import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Table2, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** Gradient greeting banner with date and quick actions. */
export function HeroBanner({ eyebrow, title, subtitle, actions, aside }: {
  eyebrow: string; title: ReactNode; subtitle?: ReactNode; actions?: { to: string; label: string; icon: LucideIcon; primary?: boolean }[]; aside?: ReactNode
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-500 to-aqua-500 p-6 text-white shadow-[0_24px_60px_-30px_hsl(236_70%_40%/0.6)] md:p-8 animate-fade-up">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_18rem_at_100%_0%,hsl(0_0%_100%/0.2),transparent_60%),radial-gradient(24rem_14rem_at_0%_100%,hsl(0_0%_100%/0.12),transparent_60%)]" />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0 max-w-2xl">
          <p className="text-sm font-medium text-white/75">{eyebrow}</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-white md:text-4xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-white/85 md:text-base">{subtitle}</p>}
          {actions && actions.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {actions.map(({ to, label, icon: Icon, primary }) => (
                <Link key={to + label} to={to}
                  className={cn('inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all',
                    primary ? 'bg-white text-brand-600 shadow hover:-translate-y-px' : 'bg-white/15 text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/25')}>
                  <Icon className="h-4 w-4" />{label}
                </Link>
              ))}
            </div>
          )}
        </div>
        {aside}
      </div>
    </section>
  )
}

const TONES = {
  brand: 'bg-brand-500/10 text-brand-600', ok: 'bg-ok/12 text-ok', warn: 'bg-warn/12 text-warn',
  bad: 'bg-bad/12 text-bad', aqua: 'bg-aqua-500/12 text-aqua-400', neutral: 'bg-ink-800 text-ink-300',
}
export type Tone = keyof typeof TONES

/** KPI tile; optionally a link. `hint` is a short secondary line. */
export function Kpi({ icon: Icon, label, value, hint, tone = 'brand', to }: { icon: LucideIcon; label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; to?: string }) {
  const body = (
    <Card className={cn('h-full p-4 transition-all', to && 'hover:-translate-y-0.5 hover:shadow-glow')}>
      <div className="flex items-start justify-between gap-2">
        <span className={cn('grid h-10 w-10 place-items-center rounded-xl', TONES[tone])}><Icon className="h-5 w-5" /></span>
        {to && <ArrowRight className="h-4 w-4 text-ink-500" />}
      </div>
      <div className="mt-3 font-display text-2xl font-bold tabular-nums text-fg">{value}</div>
      <div className="text-sm text-ink-300">{label}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </Card>
  )
  return to ? <Link to={to} className="block h-full">{body}</Link> : body
}

/** Card with a titled header and optional "view all" link. */
export function Panel({ icon: Icon, title, action, children, className }: { icon?: LucideIcon; title: string; action?: { to: string; label: string }; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">{Icon && <Icon className="h-4.5 w-4.5 text-brand-600" />}{title}</h2>
        {action && <Link to={action.to} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">{action.label}<ArrowRight className="h-3 w-3" /></Link>}
      </div>
      <div className="flex-1 p-5">{children}</div>
    </Card>
  )
}

export function Empty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return <div className="grid h-full min-h-28 place-items-center text-center text-sm text-ink-300"><div><Icon className="mx-auto mb-2 h-7 w-7 text-ink-500" />{children}</div></div>
}

/** Ring gauge for a single percentage (null renders an em dash). */
export function Ring({ value, size = 112, threshold, label }: { value: number | null; size?: number; threshold?: number; label?: string }) {
  const r = (size - 14) / 2, c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value ?? 0))
  const color = value == null ? 'var(--color-ink-700)' : threshold != null && value < threshold ? 'var(--color-bad)' : 'var(--color-ok)'
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label ?? 'Value'}: ${value == null ? 'no data' : `${value}%`}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth="10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-xl font-bold tabular-nums text-fg">{value == null ? '—' : `${value}%`}</div>
        {label && <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>}
      </div>
    </div>
  )
}

/** Single-series column chart (one hue, rounded data ends at the top, hover tooltip, table view). */
export function Columns({ data, max = 100, unit = '%', caption }: {
  data: { key: string; label: string; value: number | null; tooltip?: string }[]; max?: number; unit?: string; caption: string
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [hover, setHover] = useState<string | null>(null)
  if (!data.length) return <p className="py-8 text-center text-sm text-ink-300">No data yet.</p>
  return (
    <figure className="space-y-2">
      <div className="flex items-center justify-between">
        <figcaption className="text-xs text-ink-500">{caption}</figcaption>
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Chart or table">
          {(['chart', 'table'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} aria-label={`${v} view`} className={cn('cursor-pointer rounded-md p-1', view === v ? 'bg-ink-800 text-fg' : 'text-ink-500 hover:text-fg')}>
              {v === 'chart' ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      </div>
      {view === 'table' ? (
        <table className="w-full text-sm"><tbody>{data.map((d) => (
          <tr key={d.key} className="border-b border-line last:border-0"><td className="py-1.5 text-ink-300">{d.label}</td><td className="py-1.5 text-right tabular-nums">{d.value == null ? '—' : `${d.value}${unit}`}</td></tr>
        ))}</tbody></table>
      ) : (
        <div className="relative">
          <div className="flex h-40 items-end gap-1.5">
            {data.map((d) => (
              <div key={d.key} className="relative flex h-full flex-1 flex-col items-center justify-end gap-1" onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}
                tabIndex={0} onFocus={() => setHover(d.key)} onBlur={() => setHover(null)} aria-label={`${d.label}: ${d.value == null ? 'no data' : `${d.value}${unit}`}`}>
                <div className="flex h-[82%] w-full items-end justify-center">
                  <div className={cn('w-full max-w-7 rounded-t-[4px] bg-brand-500 transition-[height] duration-500', hover === d.key && 'brightness-110', d.value == null && 'bg-ink-700')}
                    style={{ height: `${d.value == null ? 3 : Math.max(3, (d.value / max) * 100)}%` }} />
                </div>
                <span className="text-[10px] tabular-nums text-ink-500">{d.label}</span>
                {hover === d.key && (
                  <div role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg border border-line bg-ink-900 px-2 py-1 text-xs shadow-lg">
                    <b className="text-fg">{d.value == null ? '—' : `${d.value}${unit}`}</b>{d.tooltip && <span className="text-ink-300"> · {d.tooltip}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </figure>
  )
}

