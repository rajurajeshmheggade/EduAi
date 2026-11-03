import { useCallback, useEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { toast } from '@/components/ui/toast'
import { useWellness } from '@/components/wellness/WellnessContext'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'
import type { AuraMemory, ChatMessage, JournalEntry } from '@/types/wellness'
import { formatJournalDate } from '../journal/journalFormat'
import { AURA_GREETING, AURA_JOURNAL_WINDOW, AURA_OFFLINE_REPLY, type UiMessage } from './chatCopy'
import { ChatWindow } from './ChatWindow'
import { JournalPanel } from './JournalPanel'
import { MemoriesPanel } from './MemoriesPanel'

const now = () => new Date().toISOString()
const greeting = (): UiMessage => ({ key: 'greeting', role: 'model', content: AURA_GREETING, timestamp: now() })
const fromServer = (m: ChatMessage, i: number): UiMessage => ({
  key: `s${m.id ?? `i${i}`}`, role: m.role, content: m.content, timestamp: m.timestamp ?? '',
  channel: m.channel, guardrailType: m.guardrailType ?? null, aiSource: m.aiSource ?? null,
})

/** Student ▸ Wellness ▸ Aura Chat — MindAlign ChatCompanion. History, context and journal references live on the server. */
export function ChatTab() {
  const { meta, confirm } = useWellness()
  const [messages, setMessages] = useState<UiMessage[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [journals, setJournals] = useState<JournalEntry[] | null>(null)
  const [journalsError, setJournalsError] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // null until a reply arrives — until then the server's meta.aiEnabled decides the offline notice.
  const [aiOffline, setAiOffline] = useState<boolean | null>(null)
  const [memories, setMemories] = useState<AuraMemory[] | null>(null)
  const [memoriesError, setMemoriesError] = useState<string | null>(null)
  const [forgettingId, setForgettingId] = useState<number | null>(null)
  const seq = useRef(0)
  const nextKey = () => `l${++seq.current}`

  // Errors are cleared by the retry buttons, so loading never sets state synchronously inside the mount effect.
  const loadHistory = useCallback(() => wellnessService.chatHistory(60)
    .then((rows) => { setMessages(rows.length ? rows.map(fromServer) : [greeting()]); setHistoryError(null) })
    .catch((e: unknown) => setHistoryError(errorMessage(e, 'Could not load your conversation with Aura'))), [])

  // Aura references written journals only (not quick mood check-ins), newest first.
  const loadJournals = useCallback(() => wellnessService.journals(50)
    .then((all) => { setJournals(all.filter((j) => j.kind === 'journal').slice(0, AURA_JOURNAL_WINDOW)); setJournalsError(null) })
    .catch((e: unknown) => setJournalsError(errorMessage(e, 'Could not load your journals'))), [])

  const loadMemories = useCallback(() => wellnessService.memories()
    .then((xs) => { setMemories(xs); setMemoriesError(null) })
    .catch((e: unknown) => setMemoriesError(errorMessage(e, "Could not load Aura's memories"))), [])

  useEffect(() => {
    void loadHistory()
    void loadJournals()
    void loadMemories()
  }, [loadHistory, loadJournals, loadMemories])

  const focusedJournal = journals?.find((j) => j.id === focusedId) ?? null
  // Until the history arrives, a new message could be overwritten by it — hold sends until then.
  const busy = sending || (messages === null && historyError === null)
  const append = (m: UiMessage) => setMessages((xs) => [...(xs ?? []), m])

  // focusOverride lets "Discuss with Aura" reference an entry before the focus state has updated
  const send = async (textToSend?: string, focusOverride?: string | null) => {
    const text = (textToSend ?? input).trim()
    if (!text || busy) return
    if (textToSend === undefined) setInput('')
    append({ key: nextKey(), role: 'user', content: text, timestamp: now() })
    setSending(true)
    try {
      const r = await wellnessService.chat(text, { focusJournalId: focusOverride !== undefined ? focusOverride : focusedId })
      if (typeof r.reply !== 'string' || !r.reply.trim()) throw new Error('Empty reply')
      // The server answers with generic built-in replies when it has no working AI key; guardrail replies say nothing about that.
      if (r.aiSource !== 'guardrail') setAiOffline(r.aiSource === 'fallback')
      append({
        key: nextKey(), role: 'model', content: r.reply, timestamp: now(), aiSource: r.aiSource,
        guardrailType: r.guardrailTriggered ? (r.guardrailType ?? 'guardrail') : null, helplines: r.helplines ?? null,
      })
      // Aura may have learned something new from this message.
      if (!r.guardrailTriggered) wellnessService.memories().then(setMemories).catch(() => {})
    } catch (e) {
      // The server was reached but refused (e.g. too many messages) — say why, as well as the safe reply.
      if (isAxiosError(e) && e.response) toast(errorMessage(e, 'Aura could not answer that message'), 'error')
      append({ key: nextKey(), role: 'model', content: AURA_OFFLINE_REPLY, timestamp: now() })
    } finally {
      setSending(false)
    }
  }

  // Start a conversation about one journal entry; Aura keeps it in focus until the student clears it
  const discuss = (log: JournalEntry) => {
    setFocusedId(log.id)
    void send(`Can we talk about my journal entry from ${formatJournalDate(log.date)}?`, log.id)
  }

  const clearChat = () =>
    confirm(
      'Reset Chat History',
      'Are you sure you want to clear your chat messages with Aura? This will reset your conversation logs.',
      () => {
        wellnessService.clearChat()
          .then(() => { setMessages([greeting()]); setFocusedId(null) })
          .catch((e: unknown) => toast(errorMessage(e, 'Could not clear your chat history'), 'error'))
      },
    )

  const forget = async (m: AuraMemory) => {
    setForgettingId(m.id)
    try {
      await wellnessService.deleteMemory(m.id)
      setMemories((xs) => xs?.filter((x) => x.id !== m.id) ?? xs)
      toast('Aura has forgotten that', 'success')
    } catch (e) {
      toast(errorMessage(e, 'Could not remove this memory'), 'error')
    } finally {
      setForgettingId(null)
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ChatWindow
        messages={messages}
        historyError={historyError}
        onRetryHistory={() => { setHistoryError(null); void loadHistory() }}
        sending={busy}
        journalsCount={journals?.length ?? 0}
        aiOffline={aiOffline ?? (meta ? !meta.aiEnabled : false)}
        focusedJournal={focusedJournal}
        onClearFocus={() => setFocusedId(null)}
        onClearChat={clearChat}
        input={input}
        onInput={setInput}
        onSend={(text) => void send(text)}
        crisisHelplines={meta?.helplines ?? null}
      />

      <div className="flex min-w-0 flex-col gap-5">
        <JournalPanel
          journals={journals}
          error={journalsError}
          focusedId={focusedId}
          busy={busy}
          onDiscuss={discuss}
          onRetry={() => { setJournalsError(null); void loadJournals() }}
        />
        <MemoriesPanel
          memories={memories}
          error={memoriesError}
          deletingId={forgettingId}
          onDelete={(m) => void forget(m)}
          onRetry={() => { setMemoriesError(null); void loadMemories() }}
        />
      </div>
    </div>
  )
}
