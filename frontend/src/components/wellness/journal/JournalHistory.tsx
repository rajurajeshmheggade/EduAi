import { Calendar, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { JournalEntry } from '@/types/wellness'
import { formatEntryDate, formatHistoryDate, moodTone } from './journalFormat'

/** Right-hand "Journal History" list (MindAlign db-col-4 panel). Picking an entry shows its text and analysis. */
export function JournalHistory({ entries, error, selectedId, onSelect, onRetry }: {
  entries: JournalEntry[] | null
  error: string | null
  selectedId: string | null
  onSelect: (entry: JournalEntry) => void
  onRetry: () => void
}) {
  return (
    <Card className="flex max-h-[550px] min-w-0 flex-col gap-4 p-5 lg:sticky lg:top-4">
      <h4 className="flex items-center gap-2 font-semibold">
        <Calendar className="h-[18px] w-[18px] text-rose-400" aria-hidden />
        Journal History
        {entries && entries.length > 0 && <span className="text-sm font-normal text-ink-500">({entries.length})</span>}
      </h4>

      {error && !entries ? (
        <div className="my-auto flex flex-col items-center gap-3 py-6 text-center">
          <p role="alert" className="text-sm text-bad">{error}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" />Try again</Button>
        </div>
      ) : !entries ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading journal history">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[72px]" />)}
        </div>
      ) : entries.length === 0 ? (
        <p className="my-auto py-8 text-center text-sm text-ink-500">
          Your past logs will appear here. Start by writing your first journal entry.
        </p>
      ) : (
        <ul className="-mr-2 flex flex-col gap-3 overflow-y-auto pr-2">
          {entries.map((log) => {
            const active = log.id === selectedId
            const mood = log.analysis?.mood_score
            return (
              <li key={log.id}>
                <button
                  type="button"
                  onClick={() => onSelect(log)}
                  aria-pressed={active}
                  aria-label={`Show your ${log.kind === 'checkin' ? 'mood check-in' : 'journal entry'} from ${formatEntryDate(log.date)} and its analysis`}
                  className={cn(
                    'flex w-full cursor-pointer flex-col gap-1.5 rounded-xl border px-4 py-3 text-left transition-colors',
                    active
                      ? 'border-purple-400 bg-purple-500/10 ring-2 ring-purple-400/20'
                      : 'border-line bg-ink-900 hover:border-purple-300 hover:bg-purple-500/5',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-ink-500">
                      {formatHistoryDate(log.date)}
                      {log.kind === 'checkin' && (
                        <span className="rounded-full bg-aqua-500/10 px-1.5 py-px text-[10px] font-medium text-aqua-400">Check-in</span>
                      )}
                    </span>
                    {Number.isFinite(mood) && (
                      <Badge tone={moodTone(mood)} className="px-1.5 py-px text-[11px]">Mood: {mood}</Badge>
                    )}
                  </span>
                  <span className="line-clamp-2 text-[13px] leading-snug text-ink-300 [overflow-wrap:anywhere]">{log.text}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
