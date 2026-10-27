import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Mic, RotateCcw, SendHorizontal, Square } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { aiErrorMessage } from '@/services/lessonPlanService'
import type { LpScope } from '@/types/lessonPlan'
import { IdentityCard, MessageRow, TypingRow } from './assistant/ChatMessage'
import { flattenScope, suggestionChips } from './assistant/match'
import { GREETING, NO_CLASSES } from './assistant/text'
import { handleTurn } from './assistant/turn'
import type { AssistantDeps, ChaptersCtx, Msg, Pipeline, Turn } from './assistant/types'

/* AI Bot — the conversational Lesson Plan Assistant (port of the `lessonplan` mode of Rapid's ChatBotScreen).
   The model (system prompt built server-side) only collects the inputs and emits trigger tokens; the pipeline in
   ./assistant runs the same generators as the Manual creator and saves the plan to the repository. */

// Web Speech API — not part of TypeScript's DOM lib.
interface SpeechRec {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start(): void
  stop(): void
}
type SpeechRecCtor = new () => SpeechRec
const speechCtor = (): SpeechRecCtor | null => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const greetingFor = (hasClasses: boolean) => (hasClasses ? GREETING : `${GREETING}\n\n_${NO_CLASSES}_`)

export function LessonPlanAssistant({ scope, onClose, onSaved }: {
  scope: LpScope
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const initials = (user?.full_name ?? '').split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || 'You'
  const rows = useMemo(() => flattenScope(scope), [scope])
  const chips = useMemo(() => suggestionChips(rows), [rows])
  const greeting = greetingFor(rows.length > 0)

  const [msgs, setMsgs] = useState<Msg[]>(() => [{ id: 0, role: 'assistant', content: greeting }])
  const [val, setVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceOk] = useState(() => speechCtor() !== null)

  const seq = useRef(1)
  const epoch = useRef(0)                       // bumped by "New chat" / unmount: late results of the old chat are dropped
  const pipe = useRef<Pipeline | null>(null)     // lesson-plan pipeline state
  const lesson = useRef<Pipeline | null>(null)   // last complete plan shown, for a later "download"
  const saved = useRef(false)
  const chapters = useRef<ChaptersCtx | null>(null)
  const classOk = useRef<string | null>(null)
  const rec = useRef<SpeechRec | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const mk = (role: Msg['role'], content: string, busy?: boolean): Msg => ({ id: seq.current++, role, content, ...(busy ? { busy } : {}) })
  const stopVoice = () => {
    try { rec.current?.stop() } catch { /* already stopped */ }
    rec.current = null
  }

  // Wipe the whole session — visible turns AND the hidden state — and reopen with a clean greeting.
  const resetChat = () => {
    epoch.current += 1
    stopVoice()
    pipe.current = null
    lesson.current = null
    saved.current = false
    chapters.current = null
    classOk.current = null
    setListening(false)
    setLoading(false)
    setVal('')
    setMsgs([mk('assistant', greeting)])
    inputRef.current?.focus()
  }

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [msgs, loading])
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => () => { epoch.current += 1; stopVoice() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const send = async (text?: string) => {
    const t = (text ?? val).trim()
    if (!t || loading) return
    setVal('')
    const mine = epoch.current
    const live = () => epoch.current === mine
    const visible = [...msgs.filter((m) => !m.busy), mk('user', t)]
    setMsgs(visible)
    setLoading(true)
    const turn: Turn = { visible, live, say: (content, busy) => { if (live()) setMsgs([...visible, mk('assistant', content, busy)]) } }
    const deps: AssistantDeps = { rows, pipe, lesson, saved, chapters, classOk, onSaved }
    try {
      await handleTurn(t, turn, deps)
    } catch (e) {
      turn.say(`Sorry, I hit a problem reaching the assistant. ${aiErrorMessage(e, '')}`.trim())
    }
    if (live()) setLoading(false)
  }

  const voice = () => {
    if (listening) { stopVoice(); setListening(false); return }
    const SR = speechCtor()
    if (!SR) return
    try {
      const r = new SR()
      r.lang = 'en-IN'
      r.interimResults = false
      r.maxAlternatives = 1
      r.onresult = (e) => { const tr = e.results[0]?.[0]?.transcript; if (tr) setVal(tr) }
      r.onend = () => { setListening(false); if (rec.current === r) rec.current = null }
      r.onerror = () => setListening(false)
      rec.current = r
      setListening(true)
      r.start()
    } catch { setListening(false) }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); void send() }
  const last = msgs[msgs.length - 1]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar — only Back + New chat (the logo / nav live in the app shell). */}
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4 md:px-8">
        <Button id="lp-assistant-back" variant="secondary" className="rounded-full" onClick={onClose}><ArrowLeft className="h-4 w-4" />Back</Button>
        <Button id="lp-assistant-new-chat" variant="secondary" className="rounded-full" onClick={resetChat}><RotateCcw className="h-4 w-4" />New chat</Button>
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto py-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
          <IdentityCard />
          <div role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-4">
            {msgs.map((m) => <MessageRow key={m.id} msg={m} initials={initials} />)}
          </div>
          {loading && !last?.busy && <TypingRow />}
          {msgs.length === 1 && !loading && chips.length > 0 && (
            <div className="flex flex-wrap gap-2 pl-12">
              {chips.map((c) => (
                <button key={c.prompt} type="button" onClick={() => void send(c.prompt)}
                  className="cursor-pointer rounded-full border border-line bg-ink-900 px-3.5 py-1.5 text-sm font-medium text-ink-300 transition-colors hover:border-brand-400/40 hover:bg-brand-500/5 hover:text-fg">
                  {c.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <form onSubmit={submit} className="shrink-0 border-t border-line bg-ink-900/80 px-4 py-3 backdrop-blur md:py-4">
        <div className="glass mx-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-brand-400/60">
          <input id="lp-assistant-input" ref={inputRef} value={val} maxLength={2000} onChange={(e) => setVal(e.target.value)}
            placeholder={listening ? 'Listening… speak now' : 'Type your message…'} aria-label="Message the Lesson Plan Assistant"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-fg placeholder:text-ink-500 focus:outline-none" />
          {voiceOk && (
            <Button id="lp-assistant-voice" size="icon" variant={listening ? 'danger' : 'secondary'} onClick={voice} aria-pressed={listening}
              aria-label={listening ? 'Stop listening' : 'Speak your message'} title={listening ? 'Listening… tap to stop' : 'Speak'}
              className={cn('h-10 w-10 shrink-0', listening && 'animate-pulse')}>
              {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          )}
          <Button id="lp-assistant-send" type="submit" size="icon" disabled={loading || !val.trim()} aria-label="Send message"
            className="h-10 w-10 shrink-0 bg-gradient-to-br from-brand-500 to-aqua-500">
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
