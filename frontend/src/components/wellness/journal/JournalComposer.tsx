import type { FormEvent } from 'react'
import { BrainCircuit, Loader2, PenTool } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/field'
import { MAX_JOURNAL_CHARS, MIN_JOURNAL_CHARS, stressHint } from './journalFormat'

/** "Expressive Journaling" editor: free text + self-reported stress slider + Analyze button. */
export function JournalComposer({ text, onText, stress, onStress, loading, onSubmit }: {
  text: string
  onText: (v: string) => void
  stress: number
  onStress: (v: number) => void
  loading: boolean
  onSubmit: () => void
}) {
  const length = text.trim().length
  const tooShort = length < MIN_JOURNAL_CHARS
  const submit = (e: FormEvent) => { e.preventDefault(); if (!loading && !tooShort) onSubmit() }

  return (
    <Card className="p-5 md:p-6">
      <div className="mb-4 flex items-center gap-2">
        <PenTool className="h-[22px] w-[22px] text-purple-500" aria-hidden />
        <h3 className="m-0 font-display text-lg font-semibold">Expressive Journaling</h3>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-ink-300">
        Write freely about your day, mock test scores, time struggles, syllabus stress, or exam fears.
        Our empathetic AI analyzes your writing to detect hidden triggers standard logs miss.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <div>
          <label htmlFor="journal-textarea" className="mb-1.5 block text-sm font-medium text-ink-100">
            How are your thoughts today? (Minimum {MIN_JOURNAL_CHARS} characters)
          </label>
          <Textarea
            id="journal-textarea"
            className="min-h-[200px] resize-y"
            placeholder="Today was tough. I spent 4 hours on mathematics but still got stuck on mock test questions. I feel like I'm falling behind, and my peers are revising faster. Sleeping is getting harder..."
            value={text}
            onChange={(e) => onText(e.target.value)}
            maxLength={MAX_JOURNAL_CHARS}
            aria-describedby="journal-count"
            disabled={loading}
            required
          />
          <p id="journal-count" className="mt-1 text-right text-[11px] tabular-nums text-ink-500">
            {tooShort && length > 0 ? `${MIN_JOURNAL_CHARS - length} more characters needed · ` : ''}
            {text.length}/{MAX_JOURNAL_CHARS}
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="journal-stress" className="text-sm font-medium text-ink-100">
              Self-Reported Tension/Stress Level: <strong className="text-fg">{stress}%</strong>
            </label>
            <span className="text-xs text-ink-500">{stressHint(stress)}</span>
          </div>
          <input
            id="journal-stress"
            type="range"
            min={1}
            max={100}
            value={stress}
            onChange={(e) => onStress(Number(e.target.value))}
            aria-valuetext={`${stress}% — ${stressHint(stress).replace(/^\S+\s/, '')}`}
            disabled={loading}
            className="h-2 w-full cursor-pointer accent-purple-600 disabled:cursor-not-allowed"
          />
        </div>

        <Button type="submit" className="self-start" disabled={loading || tooShort}>
          {loading
            ? <><Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> Analyzing Sentiments...</>
            : <><BrainCircuit className="h-[18px] w-[18px]" aria-hidden /> Analyze with GenAI</>}
        </Button>
      </form>
    </Card>
  )
}
