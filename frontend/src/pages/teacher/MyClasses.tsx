import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, Download, FileUp, KeyRound, Loader2, Lock, School, Search, UserPlus } from 'lucide-react'
import { CredentialNotice } from '@/components/admin/CredentialNotice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { classroomService, downloadBlob, type StudentBody } from '@/services/classroomService'
import { cn } from '@/lib/utils'
import type { CreatedMember, Member, TeacherClass } from '@/types'

const CSV_TEMPLATE = 'full_name,user_code,roll_number,email,guardian_name,guardian_phone,phone,password\nAsha Rao,ADM-1001,1,,Ramesh Rao,+91 98xxxxxx01,,\n'
const EMPTY: StudentBody = { full_name: '', user_code: '', roll_number: '', email: '', guardian_name: '', guardian_phone: '', phone: '', password: '' }

/** Teacher: classes I teach. Only the class teacher can enrol/edit students — and only in their own class. */
export default function MyClasses() {
  const [classes, setClasses] = useState<TeacherClass[] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [roster, setRoster] = useState<{ is_class_teacher: boolean; students: Member[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'add' | 'import' | null>(null)
  const [created, setCreated] = useState<Pick<CreatedMember, 'full_name' | 'user_code' | 'email' | 'temporary_password'> | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    classroomService.myClasses().then((c) => { setClasses(c); setActive((a) => a ?? c[0]?.class_code ?? null) })
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const load = useCallback(async () => {
    if (!active) return
    try { setRoster(await classroomService.students(active)) } catch (e) { setError(errorMessage(e)) }
  }, [active])
  useEffect(() => { setRoster(null); void load() }, [load])

  async function patch(s: Member, p: { is_active?: boolean; reset_password?: boolean }) {
    if (!active) return
    setError(null)
    try {
      const r = await classroomService.updateStudent(active, s.user_code, p)
      if (r.temporary_password) setCreated({ ...s, temporary_password: r.temporary_password })
      await load()
    } catch (e) { setError(errorMessage(e)) }
  }

  if (classes && classes.length === 0) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-sm"><School className="mx-auto mb-3 h-10 w-10 text-ink-500" /><h1 className="font-display text-lg font-semibold">No classes assigned yet</h1>
          <p className="mt-1 text-sm text-ink-300">Your institution admin assigns you as a class teacher or subject teacher.</p></div>
      </div>
    )
  }

  const cls = classes?.find((c) => c.class_code === active)
  const f = filter.toLowerCase()
  const shown = roster?.students.filter((s) => !f || `${s.full_name} ${s.user_code} ${s.roll_number ?? ''}`.toLowerCase().includes(f))

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">My <span className="text-gradient">classes</span></h1>
        <p className="mt-1 text-sm text-ink-300">Class teachers enrol and manage the students of their own class. Subject teachers can view the roster.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <nav aria-label="Classes" className="space-y-2">
          {!classes ? <div className="skeleton h-40" /> : classes.map((c) => (
            <button key={c.class_code} onClick={() => setActive(c.class_code)} id={`class-${c.class_code}`}
              className={cn('w-full cursor-pointer rounded-xl border p-3 text-left transition-all',
                c.class_code === active ? 'border-brand-400 bg-brand-500/8 ring-1 ring-brand-400/40' : 'border-line bg-ink-900 hover:border-line-strong')}>
              <div className="font-medium text-fg">{c.class_name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={c.is_class_teacher ? 'brand' : 'neutral'}>{c.is_class_teacher ? 'Class teacher' : 'Subject teacher'}</Badge>
                <span className="text-xs text-ink-500">{c.student_count} students</span>
              </div>
              <div className="mt-1.5 truncate text-xs text-ink-500">{c.subjects.map((s) => s.subject_name).join(' · ')}</div>
            </button>
          ))}
        </nav>

        <Card className="min-w-0">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>{cls?.class_name ?? 'Students'} {roster && <span className="text-ink-500">({roster.students.filter((s) => s.is_active).length})</span>}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <div className="relative w-48"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-500" /><Input aria-label="Search students" className="pl-9" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
              <Link to="/teacher/attendance"><Button variant="secondary"><CalendarCheck className="h-4 w-4" /> Attendance</Button></Link>
              {roster?.is_class_teacher && <>
                <Button variant="secondary" onClick={() => setDialog('import')} id="import-students"><FileUp className="h-4 w-4" /> Import CSV</Button>
                <Button onClick={() => setDialog('add')} id="add-student"><UserPlus className="h-4 w-4" /> Add student</Button>
              </>}
            </div>
          </CardHeader>
          <CardContent>
            {roster && !roster.is_class_teacher && (
              <p className="mb-3 flex items-center gap-2 rounded-lg bg-ink-800 px-3 py-2 text-xs text-ink-300"><Lock className="h-3.5 w-3.5" /> Only the class teacher can add or edit students in this class.</p>
            )}
            {created && <div className="mb-4"><CredentialNotice member={created} onDismiss={() => setCreated(null)} /></div>}
            {error && <p role="alert" className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
            {!shown ? <div className="skeleton h-48" /> : shown.length === 0 ? (
              <p className="py-12 text-center text-sm text-ink-300">{roster?.is_class_teacher ? 'No students yet — add them one by one or import a CSV.' : 'No students in this class yet.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="py-2 pr-3 font-medium">Roll</th><th className="py-2 pr-3 font-medium">Student</th><th className="py-2 pr-3 font-medium">Admission no.</th>
                    <th className="py-2 pr-3 font-medium">Guardian</th><th className="py-2 pr-3 font-medium">Status</th>{roster?.is_class_teacher && <th className="py-2 text-right font-medium">Actions</th>}
                  </tr></thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.user_code} className={cn('border-b border-line last:border-0', !s.is_active && 'opacity-55')}>
                        <td className="py-2.5 pr-3 tabular-nums text-ink-500">{s.roll_number ?? '—'}</td>
                        <td className="py-2.5 pr-3"><div className="font-medium text-fg">{s.full_name}</div>{!s.email.endsWith('.noemail.local') && <div className="text-xs text-ink-500">{s.email}</div>}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs">{s.user_code}</td>
                        <td className="py-2.5 pr-3 text-xs"><div>{s.guardian_name ?? '—'}</div><div className="text-ink-500">{s.guardian_phone ?? ''}</div></td>
                        <td className="py-2.5 pr-3"><Badge tone={s.is_active ? 'ok' : 'neutral'}>{s.is_active ? 'Active' : 'Inactive'}</Badge></td>
                        {roster?.is_class_teacher && (
                          <td className="py-2.5 text-right"><div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" title="Reset password" aria-label={`Reset password for ${s.full_name}`} onClick={() => patch(s, { reset_password: true })}><KeyRound className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="secondary" onClick={() => patch(s, { is_active: !s.is_active })}>{s.is_active ? 'Deactivate' : 'Activate'}</Button>
                          </div></td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {active && cls && (
        <>
          <AddStudentDialog open={dialog === 'add'} onClose={() => setDialog(null)} cls={cls}
            onCreated={(m) => { setCreated(m); setDialog(null); void load() }} />
          <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} cls={cls} onDone={() => void load()} />
        </>
      )}
    </div>
  )
}

function AddStudentDialog({ open, onClose, cls, onCreated }: { open: boolean; onClose: () => void; cls: TeacherClass; onCreated: (m: CreatedMember) => void }) {
  const [form, setForm] = useState<StudentBody>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof StudentBody) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { onCreated(await classroomService.createStudent(cls.class_code, form)); setForm(EMPTY) }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Add student to ${cls.class_name}`} description="The student is enrolled in every subject of this class.">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="s-name">Full name *</Label><Input id="s-name" required minLength={2} value={form.full_name} onChange={set('full_name')} /></div>
        <div><Label htmlFor="s-code">Admission no.</Label><Input id="s-code" placeholder="Auto if empty" value={form.user_code} onChange={set('user_code')} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" /></div>
        <div><Label htmlFor="s-roll">Roll no.</Label><Input id="s-roll" value={form.roll_number} onChange={set('roll_number')} maxLength={32} /></div>
        <div className="sm:col-span-2"><Label htmlFor="s-email">Email (optional — students can sign in with admission no.)</Label><Input id="s-email" type="email" value={form.email} onChange={set('email')} /></div>
        <div><Label htmlFor="s-gname">Guardian name</Label><Input id="s-gname" value={form.guardian_name} onChange={set('guardian_name')} /></div>
        <div><Label htmlFor="s-gphone">Guardian phone</Label><Input id="s-gphone" value={form.guardian_phone} onChange={set('guardian_phone')} /></div>
        <div className="sm:col-span-2"><Label htmlFor="s-pw">Password (optional — auto-generated if empty)</Label><Input id="s-pw" type="password" minLength={8} value={form.password} onChange={set('password')} /></div>
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} id="save-student">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add student</Button>
        </div>
      </form>
    </Dialog>
  )
}

function ImportDialog({ open, onClose, cls, onDone }: { open: boolean; onClose: () => void; cls: TeacherClass; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Awaited<ReturnType<typeof classroomService.importStudents>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!file) return
    setBusy(true); setError(null); setRes(null)
    try { setRes(await classroomService.importStudents(cls.class_code, file)); onDone() }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  function downloadCredentials() {
    if (!res) return
    const lines = ['full_name,login,temporary_password', ...res.created.map((c) =>
      `"${c.full_name}",${c.email.endsWith('.noemail.local') ? c.user_code : c.email},${c.temporary_password ?? '(set in CSV)'}`)]
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv' }), `${cls.class_code}-credentials.csv`)
  }

  return (
    <Dialog open={open} onClose={() => { onClose(); setRes(null); setFile(null) }} title={`Import students into ${cls.class_name}`} description="UTF-8 CSV with a header row. Only full_name is required (max 500 rows).">
      <div className="space-y-4">
        <Button size="sm" variant="secondary" onClick={() => downloadBlob(new Blob([CSV_TEMPLATE], { type: 'text/csv' }), 'students-template.csv')}><Download className="h-3.5 w-3.5" /> Download template</Button>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full cursor-pointer rounded-xl border border-dashed border-line-strong bg-ink-800 p-4 text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-white" />
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {res && (
          <div className="space-y-2 text-sm">
            <p className="text-ok">{res.created.length} student(s) created.</p>
            {res.created.some((c) => c.temporary_password) && <Button size="sm" onClick={downloadCredentials}><Download className="h-3.5 w-3.5" /> Download sign-in details (shown once)</Button>}
            {res.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-bad/30 bg-bad/5 p-2 text-xs text-bad">
                {res.errors.map((e) => <div key={e.row}>Row {e.row}: {e.error}</div>)}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={run} disabled={!file || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} Import</Button>
        </div>
      </div>
    </Dialog>
  )
}
