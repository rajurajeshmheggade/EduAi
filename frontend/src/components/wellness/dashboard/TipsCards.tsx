import { Brain, Loader2, Quote, Sparkles } from 'lucide-react'
import type { DailyTips } from '@/types/wellness'

function TipLine({ width }: { width: string }) {
  return <span className="skeleton block h-3" style={{ width }} />
}

/** AI focus tip + AI stress-reliever cards, followed by today's affirmation. */
export function TipsCards({ tips, refreshing }: { tips: DailyTips | null; refreshing: boolean }) {
  const loading = !tips
  return (
    <section aria-label="Today's AI tips" aria-busy={loading || refreshing} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="glass flex items-start gap-3 rounded-2xl border-l-4 border-l-purple-500 p-5">
          <Brain className="h-6 w-6 shrink-0 text-purple-600" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-500">AI Dynamic Focus Tip</h3>
            {loading ? (
              <div className="space-y-2 pt-1"><TipLine width="95%" /><TipLine width="70%" /></div>
            ) : (
              <p className="text-sm leading-relaxed text-ink-300">{tips.focus_tip}</p>
            )}
          </div>
        </div>

        <div className="glass flex items-start gap-3 rounded-2xl border-l-4 border-l-rose-400 p-5">
          <Sparkles className="h-6 w-6 shrink-0 text-rose-500" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-500">AI Stress-Reliever</h3>
            {loading ? (
              <div className="space-y-2 pt-1"><TipLine width="90%" /><TipLine width="60%" /></div>
            ) : (
              <p className="text-sm leading-relaxed text-ink-300">{tips.relaxation_tip}</p>
            )}
          </div>
        </div>
      </div>

      <figure className="flex items-start gap-3 rounded-2xl border border-teal-500/25 bg-gradient-to-r from-teal-500/10 via-purple-500/5 to-rose-400/10 px-5 py-4">
        <Quote className="mt-0.5 h-5 w-5 shrink-0 text-teal-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <figcaption className="text-xs font-bold uppercase tracking-wider text-ink-500">Today&apos;s affirmation</figcaption>
          {loading ? (
            <div className="pt-2"><TipLine width="55%" /></div>
          ) : (
            <blockquote className="mt-1 font-display text-base font-semibold italic leading-snug text-fg">{tips.affirmation}</blockquote>
          )}
          {tips?.aiSource === 'fallback' && <p className="mt-1.5 text-[11px] text-ink-500">Curated tips — the AI coach is offline right now.</p>}
        </div>
        {refreshing && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-500" aria-label="Refreshing tips" />}
      </figure>
    </section>
  )
}
