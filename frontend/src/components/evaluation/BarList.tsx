import { useState } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BarDatum {
  key: string
  label: string
  value: number | null
  /** Shown at the end of the bar, in ink (never the bar colour). */
  display: string
  tooltip: string[]
  /** Optional status flag rendered as icon + text next to the label (never colour alone). */
  flag?: string
}

/**
 * Single-series horizontal bars on a 0–max scale: one hue, 4px rounded data end anchored at the baseline,
 * hover tooltip per bar, and a table view for exact values.
 */
export function BarList({ data, max = 100, caption, valueHeader = 'Value' }: {
  data: BarDatum[]
  max?: number
  caption: string
  valueHeader?: string
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [hover, setHover] = useState<string | null>(null)

  return (
    <figure className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-xs text-ink-500">{caption}</figcaption>
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Chart or table">
          {(['chart', 'table'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} aria-label={`${v} view`}
              className={cn('cursor-pointer rounded-md p-1', view === v ? 'bg-ink-800 text-fg' : 'text-ink-500 hover:text-fg')}>
              {v === 'chart' ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      </div>

      {view === 'table' ? (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-ink-500"><th className="py-1.5 font-medium">Item</th><th className="py-1.5 text-right font-medium">{valueHeader}</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.key} className="border-b border-line last:border-0"><td className="py-1.5">{d.label}{d.flag && <span className="ml-2 text-xs text-warn">⚠ {d.flag}</span>}</td><td className="py-1.5 text-right tabular-nums">{d.display}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <ul className="space-y-1.5">
          {data.map((d) => {
            const w = d.value == null ? 0 : Math.max(0, Math.min(100, (d.value / max) * 100))
            return (
              <li key={d.key} className="relative grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2 text-sm"
                onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(d.key)} onBlur={() => setHover(null)}
                tabIndex={0} aria-label={`${d.label}: ${d.display}`}>
                <span className="truncate text-ink-300">{d.label}</span>
                <div className="relative h-5 rounded-sm bg-ink-800">
                  {/* recessive 50% gridline */}
                  <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-line-strong/60" />
                  <span className={cn('absolute inset-y-[3px] left-0 rounded-r-[4px] bg-brand-500 transition-[width] duration-500', hover === d.key && 'brightness-110')} style={{ width: `${w}%` }} />
                </div>
                <span className="text-right tabular-nums text-fg">{d.display}</span>
                {d.flag && <span className="col-start-2 -mt-1 text-[11px] text-warn">⚠ {d.flag}</span>}
                {hover === d.key && (
                  <div role="tooltip" className="pointer-events-none absolute left-20 top-full z-20 mt-1 min-w-48 rounded-lg border border-line bg-ink-900 p-2.5 text-xs shadow-lg">
                    <div className="mb-1 font-semibold text-fg">{d.label}</div>
                    {d.tooltip.map((t) => <div key={t} className="text-ink-300">{t}</div>)}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </figure>
  )
}
