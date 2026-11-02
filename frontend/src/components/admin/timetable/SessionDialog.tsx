import { useState, type FormEvent } from 'react'
import { Ban, Loader2, RotateCcw, Save, SearchCheck, Trash2, Video } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { bellForDay, formatDay, isoWeekday } from '@/lib/calendar'
import { errorMessage } from '@/services/apiClient'
import { conflictsOf, timetableService } from '@/services/timetableService'
import type { BellSchedule, Member, Room, SchoolClass, TimetableConflict, TimetableSession } from '@/types'
import { ConflictList } from './ConflictList'

export interface SessionTarget { session?: TimetableSession; date: string; period: number; class_code?: string }

const pad = (n: number) => String(n).padStart(2, '0')
function bellTimes(bell: BellSchedule | null, date: string, period: number) {
  const item = bellForDay(bell, isoWeekday(date)).find((i) => i.item_kind === 'PERIOD' && i.period_number === period)
  if (item) return { start: item.start_time, end: item.end_time }
  const start = 8 * 60 + period * 45  // no bell entry for this period: a 45-minute slot after the usual day
  return { start: `${pad(Math.floor(start / 60) % 24)}:${pad(start % 60)}`, end: `${pad(Math.floor((start + 45) / 60) % 24)}:${pad((start + 45) % 60)}` }
}

/**
 * Add, edit, move, cancel or restore one dated session. Saving over a weekly period makes it that date's override
 * (e.g. a substitute teacher); the weekly pattern itself is never changed here.
 */
export function SessionDialog({ target, classes, teachers, rooms, bell, org, fixedClass, onClose, onSaved }: {
  target: SessionTarget
  classes: SchoolClass[]
  teachers: Member[]
  rooms: Room[]
  bell: BellSchedule | null
  org?: string | null
  fixedClass?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const s = target.session
  const initialClass = s?.class_code ?? target.class_code ?? classes[0]?.class_code ?? ''
  const times = bellTimes(bell, target.date, target.period)
  // '' = "the subject teacher"; an explicit teacher only when the session has someone else (e.g. a substitute)
  const subjectTeacherOf = (code: string | null | undefined) =>
    classes.find((c) => c.class_code === initialClass)?.subjects.find((x) => x.subject_code === code)?.teacher_code ?? null
  const [form, setForm] = useState({
    class_code: initialClass,
    session_date: s?.session_date ?? target.date,
    period_number: s?.period_number ?? target.period,
    subject_code: s?.subject_code ?? classes.find((c) => c.class_code === initialClass)?.subjects[0]?.subject_code ?? '',
    teacher_code: s?.teacher_code && s.teacher_code !== subjectTeacherOf(s.subject_code) ? s.teacher_code : '',
    start_time: s?.start_time ?? times.start,
    end_time: s?.end_time ?? times.end,
    room_number: s?.room_number ?? '',
    is_online: s?.is_online ?? false,
    online_url: s?.online_url ?? '',
    note: '',
  })
  const [conflicts, setConflicts] = useState<TimetableConflict[]>([])
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState<'save' | 'check' | 'cancel' | 'restore' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cls = classes.find((c) => c.class_code === form.class_code)
  const subjectTeacher = cls?.subjects.find((x) => x.subject_code === form.subject_code)
  const live = s?.status === 'SCHEDULED'
  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setChecked(false) }

  function body() {
    return {
      class_code: form.class_code, session_date: form.session_date, period_number: Number(form.period_number),
      subject_code: form.subject_code, teacher_code: form.teacher_code || null, start_time: form.start_time,
      end_time: form.end_time, room_number: form.room_number.trim() || null, is_online: form.is_online,
      online_url: form.is_online ? form.online_url || null : null, note: form.note.trim() || null,
    }
  }

  async function check() {
    setBusy('check'); setError(null)
    try {
      const r = await timetableService.checkConflicts(body(), org)
      setConflicts(r.conflicts); setChecked(true)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(null) }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy('save'); setError(null); setConflicts([])
    try {
      const moving = s && live && s.session_date === form.session_date && s.class_code === form.class_code && s.period_number !== Number(form.period_number)
      const r = await timetableService.saveSession({ ...body(), original_period_number: moving ? s.period_number : null }, org)
      toast(r.warnings.length ? `Saved — ${r.warnings.map((w) => w.message).join('; ')}` : 'Session saved', r.warnings.length ? 'info' : 'success')
      onSaved()
    } catch (err) {
      const found = conflictsOf(err)
      if (found.length) { setConflicts(found); setChecked(true) } else setError(errorMessage(err))
    } finally { setBusy(null) }
  }

  async function cancel() {
    if (!s) return
    setBusy('cancel'); setError(null)
    try {
      await timetableService.cancelSession({ class_code: s.class_code, session_date: s.session_date, period_number: s.period_number, reason: form.note.trim() || null }, org)
      toast(s.source === 'DATED' ? 'Extra session removed' : 'Cancelled for this date', 'success')
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(null) }
  }

  async function restore() {
    if (!s?.entry_id) return
    setBusy('restore'); setError(null)
    try {
      await timetableService.deleteEntry(s.entry_id, form.note.trim() || null, org)
      toast('Back to the weekly timetable for this date', 'success')
      onSaved()
    } catch (err) {
      const found = conflictsOf(err)
      if (found.length) { setConflicts(found); setChecked(true) } else setError(errorMessage(err))
    } finally { setBusy(null) }
  }

  const title = s ? `${s.subject_name ?? 'Session'} · ${s.class_name}` : 'Add a session'
  return (
    <Dialog open onClose={onClose} title={title} description={`${formatDay(form.session_date)} · Period ${form.period_number}`} className="w-[min(44rem,calc(100vw-2rem))]">
      {s && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {s.status === 'CANCELLED' && <Badge tone="bad">Cancelled on this date</Badge>}
          {s.status === 'HOLIDAY' && <Badge tone="bad">Holiday{s.holiday_name ? `: ${s.holiday_name}` : ''}</Badge>}
          {s.source === 'TEMPLATE' && live && <Badge tone="brand">Weekly period</Badge>}
          {s.source === 'OVERRIDE' && <Badge tone="warn">Changed for this date</Badge>}
          {s.source === 'DATED' && <Badge tone="ok">Extra session</Badge>}
          {s.copied_from && <Badge>Copied from {s.copied_from}</Badge>}
          {s.note && <Badge>Note: {s.note}</Badge>}
        </div>
      )}
      {s?.status === 'HOLIDAY' && <p className="mb-3 text-xs text-ink-500">Saving schedules this period anyway (it then runs despite the holiday).</p>}
      {s?.status === 'CANCELLED' && <p className="mb-3 text-xs text-ink-500">Restore it to follow the weekly timetable again, or save to run a different session in this period.</p>}
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="ds-class">Class</Label>
          <Select id="ds-class" value={form.class_code} disabled={fixedClass || !!s}
            onChange={(e) => { const c = classes.find((x) => x.class_code === e.target.value); set({ class_code: e.target.value, subject_code: c?.subjects[0]?.subject_code ?? '' }) }}>
            {classes.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor="ds-date">Date</Label><Input id="ds-date" type="date" required value={form.session_date} disabled={!!s} onChange={(e) => e.target.value && set({ session_date: e.target.value })} /></div>
          <div><Label htmlFor="ds-period">Period</Label>
            <Input id="ds-period" type="number" min={1} max={12} required value={form.period_number}
              onChange={(e) => {
                const p = Math.max(1, Math.min(12, Number(e.target.value) || 1))
                const t = bellTimes(bell, form.session_date, p)
                set(s ? { period_number: p } : { period_number: p, start_time: t.start, end_time: t.end })
              }} />
          </div>
        </div>
        {!cls?.subjects.length ? <p className="text-sm text-ink-300 sm:col-span-2">Add subjects to this class first (Classes &amp; subjects).</p> : (
          <>
            <div><Label htmlFor="ds-subject">Subject</Label>
              <Select id="ds-subject" value={form.subject_code} onChange={(e) => set({ subject_code: e.target.value })}>
                {cls.subjects.map((x) => <option key={x.subject_code} value={x.subject_code}>{x.subject_name} ({x.subject_code})</option>)}
              </Select>
            </div>
            <div><Label htmlFor="ds-teacher">Teacher</Label>
              <Select id="ds-teacher" value={form.teacher_code} onChange={(e) => set({ teacher_code: e.target.value })}>
                <option value="">Subject teacher{subjectTeacher?.teacher_name ? ` — ${subjectTeacher.teacher_name}` : ' (not assigned)'}</option>
                {teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name} (substitute / other)</option>)}
              </Select>
            </div>
            <div><Label htmlFor="ds-start">Start</Label><Input id="ds-start" type="time" required value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} /></div>
            <div><Label htmlFor="ds-end">End</Label><Input id="ds-end" type="time" required min={form.start_time} value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} /></div>
            <div><Label htmlFor="ds-room">Room</Label>
              <Input id="ds-room" list="ds-rooms" placeholder={cls.room_number ?? 'e.g. Lab-2'} maxLength={32} value={form.room_number} onChange={(e) => set({ room_number: e.target.value })} />
              <datalist id="ds-rooms">{rooms.filter((r) => r.is_active).map((r) => <option key={r.room_id} value={r.room_code}>{r.room_name ?? r.room_type}</option>)}</datalist>
            </div>
            <div className="flex items-end">
              <label className="flex h-10 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm">
                <input type="checkbox" checked={form.is_online} onChange={(e) => set({ is_online: e.target.checked })} />
                <Video className="h-4 w-4 text-ink-500" /> Online class
              </label>
            </div>
            {form.is_online && (
              <div className="sm:col-span-2"><Label htmlFor="ds-url">Meeting URL</Label>
                <Input id="ds-url" type="url" required placeholder="https://meet.google.com/…" maxLength={500} value={form.online_url} onChange={(e) => set({ online_url: e.target.value })} />
              </div>
            )}
            <div className="sm:col-span-2"><Label htmlFor="ds-note">Reason / note (optional)</Label>
              <Input id="ds-note" maxLength={300} placeholder="e.g. Substitute — Priya on leave, exam revision…" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              <p className="mt-1 text-xs text-ink-500">Kept in the change history and sent to affected students and teachers once the class's timetable is published.</p>
            </div>
          </>
        )}

        <ConflictList conflicts={conflicts} checked={checked} className="sm:col-span-2" />
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad sm:col-span-2">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {s && live && (
              <Button variant="danger" onClick={cancel} disabled={!!busy} id="cancel-session">
                {busy === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : s.source === 'DATED' ? <Trash2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                {s.source === 'DATED' ? 'Remove session' : 'Cancel on this date'}
              </Button>
            )}
            {s?.entry_id && s.source !== 'DATED' && (
              <Button variant="secondary" onClick={restore} disabled={!!busy} id="restore-session">
                {busy === 'restore' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Restore weekly period
              </Button>
            )}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="secondary" onClick={check} disabled={!!busy || !cls?.subjects.length} id="check-session">
              {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />} Check conflicts
            </Button>
            <Button type="submit" disabled={!!busy || !cls?.subjects.length} id="save-session">
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save for this date
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}
