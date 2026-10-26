import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BookMarked, CheckCircle2, ClipboardList, FileText, Loader2, Paperclip, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { errorMessage } from '@/services/apiClient'
import { classroomService, isoDay } from '@/services/classroomService'
import { cn } from '@/lib/utils'
import type { Homework, HomeworkSubmission, TeacherClass } from '@/types'

const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** FR-TE-04: post daily / chapter homework to a class subject and review what students hand in. */
export default function TeacherHomework() {
  const [classes, setClasses] = useState<TeacherClass[] | null>(null)
  const [klass, setKlass] = useState('')
  const [subject, setSubject] = useState('')
  const [items, setItems] = useState<Homework[] | null>(null)
  const [open, setOpen] = useState<Homework | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    classroomService.myClasses().then((c) => {
      setClasses(c)
      if (c[0]) { setKlass(c[0].class_code); setSubject(c[0].subjects[0]?.subject_code ?? '') }
    }).catch((e) => setError(errorMessage(e)))
  }, [])

  const load = useCallback(async () => {
    if (!klass) return
    try { setItems(await classroomService.homework(klass, subject || undefined)) } catch (e) { setError(errorMessage(e)) }
  }, [klass, subject])
  useEffect(() => { setItems(null); void load() }, [load])

  const cls = classes?.find((c) => c.class_code === klass)
  if (classes && classes.length === 0) {
    return <div className="grid h-full place-items-center p-8 text-center text-sm text-ink-300"><div><ClipboardList className="mx-auto mb-3 h-10 w-10 text-ink-500" />You are not assigned to any class yet.</div></div>
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <h1 className="font-display text-3xl font-bold">Home<span className="text-gradient">work</span></h1>
          <p className="mt-1 text-sm text-ink-300">Post homework for your classes; students see it instantly and hand in notes, photos or PDFs.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Class" id="hw-class" className="w-56" value={klass}
            onChange={(e) => { const c = classes?.find((x) => x.class_code === e.target.value); setKlass(e.target.value); setSubject(c?.subjects[0]?.subject_code ?? '') }}>
            {classes?.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
          </Select>
          <Select aria-label="Subject" id="hw-subject" className="w-48" value={subject} onChange={(e) => setSubject(e.target.value)}>
            {cls?.subjects.map((s) => <option key={s.subject_code} value={s.subject_code}>{s.subject_name}</option>)}
          </Select>
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        {klass && subject && <NewHomework klass={klass} subject={subject} subjectName={cls?.subjects.find((s) => s.subject_code === subject)?.subject_name ?? subject} onCreated={() => void load()} />}

        <Card className="min-w-0">
          <CardHeader><CardTitle>Posted homework {items && <span className="text-ink-500">({items.length})</span>}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!items ? <div className="skeleton h-40" /> : items.length === 0 ? <p className="py-10 text-center text-sm text-ink-300">No homework posted for this subject yet.</p> : items.map((h) => {
              const overdue = h.due_date < isoDay()
              return (
                <div key={h.homework_id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-fg">{h.title}</div>
                      <div className="mt-0.5 text-xs text-ink-500">{h.subject_name} · posted {fmtDate(h.created_at)} by {h.assigned_by_name ?? h.assigned_by}</div>
                    </div>
                    <Badge tone={overdue ? 'neutral' : 'warn'}>Due {fmtDate(h.due_date)}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-ink-300">{h.instructions}</p>
                  {h.attachment_url && <a href={h.attachment_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><Paperclip className="h-3 w-3" />{h.attachment_name ?? 'Attachment'}</a>}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="min-w-40 flex-1">
                      <div className="mb-1 flex justify-between text-xs text-ink-500"><span>{h.submitted}/{h.students} submitted</span><span>{h.reviewed} reviewed</span></div>
                      <Progress value={h.students ? (h.submitted / h.students) * 100 : 0} tone="ok" />
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setOpen(h)}><CheckCircle2 className="h-3.5 w-3.5" /> Submissions</Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${h.title}`}
                      onClick={async () => { if (confirm(`Delete "${h.title}" and all its submissions?`)) { await classroomService.deleteHomework(h.homework_id); void load() } }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {open && <SubmissionsDialog hw={open} onClose={() => { setOpen(null); void load() }} />}
    </div>
  )
}

function NewHomework({ klass, subject, subjectName, onCreated }: { klass: string; subject: string; subjectName: string; onCreated: () => void }) {
  const [tomorrow] = useState(() => isoDay(new Date(Date.now() + 86_400_000)))
  const [form, setForm] = useState({ title: '', instructions: '', due_date: tomorrow })
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await classroomService.createHomework({ class_code: klass, subject_code: subject, ...form, attachment: file })
      setForm({ title: '', instructions: '', due_date: tomorrow }); setFile(null)
      ;(e.target as HTMLFormElement).reset()
      setMsg({ ok: true, text: 'Homework posted to the class.' }); onCreated()
    } catch (err) { setMsg({ ok: false, text: errorMessage(err) }) } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><BookMarked className="h-5 w-5 text-brand-600" /> New homework</CardTitle><CardDescription>{subjectName} · {klass}</CardDescription></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div><Label htmlFor="hw-title">Title</Label><Input id="hw-title" required minLength={2} maxLength={300} placeholder="Ray diagrams — all 6 cases" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><Label htmlFor="hw-inst">Instructions</Label><Textarea id="hw-inst" required minLength={2} rows={4} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></div>
          <div><Label htmlFor="hw-due">Due date</Label><Input id="hw-due" type="date" required min={isoDay()} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
          <div><Label htmlFor="hw-file">Worksheet / notes (optional PDF or image, max 10 MB)</Label>
            <input id="hw-file" type="file" accept=".pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full cursor-pointer rounded-xl border border-dashed border-line-strong bg-ink-800 p-2.5 text-xs text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1 file:text-white" />
          </div>
          {msg && <p role="status" className={cn('text-sm', msg.ok ? 'text-ok' : 'text-bad')}>{msg.text}</p>}
          <Button type="submit" className="w-full" disabled={busy} id="post-homework">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Post homework</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function SubmissionsDialog({ hw, onClose }: { hw: Homework; onClose: () => void }) {
  const [rows, setRows] = useState<HomeworkSubmission[] | null>(null)
  const [remarks, setRemarks] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => classroomService.submissions(hw.homework_id).then(setRows).catch((e) => setError(errorMessage(e))), [hw.homework_id])
  useEffect(() => { void load() }, [load])

  async function review(code: string) {
    setError(null)
    try { await classroomService.review(hw.homework_id, code, remarks[code] ?? ''); await load() } catch (e) { setError(errorMessage(e)) }
  }

  return (
    <Dialog open onClose={onClose} title={hw.title} description={`${hw.subject_name} · due ${fmtDate(hw.due_date)}`} className="w-[min(46rem,calc(100vw-2rem))]">
      {error && <p role="alert" className="mb-3 text-sm text-bad">{error}</p>}
      {!rows ? <div className="skeleton h-40" /> : (
        <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {rows.map((r) => (
            <li key={r.student_user_code} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-right text-xs tabular-nums text-ink-500">{r.roll_number ?? ''}</span>
                <span className="flex-1 text-sm font-medium text-fg">{r.full_name}</span>
                <Badge tone={r.status === 'REVIEWED' ? 'ok' : r.status === 'SUBMITTED' ? 'brand' : 'neutral'}>{r.status.toLowerCase()}</Badge>
              </div>
              {r.status !== 'PENDING' && (
                <div className="space-y-2 pl-8 text-sm">
                  {r.submission_notes && <p className="text-ink-300">“{r.submission_notes}”</p>}
                  {r.file_url && <a href={r.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><FileText className="h-3 w-3" />{r.file_name ?? 'Open file'}</a>}
                  {r.status === 'REVIEWED' ? (
                    r.teacher_remarks && <p className="text-xs text-ok">Your remarks: {r.teacher_remarks}</p>
                  ) : (
                    <div className="flex gap-2">
                      <Input aria-label={`Remarks for ${r.full_name}`} className="h-9" placeholder="Remarks (optional)" maxLength={2000}
                        value={remarks[r.student_user_code] ?? ''} onChange={(e) => setRemarks({ ...remarks, [r.student_user_code]: e.target.value })} />
                      <Button size="sm" className="h-9" onClick={() => review(r.student_user_code)}><CheckCircle2 className="h-3.5 w-3.5" /> Mark reviewed</Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
