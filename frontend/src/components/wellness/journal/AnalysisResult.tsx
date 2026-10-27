import { CloudOff, Heart, Loader2, Quote } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { JournalEntry } from '@/types/wellness'
import { moodLabel, moodTone } from './journalFormat'

/** The AI analysis of one entry: mood, emotions, empathetic summary, triggers and the coping checklist. */
export function AnalysisResult({ entry, pendingTitle, onToggleCoping }: {
  entry: JournalEntry
  /** Coping title whose tick is being saved (its checkbox is disabled meanwhile). */
  pendingTitle: string | null
  onToggleCoping: (entry: JournalEntry, title: string) => void
}) {
  const a = entry.analysis
  const done = new Set(entry.copingDone ?? [])
  const emotions = a.primary_emotions ?? []
  const triggers = a.triggers ?? []
  const strategies = a.coping_strategies ?? []

  return (
    <Card className="grid gap-6 p-5 animate-fade-up md:grid-cols-[2fr_1fr] md:p-6">
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <Badge tone={moodTone(a.mood_score)}>Mood Score: {a.mood_score}/100</Badge>
          <h3 className="text-gradient mt-2 font-display text-2xl font-bold">{moodLabel(a.mood_score)}</h3>
        </div>

        {emotions.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Primary emotions">
            {emotions.map((emotion, idx) => (
              <li key={`${emotion}-${idx}`}>
                <Badge className="border-purple-500/30 bg-purple-500/10 text-purple-700">{emotion}</Badge>
              </li>
            ))}
          </ul>
        )}

        <div>
          <h4 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <Heart className="h-4 w-4 text-rose-400" aria-hidden /> AI Empathetic Analysis
          </h4>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-100">{a.analysis_summary}</p>
          {entry.aiSource === 'fallback' && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-warn">
              <CloudOff className="h-3.5 w-3.5" aria-hidden />
              Aura's AI is offline on this server, so this analysis is a generic estimate.
            </p>
          )}
        </div>

        {a.milestone_encouragement && (
          <div className="flex gap-3 rounded-xl border border-dashed border-purple-400 bg-purple-500/5 p-4">
            <Quote className="h-5 w-5 shrink-0 text-purple-500" aria-hidden />
            <p className="text-sm italic leading-snug text-ink-300">{a.milestone_encouragement}</p>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-5 border-line max-md:border-t max-md:pt-5 md:border-l md:pl-5">
        <div>
          <h4 className="mb-2 text-sm font-semibold text-ink-300">Detected Triggers</h4>
          {triggers.length === 0 ? (
            <p className="text-sm text-ink-500">No specific triggers detected.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {triggers.map((trigger, idx) => (
                <li key={`${trigger}-${idx}`} className="flex items-center gap-2 text-sm text-ink-100">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" aria-hidden />
                  {trigger}
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-semibold text-ink-300">Recommended Steps</legend>
          <div className="flex flex-col gap-3">
            {strategies.map((strategy, idx) => {
              const checked = done.has(strategy.title)
              const pending = pendingTitle === strategy.title
              const id = `coping-check-${entry.id}-${idx}`
              return (
                <label
                  key={`${strategy.title}-${idx}`}
                  htmlFor={id}
                  className={cn(
                    'flex cursor-pointer items-center gap-4 rounded-xl border px-4 py-3 transition-colors',
                    checked
                      ? 'border-purple-400 bg-purple-500/10 line-through opacity-75'
                      : 'border-line bg-ink-800/60 hover:border-purple-300',
                    pending && 'cursor-wait',
                  )}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    disabled={pending}
                    onChange={() => onToggleCoping(entry, strategy.title)}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-purple-600"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-fg">{strategy.title}</span>
                    <span className="text-xs leading-snug text-ink-300">{strategy.description}</span>
                  </span>
                  {pending && <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-purple-500" aria-label="Saving" />}
                </label>
              )
            })}
          </div>
        </fieldset>
      </div>
    </Card>
  )
}
