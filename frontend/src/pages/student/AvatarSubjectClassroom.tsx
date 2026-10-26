import { Suspense, useCallback, useEffect, useState } from 'react'
import { BookOpen, Library } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SubjectPicker } from '@/components/SubjectPicker'
import { AIAvatarCanvas } from '@/components/pdf-avatar/AIAvatarCanvas'
import { SplitScreenPDFReader } from '@/components/pdf-avatar/SplitScreenPDFReader'
import { K3RagChatPanel } from '@/components/rag-chat/K3RagChatPanel'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { curriculumService } from '@/services/curriculumService'
import { errorMessage } from '@/services/apiClient'
import type { Textbook } from '@/types'

/** Student classroom: split-screen textbook PDF (left) + AI avatar (top-right) + k=3 RAG chat (bottom-right). */
export default function AvatarSubjectClassroom() {
  const { subject } = useAuth()
  const [books, setBooks] = useState<Textbook[] | null>(null)
  const [bookId, setBookId] = useState<string>('')
  const [page, setPage] = useState(1)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!subject) return
    let alive = true
    setBooks(null); setError(null)
    curriculumService.listTextbooks(subject)
      .then((b) => { if (!alive) return; const ready = b.filter((x) => x.vector_status === 'indexed'); setBooks(ready); setBookId(ready[0]?.textbook_id ?? ''); setPage(1); setHighlight(null) })
      .catch((e) => alive && setError(errorMessage(e)))
    return () => { alive = false }
  }, [subject])

  const book = books?.find((b) => b.textbook_id === bookId)
  const jump = useCallback((p: number, snippet?: string) => { setPage(p); setHighlight(snippet ?? null) }, [])

  if (!subject) return <Empty title="No subjects assigned" body="Ask your teacher to enrol you in a subject." />
  if (error) return <Empty title="Couldn't load your library" body={error} />
  if (!books) return <div className="p-8"><div className="skeleton h-[70vh]" /></div>
  if (!book) return <Empty title={`No textbook published for ${subject} yet`} body="Your teacher hasn't published a chapter for this subject. Check back soon." action={<SubjectPicker className="mx-auto mt-4 w-48" />} />

  return (
    <div className="flex h-full min-h-[34rem] flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto flex items-center gap-2 font-display text-xl font-semibold text-fg"><BookOpen className="h-5 w-5 text-brand-300" /> {book.title}</h1>
        <SubjectPicker />
        {books.length > 1 && (
          <Select aria-label="Textbook" className="w-56" value={bookId} onChange={(e) => { setBookId(e.target.value); setPage(1); setHighlight(null) }}>
            {books.map((b) => <option key={b.textbook_id} value={b.textbook_id}>{b.title}</option>)}
          </Select>
        )}
        {book.chapters.length > 0 && (
          <Select aria-label="Jump to chapter" id="chapter-jump" className="w-60" value="" onChange={(e) => { if (e.target.value) jump(Number(e.target.value)) }}>
            <option value="">Jump to chapter…</option>
            {book.chapters.map((c) => <option key={c.chapter_number} value={c.first_page}>{c.chapter_number}. {c.chapter_title}</option>)}
          </Select>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card className="min-h-[30rem] overflow-hidden">
          {/* Contain PDF loading/errors to this pane so they never re-suspend or blank the whole page. */}
          <ErrorBoundary title="The textbook couldn't be displayed" key={book.textbook_id}>
            <Suspense fallback={<div className="skeleton m-4 h-[60vh]" />}>
              <SplitScreenPDFReader url={book.pdf_url} page={page} onPageChange={(p) => jump(p)} highlight={highlight} />
            </Suspense>
          </ErrorBoundary>
        </Card>
        <div className="grid min-h-0 grid-rows-[11rem_minmax(22rem,1fr)] gap-4">
          <Card className="overflow-hidden"><AIAvatarCanvas caption={`Ask me about ${book.title}`} /></Card>
          <Card className="min-h-0 overflow-hidden"><K3RagChatPanel subject={subject} textbookId={book.textbook_id} currentPage={page} onJump={jump} /></Card>
        </div>
      </div>
    </div>
  )
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-sm text-center animate-fade-up">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-ink-800 ring-1 ring-line"><Library className="h-7 w-7 text-ink-300" /></div>
        <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
        <p className="mt-1 text-sm text-ink-300">{body}</p>
        {action}
      </div>
    </div>
  )
}
