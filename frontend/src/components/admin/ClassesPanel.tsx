import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BookPlus, GraduationCap, Loader2, Plus, Trash2, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/field'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import type { Member, SchoolClass, SubjectType } from '@/types'

const TYPE_LABEL: Record<SubjectType, string> = { THEORY: 'Theory', LAB: 'Lab', COACHING_TEST: 'Test series' }

/** Admin: create classes, choose the class teacher, and assign a subject teacher per class subject. */
export function ClassesPanel({ org }: { org?: string | null }) {
  const [classes, setClasses] = useState<SchoolClass[] | null>(null)
  const [teachers, setTeachers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ class_code: '', class_name: '', class_teacher_code: '', room_number: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([adminService.classes(org), adminService.teachers(org)])
      setClasses(c); setTeachers(t.filter((x) => x.is_active))
    } catch (e) { setError(errorMessage(e)) }
  }, [org])
  useEffect(() => { setClasses(null); void load() }, [load])

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try { await fn(); await load() } catch (e) { setError(errorMessage(e)) }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    await run(() => adminService.createClass({ ...form, class_teacher_code: form.class_teacher_code || null, room_number: form.room_number || null }, org))
    setForm({ class_code: '', class_name: '', class_teacher_code: '', room_number: '' })
    setBusy(false)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>New class / section / batch</CardTitle><CardDescription>The class teacher is the only teacher who can enrol students into this class.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_1.4fr_1.4fr_0.7fr_auto] sm:items-end">
            <div><Label htmlFor="c-code">Class code</Label><Input id="c-code" required placeholder="Grade-8-C" value={form.class_code} onChange={(e) => setForm({ ...form, class_code: e.target.value })} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" /></div>
            <div><Label htmlFor="c-name">Display name</Label><Input id="c-name" required minLength={2} placeholder="Grade 8 — Section C" value={form.class_name} onChange={(e) => setForm({ ...form, class_name: e.target.value })} /></div>
            <div><Label htmlFor="c-teacher">Class teacher</Label>
              <Select id="c-teacher" value={form.class_teacher_code} onChange={(e) => setForm({ ...form, class_teacher_code: e.target.value })}>
                <option value="">— Assign later —</option>
                {teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name} ({t.user_code})</option>)}
              </Select>
            </div>
            <div><Label htmlFor="c-room">Room</Label><Input id="c-room" placeholder="Room-204" value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} maxLength={32} /></div>
            <Button type="submit" disabled={busy} id="create-class">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create</Button>
          </form>
        </CardContent>
      </Card>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {!classes ? <div className="skeleton h-48" /> : classes.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-300"><GraduationCap className="mx-auto mb-2 h-8 w-8 text-ink-500" />No classes yet.</Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {classes.map((c) => <ClassCard key={c.class_code} c={c} teachers={teachers} run={run} org={org} />)}
        </div>
      )}
    </div>
  )
}

function ClassCard({ c, teachers, run, org }: { c: SchoolClass; teachers: Member[]; run: (fn: () => Promise<unknown>) => Promise<void>; org?: string | null }) {
  const [sub, setSub] = useState<{ subject_code: string; subject_name: string; teacher_code: string; subject_type: SubjectType }>({ subject_code: '', subject_name: '', teacher_code: '', subject_type: 'THEORY' })
  const tOptions = teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name}</option>)

  return (
    <Card className={c.is_active ? '' : 'opacity-60'}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{c.class_name}</CardTitle>
            <CardDescription><span className="font-mono">{c.class_code}</span> · {c.year_code} {c.cycle_code}{c.room_number ? ` · ${c.room_number}` : ''}</CardDescription>
          </div>
          <Badge tone="aqua"><Users className="h-3 w-3" /> {c.student_count} students</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <Label htmlFor={`ct-${c.class_code}`}>Class teacher</Label>
            <Select id={`ct-${c.class_code}`} value={c.class_teacher_code ?? ''}
              onChange={(e) => run(() => adminService.updateClass(c.class_code, { class_name: c.class_name, class_teacher_code: e.target.value || null, is_active: c.is_active }, org))}>
              <option value="">— Not assigned —</option>{tOptions}
            </Select>
          </div>
          <Button size="sm" variant="secondary" className="h-10"
            onClick={() => run(() => adminService.updateClass(c.class_code, { class_name: c.class_name, class_teacher_code: c.class_teacher_code, is_active: !c.is_active }, org))}>
            {c.is_active ? 'Archive' : 'Restore'}
          </Button>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">Subjects & subject teachers</div>
          <div className="divide-y divide-line rounded-xl border border-line">
            {c.subjects.length === 0 && <p className="p-3 text-sm text-ink-500">No subjects yet — add one below.</p>}
            {c.subjects.map((s) => (
              <div key={s.subject_code} className="flex items-center gap-2 p-2.5">
                <div className="min-w-0 flex-1"><div className="text-sm font-medium text-fg">{s.subject_name}</div><div className="text-xs text-ink-500"><span className="font-mono">{s.subject_code}</span> · {TYPE_LABEL[s.subject_type ?? 'THEORY']}</div></div>
                <Select aria-label={`Teacher for ${s.subject_name}`} className="h-9 w-48"
                  value={s.teacher_code ?? ''} onChange={(e) => run(() => adminService.setClassSubject(c.class_code, s.subject_code, { subject_name: s.subject_name, teacher_code: e.target.value || null, subject_type: s.subject_type }, org))}>
                  <option value="">— No teacher —</option>{tOptions}
                </Select>
                <Button size="icon" variant="ghost" aria-label={`Remove ${s.subject_name}`}
                  onClick={() => { if (confirm(`Remove ${s.subject_name} from ${c.class_name}? Existing attendance is kept.`)) void run(() => adminService.removeClassSubject(c.class_code, s.subject_code, org)) }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <form className="mt-2 grid gap-2 sm:grid-cols-[1fr_1.3fr_0.9fr_1.3fr_auto]"
            onSubmit={(e) => { e.preventDefault(); void run(() => adminService.setClassSubject(c.class_code, sub.subject_code.trim(), { subject_name: sub.subject_name, teacher_code: sub.teacher_code || null, subject_type: sub.subject_type }, org)).then(() => setSub({ subject_code: '', subject_name: '', teacher_code: '', subject_type: 'THEORY' })) }}>
            <Input aria-label="Subject code" required placeholder="PHY101" value={sub.subject_code} onChange={(e) => setSub({ ...sub, subject_code: e.target.value })} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" />
            <Input aria-label="Subject name" required minLength={2} placeholder="Physics" value={sub.subject_name} onChange={(e) => setSub({ ...sub, subject_name: e.target.value })} />
            <Select aria-label="Subject type" value={sub.subject_type} onChange={(e) => setSub({ ...sub, subject_type: e.target.value as SubjectType })}>
              {(Object.keys(TYPE_LABEL) as SubjectType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </Select>
            <Select aria-label="Subject teacher" value={sub.teacher_code} onChange={(e) => setSub({ ...sub, teacher_code: e.target.value })}>
              <option value="">— Teacher —</option>{tOptions}
            </Select>
            <Button type="submit" variant="outline"><BookPlus className="h-4 w-4" /> Add</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}
