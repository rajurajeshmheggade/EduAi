import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, Loader2, SendHorizonal, Sparkles, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { parseCitations } from '@/lib/citations'
import { streamRagQuery } from '@/services/ragAvatarService'
import type { Citation } from '@/types'
import { PageCitationBadge } from './PageCitationBadge'
import { VoiceQueryButton } from './VoiceQueryButton'

interface Msg { id: number; role: 'user' | 'ai'; text: string; citations?: Citation[]; streaming?: boolean; error?: boolean }

const SUGGESTIONS = ['Explain this page in simple words', 'Why does this happen?', 'Give me a real-life example']

export function K3RagChatPanel({ subject, textbookId, currentPage, onJump }: {
  subject: string
  textbookId?: string
  currentPage?: number
  onJump: (page: number, snippet?: string) => void
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const session = useRef<string | undefined>(undefined)
  const abort = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs])
  useEffect(() => () => abort.current?.abort(), [])
  // New subject/textbook = new conversation
  useEffect(() => { setMsgs([]); session.current = undefined }, [subject, textbookId])

  async function ask(q: string) {
    const query = q.trim()
    if (query.length < 2 || busy) return
    const aiId = ++seq.current + 1000
    setMsgs((m) => [...m, { id: ++seq.current, role: 'user', text: query }, { id: aiId, role: 'ai', text: '', streaming: true }])
    setInput('')
    setBusy(true)
    abort.current = new AbortController()
    const patch = (p: Partial<Msg>) => setMsgs((m) => m.map((x) => (x.id === aiId ? { ...x, ...p } : x)))
    try {
      let text = ''
      await streamRagQuery(
        { query, subject_code: subject, textbook_id: textbookId, current_page: currentPage, session_id: session.current },
        {
          onMeta: (meta) => { session.current = meta.session_id; patch({ citations: meta.citations }) },
          onToken: (t) => { text += t; patch({ text }) },
          onDone: () => patch({ streaming: false }),
          onError: (msg) => patch({ text: msg, streaming: false, error: true }),
        },
        abort.current.signal,
      )
      patch({ streaming: false })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patch({ text: 'Connection lost. Please try again.', streaming: false, error: true })
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); void ask(input) }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {msgs.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div className="max-w-xs animate-fade-up">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/30 to-aqua-500/30 ring-1 ring-line">
                <Sparkles className="h-6 w-6 text-brand-300" />
              </div>
              <h3 className="font-display text-base font-semibold text-fg">Ask anything about {subject}</h3>
              <p className="mt-1 text-sm text-ink-300">Answers come only from your textbook, with page citations you can click.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => ask(s)} className="cursor-pointer rounded-full border border-line bg-ink-800 px-3 py-1 text-xs text-ink-300 transition-colors hover:border-brand-400/40 hover:text-fg">{s}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {msgs.map((m) => (
          <div key={m.id} className={`flex gap-3 animate-fade-up ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${m.role === 'user' ? 'bg-brand-600' : 'bg-gradient-to-br from-aqua-500 to-brand-500'}`}>
              {m.role === 'user' ? <User className="h-4 w-4 text-white" /> : <Bot className="h-4 w-4 text-white" />}
            </div>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === 'user' ? 'bg-brand-600 text-white' : m.error ? 'border border-bad/30 bg-bad/10 text-bad' : 'border border-line bg-ink-800/80 text-ink-100'}`}>
              {m.role === 'ai' && !m.text && m.streaming ? (
                <span className="inline-flex items-center gap-2 text-ink-300"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching your textbook…</span>
              ) : (
                <div className="whitespace-pre-wrap">
                  {parseCitations(m.text).map((s, i) => s.type === 'text'
                    ? <span key={i}>{s.text}</span>
                    : <PageCitationBadge key={i} page={s.page} onJump={(p) => onJump(p, m.citations?.find((c) => c.page_number === p)?.snippet)} />)}
                  {m.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-aqua-400 align-middle" />}
                </div>
              )}
              {m.citations && m.citations.length > 0 && !m.streaming && (
                <div className="mt-3 border-t border-line pt-2">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-500">Top {m.citations.length} sources</div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.citations.map((c) => (
                      <button key={c.chunk_id} onClick={() => onJump(c.page_number, c.snippet)}
                        className="cursor-pointer rounded-lg border border-line bg-ink-900/60 px-2 py-1 text-left text-[11px] text-ink-300 transition-colors hover:border-aqua-400/40"
                        title={c.snippet}>
                        <span className="font-semibold text-aqua-400">p.{c.page_number}</span> · {c.chapter_title ?? 'Untitled'}
                        <span className="ml-1 text-ink-500">{Math.round(c.similarity * 100)}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-line p-3">
        <Input id="rag-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Ask a question about ${subject}…`} maxLength={2000} disabled={busy} aria-label="Your question" />
        <VoiceQueryButton disabled={busy} onText={(t) => { setInput(t); void ask(t) }} />
        <Button id="rag-send" type="submit" size="icon" disabled={busy || input.trim().length < 2} aria-label="Send question">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
        </Button>
      </form>
    </div>
  )
}
