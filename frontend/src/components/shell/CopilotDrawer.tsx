import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Lock, Loader2, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Select } from '@/components/ui/field'
import { streamCopilotQuery } from '@/services/copilotService'
import { adminService } from '@/services/adminService'
import { cn } from '@/lib/utils'

const STAFF_EXAMPLES = [
  'How many students and teachers do we have?',
  "What's attendance looking like today?",
  'How many admission applicants have given consent?',
  'Are there any classes without a class teacher?',
]
const STUDENT_EXAMPLES = [
  "How's my attendance this month?",
  'What homework do I have pending?',
  'What classes do I have today?',
  'What was my most recent test result?',
]

interface Msg { role: 'user' | 'assistant'; text: string; error?: boolean; streaming?: boolean }

/**
 * Right-hand Copilot drawer (present on every screen, roles in AppShell's COPILOT_ROLES). Answers come from a
 * real LLM call grounded in a server-assembled snapshot (backend/app/services/copilot.py): staff get an
 * aggregated, anonymised institution view (never an individual student's name, answers or photos); a student
 * gets only their OWN attendance/homework/timetable/results, never another student's or staff-wide data.
 */
export function CopilotDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const isStudent = user?.role === 'student'
  const examples = isStudent ? STUDENT_EXAMPLES : STAFF_EXAMPLES
  const closeBtn = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [orgs, setOrgs] = useState<{ org_code: string; org_name: string }[] | null>(null)
  const [orgCode, setOrgCode] = useState<string | null>(null)
  const lastQuery = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Superadmin has no "home" institution of their own — let them pick which one Copilot answers about.
  useEffect(() => {
    if (open && user?.role === 'superadmin' && !orgs) {
      adminService.organizations().then((list) => {
        const real = list.filter((o) => o.org_code !== 'PLATFORM')
        setOrgs(real)
        setOrgCode((c) => c ?? real[0]?.org_code ?? null)
      }).catch(() => setOrgs([]))
    }
  }, [open, user, orgs])

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [messages])
  useEffect(() => () => abortRef.current?.abort(), [])

  async function ask(query: string) {
    if (!query.trim() || busy) return
    lastQuery.current = query
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: query }, { role: 'assistant', text: '', streaming: true }])
    setBusy(true)
    const ac = new AbortController()
    abortRef.current = ac
    const patch = (fn: (m: Msg) => Msg) => setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)))
    try {
      await streamCopilotQuery({ query, org_code: orgCode }, {
        onToken: (t) => patch((m) => ({ ...m, text: m.text + t })),
        onDone: () => patch((m) => ({ ...m, streaming: false })),
        onError: (msg) => patch(() => ({ role: 'assistant', text: msg, error: true })),
      }, ac.signal)
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void ask(input)
  }

  return (
    <aside aria-label="Copilot" aria-hidden={!open} inert={!open}
      className={cn('fixed inset-y-0 right-0 z-40 flex w-[min(24rem,100vw)] flex-col border-l border-line bg-ink-900 shadow-2xl transition-transform duration-200 motion-reduce:transition-none print:hidden',
        open ? 'translate-x-0' : 'translate-x-full')}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-aqua-500"><Sparkles className="h-4 w-4 text-white" /></span>
        <div className="flex-1"><div className="font-display text-sm font-semibold text-fg">Copilot</div><div className="text-xs text-ink-500">{isStudent ? 'Your study assistant' : 'Aggregated, read-only answers about your institution'}</div></div>
        <button ref={closeBtn} onClick={onClose} aria-label="Close Copilot" className="cursor-pointer rounded-lg p-1.5 text-ink-500 hover:bg-ink-800 hover:text-fg"><X className="h-4 w-4" /></button>
      </div>

      {user?.role === 'superadmin' && orgs && orgs.length > 0 && (
        <div className="shrink-0 border-b border-line px-4 py-2.5">
          <Select aria-label="Institution for Copilot" className="h-9 w-full text-sm" value={orgCode ?? ''} onChange={(e) => setOrgCode(e.target.value)}>
            {orgs.map((o) => <option key={o.org_code} value={o.org_code}>{o.org_name}</option>)}
          </Select>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <p className="flex items-start gap-2 rounded-xl border border-line bg-ink-800/50 p-3 text-ink-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          {isStudent
            ? "Copilot answers using only your own attendance, homework, timetable and results — never another student's data."
            : "Copilot answers from aggregated, anonymised views of your school's data through read-only queries. It never sees a child's name, answers or photos."}
        </p>
        {messages.length === 0 && (
          <div>
            {isStudent && <p className="mb-3 text-ink-300">Hi {user?.full_name?.split(' ')[0] ?? 'there'} 👋 Ask me about your attendance, homework, today's classes or recent results.</p>}
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
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn('rounded-xl px-3 py-2', m.role === 'user' ? 'ml-6 bg-brand-500/15 text-fg' : m.error ? 'border border-bad/30 bg-bad/10 text-bad' : 'border border-line bg-ink-800/40 text-ink-100')}>
            {m.text || (m.streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-500" /> : null)}
            {m.streaming && m.text && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-ink-500 align-middle" aria-hidden />}
            {m.error && !busy && (
              <button type="button" onClick={() => lastQuery.current && void ask(lastQuery.current)}
                className="mt-1.5 flex cursor-pointer items-center gap-1 text-xs font-medium text-bad underline-offset-2 hover:underline">
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-line p-3">
        <div className="relative">
          <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
            aria-label="Ask Copilot" placeholder={isStudent ? 'Ask about your studies…' : 'Ask about your institution…'}
            className="h-10 w-full rounded-xl border border-line bg-ink-800/50 px-3 pr-10 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-400/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60" />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send"
            className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-ink-500 hover:bg-ink-800 hover:text-fg disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </aside>
  )
}
