import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, CheckCircle2, CircleAlert, Library, Loader2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ProctorGate } from '@/components/proctoring/ProctorGate'
import { SubjectPicker } from '@/components/SubjectPicker'
import { AvatarTutor } from '@/components/pdf-avatar/AvatarTutor'
import { SplitScreenPDFReader } from '@/components/pdf-avatar/SplitScreenPDFReader'
import { useReadAloud, type ReadAloud } from '@/components/pdf-avatar/useReadAloud'
import { K3RagChatPanel } from '@/components/rag-chat/K3RagChatPanel'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { ErrorState, PageLoader, Skeleton } from '@/components/ui/loading'
import { loadAvatarModel } from '@/lib/avatarModel'
import { AVATAR_MODELS, hasWebGL, loadAvatar3D } from '@/lib/avatars'
import { useReadiness, type ReadinessSnapshot, type ReadinessStep, type StepState } from '@/lib/readiness'
import { cn } from '@/lib/utils'
import { curriculumService } from '@/services/curriculumService'
import { errorMessage } from '@/services/apiClient'
import type { Textbook } from '@/types'

/** The classroom shows once these are ready (or have timed out: the avatar then stays 2D, the page keeps preparing). */
function classroomSteps(reader: ReadAloud, page: number, onModel: (url: string | null) => void): ReadinessStep[] {
  let gender: 'male' | 'female' = 'female'
  return [
    { id: 'voice', label: "Getting your teacher's voice ready", timeoutMs: 8_000,
      run: async () => { gender = (await reader.whenVoice()).voice } },
    { id: 'avatar', label: 'Loading your 3D teacher', weight: 4, after: ['voice'], timeoutMs: 20_000,
      run: async ({ progress }) => {
        const url = AVATAR_MODELS[gender]
        if (!url || !hasWebGL()) { onModel(null); return }       // no 3D model for this voice: the 2D avatar
        const [model] = await Promise.all([loadAvatarModel(url, progress), loadAvatar3D()])
        onModel(model)
      } },
    { id: 'script', label: `Preparing the explanation of page ${page}`, weight: 2, timeoutMs: 15_000,
      run: () => reader.loadScript(page) },
    { id: 'audio', label: 'Voicing the first words', after: ['voice', 'script'], timeoutMs: 12_000, run: () => reader.preload(page) },
  ]
}

/** Student classroom: split-screen textbook PDF (left) + AI avatar tutor that explains the open page aloud
 * (top-right) + k=3 RAG chat (bottom-right). A proctored AI Classroom session per subject (unified proctoring gate);
 * switching subject or leaving the page closes it. On entry a loader prepares the avatar, its voice and the first
 * page before the classroom appears. */
export default function AvatarSubjectClassroom() {
  const { subject } = useAuth()
  if (!subject) return <Empty title="No subjects assigned" body="Ask your teacher to enrol you in a subject." />
  return (
    <ProctorGate key={subject} module="AI_CLASSROOM" refId={`textbook/${subject}`} title={`${subject} textbook classroom`}
      startLabel="Start classroom session" beginLabel="Begin session"
      intro={<div className="flex items-center gap-3"><BookOpen className="h-6 w-6 text-brand-600" /><div><h1 className="font-display text-xl font-bold text-fg">Textbook classroom</h1>
        <p className="text-sm text-ink-300">Your {subject} textbook with the AI avatar tutor and page-aware chat.</p></div><SubjectPicker className="ml-auto w-44" /></div>}>
      <TextbookClassroom subject={subject} />
    </ProctorGate>
  )
}

function TextbookClassroom({ subject }: { subject: string }) {
  const [books, setBooks] = useState<Textbook[] | null>(null)
  const [bookId, setBookId] = useState<string>('')
  const [page, setPage] = useState(1)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [model, setModel] = useState<string | null | undefined>(undefined)
  const [entered, setEntered] = useState(false)
  const enteredRef = useRef(false)

  useEffect(() => {
    if (!subject) return
    let alive = true
    setBooks(null); setError(null)
    curriculumService.listTextbooks(subject)
      .then((b) => { if (!alive) return; const ready = b.filter((x) => x.vector_status === 'indexed'); setBooks(ready); setBookId(ready[0]?.textbook_id ?? ''); setPage(1); setHighlight(null) })
      .catch((e) => alive && setError(errorMessage(e)))
    return () => { alive = false }
  }, [subject, reload])

  const book = books?.find((b) => b.textbook_id === bookId)
  const turnPage = useCallback((p: number) => { setPage(p); setHighlight(null) }, [])
  const reader = useReadAloud(book?.textbook_id ?? '', turnPage, page)
  const { followPage } = reader
  const jump = useCallback((p: number, snippet?: string) => { setPage(p); setHighlight(snippet ?? null); followPage(p) }, [followPage])
  // While the tutor speaks, the PDF highlights what it is talking about: the key point's words when explaining,
  // the sentence when reading word for word.
  const tutorHighlight = reader.reading && reader.page === page
    ? (reader.mode === 'explain' ? reader.segment?.quote : reader.text) ?? null
    : null

  const enter = useCallback(() => { enteredRef.current = true; setEntered(true) }, [])
  // The avatar is prepared once, on the way in; a late model after the student skipped ahead is not swapped in.
  const onModel = useCallback((url: string | null) => { if (!enteredRef.current) setModel(url) }, [])
  const readiness = useReadiness(() => (book && !enteredRef.current ? classroomSteps(reader, page, onModel) : null), [book?.textbook_id])
  useEffect(() => {
    if (!readiness?.settled || enteredRef.current) return
    if (readiness.steps.find((s) => s.id === 'avatar')?.state !== 'done') setModel(null)   // 2D avatar instead
    enter()
  }, [readiness, enter])

  if (error) return <div className="mx-auto max-w-xl p-8"><ErrorState title="Couldn't load your library" message={error} onRetry={() => setReload((n) => n + 1)} /></div>
  if (books && !book) return <Empty title={`No textbook published for ${subject} yet`} body="Your teacher hasn't published a chapter for this subject. Check back soon." action={<SubjectPicker className="mx-auto mt-4 w-48" />} />
  // One loader from "finding your textbook" to "first page ready", so it never flickers between phases.
  if (!books || !book || !entered) return <ClassroomLoader readiness={books ? readiness : null} onSkip={books ? enter : undefined} />

  return (
    <div className="flex h-full min-h-[34rem] flex-col gap-3 p-4 md:p-6 animate-fade-up">
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
            <Suspense fallback={<Skeleton className="m-4 h-[60vh]" />}>
              <SplitScreenPDFReader url={book.pdf_url} page={page} onPageChange={(p) => jump(p)} highlight={tutorHighlight ?? highlight} />
            </Suspense>
          </ErrorBoundary>
        </Card>
        <div className="flex min-h-0 flex-col gap-4">
          <Card className="shrink-0 overflow-hidden" aria-label="AI avatar tutor"><AvatarTutor reader={reader} page={page} modelUrl={model} /></Card>
          <Card className="min-h-[16rem] flex-1 overflow-hidden"><K3RagChatPanel subject={subject} textbookId={book.textbook_id} currentPage={page} onJump={jump} /></Card>
        </div>
      </div>
    </div>
  )
}

const STEP_ICON: Partial<Record<StepState, typeof Loader2>> = { running: Loader2, done: CheckCircle2, failed: CircleAlert, timeout: CircleAlert, skipped: CircleAlert }

/** Entry loader: what is being prepared, with real progress (the 3D model's download counts most). */
function ClassroomLoader({ readiness, onSkip }: { readiness: ReadinessSnapshot | null; onSkip?: () => void }) {
  const [canSkip, setCanSkip] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setCanSkip(true), 5000)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <PageLoader message="Getting your AI classroom ready…"
      detail={readiness ? "Your teacher's avatar, voice and the first page are being prepared." : 'Finding your textbook…'}
      progress={readiness?.progress ?? 0} slowAfterMs={15_000} className="min-h-[70vh]">
      <ul className="mt-4 space-y-1.5 text-left text-xs" aria-label="Classroom preparation">
        {(readiness?.steps ?? []).map((s) => {
          const Icon = STEP_ICON[s.state]
          return (
            <li key={s.id} data-state={s.state} className={cn('flex items-center gap-2', s.state === 'done' ? 'text-fg' : 'text-ink-300')}>
              {Icon ? <Icon className={cn('h-3.5 w-3.5 shrink-0', s.state === 'running' && 'animate-spin text-brand-400', s.state === 'done' && 'text-ok',
                (s.state === 'failed' || s.state === 'timeout' || s.state === 'skipped') && 'text-warn')} aria-hidden />
                : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-line" aria-hidden />}
              <span>{s.label}{s.state === 'running' && s.id === 'avatar' && s.progress > 0 ? ` · ${Math.round(s.progress * 100)}%` : ''}
                {s.id === 'avatar' && (s.state === 'failed' || s.state === 'timeout') ? ' · using the 2D avatar' : ''}
                {s.id !== 'avatar' && s.state === 'timeout' ? ' · continuing in the background' : ''}</span>
            </li>
          )
        })}
      </ul>
      {canSkip && onSkip && <Button size="sm" variant="ghost" className="mt-3" onClick={onSkip}>Open the classroom now</Button>}
    </PageLoader>
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
