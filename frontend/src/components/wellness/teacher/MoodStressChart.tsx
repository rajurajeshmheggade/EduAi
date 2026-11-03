import { useCallback, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { WellbeingStudentDetail } from '@/types/wellness'
import { fmtDateTime, fmtDay } from './labels'

type Point = WellbeingStudentDetail['series'][number]

const H = 220
const M = { top: 12, right: 14, bottom: 26, left: 34 }
const Y_TICKS = [0, 25, 50, 75, 100]
const kindLabel = (k: Point['kind']) => (k === 'checkin' ? 'Check-in' : 'Journal')
const clamp = (v: number) => Math.min(100, Math.max(0, v))
const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)

/** Width of the element the returned callback ref is attached to (re-attaches if the element remounts). */
function useWidth() {
  const [w, setW] = useState(0)
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const ro = new ResizeObserver((entries) => { for (const e of entries) setW(Math.round(e.contentRect.width)) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Mood (brand indigo) and stress (rose) on one shared 0–100 axis, time on x. Hover or arrow keys move a
    crosshair with a readout of both series; a data table below carries every value without hovering. */
export function MoodStressChart({ series }: { series: Point[] }) {
  const [wrapRef, width] = useWidth()
  const [active, setActive] = useState<number | null>(null)

  const geo = useMemo(() => {
    if (!series.length) return null
    const innerW = Math.max(1, width - M.left - M.right)
    const innerH = H - M.top - M.bottom
    const ts = series.map((p) => new Date(p.date).getTime())
    const t0 = Math.min(...ts)
    const t1 = Math.max(...ts)
    const x = (t: number) => M.left + (t1 === t0 ? innerW / 2 : ((t - t0) / (t1 - t0)) * innerW)
    const y = (v: number) => M.top + (1 - clamp(v) / 100) * innerH
    const xs = ts.map(x)
    const path = (key: 'mood' | 'stress') => series.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
    const tickCount = t1 === t0 ? 1 : Math.max(2, Math.min(6, Math.floor(innerW / 90)))
    const xTicks: { x: number; label: string }[] = []
    for (let i = 0; i < tickCount; i++) {
      const t = tickCount === 1 ? t0 : t0 + ((t1 - t0) * i) / (tickCount - 1)
      const label = fmtDay(new Date(t).toISOString())
      if (xTicks[xTicks.length - 1]?.label !== label) xTicks.push({ x: x(t), label })
    }
    return { innerW, innerH, xs, y, moodPath: path('mood'), stressPath: path('stress'), xTicks }
  }, [series, width])

  if (!geo) return <p className="py-10 text-center text-sm text-ink-500">No check-ins or journal entries in this period.</p>

  const first = series[0]
  const last = series[series.length - 1]
  const summary = `Mood and stress over ${series.length} entr${series.length === 1 ? 'y' : 'ies'} from ${fmtDay(first.date)} to ${fmtDay(last.date)}. ` +
    `Mood averaged ${avg(series.map((p) => p.mood))} (latest ${last.mood}); stress averaged ${avg(series.map((p) => p.stress))}% (latest ${last.stress}%).`
  const showDots = series.length <= 40
  const a = active == null ? null : series[active]

  const xs = geo.xs
  function nearest(px: number) {
    let best = 0
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i
    return best
  }
  function onPoint(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (box) setActive(nearest(e.clientX - box.left))
  }
  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    const n = series.length
    const cur = active ?? n - 1
    const next = e.key === 'ArrowLeft' ? cur - 1 : e.key === 'ArrowRight' ? cur + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null
    if (next == null) return
    e.preventDefault()
    setActive(Math.max(0, Math.min(n - 1, next)))
  }

  const tipLeft = a && active != null ? Math.min(Math.max(geo.xs[active] + 12, 8), Math.max(8, width - 168)) : 0

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-300" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-4 rounded bg-brand-500" />Mood score (0–100)</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-4 rounded bg-rose-400" />Stress (self-reported %)</li>
      </ul>
      <div ref={wrapRef} className="relative">
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={summary} aria-describedby="msc-help" tabIndex={0} onKeyDown={onKey}
            onFocus={() => setActive((v) => v ?? series.length - 1)} onBlur={() => setActive(null)} className="block rounded-lg">
            {Y_TICKS.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + geo.innerW} y1={geo.y(t)} y2={geo.y(t)} className="stroke-line" strokeWidth={1} />
                <text x={M.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-ink-500 text-[11px] tabular-nums">{t}</text>
              </g>
            ))}
            {geo.xTicks.map((t) => (
              <text key={t.label} x={t.x} y={H - 6} textAnchor="middle" className="fill-ink-500 text-[11px]">{t.label}</text>
            ))}
            {a && active != null && <line x1={geo.xs[active]} x2={geo.xs[active]} y1={M.top} y2={M.top + geo.innerH} className="stroke-line-strong" strokeWidth={1} />}
            <path d={geo.stressPath} fill="none" className="stroke-rose-400" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={geo.moodPath} fill="none" className="stroke-brand-500" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {series.map((p, i) => (showDots || i === series.length - 1 || i === active) && (
              <g key={i}>
                <circle cx={geo.xs[i]} cy={geo.y(p.stress)} r={i === active ? 5 : 4} className="fill-rose-400 stroke-ink-900" strokeWidth={2} />
                <circle cx={geo.xs[i]} cy={geo.y(p.mood)} r={i === active ? 5 : 4} className="fill-brand-500 stroke-ink-900" strokeWidth={2} />
              </g>
            ))}
            <rect x={M.left - 6} y={M.top} width={geo.innerW + 12} height={geo.innerH} fill="transparent"
              onPointerMove={onPoint} onPointerDown={onPoint} onPointerLeave={() => setActive(null)} />
          </svg>
        )}
        {a && (
          <div aria-hidden className="pointer-events-none absolute top-2 w-40 rounded-lg border border-line bg-ink-900 px-3 py-2 text-xs shadow-lg" style={{ left: tipLeft }}>
            <div className="mb-1 text-[11px] text-ink-500">{fmtDateTime(a.date)} · {kindLabel(a.kind)}</div>
            <div className="flex items-center gap-2"><span className="h-0.5 w-3 rounded bg-brand-500" /><b className="tabular-nums text-fg">{a.mood}</b><span className="text-ink-500">Mood</span></div>
            <div className="flex items-center gap-2"><span className="h-0.5 w-3 rounded bg-rose-400" /><b className="tabular-nums text-fg">{a.stress}%</b><span className="text-ink-500">Stress</span></div>
          </div>
        )}
        <p id="msc-help" className="sr-only">Use the left and right arrow keys to step through entries.</p>
        <p className="sr-only" aria-live="polite">{a ? `${fmtDateTime(a.date)}, ${kindLabel(a.kind)}: mood ${a.mood}, stress ${a.stress} percent` : ''}</p>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-ink-500 hover:text-fg">View as table</summary>
        <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-line">
          <table className="w-full">
            <thead className="sticky top-0 bg-ink-800 text-left text-ink-500">
              <tr><th scope="col" className="px-3 py-1.5 font-medium">Date</th><th scope="col" className="px-3 py-1.5 font-medium">Type</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Mood</th><th scope="col" className="px-3 py-1.5 text-right font-medium">Stress</th></tr>
            </thead>
            <tbody>
              {[...series].reverse().map((p, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-1.5 text-ink-300">{fmtDateTime(p.date)}</td><td className="px-3 py-1.5 text-ink-300">{kindLabel(p.kind)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-fg">{p.mood}</td><td className="px-3 py-1.5 text-right tabular-nums text-fg">{p.stress}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
