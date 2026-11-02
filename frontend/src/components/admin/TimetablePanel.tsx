import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarClock, Eye, EyeOff, Loader2, Save, Trash2, Video } from 'lucide-react'
import { WeeklyGrid } from '@/components/timetable/WeeklyGrid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/field'
import { ErrorState } from '@/components/ui/loading'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import { DAY_NAMES, defaultPeriodTimes } from '@/lib/timetable'
import { cn } from '@/lib/utils'
import type { Holiday, Member, SchoolClass, TimetableSlot } from '@/types'

interface Editing { day: number; period: number; slot?: TimetableSlot }

/** FR-AD-07: weekly timetable per class. The server rejects teacher double-booking and overlapping periods. */
export function TimetablePanel({ org }: { org?: string | null }) {
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [classesLoaded, setClassesLoaded] = useState(false)
  const [teachers, setTeachers] = useState<Member[]>([])
  const [klass, setKlass] = useState('')
  const [view, setView] = useState<'class' | 'teacher'>('class')
  const [teacher, setTeacher] = useState('')
  const [slots, setSlots] = useState<TimetableSlot[] | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publishBusy, setPublishBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [today] = useState(() => new Date().getDay() || 7)  // ISO weekday

  const loadClasses = useCallback(() => adminService.classes(org).then((c) => {
    const active = c.filter((x) => x.is_active)
    setClasses(active); setClassesLoaded(true)
    setKlass((k) => k || active[0]?.class_code || '')
  }).catch((e) => setError(errorMessage(e))), [org])

  useEffect(() => {
    void loadClasses()
    adminService.teachers(org).then((t) => {
      setTeachers(t.filter((x) => x.is_active))
      setTeacher((x) => x || t[0]?.user_code || '')
    }).catch((e) => setError(errorMessage(e)))
  }, [org, loadClasses, reload])

  const load = useCallback(async () => {
    const filter = view === 'class' ? { class_code: klass } : { teacher_code: teacher }
    if (!Object.values(filter)[0]) return
    try { setSlots(await adminService.timetable(filter, org)) } catch (e) { setError(errorMessage(e)) }
  }, [view, klass, teacher, org])
  useEffect(() => { setSlots(null); void load() }, [load, reload])

  const cls = classes.find((c) => c.class_code === klass)
  const published = (cls?.timetable_status ?? 'PUBLISHED') === 'PUBLISHED'

  async function togglePublish() {
    if (!cls) return
    setPublishBusy(true); setError(null)
    try {
      await adminService.setTimetableStatus(cls.class_code, published ? 'DRAFT' : 'PUBLISHED', org)
      await loadClasses()
    } catch (e) { setError(errorMessage(e)) } finally { setPublishBusy(false) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-brand-600" /> Weekly timetable</CardTitle>
            <CardDescription>Click a period to assign a subject. A teacher can’t be booked in two classes at the same time.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="View by" className="w-36" value={view} onChange={(e) => setView(e.target.value as 'class' | 'teacher')}>
              <option value="class">By class</option><option value="teacher">By teacher</option>
            </Select>
            {view === 'class' ? (
              <>
                <Select aria-label="Class" id="tt-class" className="w-56" value={klass} onChange={(e) => setKlass(e.target.value)}>
                  {classes.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
                </Select>
                {cls && (
                  <>
                    <Badge tone={published ? 'ok' : 'neutral'}>{published ? 'Published' : 'Draft'}</Badge>
                    <Button type="button" size="sm" variant="secondary" disabled={publishBusy} onClick={togglePublish} id="toggle-timetable-publish"
                      title={published ? "Hide this class's timetable from teachers and students while you edit it" : 'Make this class timetable visible to its teachers and students'}>
                      {publishBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {published ? 'Unpublish' : 'Publish'}
                    </Button>
                  </>
                )}
              </>
            ) : (
              <Select aria-label="Teacher" className="w-56" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
                {teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name}</option>)}
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {error && (classesLoaded && slots ? <p role="alert" className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>
            : <ErrorState className="mb-3" title="Couldn’t load the timetable" message={error} onRetry={() => { setError(null); setReload((n) => n + 1) }} />)}
          {!classesLoaded ? !error && <div className="skeleton h-80" />
            : classes.length === 0 ? <p className="py-10 text-center text-sm text-ink-300">Create classes and subjects first.</p>
            : !slots ? !error && <div className="skeleton h-80" />
              : <WeeklyGrid slots={slots} secondary={view === 'class' ? 'teacher' : 'class'} today={today}
                  onCell={view === 'class' ? (day, period, slot) => setEditing({ day, period, slot }) : undefined} />}
          {view === 'teacher' && <p className="mt-2 text-xs text-ink-500">Switch to “By class” to edit periods.</p>}
          {view === 'class' && cls && !published && (
            <p className="mt-2 text-xs text-warn">Draft — hidden from this class's teachers and students until you Publish it.</p>
          )}
        </CardContent>
      </Card>

      {editing && cls && (
        <SlotDialog key={`${editing.day}-${editing.period}`} editing={editing} cls={cls} teachers={teachers} org={org}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />
      )}

      <HolidaysPanel classes={classes} org={org} />
    </div>
  )
}

const HOLIDAY_EMPTY = { name: '', start_date: '', end_date: '', holiday_type: 'SCHOOL' as const, description: '',
  scope: 'SCHOOL_WIDE' as const, class_codes: [] as string[], is_full_day: true, status: 'PUBLISHED' as const }

/** Admin holiday management (#10): school-wide or class-specific, published or draft, full or partial day. */
function HolidaysPanel({ classes, org }: { classes: SchoolClass[]; org?: string | null }) {
  const [rows, setRows] = useState<Holiday[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null)

  const load = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    const end = new Date(); end.setFullYear(end.getFullYear() + 1)
    adminService.holidays({ start: today, end: end.toISOString().slice(0, 10) }, org).then(setRows).catch((e) => setError(errorMessage(e)))
  }, [org])
  useEffect(() => { setRows(null); void load() }, [load])

  async function remove(h: Holiday) {
    try { await adminService.deleteHoliday(h.holiday_id, org); void load() } catch (e) { setError(errorMessage(e)) }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div><CardTitle className="text-base">Holidays</CardTitle><CardDescription>Published holidays appear automatically on teacher and student timetables.</CardDescription></div>
        <Button size="sm" onClick={() => setEditing('new')} id="add-holiday">Add holiday</Button>
      </CardHeader>
      <CardContent>
        {error && rows && <p role="alert" className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        {!rows ? (error ? <ErrorState title="Couldn’t load holidays" message={error} onRetry={() => { setError(null); load() }} /> : <div className="skeleton h-24" />) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-300">No upcoming holidays. Add one to let students and teachers know in advance.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((h) => (
              <li key={h.holiday_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium text-fg">{h.name}
                    <Badge tone={h.status === 'PUBLISHED' ? 'ok' : 'neutral'}>{h.status === 'PUBLISHED' ? 'Published' : 'Draft'}</Badge>
                    <Badge tone="neutral">{h.holiday_type === 'PUBLIC' ? 'Public holiday' : 'School holiday'}</Badge>
                    {!h.is_full_day && <Badge tone="warn">Partial day</Badge>}
                  </div>
                  <div className="text-xs text-ink-500">
                    {h.start_date === h.end_date ? h.start_date : `${h.start_date} – ${h.end_date}`}
                    {' · '}{h.scope === 'SCHOOL_WIDE' ? 'Whole school' : `Classes: ${h.class_codes.join(', ')}`}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(h)}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => remove(h)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing && (
        <HolidayDialog holiday={editing === 'new' ? null : editing} classes={classes} org={org}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />
      )}
    </Card>
  )
}

function HolidayDialog({ holiday, classes, org, onClose, onSaved }: {
  holiday: Holiday | null; classes: SchoolClass[]; org?: string | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState(holiday ? {
    name: holiday.name, start_date: holiday.start_date, end_date: holiday.end_date, holiday_type: holiday.holiday_type,
    description: holiday.description ?? '', scope: holiday.scope, class_codes: holiday.class_codes,
    is_full_day: holiday.is_full_day, status: holiday.status,
  } : HOLIDAY_EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const body = { ...form, description: form.description || null }
      if (holiday) await adminService.updateHoliday(holiday.holiday_id, body, org)
      else await adminService.createHoliday(body, org)
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  function toggleClass(code: string) {
    setForm((f) => ({ ...f, class_codes: f.class_codes.includes(code) ? f.class_codes.filter((c) => c !== code) : [...f.class_codes, code] }))
  }

  return (
    <Dialog open onClose={onClose} title={holiday ? 'Edit holiday' : 'Add holiday'}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="h-name">Name</Label><Input id="h-name" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><Label htmlFor="h-start">Start date</Label><Input id="h-start" type="date" required value={form.start_date}
          onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value, end_date: f.end_date && f.end_date < e.target.value ? e.target.value : f.end_date }))} /></div>
        <div><Label htmlFor="h-end">End date</Label><Input id="h-end" type="date" required min={form.start_date || undefined} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
        <div><Label htmlFor="h-type">Type</Label>
          <Select id="h-type" value={form.holiday_type} onChange={(e) => setForm({ ...form, holiday_type: e.target.value as typeof form.holiday_type })}>
            <option value="SCHOOL">School holiday</option><option value="PUBLIC">Public holiday</option>
          </Select>
        </div>
        <div><Label htmlFor="h-status">Visibility</Label>
          <Select id="h-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}>
            <option value="PUBLISHED">Published</option><option value="DRAFT">Draft (not visible yet)</option>
          </Select>
        </div>
        <div className="sm:col-span-2"><Label htmlFor="h-desc">Description (optional)</Label><Input id="h-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000} /></div>
        <div className="sm:col-span-2 flex items-center gap-2">
          <label className="flex h-10 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm">
            <input type="checkbox" checked={form.is_full_day} onChange={(e) => setForm({ ...form, is_full_day: e.target.checked })} /> Full day closure
          </label>
        </div>
        <div className="sm:col-span-2"><Label htmlFor="h-scope">Scope</Label>
          <Select id="h-scope" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope, class_codes: e.target.value === 'SCHOOL_WIDE' ? [] : form.class_codes })}>
            <option value="SCHOOL_WIDE">Whole school</option><option value="CLASS">Specific classes</option>
          </Select>
        </div>
        {form.scope === 'CLASS' && (
          <div className="sm:col-span-2">
            <Label>Classes</Label>
            <div className="flex flex-wrap gap-1.5">
              {classes.map((c) => (
                <button key={c.class_code} type="button" onClick={() => toggleClass(c.class_code)}
                  className={cn('rounded-full border px-3 py-1 text-sm transition-colors', form.class_codes.includes(c.class_code) ? 'border-brand-400 bg-brand-500/10 font-medium text-brand-600' : 'border-line text-ink-300 hover:text-fg')}>
                  {c.class_name}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} id="save-holiday">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save holiday</Button>
        </div>
      </form>
    </Dialog>
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
    schedule_type: s?.schedule_type ?? 'WEEKLY',
    effective_from: s?.effective_from ?? '',
    effective_to: s?.effective_to ?? '',
    is_online: s?.is_online ?? false,
    online_url: s?.online_url ?? '',
  })
  const [reason, setReason] = useState('')
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
        effective_from: form.effective_from || null, effective_to: form.effective_to || null,
        online_url: form.is_online ? form.online_url || null : null, change_reason: s ? reason || null : null,
      }, org)
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function remove() {
    if (!s) return
    setBusy(true)
    try { await adminService.deleteSlot(s.slot_id, reason, org); onSaved() } catch (err) { setError(errorMessage(err)); setBusy(false) }
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

          <div><Label htmlFor="sl-recur">Recurs</Label>
            <Select id="sl-recur" value={form.schedule_type} onChange={(e) => setForm({ ...form, schedule_type: e.target.value as typeof form.schedule_type })}>
              <option value="WEEKLY">Weekly (every week)</option>
              <option value="MONTHLY">Monthly (e.g. a monthly test)</option>
              <option value="YEARLY">Yearly (e.g. an annual event)</option>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex h-10 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm">
              <input type="checkbox" checked={form.is_online} onChange={(e) => setForm({ ...form, is_online: e.target.checked })} />
              <Video className="h-4 w-4 text-ink-500" /> Online class
            </label>
          </div>
          {form.is_online && (
            <div className="sm:col-span-2"><Label htmlFor="sl-url">Meeting URL</Label>
              <Input id="sl-url" type="url" required placeholder="https://meet.google.com/…" value={form.online_url}
                onChange={(e) => setForm({ ...form, online_url: e.target.value })} maxLength={500} />
            </div>
          )}
          <div><Label htmlFor="sl-from">Effective from (optional)</Label><Input id="sl-from" type="date" value={form.effective_from} max={form.effective_to || undefined} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></div>
          <div><Label htmlFor="sl-to">Effective until (optional)</Label><Input id="sl-to" type="date" value={form.effective_to} min={form.effective_from || undefined} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} /></div>
          <p className="-mt-1 text-xs text-ink-500 sm:col-span-2">Leave the dates empty for a period that always applies. Set them to run this period for a limited window only (e.g. a term, or a short substitution).</p>

          {s && (
            <div className="sm:col-span-2"><Label htmlFor="sl-reason">Reason for change (optional)</Label>
              <Input id="sl-reason" placeholder="e.g. Lab clash, substitute teacher…" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
              <p className="mt-1 text-xs text-ink-500">Saved with the timetable's change history and shown to affected students and teachers.</p>
            </div>
          )}

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
