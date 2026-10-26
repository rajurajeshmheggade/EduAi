import { useEffect, useState } from 'react'
import { CalendarCheck, TriangleAlert } from 'lucide-react'
import { STATUS_META, STATUS_ORDER } from '@/components/attendance/status'
import { MonthPicker } from '@/components/attendance/RegisterGrid'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { StatCard, fmtPct, pctTone } from '@/components/ui/stat'
import { errorMessage } from '@/services/apiClient'
import { isoMonth, monthLabel } from '@/services/classroomService'
import { classroomService } from '@/services/classroomService'
import { cn } from '@/lib/utils'
import type { StudentAttendance, StudentSubjectAttendance } from '@/types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Student: own attendance per subject for a chosen month, with a calendar and a month-by-month trend. */
export default function MyAttendance() {
  const [month, setMonth] = useState(isoMonth())
  const [data, setData] = useState<StudentAttendance | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null); setError(null)
    classroomService.myAttendance(month).then(setData).catch((e) => setError(errorMessage(e)))
  }, [month])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <h1 className="font-display text-3xl font-bold">My <span className="text-gradient">attendance</span></h1>
          <p className="mt-1 text-sm text-ink-300">Subject-wise, month by month.{data && ` Minimum required: ${data.threshold}%.`}</p>
        </div>
        <MonthPicker value={month} onChange={setMonth} />
      </header>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {!data ? !error && <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-48" />)}</div> : (
        <>
          <section className="grid gap-4 sm:grid-cols-3" aria-label="Summary">
            <StatCard label={monthLabel(month)} value={fmtPct(data.summary.percentage)} tone={pctTone(data.summary.percentage, data.threshold)}
              hint={`${data.summary.present + data.summary.late} attended of ${data.summary.total - data.summary.excused} periods`} icon={CalendarCheck} />
            <StatCard label="Overall (this year)" value={fmtPct(data.overall.percentage)} tone={pctTone(data.overall.percentage, data.threshold)} hint={`${data.overall.total} periods marked`} />
            <StatCard label="Subjects below minimum" value={data.subjects.filter((s) => s.is_below_threshold).length}
              tone={data.subjects.some((s) => s.is_below_threshold) ? 'text-bad' : 'text-ok'} hint={`of ${data.subjects.length} subjects`} />
          </section>

          {data.subjects.length === 0 ? (
            <Card className="p-10 text-center text-sm text-ink-300">No subjects yet for your class.</Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {data.subjects.map((s) => <SubjectCard key={s.subject_code} s={s} month={month} threshold={data.threshold} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SubjectCard({ s, month, threshold }: { s: StudentSubjectAttendance; month: string; threshold: number }) {
  const pct = s.month.percentage
  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{s.subject_name}</CardTitle>
            <div className="font-mono text-xs text-ink-500">{s.subject_code}</div>
          </div>
          <div className="text-right">
            <div className={cn('font-display text-3xl font-bold tabular-nums', pctTone(pct, threshold))}>{fmtPct(pct)}</div>
            <div className="text-xs text-ink-500">this month</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={pct ?? 0} tone={pct != null && pct < threshold ? 'bad' : 'ok'} />
        <div className="flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((st) => <Badge key={st} className={cn('border-transparent', STATUS_META[st].cell)}>{STATUS_META[st].label} {s.month[st]}</Badge>)}
        </div>
        {s.is_below_threshold && (
          <p className="flex items-center gap-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> Overall {fmtPct(s.overall.percentage)} is below the {threshold}% minimum.
          </p>
        )}
        <MonthCalendar month={month} records={s.records} />
        {s.trend.length > 1 && <Trend trend={s.trend} threshold={threshold} />}
      </CardContent>
    </Card>
  )
}

function MonthCalendar({ month, records }: { month: string; records: StudentSubjectAttendance['records'] }) {
  const first = new Date(`${month}-01T00:00:00`)
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const offset = (first.getDay() + 6) % 7 // Monday-first
  const byDay = new Map<number, StudentSubjectAttendance['records']>()
  records.forEach((r) => { const d = Number(r.date.slice(8)); byDay.set(d, [...(byDay.get(d) ?? []), r]) })

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase text-ink-500">{WEEKDAYS.map((w) => <div key={w}>{w}</div>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => <div key={`x${i}`} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const recs = byDay.get(i + 1) ?? []
          const main = recs.find((r) => r.status === 'absent')?.status ?? recs[0]?.status
          return (
            <div key={i} title={recs.map((r) => `${r.session_slot}: ${STATUS_META[r.status].label}${r.remarks ? ` — ${r.remarks}` : ''}`).join('\n') || undefined}
              className={cn('grid aspect-square place-items-center rounded-md text-xs tabular-nums', main ? STATUS_META[main].cell + ' font-semibold' : 'text-ink-500')}>
              {i + 1}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Trend({ trend, threshold }: { trend: StudentSubjectAttendance['trend']; threshold: number }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-500">Month-wise trend</div>
      <div className="flex h-20 items-end gap-1.5" role="list">
        {trend.slice(-8).map((t) => (
          <div key={t.month} role="listitem" className="flex flex-1 flex-col items-center gap-1" title={`${monthLabel(t.month)}: ${fmtPct(t.percentage)}`}>
            <div className="flex w-full flex-1 items-end rounded bg-ink-800">
              <div className={cn('w-full rounded', t.percentage != null && t.percentage < threshold ? 'bg-bad/70' : 'bg-ok/70')} style={{ height: `${t.percentage ?? 0}%` }} />
            </div>
            <span className="text-[10px] text-ink-500">{new Date(`${t.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' })}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
