import { LifeBuoy, Quote, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { Helpline, JournalEntry } from '@/types/wellness'
import { HelplineList } from '../chat/HelplineList'
import { formatEntryDate } from './journalFormat'

/** "What you wrote": the full text of the selected entry, plus helplines when it contained crisis language. */
export function EntryPreview({ entry, helplines, deleting, onDelete }: {
  entry: JournalEntry
  /** Set only for an entry just analysed whose text the server flagged as crisis language. */
  helplines: Record<string, Helpline> | null
  deleting: boolean
  onDelete: (entry: JournalEntry) => void
}) {
  return (
    <>
      {helplines && (
        <Card role="alert" className="border-rose-400/40 bg-rose-400/5 p-5 animate-fade-up">
          <h4 className="flex items-center gap-2 font-semibold text-fg">
            <LifeBuoy className="h-5 w-5 text-rose-400" aria-hidden /> You don't have to carry this alone
          </h4>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-300">
            Some of what you wrote sounds really heavy. Please talk to someone right now — these helplines are free,
            confidential and answered by trained counsellors. A trusted adult, teacher or family member can help too.
          </p>
          <HelplineList helplines={helplines} className="mt-3" />
        </Card>
      )}

      <Card className="p-5 animate-fade-up">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 font-semibold">
            <Quote className="h-4 w-4 text-purple-500" aria-hidden />
            {entry.kind === 'checkin' ? 'Your mood check-in' : 'What you wrote'}
          </h4>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-500">{formatEntryDate(entry.date)} · Stress {entry.stress_input}%</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-ink-500 hover:bg-bad/10 hover:text-bad"
              onClick={() => onDelete(entry)}
              disabled={deleting}
              aria-label={`Delete this ${entry.kind === 'checkin' ? 'check-in' : 'journal entry'}`}
              title="Delete entry"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="m-0 max-h-[280px] overflow-y-auto whitespace-pre-wrap rounded-md border-l-[3px] border-purple-500 bg-purple-500/5 px-4 py-3.5 text-[15px] leading-relaxed text-ink-100 [overflow-wrap:anywhere]">
          {entry.text}
        </p>
      </Card>
    </>
  )
}
