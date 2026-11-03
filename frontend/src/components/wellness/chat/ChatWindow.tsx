import { useEffect, useRef, type FormEvent } from 'react'
import { BookOpen, CloudOff, Heart, Loader2, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import type { Helpline, JournalEntry } from '@/types/wellness'
import { formatJournalDate, prefersReducedMotion } from '../journal/journalFormat'
import { QUICK_CHIPS, type UiMessage } from './chatCopy'
import { MessageBubble } from './MessageBubble'

const MAX_MESSAGE_CHARS = 2000

/** The Aura conversation card: header, message log, status bars, quick-reply chips and the input row. */
export function ChatWindow(props: {
  messages: UiMessage[] | null
  historyError: string | null
  onRetryHistory: () => void
  sending: boolean
  journalsCount: number
  aiOffline: boolean
  focusedJournal: JournalEntry | null
  onClearFocus: () => void
  onClearChat: () => void
  input: string
  onInput: (v: string) => void
  onSend: (text?: string) => void
  crisisHelplines: Record<string, Helpline> | null
}) {
  const { messages, historyError, sending, journalsCount, aiOffline, focusedJournal, input } = props
  const logRef = useRef<HTMLDivElement>(null)

  // Keep the newest message in view (scrolls the log only, never the page).
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [messages, sending])

  const submit = (e: FormEvent) => { e.preventDefault(); if (!sending && input.trim()) props.onSend() }

  return (
    <section aria-label="Aura chat" className="glass flex h-[550px] min-w-0 flex-col overflow-hidden rounded-2xl">
      <header className="flex items-center gap-4 border-b border-purple-500/15 bg-ink-900 px-5 py-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-purple-600 to-rose-500 shadow-[0_0_15px_rgb(124_58_237/0.35)]" aria-hidden>
          <Heart className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="m-0 flex items-center gap-1.5 font-semibold">
            Aura <Sparkles className="h-3.5 w-3.5 text-rose-400" aria-hidden />
          </h4>
          <p className="m-0 truncate text-xs text-ink-300">
            Empathetic Student Wellness Companion
            {journalsCount > 0 ? ` · reading ${journalsCount} journal ${journalsCount === 1 ? 'entry' : 'entries'}` : ''}
          </p>
        </div>
        <Button variant="secondary" size="icon" className="rounded-full" onClick={props.onClearChat} title="Reset Chat" aria-label="Reset chat history">
          <Trash2 className="h-4 w-4" />
        </Button>
      </header>

      {historyError && !messages ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p role="alert" className="text-sm text-bad">{historyError}</p>
          <Button variant="secondary" size="sm" onClick={props.onRetryHistory}><RefreshCw className="h-3.5 w-3.5" />Try again</Button>
        </div>
      ) : !messages ? (
        <div className="flex flex-1 flex-col gap-4 p-5" aria-busy="true" aria-label="Loading your conversation">
          <div className="skeleton h-16 w-3/4" />
          <div className="skeleton ml-auto h-10 w-1/2" />
          <div className="skeleton h-20 w-2/3" />
        </div>
      ) : (
        <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation with Aura" className="flex flex-1 flex-col gap-4 overflow-y-auto bg-ink-800/40 p-5">
          {messages.map((msg) => <MessageBubble key={msg.key} msg={msg} crisisHelplines={props.crisisHelplines} />)}
          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-purple-500/15 bg-ink-900 px-4 py-3 text-sm text-ink-300">
                <Loader2 className="h-4 w-4 animate-spin text-purple-500" aria-hidden />
                <span>Aura is typing...</span>
              </div>
            </div>
          )}
        </div>
      )}

      {aiOffline && (
        <div role="status" className="flex items-center gap-2 border-t border-warn/30 bg-warn/10 px-5 py-2 text-xs text-warn">
          <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="flex-1">Aura's AI is offline on this server, so her replies are generic.</span>
        </div>
      )}

      {focusedJournal && (
        <div className="flex items-center gap-2 border-t border-purple-500/25 bg-purple-500/10 px-5 py-2 text-xs text-purple-700">
          <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="flex-1">Discussing your journal from <strong>{formatJournalDate(focusedJournal.date)}</strong></span>
          <button
            type="button"
            onClick={props.onClearFocus}
            aria-label="Stop discussing this journal entry"
            title="Stop discussing this entry"
            className="grid h-6 w-6 cursor-pointer place-items-center rounded-full text-purple-700 transition-colors hover:bg-purple-500/15"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto border-t border-line bg-ink-800/60 px-5 py-3 [scrollbar-width:none]" role="group" aria-label="Quick replies">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => props.onSend(chip)}
            disabled={sending}
            className={cn(
              'shrink-0 cursor-pointer whitespace-nowrap rounded-full border border-purple-500/20 bg-ink-900 px-4 py-2 text-xs text-ink-100 transition-colors',
              'hover:border-purple-400 hover:bg-purple-500/10 hover:text-purple-700 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {chip}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex gap-3 border-t border-purple-500/15 bg-ink-900 px-5 py-4">
        <Input
          type="text"
          value={input}
          onChange={(e) => props.onInput(e.target.value)}
          placeholder="Talk to Aura... (e.g. 'I am feeling burned out')"
          maxLength={MAX_MESSAGE_CHARS}
          aria-label="Message input for Aura companion"
          autoComplete="off"
          className="h-11"
        />
        <Button
          type="submit"
          size="icon"
          className="h-11 w-11 shrink-0 from-purple-600 to-rose-500"
          disabled={sending || !input.trim()}
          aria-label="Send message to Aura"
        >
          <Send className="h-[18px] w-[18px]" />
        </Button>
      </form>
    </section>
  )
}
