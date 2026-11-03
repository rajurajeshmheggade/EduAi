import { BookOpen, MessageCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { JournalEntry } from '@/types/wellness'
import { formatJournalDate } from '../journal/journalFormat'

/** Journal references: Aura reads these, and the student can pick one to discuss. */
export function JournalPanel({ journals, error, focusedId, busy, onDiscuss, onRetry }: {
  journals: JournalEntry[] | null
  error: string | null
  focusedId: string | null
  busy: boolean
  onDiscuss: (entry: JournalEntry) => void
  onRetry: () => void
}) {
  return (
    <aside aria-label="Your journal entries" className="glass flex max-h-[480px] min-h-0 flex-col gap-3 rounded-2xl p-5 lg:h-[550px] lg:max-h-none">
      <div className="flex items-center gap-2">
        <BookOpen className="h-[18px] w-[18px] text-purple-500" aria-hidden />
        <h4 className="m-0 flex-1 font-semibold">Your Journals</h4>
        <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-px text-[11px] font-semibold text-rose-400">
          {journals?.length ?? 0}
        </span>
      </div>
      <p className="m-0 text-xs leading-snug text-ink-500">
        Aura reads your recent entries to personalise every reply. Pick one to talk it through.
      </p>

      <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2">
        {error && !journals ? (
          <div className="my-auto flex flex-col items-center gap-3 py-6 text-center">
            <p role="alert" className="text-sm text-bad">{error}</p>
            <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" />Try again</Button>
          </div>
        ) : !journals ? (
          [0, 1, 2].map((i) => <div key={i} className="skeleton h-28 shrink-0" />)
        ) : journals.length === 0 ? (
          <p className="my-auto py-6 text-center text-sm leading-relaxed text-ink-500">
            No journal entries yet. Write one in the <strong className="text-fg">Journal</strong> tab and Aura will use it here.
          </p>
        ) : (
          journals.map((log) => {
            const isFocused = log.id === focusedId
            const triggers = Array.isArray(log.analysis?.triggers) ? log.analysis.triggers.slice(0, 3) : []
            const date = formatJournalDate(log.date)
            return (
              <article
                key={log.id}
                aria-current={isFocused ? 'true' : undefined}
                className={cn(
                  'flex shrink-0 flex-col gap-2 rounded-xl border p-3.5 transition-colors',
                  isFocused ? 'border-purple-400 bg-purple-500/10 ring-2 ring-purple-400/20' : 'border-line bg-ink-800/50 hover:border-purple-300',
                )}
              >
                <div className="flex items-center justify-between text-[11px] text-ink-500">
                  <span>{date}</span>
                  {Number.isFinite(log.analysis?.mood_score) && (
                    <span className="rounded-full bg-rose-400/10 px-2 py-px font-semibold text-rose-400">Mood {log.analysis.mood_score}</span>
                  )}
                </div>
                <p className="m-0 line-clamp-3 text-[13px] leading-snug text-ink-300 [overflow-wrap:anywhere]">{log.text}</p>
                {triggers.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Triggers">
                    {triggers.map((trigger) => (
                      <li key={trigger} className="rounded-full border border-purple-500/20 bg-ink-900 px-2 py-px text-[11px] text-ink-300">{trigger}</li>
                    ))}
                  </ul>
                )}
                <Button
                  size="sm"
                  variant={isFocused ? 'default' : 'secondary'}
                  className={cn('self-start', isFocused && 'from-purple-600 to-rose-500 shadow-none disabled:opacity-90')}
                  onClick={() => onDiscuss(log)}
                  disabled={busy || isFocused}
                  aria-label={isFocused ? `Discussing your journal entry from ${date}` : `Discuss your journal entry from ${date} with Aura`}
                >
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden /> {isFocused ? 'In discussion' : 'Discuss with Aura'}
                </Button>
              </article>
            )
          })
        )}
      </div>
    </aside>
  )
}
