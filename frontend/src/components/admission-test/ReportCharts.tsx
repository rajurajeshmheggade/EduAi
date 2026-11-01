/**
 * Lightweight SVG charts for the admission report. Each has a text alternative (aria-label / visually hidden list).
 * Status colours (ok / warn / bad) are used only for bands, always next to the band's name.
 */
import { fmtOffset } from '@/lib/proctor/format'
import { cn } from '@/lib/utils'

export type Tone = 'ok' | 'warn' | 'bad' | 'brand'
const STROKE: Record<Tone, string> = { ok: 'var(--color-ok)', warn: 'var(--color-warn)', bad: 'var(--color-bad)', brand: 'var(--color-brand-500)' }

/** Composite ring (0–100). */
export function Ring({ value, tone, label, size = 96 }: { value: number | null; tone: Tone; label: string; size?: number }) {
  const r = 40
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value ?? 0))
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${label}: ${value ?? 'not available'} out of 100`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={STROKE[tone]} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="56" textAnchor="middle" className="fill-[var(--color-fg)] font-display text-[22px] font-bold">{value === null ? '—' : Math.round(v)}</text>
    </svg>
  )
}

/** Half-circle gauge for integrity, coloured by band. */
export function Gauge({ value, tone, size = 120 }: { value: number; tone: Tone; size?: number }) {
  const v = Math.max(0, Math.min(100, value))
  const a = Math.PI * (1 - v / 100)
  const x = 50 + 40 * Math.cos(a)
  const y = 52 - 40 * Math.sin(a)
  return (
    <svg viewBox="0 0 100 60" width={size} height={size * 0.6} role="img" aria-label={`Integrity ${value} out of 100`}>
      <path d="M10 52 A40 40 0 0 1 90 52" fill="none" stroke="var(--color-ink-700)" strokeWidth="9" strokeLinecap="round" />
      {v > 0 && <path d={`M10 52 A40 40 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={STROKE[tone]} strokeWidth="9" strokeLinecap="round" />}
      <text x="50" y="50" textAnchor="middle" className="fill-[var(--color-fg)] font-display text-[18px] font-bold">{value}</text>
    </svg>
  )
}

/** Pentagon radar of the HQ dimensions with a dashed ring at the age-typical 60. */
export function Radar({ dims, typical = 60, size = 240 }: { dims: { key: string; score: number | null }[]; typical?: number; size?: number }) {
  const n = dims.length
  const cx = 120
  const cy = 120
  const R = 88
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n
    return [cx + R * (v / 100) * Math.cos(a), cy + R * (v / 100) * Math.sin(a)] as const
  }
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(',')).join(' ')
  const scored = dims.map((d) => d.score ?? 0)
  return (
    <svg viewBox="0 0 240 240" width={size} height={size} role="img"
      aria-label={`HQ profile: ${dims.map((d) => `${d.key} ${d.score === null ? 'not enough evidence' : Math.round(d.score)}`).join(', ')}`}>
      {[25, 50, 75, 100].map((v) => <polygon key={v} points={poly(dims.map(() => v))} fill="none" stroke="var(--color-line)" strokeWidth="1" />)}
      <polygon points={poly(dims.map(() => typical))} fill="none" stroke="var(--color-ink-500)" strokeWidth="1.5" strokeDasharray="4 4" />
      <polygon points={poly(scored)} fill="color-mix(in oklab, var(--color-brand-500) 18%, transparent)" stroke="var(--color-brand-500)" strokeWidth="2" />
      {dims.map((d, i) => {
        const [x, y] = pt(i, 116)
        const [px, py] = pt(i, d.score ?? 0)
        return (
          <g key={d.key}>
            {d.score !== null && <circle cx={px} cy={py} r="4" fill="var(--color-brand-500)" stroke="var(--color-ink-900)" strokeWidth="2" />}
            <text x={x} y={y + 4} textAnchor="middle" className="fill-[var(--color-ink-300)] text-[12px] font-semibold">{d.key}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Horizontal bars: section score against its maximum. */
export function SectionBars({ rows }: { rows: { section: string; score: number; max: number; pct: number | null; time_min: number }[] }) {
  return (
    <ul className="space-y-2.5" aria-label="Section scores">
      {rows.map((r) => (
        <li key={r.section}>
          <div className="mb-1 flex justify-between text-sm"><span className="text-fg">{r.section}</span>
            <span className="tabular-nums text-ink-300">{r.score}/{r.max} · {r.pct ?? '—'}% · {r.time_min} min</span></div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-700" aria-hidden>
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(0, Math.min(100, r.pct ?? 0))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const SEV_COLOR: Record<string, string> = { Crit: 'var(--color-bad)', High: 'var(--color-warn)', Med: 'var(--color-brand-500)', Low: 'var(--color-ink-500)', Info: 'var(--color-ink-500)' }

/** Flags across the test duration: one tick per event, height by severity; hover shows the details. */
export function Timeline({ events, durationS }: { events: { event_id: number; t_offset_s: number; label: string; severity: string; duration_s: number; confidence: number | null; calibration: boolean }[]; durationS: number }) {
  const W = 600
  const total = Math.max(1, durationS)
  const h = (s: string) => (s === 'Crit' ? 34 : s === 'High' ? 26 : s === 'Med' ? 18 : 10)
  return (
    <figure>
      <svg viewBox={`0 0 ${W} 48`} className="h-16 w-full" role="img" aria-label={`${events.length} proctoring events across ${Math.round(total / 60)} minutes`}>
        <rect x="0" y="40" width={W} height="4" rx="2" fill="var(--color-ink-700)" />
        {events.map((e) => {
          const x = Math.max(2, Math.min(W - 2, (e.t_offset_s / total) * W))
          return (
            <g key={e.event_id}>
              <title>{`${fmtOffset(e.t_offset_s)} · ${e.label}${e.duration_s ? ` · ${e.duration_s}s` : ''}${e.confidence !== null ? ` · confidence ${e.confidence}` : ''}${e.calibration ? ' · calibration (not counted)' : ''}`}</title>
              <rect x={x - 1.5} y={42 - h(e.severity)} width="3" height={h(e.severity)} rx="1.5" fill={SEV_COLOR[e.severity] ?? SEV_COLOR.Info} opacity={e.calibration ? 0.4 : 1} />
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-ink-500"><span>Start</span><span>{fmtOffset(total)}</span></figcaption>
    </figure>
  )
}

/** Time spent per question; implausibly fast answers (TIME_ANOMALY) are highlighted. */
export function TimeStrip({ items }: { items: { number: number; time_s: number; anomaly: boolean; answered: boolean }[] }) {
  const max = Math.max(1, ...items.map((i) => i.time_s))
  return (
    <div className="flex h-20 items-end gap-0.5" role="img" aria-label={`Time per question; ${items.filter((i) => i.anomaly).length} flagged as implausibly fast`}>
      {items.map((i) => (
        <div key={i.number} title={`Q${i.number}: ${i.time_s}s${i.anomaly ? ' · implausibly fast' : ''}${i.answered ? '' : ' · not answered'}`}
          className={cn('min-w-[4px] flex-1 rounded-t', i.anomaly ? 'bg-warn' : i.answered ? 'bg-brand-500' : 'bg-ink-700')}
          style={{ height: `${Math.max(4, (i.time_s / max) * 100)}%` }} />
      ))}
    </div>
  )
}

