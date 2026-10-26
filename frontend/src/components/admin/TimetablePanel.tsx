import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarClock, Loader2, Save, Trash2 } from 'lucide-react'
import { WeeklyGrid } from '@/components/timetable/WeeklyGrid'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/field'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import { DAY_NAMES, defaultPeriodTimes } from '@/lib/timetable'
import type { Member, SchoolClass, TimetableSlot } from '@/types'

interface Editing { day: number; period: number; slot?: TimetableSlot }

/** FR-AD-07: weekly timetable per class. The server rejects teacher double-booking and overlapping periods. */
export function TimetablePanel({ org }: { org?: string | null }) {
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [teachers, setTeachers] = useState<Member[]>([])
  const [klass, setKlass] = useState('')
  const [view, setView] = useState<'class' | 'teacher'>('class')
  const [teacher, setTeacher] = useState('')
  const [slots, setSlots] = useState<TimetableSlot[] | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [today] = useState(() => new Date().getDay() || 7)  // ISO weekday

  useEffect(() => {
    Promise.all([adminService.classes(org), adminService.teachers(org)]).then(([c, t]) => {
      const active = c.filter((x) => x.is_active)
      setClasses(active); setTeachers(t.filter((x) => x.is_active))
      setKlass((k) => k || active[0]?.class_code || '')
      setTeacher((x) => x || t[0]?.user_code || '')
    }).catch((e) => setError(errorMessage(e)))
  }, [org])

  const load = useCallback(async () => {
    const filter = view === 'class' ? { class_code: klass } : { teacher_code: teacher }
    if (!Object.values(filter)[0]) return
    try { setSlots(await adminService.timetable(filter, org)) } catch (e) { setError(errorMessage(e)) }
  }, [view, klass, teacher, org])
  useEffect(() => { setSlots(null); void load() }, [load])

  const cls = classes.find((c) => c.class_code === klass)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-brand-600" /> Weekly timetable</CardTitle>
            <CardDescription>Click a period to assign a subject. A teacher can’t be booked in two classes at the same time.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select aria-label="View by" className="w-36" value={view} onChange={(e) => setView(e.target.value as 'class' | 'teacher')}>
              <option value="class">By class</option><option value="teacher">By teacher</option>
            </Select>
            {view === 'class' ? (
              <Select aria-label="Class" id="tt-class" className="w-56" value={klass} onChange={(e) => setKlass(e.target.value)}>
                {classes.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
              </Select>
            ) : (
              <Select aria-label="Teacher" className="w-56" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
                {teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name}</option>)}
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && <p role="alert" className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          {classes.length === 0 ? <p className="py-10 text-center text-sm text-ink-300">Create classes and subjects first.</p>
            : !slots ? <div className="skeleton h-80" />
              : <WeeklyGrid slots={slots} secondary={view === 'class' ? 'teacher' : 'class'} today={today}
                  onCell={view === 'class' ? (day, period, slot) => setEditing({ day, period, slot }) : undefined} />}
          {view === 'teacher' && <p className="mt-2 text-xs text-ink-500">Switch to “By class” to edit periods.</p>}
        </CardContent>
      </Card>

      {editing && cls && (
        <SlotDialog key={`${editing.day}-${editing.period}`} editing={editing} cls={cls} teachers={teachers} org={org}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />
      )}
    </div>
  )
}

function SlotDialog({ editing, cls, teachers, org, onClose, onSaved }: {
  editing: Editing; cls: SchoolClass; teachers: Member[]; org?: string | null; onClose: () => void; onSaved: () => void
}) {
  const s = editing.slot
  const def = defaultPeriodTimes(editing.period)
  const [form, setForm] = useState({
    subject_code: s?.subject_code ?? cls.subjects[0]?.subject_code ?? '',
    teacher_code: s?.teacher_code ?? '',
    start_time: s?.start_time ?? def.start,
    end_time: s?.end_time ?? def.end,
    room_number: s?.room_number ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const subjectTeacher = cls.subjects.find((x) => x.subject_code === form.subject_code)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await adminService.saveSlot({
        class_code: cls.class_code, day_of_week: editing.day, period_number: editing.period, ...form,
        teacher_code: form.teacher_code || null, room_number: form.room_number || null,
      }, org)
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function remove() {
    if (!s) return
    setBusy(true)
    try { await adminService.deleteSlot(s.slot_id, org); onSaved() } catch (err) { setError(errorMessage(err)); setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={`${cls.class_name} · ${DAY_NAMES[editing.day]} · Period ${editing.period}`}>
      {cls.subjects.length === 0 ? <p className="text-sm text-ink-300">Add subjects to this class first (Classes & subjects tab).</p> : (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="sl-subject">Subject</Label>
            <Select id="sl-subject" value={form.subject_code} onChange={(e) => setForm({ ...form, subject_code: e.target.value })}>
              {cls.subjects.map((x) => <option key={x.subject_code} value={x.subject_code}>{x.subject_name} ({x.subject_code})</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2"><Label htmlFor="sl-teacher">Teacher</Label>
            <Select id="sl-teacher" value={form.teacher_code} onChange={(e) => setForm({ ...form, teacher_code: e.target.value })}>
              <option value="">Subject teacher{subjectTeacher?.teacher_name ? ` — ${subjectTeacher.teacher_name}` : ' (not assigned)'}</option>
              {teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name} (substitute / other)</option>)}
            </Select>
          </div>
          <div><Label htmlFor="sl-start">Start</Label><Input id="sl-start" type="time" required value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
          <div><Label htmlFor="sl-end">End</Label><Input id="sl-end" type="time" required value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="sl-room">Room (optional)</Label><Input id="sl-room" placeholder={cls.room_number ?? 'e.g. Lab-2'} value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} maxLength={32} /></div>
          {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            {s && <Button variant="danger" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" /> Clear</Button>}
            <Button variant="ghost" className="ml-auto" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy} id="save-slot">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save period</Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
