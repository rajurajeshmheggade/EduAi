import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight, BookOpenText, FastForward, GraduationCap, Highlighter, Library, MessageSquareText, ShieldCheck, SlidersHorizontal, Volume2,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label, Select } from '@/components/ui/field'
import { ErrorState, Skeleton } from '@/components/ui/loading'
import { classroomLink, readyTextbooks } from '@/lib/classroomLink'
import { useAsync } from '@/lib/useAsync'
import { curriculumService } from '@/services/curriculumService'
import type { Textbook } from '@/types'

/** One choice in the chapter dropdown: a detected chapter, or "Start from page 1" for a book without chapters. */
interface ChapterChoice { value: string; textbook: Textbook; page: number; label: string; chapter: string | null }

function chapterChoices(books: Textbook[]): ChapterChoice[] {
  return books.flatMap((textbook): ChapterChoice[] => textbook.chapters.length
    ? textbook.chapters.map((c) => ({
      value: `${textbook.textbook_id}:${c.chapter_number}`, textbook, page: Math.max(1, c.first_page),
      label: `${c.chapter_number}. ${c.chapter_title} · p. ${c.first_page}`, chapter: `Chapter ${c.chapter_number} · ${c.chapter_title}`,
    }))
    : [{ value: `${textbook.textbook_id}:start`, textbook, page: 1, label: 'Start from page 1', chapter: null }])
}

/** The student's subjects that have a published, indexed textbook, with those books. */
async function loadLibrary(subjects: string[]): Promise<{ subject: string; books: Textbook[] }[]> {
  const all = await Promise.all(subjects.map(async (subject) => ({ subject, books: readyTextbooks(await curriculumService.listTextbooks(subject)) })))
  return all.filter((s) => s.books.length > 0)
}

const STEPS = [
  { icon: Volume2, title: 'Explains every page aloud', body: 'Your AI teacher explains the open page in simple words — a talking avatar whose lips move with the voice.' },
  { icon: Highlighter, title: 'Highlights as it speaks', body: 'The words being explained light up on the textbook page, so you can follow along.' },
  { icon: FastForward, title: 'The next page is already prepared', body: 'While you listen, the next page is prepared in the background, so moving on needs no waiting.' },
  { icon: MessageSquareText, title: 'Ask in the chat', body: 'Type any doubt in the chat under the avatar. Answers come from your textbook, with page links you can jump to.' },
  { icon: SlidersHorizontal, title: 'You are in control', body: 'Previous / Next to move between parts and pages, Pause / Resume any time, change the speed, or switch to Word for word to hear the page read exactly as written.' },
  { icon: ShieldCheck, title: 'A classroom session starts first', body: 'After OK you start a classroom session. If your school proctors it, you see the rules and check your camera before the lesson begins — only flags reach your teacher, never video, photos or audio. Leaving the page ends the session.' },
] as const

/**
 * AI Classroom home: the student's own class is implied, so only a Subject and a Chapter dropdown (chapters of the
 * teacher-uploaded textbooks), an explanation of how the avatar teaches, and OK — which opens the avatar classroom on
 * that textbook at the chapter's first page.
 */
export default function AiClassroomHome() {
  const { user, subject: workspace, setSubject } = useAuth()
  const nav = useNavigate()
  const subjects = user?.allowed_subjects ?? []
  const lib = useAsync(() => loadLibrary(subjects), [subjects.join('|')])
  const [pickedSubject, setPickedSubject] = useState('')
  const [pickedChapter, setPickedChapter] = useState('')

  const library = lib.data ?? []
  const current = library.find((s) => s.subject === pickedSubject) ?? library.find((s) => s.subject === workspace) ?? library[0]
  const choices = current ? chapterChoices(current.books) : []
  const choice = choices.find((c) => c.value === pickedChapter) ?? choices[0]
  const grouped = (current?.books.length ?? 0) > 1

  function open() {
    if (!current || !choice) return
    setSubject(current.subject)
    nav(classroomLink({ subject: current.subject, textbookId: choice.textbook.textbook_id, page: choice.page }))
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <p className="flex items-center gap-1.5 text-sm text-ink-300"><MessageSquareText className="h-4 w-4" /> AI Classroom</p>
        <h1 className="mt-1 font-display text-3xl font-bold">Learn with your <span className="text-gradient">AI teacher</span></h1>
        <p className="mt-1 text-sm text-ink-300">Pick a subject and a chapter from your textbook, read how the lesson works, then press OK.</p>
      </header>

      {subjects.length === 0 ? (
        <Notice title="No subjects assigned yet" body="Ask your teacher to enrol you in a subject — your textbooks will appear here." />
      ) : lib.error ? (
        <ErrorState title="Couldn't load your textbooks" message={lib.error} onRetry={lib.retry} />
      ) : !lib.data ? (
        <Card className="space-y-4 p-5" aria-busy="true">
          <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          <Skeleton className="h-56" />
        </Card>
      ) : !current || !choice ? (
        <Notice title="No textbooks yet"
          body="Your teacher hasn't published a textbook for your subjects yet. Once they do, you can pick a chapter here and learn with your AI teacher." />
      ) : (
        <Card className="space-y-5 p-5 animate-fade-up">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ac-subject">Subject</Label>
              <Select id="ac-subject" value={current.subject} onChange={(e) => { setPickedSubject(e.target.value); setPickedChapter('') }}>
                {library.map((s) => <option key={s.subject} value={s.subject}>{s.subject}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="ac-chapter">Chapter</Label>
              <Select id="ac-chapter" value={choice.value} onChange={(e) => setPickedChapter(e.target.value)}>
                {grouped
                  ? current.books.map((b) => (
                    <optgroup key={b.textbook_id} label={b.title}>
                      {choices.filter((c) => c.textbook === b).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </optgroup>
                  ))
                  : choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </div>
          </div>

          <p className="flex items-start gap-2 text-sm text-ink-300" id="ac-selection">
            <BookOpenText className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>
              {choice.chapter
                ? <>You start at <b className="text-fg">{choice.chapter}</b> (page {choice.page}) of <b className="text-fg">{choice.textbook.title}</b>.</>
                : <>Chapters weren't detected in <b className="text-fg">{choice.textbook.title}</b>, so you start from page 1 — you can turn to any page in the classroom.</>}
            </span>
          </p>

          <section aria-labelledby="ac-how" className="rounded-2xl border border-line bg-ink-800/40 p-4">
            <h2 id="ac-how" className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-fg">
              <GraduationCap className="h-5 w-5 text-brand-600" /> How your AI teacher will teach
            </h2>
            <ol className="grid gap-3 sm:grid-cols-2">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="flex gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600" aria-hidden><Icon className="h-4 w-4" /></span>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-fg"><span className="sr-only">Step {i + 1}: </span>{title}</p>
                    <p className="text-ink-300">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-ink-500">Opens the avatar classroom</span>
            <Button size="lg" className="min-w-32" id="ai-classroom-ok" aria-describedby="ac-selection" onClick={open}>OK <ArrowRight className="h-4 w-4" /></Button>
          </div>
        </Card>
      )}
    </div>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Card className="grid place-items-center p-10 text-center animate-fade-up">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-ink-800 ring-1 ring-line"><Library className="h-7 w-7 text-ink-300" /></div>
        <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
        <p className="mt-1 text-sm text-ink-300">{body}</p>
      </div>
    </Card>
  )
}
