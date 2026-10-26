import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarCheck, CheckCheck, Download, Loader2, Save, Sheet } from 'lucide-react'
import { STATUS_META, STATUS_ORDER } from '@/components/attendance/status'
import { MonthPicker, RegisterGrid } from '@/components/attendance/RegisterGrid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/field'
import { Tabs } from '@/components/ui/tabs'
import { PERIODS } from '@/lib/timetable'
import { errorMessage } from '@/services/apiClient'
import { classroomService, isoDay, isoMonth } from '@/services/classroomService'
import { cn } from '@/lib/utils'
import { ExportAttendanceDialog } from '@/components/attendance/ExportAttendanceDialog'
import type { AttendanceRegister, AttendanceStatus, DayRosterRow, TeacherClass } from '@/types'


/** Teacher: subject-wise attendance — mark a session, or review the monthly register (FR-T3-01/02). */
export default function TeacherAttendance() {
  // Deep links from the timetable / dashboard: ?class=…&subject=…&period=N
  const [params] = useSearchParams()
  const linkPeriod = Number(params.get('period'))
  const initialSlot = linkPeriod >= 1 && linkPeriod <= PERIODS.length ? `Period-${linkPeriod}` : PERIODS[0]
  const [classes, setClasses] = useState<TeacherClass[] | null>(null)
  const [klass, setKlass] = useState('')
  const [subject, setSubject] = useState('')
  const [tab, setTab] = useState<'mark' | 'register'>('mark')
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<{ month?: string } | null>(null)

  useEffect(() => {
    classroomService.myClasses().then((c) => {
      setClasses(c)
      const linked = c.find((x) => x.class_code === params.get('class'))
      const first = linked ?? c[0]
      if (first) {
        setKlass(first.class_code)
        const s = first.subjects.find((x) => x.subject_code === params.get('subject')) ?? first.subjects[0]
        setSubject(s?.subject_code ?? '')
      }
    }).catch((e) => setError(errorMessage(e)))
  }, [params])

  const cls = classes?.find((c) => c.class_code === klass)

  if (classes && classes.length === 0) {
    return <div className="grid h-full place-items-center p-8 text-center text-sm text-ink-300"><div><CalendarCheck className="mx-auto mb-3 h-10 w-10 text-ink-500" />You are not assigned to any class yet.</div></div>
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <h1 className="font-display text-3xl font-bold">Subject-wise <span className="text-gradient">attendance</span></h1>
          <p className="mt-1 text-sm text-ink-300">Mark attendance for the subjects you teach — class teachers can mark every subject of their class.</p>
        </div>
        <Button variant="secondary" id="open-export" disabled={!classes?.length} onClick={() => setExporting({})}><Download className="h-4 w-4" /> Export attendance</Button>
      </header>

      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div><Label htmlFor="a-class">Class</Label>
            <Select id="a-class" value={klass} onChange={(e) => { const c = classes?.find((x) => x.class_code === e.target.value); setKlass(e.target.value); setSubject(c?.subjects[0]?.subject_code ?? '') }}>
              {classes?.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}{c.is_class_teacher ? ' (class teacher)' : ''}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="a-subject">Subject</Label>
            <Select id="a-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!cls?.subjects.length}>
              {cls?.subjects.map((s) => <option key={s.subject_code} value={s.subject_code}>{s.subject_name} ({s.subject_code})</option>)}
              {!cls?.subjects.length && <option>No subjects in this class</option>}
            </Select>
          </div>
          <Tabs items={[{ id: 'mark', label: 'Mark', icon: CheckCheck }, { id: 'register', label: 'Monthly register', icon: Sheet }]} value={tab} onChange={setTab} />
        </CardContent>
      </Card>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {!classes ? <div className="skeleton h-64" /> : klass && subject && (tab === 'mark'
        ? <MarkSession key={`${klass}-${subject}`} klass={klass} subject={subject} initialSlot={initialSlot} />
        : <Register key={`${klass}-${subject}`} klass={klass} subject={subject} onExport={(month) => setExporting({ month })} />)}
      {exporting && classes && (
        <ExportAttendanceDialog open onClose={() => setExporting(null)} classes={classes}
          initial={{ class_code: klass, subject_code: exporting.month ? subject : '', month: exporting.month }} />
      )}
    </div>
  )
}

function MarkSession({ klass, subject, initialSlot }: { klass: string; subject: string; initialSlot: string }) {
  const [day, setDay] = useState(isoDay())
  const [slot, setSlot] = useState(initialSlot)
  const [rows, setRows] = useState<DayRosterRow[] | null>(null)
  const [marks, setMarks] = useState<Record<string, { status: AttendanceStatus | null; remarks: string }>>({})
  const [saved, setSaved] = useState<string>('')
  const [wasMarked, setWasMarked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setRows(null); setMsg(null)
    try {
      const d = await classroomService.day({ class_code: klass, subject_code: subject, attendance_date: day, session_slot: slot })
      const m = Object.fromEntries(d.students.map((s) => [s.student_user_code, { status: s.status, remarks: s.remarks ?? '' }]))
      setRows(d.students); setMarks(m); setSaved(JSON.stringify(m)); setWasMarked(d.is_marked)
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) }
  }, [klass, subject, day, slot])
  useEffect(() => { void load() }, [load])

  const dirty = JSON.stringify(marks) !== saved
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 }
    Object.values(marks).forEach((m) => { if (m.status) c[m.status]++; else c.unmarked++ })
    return c
  }, [marks])

  const setAll = (status: AttendanceStatus) => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, status }])))
  const setOne = (code: string, status: AttendanceStatus) => setMarks((m) => ({ ...m, [code]: { ...m[code], status } }))

  async function save() {
    const records = Object.entries(marks).filter(([, v]) => v.status).map(([k, v]) => ({ student_user_code: k, status: v.status!, remarks: v.remarks || null }))
    if (!records.length) return
    setBusy(true); setMsg(null)
    try {
      const r = await classroomService.save({ class_code: klass, subject_code: subject, attendance_date: day, session_slot: slot, records })
      setSaved(JSON.stringify(marks)); setWasMarked(true)
      setMsg({ ok: true, text: `Saved ${r.saved} record${r.saved === 1 ? '' : 's'}.` })
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="a-date">Date</Label><Input id="a-date" type="date" className="w-44" max={isoDay()} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
          <div><Label htmlFor="a-slot">Period</Label>
            <Select id="a-slot" className="w-40" value={slot} onChange={(e) => setSlot(e.target.value)}>{PERIODS.map((s) => <option key={s} value={s}>{s.replace('-', ' ')}</option>)}</Select>
          </div>
          <div className="flex flex-wrap gap-1.5 pb-1">
            {wasMarked ? <Badge tone="ok">Already marked — editing</Badge> : <Badge tone="warn">Not marked yet</Badge>}
            {STATUS_ORDER.map((s) => <Badge key={s} className={STATUS_META[s].cell + ' border-transparent'}>{STATUS_META[s].label} {counts[s]}</Badge>)}
            {counts.unmarked > 0 && <Badge>Unmarked {counts.unmarked}</Badge>}
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => setAll('present')} disabled={!rows?.length} id="mark-all-present"><CheckCheck className="h-4 w-4" /> All present</Button>
          </div>
        </div>

        {!rows ? <div className="skeleton h-64" /> : rows.length === 0 ? <p className="py-12 text-center text-sm text-ink-300">No students in this class yet. The class teacher can add them under My classes.</p> : (
          <div className="divide-y divide-line rounded-xl border border-line">
            {rows.map((s) => {
              const m = marks[s.student_user_code]
              return (
                <div key={s.student_user_code} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="w-8 text-right text-sm tabular-nums text-ink-500">{s.roll_number ?? ''}</span>
                  <div className="min-w-40 flex-1"><div className="text-sm font-medium text-fg">{s.full_name}</div><div className="font-mono text-[11px] text-ink-500">{s.student_user_code}</div></div>
                  <div role="radiogroup" aria-label={`Attendance for ${s.full_name}`} className="flex gap-1">
                    {STATUS_ORDER.map((st) => (
                      <button key={st} role="radio" aria-checked={m?.status === st} title={STATUS_META[st].label}
                        onClick={() => setOne(s.student_user_code, st)}
                        className={cn('h-9 min-w-9 cursor-pointer rounded-lg border px-2.5 text-xs font-semibold transition-all',
                          m?.status === st ? STATUS_META[st].active : cn('border-line bg-ink-900 text-ink-500', STATUS_META[st].idle))}>
                        <span className="sm:hidden">{STATUS_META[st].short}</span><span className="hidden sm:inline">{STATUS_META[st].label}</span>
                      </button>
                    ))}
                  </div>
                  {m?.status && m.status !== 'present' && (
                    <Input aria-label={`Remarks for ${s.full_name}`} className="h-9 w-full sm:w-52" placeholder="Remarks (optional)" maxLength={300}
                      value={m.remarks} onChange={(e) => setMarks((x) => ({ ...x, [s.student_user_code]: { ...x[s.student_user_code], remarks: e.target.value } }))} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="sticky bottom-0 -mx-5 flex items-center justify-end gap-3 border-t border-line bg-ink-900/95 px-5 py-3 backdrop-blur">
          {msg && <span role="status" className={cn('mr-auto text-sm', msg.ok ? 'text-ok' : 'text-bad')}>{msg.text}</span>}
          {dirty && !msg && <span className="mr-auto text-sm text-warn">Unsaved changes</span>}
          <Button onClick={save} disabled={busy || !dirty || counts.unmarked === rows?.length} id="save-attendance">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save attendance
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Register({ klass, subject, onExport }: { klass: string; subject: string; onExport: (month: string) => void }) {
  const [month, setMonth] = useState(isoMonth())
  const [reg, setReg] = useState<AttendanceRegister | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setReg(null); setError(null)
    classroomService.register({ class_code: klass, subject_code: subject, month }).then(setReg).catch((e) => setError(errorMessage(e)))
  }, [klass, subject, month])

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthPicker value={month} onChange={setMonth} />
          <Button variant="secondary" disabled={!reg?.marked_days.length} onClick={() => onExport(month)}>
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {reg ? <RegisterGrid reg={reg} /> : !error && <div className="skeleton h-64" />}
      </CardContent>
    </Card>
  )
}
