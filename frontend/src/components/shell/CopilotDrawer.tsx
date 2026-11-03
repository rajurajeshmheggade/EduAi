import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerDownRight, Info, Lock, Loader2, Mic, RefreshCw, Send, Sparkles, Square, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Markdown } from '@/components/Markdown'
import { Select } from '@/components/ui/field'
import { COPILOT_MAX_WIDTH, COPILOT_MIN_WIDTH, COPILOT_DEFAULT_WIDTH, COPILOT_SHORTCUT } from '@/components/shell/copilot/useCopilotDock'
import { speechLang, useVoiceInput } from '@/components/shell/copilot/useVoiceInput'
import { copilotService, streamCopilotQuery, type CopilotStatus } from '@/services/copilotService'
import { adminService } from '@/services/adminService'
import { cn } from '@/lib/utils'

const STAFF_EXAMPLES = [
  'How many students and teachers do we have?',
  "What's attendance looking like today?",
  'How many admission applicants have given consent?',
  'What should we focus on this week?',
]
const TEACHER_EXAMPLES = [
  'What periods do I have today?',
  "Which of today's periods still need attendance?",
  'What homework is waiting for my review?',
  'Which assessments need my attention?',
  'What should I focus on this week?',
]
const STUDENT_EXAMPLES = [
  "How's my attendance this month?",
  'What homework do I have pending?',
  'What classes do I have today?',
  'Suggest how I can improve this week',
]

const AUTOSEND_KEY = 'eduai.copilot.autosend'
const readAutoSend = () => { try { return localStorage.getItem(AUTOSEND_KEY) === '1' } catch { return false } }

interface Msg { id: number; role: 'user' | 'assistant'; text: string; error?: boolean; streaming?: boolean; suggestions?: string[] }

const joinText = (base: string, add: string) => [base.trim(), add.trim()].filter(Boolean).join(' ')
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export interface CopilotDrawerProps {
  open: boolean
  onClose: () => void
  /** Docked beside the page (wide screens: the page shrinks to make room) or over the content (narrow screens). */
  docked?: boolean
  /** Docked width in px (resizable from the panel's left edge). */
  width?: number
  onResize?: (width: number, commit: boolean) => void
}

/**
 * Copilot panel (roles in AppShell's COPILOT_ROLES), opened with the header button or Ctrl/⌘-J. On wide screens it
 * docks BELOW the header, beside the page; on narrow screens it slides over the content. Answers come from a real LLM
 * call grounded in a server-assembled snapshot (backend/app/services/copilot.py): staff get an aggregated, anonymised
 * institution view (never an individual student's name, answers or photos); a teacher gets their own classes at class
 * level (never another teacher's data); a student gets only their OWN attendance/homework/timetable/results.
 * Each answer ends with follow-up suggestions; the mic dictates (browser speech recognition) or records a voice
 * message for server transcription, and the text is left in the box to review before sending.
 */
export function CopilotDrawer({ open, onClose, docked = false, width = COPILOT_DEFAULT_WIDTH, onResize }: CopilotDrawerProps) {
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const role = user?.role
  const isStudent = role === 'student'
  const isTeacher = role === 'teacher'
  const isAdmin = role === 'orgadmin' || role === 'superadmin'
  const examples = isStudent ? STUDENT_EXAMPLES : isTeacher ? TEACHER_EXAMPLES : STAFF_EXAMPLES
  const rootRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const seq = useRef(0)
  const lastQuery = useRef<string | null>(null)
  const voiceBase = useRef('')
  const wasOpen = useRef(open)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [orgs, setOrgs] = useState<{ org_code: string; org_name: string }[] | null>(null)
  const [orgCode, setOrgCode] = useState<string | null>(null)
  const [status, setStatus] = useState<CopilotStatus | null>(null)
  const [autoSend, setAutoSend] = useState(readAutoSend)
  const [resizing, setResizing] = useState(false)

  const voice = useVoiceInput({
    lang: speechLang(i18n?.language),
    serverTranscription: status ? status.voice_transcription : null,
    onText: (t) => setInput(joinText(voiceBase.current, t)),
    onComplete: (t) => {
      if (autoSend) void ask(joinText(voiceBase.current, t))
      else inputRef.current?.focus()
    },
  })
  const voiceActive = voice.state === 'listening' || voice.state === 'recording'

  // Opening moves focus to the question box (not on first render: a remembered-open panel must not steal focus).
  useEffect(() => {
    if (open && !wasOpen.current) inputRef.current?.focus()
    wasOpen.current = open
  }, [open])

  // Is Copilot on a live AI provider or offline demo answers? Asked once, the first time the panel opens.
  useEffect(() => {
    if (open && !status) copilotService.status().then(setStatus).catch(() => {})
  }, [open, status])

  // Superadmin has no "home" institution of their own — let them pick which one Copilot answers about.
  useEffect(() => {
    if (open && role === 'superadmin' && !orgs) {
      adminService.organizations().then((list) => {
        const real = list.filter((o) => o.org_code !== 'PLATFORM')
        setOrgs(real)
        setOrgCode((c) => c ?? real[0]?.org_code ?? null)
      }).catch(() => setOrgs([]))
    }
  }, [open, role, orgs])

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [messages])
  useEffect(() => () => abortRef.current?.abort(), [])
  // Grow the question box with dictated / multi-line text, up to a few lines.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    // scrollHeight excludes the borders (border-box sizing): add them back so no scrollbar appears until the cap.
    if (el.scrollHeight) el.style.height = `${Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, 160)}px`
  }, [input])

  function close() {
    const hadFocus = !!rootRef.current?.contains(document.activeElement)
    voice.cancel()
    onClose()
    if (hadFocus) document.getElementById('open-copilot')?.focus()
  }

  async function ask(query: string) {
    const q = query.trim()
    if (!q || busy) return
    lastQuery.current = q
    setInput('')
    const uid = ++seq.current
    const aid = ++seq.current
    setMessages((m) => [...m, { id: uid, role: 'user', text: q }, { id: aid, role: 'assistant', text: '', streaming: true }])
    setBusy(true)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const patch = (fn: (m: Msg) => Msg) => setMessages((prev) => prev.map((m) => (m.id === aid ? fn(m) : m)))
    try {
      await streamCopilotQuery({ query: q, org_code: orgCode }, {
        onToken: (t) => patch((m) => ({ ...m, text: m.text + t })),
        // The answer is complete at `done`; follow-up suggestions arrive just after it.
        onDone: () => { patch((m) => ({ ...m, streaming: false })); setBusy(false) },
        onSuggestions: (items) => patch((m) => ({ ...m, suggestions: items.slice(0, 4) })),
        onError: (msg) => { patch((m) => ({ ...m, text: msg, error: true, streaming: false })); setBusy(false) },
      }, ac.signal)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        patch((m) => ({ ...m, text: "Couldn't reach Copilot — check your connection and try again.", error: true, streaming: false }))
      }
    } finally {
      if (abortRef.current === ac) {
        patch((m) => (m.streaming ? { ...m, streaming: false } : m))
        setBusy(false)
      }
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    voice.cancel() // sending now: a still-running dictation must not refill the box or auto-send again
    void ask(input)
  }

  function onInputKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }

  function onPanelKey(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    e.stopPropagation()
    if (voiceActive) voice.stop()
    else close()
  }

  function toggleVoice() {
    if (voice.state === 'idle') voiceBase.current = input
    voice.toggle()
  }

  function setAuto(on: boolean) {
    setAutoSend(on)
    try { localStorage.setItem(AUTOSEND_KEY, on ? '1' : '0') } catch { /* storage unavailable */ }
  }

  // ── resize (docked only): drag the left edge, or focus it and use the arrow keys
  function onHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!onResize) return
    e.preventDefault()
    const el = e.currentTarget
    const startX = e.clientX
    const startW = width
    el.setPointerCapture?.(e.pointerId)
    setResizing(true)
    const move = (ev: PointerEvent) => onResize(startW + (startX - ev.clientX), false)
    const up = (ev: PointerEvent) => {
      onResize(startW + (startX - ev.clientX), true)
      setResizing(false)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  function onHandleKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!onResize) return
    const next = { ArrowLeft: width + 16, ArrowRight: width - 16, Home: COPILOT_MIN_WIDTH, End: COPILOT_MAX_WIDTH }[e.key]
    if (next === undefined) return
    e.preventDefault()
    onResize(next, true)
  }

  const greeting = isStudent
    ? "Ask me about your attendance, homework, today's classes or recent results — or ask for suggestions."
    : isTeacher
      ? "Ask me about today's periods, attendance to mark, homework to review or your assessments — or ask for suggestions."
      : null
  const lastIndex = messages.length - 1

  const body = (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-aqua-500"><Sparkles className="h-4 w-4 text-white" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-semibold text-fg">Copilot</div>
          <div className="truncate text-xs text-ink-500">{isStudent ? 'Your study assistant' : isTeacher ? 'Your teaching assistant' : 'Aggregated, read-only answers about your institution'}</div>
        </div>
        <kbd className="hidden rounded border border-line px-1.5 text-[10px] text-ink-500 sm:inline" title={`Press ${COPILOT_SHORTCUT.label} to open or close Copilot`}>{COPILOT_SHORTCUT.label}</kbd>
        <button onClick={close} aria-label="Close Copilot" title={`Close Copilot (${COPILOT_SHORTCUT.label})`} aria-keyshortcuts={`Escape ${COPILOT_SHORTCUT.aria}`}
          className="cursor-pointer rounded-lg p-1.5 text-ink-500 hover:bg-ink-800 hover:text-fg"><X className="h-4 w-4" /></button>
      </div>

      {status && !status.ai_ready && (
        <p role="note" className="flex shrink-0 items-start gap-2 border-b border-line bg-ink-800/40 px-4 py-2 text-xs text-ink-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
          {isAdmin
            ? 'Offline demo answers — add the AI key in .env to get full answers.'
            : 'Offline demo answers — full AI answers turn on once your school adds its AI key.'}
        </p>
      )}

      {role === 'superadmin' && orgs && orgs.length > 0 && (
        <div className="shrink-0 border-b border-line px-4 py-2.5">
          <Select aria-label="Institution for Copilot" className="h-9 w-full text-sm" value={orgCode ?? ''} onChange={(e) => setOrgCode(e.target.value)}>
            {orgs.map((o) => <option key={o.org_code} value={o.org_code}>{o.org_name}</option>)}
          </Select>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 text-sm">
        <p className="flex items-start gap-2 rounded-xl border border-line bg-ink-800/50 p-3 text-ink-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          {isStudent
            ? "Copilot answers using only your own attendance, homework, timetable and results — never another student's data."
            : isTeacher
              ? "Copilot answers from your own classes, periods, homework and assessments (class-level figures) and aggregated school numbers. It never sees a child's name, answers or photos, or another teacher's data."
              : "Copilot answers from aggregated, anonymised views of your school's data through read-only queries. It never sees a child's name, answers or photos."}
        </p>
        {messages.length === 0 && (
          <div>
            {greeting && <p className="mb-3 text-ink-300">Hi {user?.full_name?.split(' ')[0] ?? 'there'} 👋 {greeting}</p>}
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Try asking</div>
            <ul className="space-y-1.5">
              {examples.map((q) => (
                <li key={q}>
                  <button type="button" onClick={() => void ask(q)}
                    className="w-full cursor-pointer rounded-lg border border-dashed border-line px-3 py-2 text-left text-ink-300 hover:border-brand-400 hover:text-fg">
                    {q}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-500">Tip: press <kbd className="rounded border border-line px-1">{COPILOT_SHORTCUT.label}</kbd> to open or close Copilot, or tap the mic to ask by voice.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={m.id}>
            <div className={cn('rounded-xl px-3 py-2', m.role === 'user' ? 'ml-6 whitespace-pre-wrap bg-brand-500/15 text-fg' : m.error ? 'border border-bad/30 bg-bad/10 text-bad' : 'border border-line bg-ink-800/40 text-ink-100')}
              aria-busy={m.streaming || undefined}>
              {m.role === 'assistant' && !m.error && m.text ? <Markdown source={m.text} /> : m.text}
              {m.streaming && !m.text && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-500" aria-label="Copilot is answering" />}
              {m.streaming && m.text && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-ink-500 align-middle" aria-hidden />}
              {m.error && !busy && i === lastIndex && (
                <button type="button" onClick={() => lastQuery.current && void ask(lastQuery.current)}
                  className="mt-1.5 flex cursor-pointer items-center gap-1 text-xs font-medium text-bad underline-offset-2 hover:underline">
                  <RefreshCw className="h-3 w-3" /> Retry
                </button>
              )}
            </div>
            {i === lastIndex && m.role === 'assistant' && !m.streaming && !m.error && !!m.suggestions?.length && (
              <div role="group" aria-label="Suggested follow-up questions" className="mt-2 flex flex-wrap gap-1.5">
                {m.suggestions.map((s) => (
                  <button key={s} type="button" disabled={busy} onClick={() => void ask(s)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-brand-400/40 bg-brand-500/5 px-2.5 py-1 text-left text-xs text-brand-600 transition-colors hover:bg-brand-500/15 disabled:cursor-not-allowed disabled:opacity-50">
                    <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />{s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-line p-3">
        {voice.state !== 'idle' && (
          <p role="status" aria-live="polite" className="mb-2 flex items-center gap-2 text-xs text-ink-300">
            {voice.state === 'transcribing'
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" aria-hidden /> Transcribing your voice message…</>
              : <><span className="h-2 w-2 animate-pulse rounded-full bg-bad" aria-hidden />
                {voice.state === 'listening' ? 'Listening… it stops when you pause — or tap the mic.' : `Recording ${mmss(voice.elapsed)} — tap the mic again to finish.`}</>}
          </p>
        )}
        {voice.error && (
          <p role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/10 px-2.5 py-1.5 text-xs text-bad">
            <span className="flex-1">{voice.error}</span>
            <button type="button" onClick={voice.clearError} aria-label="Dismiss voice message error" className="cursor-pointer rounded p-0.5 hover:bg-bad/10"><X className="h-3 w-3" /></button>
          </p>
        )}
        <div className="flex items-end gap-1.5">
          <textarea ref={inputRef} value={input} rows={1} onChange={(e) => setInput(e.target.value)} onKeyDown={onInputKey} readOnly={voiceActive}
            aria-label="Ask Copilot" placeholder={isStudent ? 'Ask about your studies…' : isTeacher ? 'Ask about your classes…' : 'Ask about your institution…'}
            className="min-h-10 flex-1 resize-none rounded-xl border border-line bg-ink-800/50 px-3 py-2 text-sm leading-6 text-ink-100 placeholder:text-ink-500 focus:border-brand-400/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          <div className="relative">
            <button type="button" onClick={toggleVoice} disabled={busy || voice.state === 'transcribing'} id="copilot-voice"
              aria-pressed={voiceActive} aria-label={voiceActive ? 'Stop voice input' : voice.state === 'transcribing' ? 'Transcribing voice message' : 'Ask by voice'}
              title={voiceActive ? 'Stop' : 'Ask by voice'}
              className={cn('grid h-10 w-10 cursor-pointer place-items-center rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                voiceActive ? 'border-bad/50 bg-bad/10 text-bad' : 'border-line text-ink-500 hover:border-line-strong hover:text-fg')}>
              {voice.state === 'transcribing' ? <Loader2 className="h-4 w-4 animate-spin" /> : voiceActive ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            {voiceActive && <span className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-xl border border-bad motion-reduce:animate-none" aria-hidden />}
          </div>
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send"
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl bg-brand-500 text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-500" title="Off: your spoken question stays in the box so you can check it before sending">
          <input type="checkbox" checked={autoSend} onChange={(e) => setAuto(e.target.checked)} className="h-3 w-3 accent-brand-500" />
          Send voice questions automatically
        </label>
      </form>
    </>
  )

  if (docked) {
    return (
      <aside id="copilot-panel" ref={rootRef} aria-label="Copilot" aria-hidden={!open} inert={!open} data-mode="docked" onKeyDown={onPanelKey}
        style={{ width: open ? width : 0 }}
        className={cn('relative h-full shrink-0 overflow-hidden bg-ink-900 print:hidden',
          !resizing && 'transition-[width] duration-200 ease-out motion-reduce:transition-none', open && 'border-l border-line')}>
        {open && onResize && (
          <div role="separator" aria-orientation="vertical" aria-label="Resize Copilot panel" tabIndex={0}
            aria-valuemin={COPILOT_MIN_WIDTH} aria-valuemax={COPILOT_MAX_WIDTH} aria-valuenow={width}
            onPointerDown={onHandlePointerDown} onKeyDown={onHandleKey}
            className={cn('absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none transition-colors hover:bg-brand-400/40 focus-visible:bg-brand-400/60 focus-visible:outline-none', resizing && 'bg-brand-400/60')} />
        )}
        {/* Fixed-width content anchored right: while the panel animates open/closed it slides rather than reflows. */}
        <div className="absolute inset-y-0 right-0 flex flex-col" style={{ width }}>{body}</div>
      </aside>
    )
  }
  return (
    <aside id="copilot-panel" ref={rootRef} aria-label="Copilot" aria-hidden={!open} inert={!open} data-mode="overlay" onKeyDown={onPanelKey}
      className={cn('fixed bottom-0 right-0 top-16 z-40 flex w-[min(24rem,100vw)] flex-col border-l border-line bg-ink-900 shadow-2xl transition-transform duration-200 motion-reduce:transition-none print:hidden',
        open ? 'translate-x-0' : 'translate-x-full')}>
      {body}
    </aside>
  )
}
