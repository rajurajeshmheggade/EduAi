import { useCallback, useEffect, useRef, useState } from 'react'
import { BookCheck, Eye, EyeOff, FileText, Loader2, Library } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { SubjectPicker } from '@/components/SubjectPicker'
import { TeachingGuidePanel } from '@/components/curriculum/TeachingGuidePanel'
import { TextbookUploader } from '@/components/curriculum/TextbookUploader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage } from '@/services/apiClient'
import { curriculumService } from '@/services/curriculumService'
import type { Textbook, VectorStatus } from '@/types'

const STATUS: Record<VectorStatus, { label: string; tone: 'neutral' | 'warn' | 'ok' | 'bad' }> = {
  pending: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Indexing…', tone: 'warn' },
  indexed: { label: 'Indexed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
}

/** Teacher App 2: textbook upload, vector status, publish toggle, and the AI "How to Teach" planner. */
export default function TextbookHowToTeach() {
  const { user, subject } = useAuth()
  const [books, setBooks] = useState<Textbook[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    if (!subject) return
    try {
      const b = await curriculumService.listTextbooks(subject)
      setBooks(b)
      setSelected((s) => (s && b.some((x) => x.textbook_id === s) ? s : b.find((x) => x.vector_status === 'indexed')?.textbook_id ?? null))
      setError(null)
    } catch (e) { setError(errorMessage(e)) }
  }, [subject])

  useEffect(() => { setBooks(null); setSelected(null); void load() }, [load])

  // Poll while anything is still being vectorized so statuses update without a refresh.
  useEffect(() => {
    window.clearInterval(timer.current)
    if (books?.some((b) => b.vector_status === 'pending' || b.vector_status === 'processing')) {
      timer.current = window.setInterval(() => void load(), 2500)
    }
    return () => window.clearInterval(timer.current)
  }, [books, load])

  async function togglePublish(b: Textbook) {
    setPublishing(b.textbook_id)
    try { await curriculumService.publish(b.textbook_id, !b.is_published_to_students); await load() }
    catch (e) { setError(errorMessage(e)) }
    finally { setPublishing(null) }
  }

  if (!user || !subject) return <div className="p-8 text-ink-300">No subject assigned to your account.</div>
  const current = books?.find((b) => b.textbook_id === selected)

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
        <h1 className="font-display text-3xl font-bold text-fg">Textbooks & <span className="text-gradient">How to Teach</span></h1>
        <p className="mt-1 text-sm text-ink-300">Upload a textbook for <b className="text-fg">{subject}</b>, let EduAI index it, then generate chapter teaching guides and publish to students.</p>
        </div>
        <SubjectPicker />
      </header>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Upload textbook</CardTitle><CardDescription>Chunked into 600-token passages and stored in pgvector.</CardDescription></CardHeader>
            <CardContent><TextbookUploader subject={subject} year={user.year_code} cycle={user.cycle_code} klass={user.class_code} onIndexed={() => void load()} /></CardContent></Card>

          <Card>
            <CardHeader><CardTitle>Library</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {books === null && <div className="skeleton h-16" />}
              {books?.length === 0 && <p className="flex items-center gap-2 py-4 text-sm text-ink-300"><Library className="h-4 w-4" /> No textbooks yet for {subject}.</p>}
              {books?.map((b) => {
                const st = STATUS[b.vector_status]
                const active = b.textbook_id === selected
                return (
                  <div key={b.textbook_id}
                    className={`rounded-xl border p-3 transition-all ${active ? 'border-brand-400/50 bg-brand-500/10' : 'border-line bg-ink-900/40 hover:border-line-strong'}`}>
                    <button className="flex w-full cursor-pointer items-start gap-3 text-left disabled:cursor-default" disabled={b.vector_status !== 'indexed'} onClick={() => setSelected(b.textbook_id)}>
                      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand-300" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-fg">{b.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone={st.tone}>{(b.vector_status === 'processing' || b.vector_status === 'pending') && <Loader2 className="h-3 w-3 animate-spin" />}{st.label}</Badge>
                          {b.total_pages > 0 && <span className="text-xs text-ink-500">{b.total_pages} pages · {b.chapters.length} chapters</span>}
                        </div>
                      </div>
                    </button>
                    {b.vector_status === 'indexed' && (
                      <Button size="sm" variant={b.is_published_to_students ? 'outline' : 'secondary'} className="mt-3 w-full" disabled={publishing === b.textbook_id}
                        onClick={() => togglePublish(b)} id={`publish-${b.textbook_id}`}>
                        {publishing === b.textbook_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : b.is_published_to_students ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {b.is_published_to_students ? 'Published — click to unpublish' : 'Publish to students'}
                      </Button>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <Card className="p-5 md:p-6">
          {current ? (
            <>
              <div className="mb-5 flex items-center gap-2"><BookCheck className="h-5 w-5 text-aqua-400" /><h2 className="font-display text-lg font-semibold text-fg">How to teach: {current.title}</h2></div>
              <TeachingGuidePanel book={current} defaultLevel={user.institution_level} />
            </>
          ) : (
            <div className="grid min-h-80 place-items-center text-center text-sm text-ink-300">
              <div><Library className="mx-auto mb-3 h-10 w-10 text-ink-500" />Upload a textbook and wait for it to finish indexing,<br />then pick it from the library to plan your lessons.</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
