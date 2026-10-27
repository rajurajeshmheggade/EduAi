import { Activity } from 'lucide-react'
import { useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'

const PLOT_H = 72

/* Mood bands (MindAlign: Good 65+ / Moderate 40–64 / Low <40). Good uses the mood hue (brand indigo, as on the
   teacher charts); the trio passes the palette validator against white, unlike rose-vs-red. */
const BANDS = [
  { min: 65, label: 'Good', range: '65+', fill: 'bg-brand-500' },
  { min: 40, label: 'Moderate', range: '40–64', fill: 'bg-[#c48a0a]' },
  { min: -Infinity, label: 'Low', range: '<40', fill: 'bg-bad' },
] as const

const bandOf = (score: number) => BANDS.find((b) => score >= b.min) ?? BANDS[2]
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** Wellness Mood Trend — the last 7 journal / check-in mood scores as columns, oldest first. */
export function MoodTrend() {
  const { stats } = useWellness()
  const points = stats.moodTrend.slice(-7)
  if (points.length < 2) return null

  const summary = `Mood trend chart, last ${points.length} wellness entries: ` +
    points.map((p) => `${day(p.date)} ${p.mood} (${bandOf(p.mood).label})`).join(', ')

  return (
    <section className="glass flex flex-col gap-3 rounded-2xl p-5" aria-labelledby="mood-trend-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="mood-trend-title" className="flex items-center gap-2 text-[0.95rem] font-semibold">
          <Activity className="h-[18px] w-[18px] text-rose-500" aria-hidden /> Wellness Mood Trend
        </h3>
        <span className="text-xs text-ink-500">Last {points.length} entries</span>
      </div>

      <div role="img" aria-label={summary} className="flex items-end gap-2 px-1">
        {points.map((p) => {
          const band = bandOf(p.mood)
          const h = Math.max(6, Math.round((Math.min(100, Math.max(0, p.mood)) / 100) * PLOT_H))
          return (
            <div key={p.id} title={`${day(p.date)}: Mood ${p.mood}/100 (${band.label})`} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[11px] tabular-nums text-ink-500">{p.mood}</span>
              <div className="flex w-full items-end justify-center" style={{ height: PLOT_H }}>
                <div className={cn('w-full max-w-6 rounded-t transition-[height] duration-300', band.fill)} style={{ height: h }} />
              </div>
              <span className="whitespace-nowrap text-[10px] text-ink-500">{day(p.date)}</span>
            </div>
          )
        })}
      </div>

      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-ink-300" aria-label="Legend">
        {BANDS.map((b) => (
          <li key={b.label} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('inline-block h-2 w-2 rounded-sm', b.fill)} /> {b.label} ({b.range})
          </li>
        ))}
      </ul>
    </section>
  )
}
