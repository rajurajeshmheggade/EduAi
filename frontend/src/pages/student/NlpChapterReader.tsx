import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Bot, CheckCircle2, Loader2, MessageCircleQuestion, Sparkles } from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SplitScreenPDFReader } from '@/components/pdf-avatar/SplitScreenPDFReader'
import { LiveCameraCheck } from '@/components/proctor/LiveCameraCheck'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { ErrorState, PageLoader } from '@/components/ui/loading'
import { RequestCache } from '@/lib/requestCache'
import { cn } from '@/lib/utils'
import { aiClassroomService, type ChatTurn } from '@/services/aiClassroomService'
import { errorMessage } from '@/services/apiClient'

const EXPLANATIONS_KEPT = 8

/**
 * AI Classroom's chapter-library reader: the chapter PDF (backend/nlp/) on the left, on the right a live camera
 * check, an auto-prepared explanation of the current page (queued one page ahead so it's ready when the
 * student turns the page), and a chat grounded in whatever page is currently open. Explanations are kept in a
 * bounded cache (one request per page, shared by the prefetch and the page itself; the server caches them too), and
 * unfinished requests for pages the student jumped away from are cancelled.
 */
export default function NlpChapterReader() {
  const { classLabel = '', subject = '', chapter = '' } = useParams()
  const cls = decodeURIComponent(classLabel)
  const subj = decodeURIComponent(subject)
  const ch = decodeURIComponent(chapter)

  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [page, setPage] = useState(1)

  useEffect(() => {
    let obj: string | null = null
    const ctl = new AbortController()
    setPdfUrl(null); setError(null)
    aiClassroomService.chapterPdf(cls, subj, ch, ctl.signal).then((blob) => { obj = URL.createObjectURL(blob); setPdfUrl(obj) })
      .catch((e) => { if (!ctl.signal.aborted) setError(errorMessage(e)) })
    return () => { ctl.abort(); if (obj) URL.revokeObjectURL(obj) }
  }, [cls, subj, ch, reload])

  // Explanation of the current page, prepared ahead of time: as soon as a page is shown, the *next* page's
  // explanation is queued in the background too, so it is usually already there by the time the student turns to it.
  const [explanations] = useState(() => new RequestCache<string>(EXPLANATIONS_KEPT))
  const [explain, setExplain] = useState<{ page: number; text: string; failed?: boolean } | null>(null)
  const [nextReady, setNextReady] = useState<number | null>(null)
  const [retryExplain, setRetryExplain] = useState(0)

  useEffect(() => { explanations.clear() }, [cls, subj, ch, explanations])

  useEffect(() => {
    let alive = true
    // An AI hiccup comes back as a polite fallback: not cached, so the retry (or the next visit) asks again.
    const fetchExplain = (p: number) => explanations.get(String(p), (signal) => aiClassroomService.explain(cls, subj, ch, p, signal)
      .then((r) => (r.engine === 'offline-fallback' ? Promise.reject(new Error(r.explanation)) : r.explanation)))
    // A short pause first, so flipping through pages doesn't ask the AI about every page passed on the way.
    const timer = window.setTimeout(() => {
      explanations.retain((k) => k === String(page) || k === String(page + 1))  // the student moved on: cancel the rest
      fetchExplain(page).then((text) => { if (alive) setExplain({ page, text }) })
        .catch((e) => { if (alive) setExplain({ page, text: errorMessage(e), failed: true }) })
      fetchExplain(page + 1).then(() => { if (alive) setNextReady(page + 1) }).catch(() => {})   // queued, result just cached
    }, explanations.ready(String(page)) ? 0 : 250)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [page, cls, subj, ch, explanations, retryExplain])
  const explainBusy = explain?.page !== page

  return (
    <div className="mx-auto max-w-[96rem] space-y-4 p-4 md:p-6">
      <header className="flex items-start gap-3">
        <Link to="/student/classroom" className="mt-1 rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-fg" aria-label="Back to AI Classroom"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{subj} · {cls.length <= 3 ? `Class` : cls}</div>
          <h1 className="truncate font-display text-xl font-bold text-fg">{ch}</h1>
        </div>
      </header>

      {error && <ErrorState title="Couldn't open this chapter" message={error} onRetry={() => setReload((n) => n + 1)} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(22rem,1fr)]">
        <Card className="min-h-[70vh] p-0">
          {!pdfUrl ? !error && <PageLoader message="Opening the chapter…" className="h-[70vh]" /> : (
            <ErrorBoundary title="Could not display this chapter's PDF">
              <SplitScreenPDFReader url={pdfUrl} page={page} onPageChange={setPage} />
            </ErrorBoundary>
          )}
        </Card>

        <div className="min-w-0 space-y-3">
          <LiveCameraCheck title="AI Classroom camera check" />

          <Card className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Sparkles className="h-4 w-4 text-brand-600" /> This page, explained</div>
            {explainBusy ? (
              <p className="flex items-center gap-2 text-sm text-ink-300"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing page {page}…</p>
            ) : explain?.failed ? (
              <ErrorState title="Couldn't explain this page" message={explain.text} onRetry={() => setRetryExplain((n) => n + 1)} />
            ) : (
              <p className="whitespace-pre-line text-sm text-ink-100">{explain?.text}</p>
            )}
            {nextReady === page + 1 && (
              <p className="flex items-center gap-1 text-[11px] text-ok"><CheckCircle2 className="h-3 w-3" aria-hidden /> Page {page + 1} is ready</p>
            )}
          </Card>

          <ChapterChat classLabel={cls} subject={subj} chapter={ch} page={page} />
        </div>
      </div>
    </div>
  )
}

function ChapterChat({ classLabel, subject, chapter, page }: { classLabel: string; subject: string; chapter: string; page: number }) {
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  async function ask(e: FormEvent) {
    e.preventDefault()
    const question = q.trim()
    if (question.length < 2) return
    const history = messages
    setMessages([...history, { role: 'user', content: question }]); setQ(''); setBusy(true)
    try {
      const r = await aiClassroomService.ask(classLabel, subject, chapter, page, question, history.slice(-6))
      setMessages((m) => [...m, { role: 'assistant', content: r.answer }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: errorMessage(err) }])
    } finally {
      setBusy(false)
      window.setTimeout(() => end.current?.scrollIntoView?.({ block: 'nearest' }), 0)
    }
  }

  return (
    <Card className="flex min-h-[20rem] flex-col p-0">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3"><Bot className="h-4 w-4 text-brand-600" /><span className="font-medium text-fg">Ask about this page</span>
        <span className="text-xs text-ink-500">page {page}</span></div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {messages.length === 0 && <p className="text-xs text-ink-500">Ask anything about what's on this page — the AI reads it along with you.</p>}
        {messages.map((m, i) => (
          <p key={i} className={cn('max-w-[90%] whitespace-pre-line rounded-xl px-3 py-2 text-sm', m.role === 'user' ? 'ml-auto bg-brand-500/15 text-fg' : 'bg-ink-800 text-ink-100')}>{m.content}</p>
        ))}
        {busy && <p className="flex items-center gap-2 text-xs text-ink-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</p>}
        <div ref={end} />
      </div>
      <form onSubmit={ask} className="flex gap-2 border-t border-line p-3">
        <Input aria-label="Question about this page" placeholder="Ask about this page" maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" size="icon" aria-label="Ask" disabled={busy || q.trim().length < 2}><MessageCircleQuestion className="h-4 w-4" /></Button>
      </form>
    </Card>
  )
}
