import { Brain, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AuraMemory } from '@/types/wellness'
import { humanizeCategory } from '../journal/journalFormat'

const updated = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** "What Aura remembers": the long-term facts Aura extracted from chats, each removable by the student. */
export function MemoriesPanel({ memories, error, deletingId, onDelete, onRetry }: {
  memories: AuraMemory[] | null
  error: string | null
  deletingId: number | null
  onDelete: (m: AuraMemory) => void
  onRetry: () => void
}) {
  return (
    <section aria-labelledby="aura-memories-title" className="glass flex max-h-[360px] min-h-0 flex-col gap-3 rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <Brain className="h-[18px] w-[18px] text-purple-500" aria-hidden />
        <h4 id="aura-memories-title" className="m-0 flex-1 font-semibold">What Aura remembers</h4>
        {memories && memories.length > 0 && (
          <span className="rounded-full border border-purple-500/25 bg-purple-500/10 px-2 py-px text-[11px] font-semibold text-purple-700">{memories.length}</span>
        )}
      </div>
      <p className="m-0 text-xs leading-snug text-ink-500">
        Aura keeps a few key facts from your chats (like subjects you find hard or what helped you) so she doesn't have to ask again.
        Remove anything you'd rather she forgot.
      </p>

      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {error && !memories ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p role="alert" className="text-xs text-bad">{error}</p>
            <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" />Try again</Button>
          </div>
        ) : !memories ? (
          <div className="flex flex-col gap-2">{[0, 1].map((i) => <div key={i} className="skeleton h-12" />)}</div>
        ) : memories.length === 0 ? (
          <p className="py-4 text-center text-xs leading-relaxed text-ink-500">
            Nothing yet. As you chat, Aura will note things that help her support you better.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {memories.map((m) => (
              <li key={m.id} className="flex items-start gap-2 rounded-xl border border-line bg-ink-800/50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10.5px] text-ink-500">
                    <span className="font-semibold uppercase tracking-wide text-purple-700">{humanizeCategory(m.category)}</span>
                    {updated(m.updatedAt) && <span>· {updated(m.updatedAt)}</span>}
                  </div>
                  <p className="m-0 mt-0.5 text-[13px] leading-snug text-ink-100 [overflow-wrap:anywhere]">{m.text}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-ink-500 hover:bg-bad/10 hover:text-bad"
                  onClick={() => onDelete(m)}
                  disabled={deletingId === m.id}
                  aria-label={`Forget: ${m.text}`}
                  title="Forget this"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
