import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpen, ClipboardList, FolderUp, Layers, Loader2, MonitorCheck, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { curriculumService } from '@/services/curriculumService'
import { evaluationService } from '@/services/evaluationService'
import { fromLocalInput, toLocalInput } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import type { AssessmentType, EvalScope, EvalTest, TeacherClass, Textbook } from '@/types'

const TYPES: { id: AssessmentType; title: string; desc: string; icon: typeof FolderUp }[] = [
  { id: 'ONLINE_TEST', title: 'Online test', desc: 'Students answer in a timed test on their device', icon: MonitorCheck },
  { id: 'ASSIGNMENT', title: 'Assignment', desc: 'Students upload a PDF of their written answers', icon: ClipboardList },
  { id: 'OFFLINE_EXAM', title: 'Offline exam', desc: 'You upload a folder of scanned answer scripts', icon: FolderUp },
]


/** FR-EV-01 / FR-TST-01 / FR-ASG-01: what is assessed, how students take it, and when. */
export function NewTestDialog({ classes, initialType = 'ONLINE_TEST', lockType = false, onClose, onCreated }: {
  classes: TeacherClass[]; initialType?: AssessmentType; lockType?: boolean; onClose: () => void; onCreated: (t: EvalTest) => void
}) {
  const [kind, setKind] = useState<AssessmentType>(initialType)
  const [klass, setKlass] = useState(classes[0]?.class_code ?? '')
  const cls = classes.find((c) => c.class_code === klass)
  const [subject, setSubject] = useState(cls?.subjects[0]?.subject_code ?? '')
  const [scope, setScope] = useState<EvalScope>('CHAPTER_LEVEL')
  const [books, setBooks] = useState<Textbook[] | null>(null)
  const [chapter, setChapter] = useState('')
  const [manualChapter, setManualChapter] = useState('')
  const [title, setTitle] = useState('')
  const [examDate, setExamDate] = useState('')
  const [pass, setPass] = useState(40)
  const [instructions, setInstructions] = useState('')
  const [duration, setDuration] = useState(30)
  const [from, setFrom] = useState('')
  const [due, setDue] = useState(() => toLocalInput(new Date(Date.now() + 7 * 86_400_000).toISOString()))
  const [allowLate, setAllowLate] = useState(false)
  const [release, setRelease] = useState<'INSTANT' | 'ON_PUBLISH'>('INSTANT')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!subject) return
    let alive = true
    curriculumService.listTextbooks(subject)
      .then((b) => { if (alive) setBooks(b.filter((x) => x.vector_status === 'indexed' && x.chapters.length)) })
      .catch(() => alive && setBooks([]))
    return () => { alive = false }
  }, [subject])

  const chapters = useMemo(() => (books ?? []).flatMap((b) => b.chapters.map((c) => ({
    key: `${b.textbook_id}|${c.chapter_number}`, title: c.chapter_title,
    label: `${(books ?? []).length > 1 ? `${b.title} — ` : ''}Ch ${c.chapter_number}: ${c.chapter_title}`,
  }))), [books])
  const chosen = chapters.find((c) => c.key === chapter)
  const scheduled = kind !== 'OFFLINE_EXAM'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const [tb, ch] = chosen ? chosen.key.split('|') : [null, null]
      const t = await evaluationService.create({
        class_code: klass, subject_code: subject, evaluation_scope: scope, test_title: title.trim(), assessment_type: kind,
        exam_date: kind === 'OFFLINE_EXAM' ? examDate || null : null, pass_percentage: pass,
        ...(scope === 'CHAPTER_LEVEL' ? { textbook_id: tb, chapter_number: ch ? Number(ch) : null, chapter_title: chosen?.title ?? manualChapter.trim() } : {}),
        ...(scheduled ? {
          instructions: instructions.trim() || null, duration_minutes: kind === 'ONLINE_TEST' ? duration : null,
          available_from: fromLocalInput(from), due_at: fromLocalInput(due), allow_late: allowLate, results_release: release,
        } : {}),
      })
      onCreated(t)
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const needsChapter = scope === 'CHAPTER_LEVEL' && !chosen && !manualChapter.trim()

  return (
    <Dialog open onClose={onClose} title={lockType ? `New ${TYPES.find((t) => t.id === initialType)?.title.toLowerCase()}` : 'New test / assignment'}
      description={lockType ? TYPES.find((t) => t.id === initialType)?.desc : 'Choose how students are assessed, then add the SL.No questions and model answers.'}
      className="w-[min(44rem,calc(100vw-2rem))]">
      <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
        {!lockType && <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Assessment type">
          {TYPES.map(({ id, title: t, desc, icon: Icon }) => (
            <button type="button" key={id} role="radio" aria-checked={kind === id} onClick={() => setKind(id)} id={`type-${id}`}
              className={cn('cursor-pointer rounded-xl border p-3 text-left transition-all', kind === id ? 'border-brand-400 bg-brand-500/8 ring-1 ring-brand-400/40' : 'border-line hover:border-line-strong')}>
              <div className="flex items-center gap-2 text-sm font-medium text-fg"><Icon className="h-4 w-4 text-brand-600" /> {t}</div>
              <div className="mt-0.5 text-xs text-ink-500">{desc}</div>
            </button>
          ))}
        </div>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="ev-class">Class / section</Label>
            <Select id="ev-class" value={klass} onChange={(e) => { const c = classes.find((x) => x.class_code === e.target.value); setKlass(e.target.value); setSubject(c?.subjects[0]?.subject_code ?? ''); setChapter('') }}>
              {classes.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="ev-subject">Subject</Label>
            <Select id="ev-subject" value={subject} onChange={(e) => { setSubject(e.target.value); setChapter('') }}>
              {cls?.subjects.map((s) => <option key={s.subject_code} value={s.subject_code}>{s.subject_name}</option>)}
            </Select>
          </div>
        </div>

        <div>
          <Label>Scope</Label>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {([['SUBJECT_LEVEL', 'Subject level', 'Full syllabus / term', Layers], ['CHAPTER_LEVEL', 'Chapter level', 'One chapter', BookOpen]] as const).map(([v, t, d, Icon]) => (
              <button type="button" key={v} role="radio" aria-checked={scope === v} onClick={() => setScope(v)} id={`scope-${v}`}
                className={cn('cursor-pointer rounded-xl border p-2.5 text-left transition-all', scope === v ? 'border-brand-400 bg-brand-500/8 ring-1 ring-brand-400/40' : 'border-line hover:border-line-strong')}>
                <div className="flex items-center gap-2 text-sm font-medium text-fg"><Icon className="h-4 w-4 text-brand-600" /> {t}</div>
                <div className="text-xs text-ink-500">{d}</div>
              </button>
            ))}
          </div>
        </div>

        {scope === 'CHAPTER_LEVEL' && (
          <div className="space-y-2">
            <Label htmlFor="ev-chapter">Chapter</Label>
            <Select id="ev-chapter" value={chapter} onChange={(e) => setChapter(e.target.value)} disabled={books === null}>
              <option value="">{books === null ? 'Loading chapters…' : chapters.length ? 'Choose from the textbook…' : 'No indexed textbook — type the chapter below'}</option>
              {chapters.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </Select>
            {!chosen && <Input aria-label="Chapter name" placeholder="Or type a chapter, e.g. Chapter 1: Light — Reflection and Refraction" value={manualChapter} onChange={(e) => setManualChapter(e.target.value)} maxLength={300} />}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <div><Label htmlFor="ev-title">Title</Label><Input id="ev-title" required minLength={2} maxLength={300} placeholder={kind === 'ASSIGNMENT' ? 'Assignment 1: Laws of motion' : 'Chapter 1 Unit Test'} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label htmlFor="ev-pass">Pass %</Label><Input id="ev-pass" type="number" min={0} max={100} value={pass} onChange={(e) => setPass(Number(e.target.value))} /></div>
        </div>

        {kind === 'OFFLINE_EXAM' ? (
          <div className="w-44"><Label htmlFor="ev-date">Exam date</Label><Input id="ev-date" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} /></div>
        ) : (
          <div className="space-y-3 rounded-xl border border-line bg-ink-800/60 p-3">
            <div><Label htmlFor="ev-instr">Instructions for students (optional)</Label><Textarea id="ev-instr" rows={2} maxLength={5000} value={instructions} onChange={(e) => setInstructions(e.target.value)}
              placeholder={kind === 'ONLINE_TEST' ? 'Answer all questions. Show steps for numericals.' : 'Write answers on paper, scan all pages into one PDF and upload.'} /></div>
            <div className="grid gap-3 sm:grid-cols-3">
              {kind === 'ONLINE_TEST' && <div><Label htmlFor="ev-dur">Duration (min)</Label><Input id="ev-dur" type="number" min={1} max={600} required value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>}
              <div><Label htmlFor="ev-from">Opens (optional)</Label><Input id="ev-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label htmlFor="ev-due">Due</Label><Input id="ev-due" type="datetime-local" required value={due} onChange={(e) => setDue(e.target.value)} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-100"><input type="checkbox" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} className="accent-[var(--color-brand-500)]" /> Accept late submissions (marked late)</label>
              <div><Label htmlFor="ev-release">Show results to students</Label>
                <Select id="ev-release" value={release} onChange={(e) => setRelease(e.target.value as 'INSTANT' | 'ON_PUBLISH')}>
                  <option value="INSTANT">Instantly after AI evaluation</option>
                  <option value="ON_PUBLISH">Only after I publish</option>
                </Select>
              </div>
            </div>
          </div>
        )}

        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !subject || needsChapter || (scheduled && !due)} id="create-evaluation">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create</Button>
        </div>
      </form>
    </Dialog>
  )
}
