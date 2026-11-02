import { useState } from 'react'
import { BellRing, CalendarDays, Coffee, Loader2, Plus, RotateCcw, Save, Trash2, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/field'
import { ErrorState, Skeleton } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { minutes } from '@/lib/calendar'
import { bellProblems, DAY_NAMES } from '@/lib/timetable'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { timetableService } from '@/services/timetableService'
import type { BellItem, BellSchedule } from '@/types'

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`

/** Working days (Mon–Sun; Saturday and Sunday optional) and the bell schedule with named breaks. */
export function BellSchedulePanel({ org }: { org?: string | null }) {
  return (
    <div className="space-y-4">
      <WorkingDaysCard org={org} />
      <BellEditor org={org} />
    </div>
  )
}

function WorkingDaysCard({ org }: { org?: string | null }) {
  const { data, error, retry } = useAsync(() => timetableService.workingDays(org), [org])
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-brand-600" /> Working days</CardTitle>
        <CardDescription>Days the institution schedules classes. Saturday and Sunday are optional; on a closed day weekly periods don't run and nothing new can be scheduled.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? <ErrorState message={error} onRetry={retry} /> : !data ? <Skeleton className="h-12" />
          : <WorkingDaysForm key={data.working_days.join()} org={org} initial={data} />}
      </CardContent>
    </Card>
  )
}

function WorkingDaysForm({ org, initial }: { org?: string | null; initial: { working_days: number[]; weekly_periods_on_closed_days: number } }) {
  const [saved, setSaved] = useState(initial)
  const [days, setDays] = useState(initial.working_days)
  const [busy, setBusy] = useState(false)
  const closedPeriods = saved.weekly_periods_on_closed_days

  async function save() {
    if (!days.length) return
    setBusy(true)
    try {
      const r = await timetableService.setWorkingDays(days, org)
      setSaved(r); setDays(r.working_days)
      toast('Working days saved', 'success')
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  const dirty = days.join() !== saved.working_days.join()
  return (
    <div className="space-y-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Working days</legend>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const on = days.includes(d)
          return (
            <label key={d} className={cn('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
              on ? 'border-brand-400 bg-brand-500/10 text-brand-600' : 'border-line text-ink-300', d >= 6 && 'border-dashed')}>
              <input type="checkbox" checked={on} onChange={() => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort()))} />
              {DAY_NAMES[d]}
            </label>
          )
        })}
      </fieldset>
      {days.length === 0 && <p className="text-xs text-bad">Keep at least one working day.</p>}
      {closedPeriods > 0 && <p className="text-xs text-warn">{closedPeriods} weekly period{closedPeriods === 1 ? ' is' : 's are'} on a closed day — kept, but not scheduled until the day is opened again.</p>}
      <Button size="sm" onClick={save} disabled={busy || !dirty || days.length === 0} id="save-working-days">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save working days
      </Button>
    </div>
  )
}

function BellEditor({ org }: { org?: string | null }) {
  const { data, error, retry } = useAsync(() => timetableService.bellSchedule(org), [org])
  return (
    <Card>
      {error ? <CardContent className="pt-5"><ErrorState message={error} onRetry={retry} /></CardContent>
        : !data ? <CardContent className="pt-5"><Skeleton className="h-64" /></CardContent>
          : <BellForm org={org} initial={data} />}
    </Card>
  )
}

function itemsFor(bell: BellSchedule, day: number | null): BellItem[] {
  return day === null ? bell.default : bell.by_day[String(day)] ?? bell.default
}

function BellForm({ org, initial }: { org?: string | null; initial: BellSchedule }) {
  const [bell, setBell] = useState<BellSchedule>(initial)
  const [day, setDayState] = useState<number | null>(null)
  const [items, setItems] = useState<BellItem[]>(initial.default)
  const [busy, setBusy] = useState(false)
  const [gen, setGen] = useState({ start: '09:00', length: 45, count: 8, breakAfter: 3, breakLen: 15, lunchAfter: 0, lunchLen: 30 })
  const setDay = (d: number | null) => { setDayState(d); setItems(itemsFor(bell, d)) }

  const own = day !== null && !!bell.by_day[String(day)]
  const problems = bellProblems(items)

  async function save(next: BellItem[] = items) {
    setBusy(true)
    try {
      const b = await timetableService.setBellSchedule(day, next, org)
      setBell(b); setItems(itemsFor(b, day))
      toast(next.length ? 'Bell schedule saved' : day === null ? 'Back to the built-in bell' : `${DAY_NAMES[day!]} now follows the default bell`, 'success')
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  function addPeriod() {
    const nums = items.filter((i) => i.item_kind === 'PERIOD').map((i) => i.period_number ?? 0)
    const next = Math.min(12, (nums.length ? Math.max(...nums) : 0) + 1)
    const last = items.length ? Math.max(...items.map((i) => minutes(i.end_time))) : 9 * 60
    setItems((xs) => [...xs, { item_kind: 'PERIOD', period_number: next, label: null, start_time: hhmm(last), end_time: hhmm(last + 45) }])
  }
  function addBreak() {
    const last = items.length ? Math.max(...items.map((i) => minutes(i.end_time))) : 11 * 60
    setItems((xs) => [...xs, { item_kind: 'BREAK', period_number: null, label: 'Break', start_time: hhmm(last), end_time: hhmm(last + 15) }])
  }
  function generate() {
    const out: BellItem[] = []
    let t = minutes(gen.start)
    for (let n = 1; n <= Math.min(12, gen.count); n++) {
      out.push({ item_kind: 'PERIOD', period_number: n, label: null, start_time: hhmm(t), end_time: hhmm(t + gen.length) })
      t += gen.length
      if (gen.breakAfter === n && gen.breakLen > 0) { out.push({ item_kind: 'BREAK', period_number: null, label: 'Short break', start_time: hhmm(t), end_time: hhmm(t + gen.breakLen) }); t += gen.breakLen }
      if (gen.lunchAfter === n && gen.lunchLen > 0) { out.push({ item_kind: 'BREAK', period_number: null, label: 'Lunch', start_time: hhmm(t), end_time: hhmm(t + gen.lunchLen) }); t += gen.lunchLen }
    }
    setItems(out)
  }
  const update = (i: number, patch: Partial<BellItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4 text-brand-600" /> Bell schedule &amp; breaks</CardTitle>
          <CardDescription>Period timings and named breaks. New sessions take their times from here; attendance offers these periods.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {!bell.configured && <Badge tone="neutral">Built-in bell</Badge>}
          <Select aria-label="Which bell" className="w-56" value={day ?? ''} onChange={(e) => setDay(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Default (every day)</option>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}{bell.by_day[String(d)] ? ' — own bell' : ''}</option>)}
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {day !== null && !own && <p className="rounded-lg border border-line bg-ink-800 px-3 py-2 text-xs text-ink-300">{DAY_NAMES[day]} follows the default bell. Edit below and save to give it its own (e.g. a half day).</p>}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-ink-800 text-xs text-ink-500">
              <tr><th scope="col" className="px-2 py-2 text-left font-medium">Type</th><th scope="col" className="px-2 py-2 text-left font-medium">Period / name</th><th scope="col" className="px-2 py-2 text-left font-medium">Start</th><th scope="col" className="px-2 py-2 text-left font-medium">End</th><th scope="col" className="px-2 py-2"><span className="sr-only">Remove</span></th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className={cn('border-t border-line', it.item_kind === 'BREAK' && 'bg-ink-800/50')}>
                  <td className="px-2 py-1.5">
                    <Select aria-label={`Row ${i + 1} type`} className="h-9 w-28" value={it.item_kind}
                      onChange={(e) => update(i, e.target.value === 'BREAK' ? { item_kind: 'BREAK', period_number: null, label: it.label || 'Break' } : { item_kind: 'PERIOD', period_number: i + 1, label: null })}>
                      <option value="PERIOD">Period</option><option value="BREAK">Break</option>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    {it.item_kind === 'PERIOD'
                      ? <Input aria-label={`Row ${i + 1} period number`} type="number" min={1} max={12} className="h-9 w-20" value={it.period_number ?? ''} onChange={(e) => update(i, { period_number: Number(e.target.value) || null })} />
                      : <Input aria-label={`Row ${i + 1} break name`} className="h-9 w-40" maxLength={60} value={it.label ?? ''} onChange={(e) => update(i, { label: e.target.value })} />}
                  </td>
                  <td className="px-2 py-1.5"><Input aria-label={`Row ${i + 1} start`} type="time" className="h-9 w-32" value={it.start_time} onChange={(e) => update(i, { start_time: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><Input aria-label={`Row ${i + 1} end`} type="time" className="h-9 w-32" value={it.end_time} onChange={(e) => update(i, { end_time: e.target.value })} /></td>
                  <td className="px-2 py-1.5 text-right"><Button size="icon" variant="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-300">No periods yet — add some or fill a standard day below.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={addPeriod}><Plus className="h-3.5 w-3.5" /> Period</Button>
          <Button size="sm" variant="secondary" onClick={addBreak}><Coffee className="h-3.5 w-3.5" /> Break</Button>
        </div>

        <details className="rounded-xl border border-line p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg"><Wand2 className="h-4 w-4 text-brand-600" /> Fill a standard day</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div><Label htmlFor="g-start">First period</Label><Input id="g-start" type="time" value={gen.start} onChange={(e) => setGen({ ...gen, start: e.target.value })} /></div>
            <div><Label htmlFor="g-len">Minutes each</Label><Input id="g-len" type="number" min={10} max={180} value={gen.length} onChange={(e) => setGen({ ...gen, length: Number(e.target.value) || 45 })} /></div>
            <div><Label htmlFor="g-count">Periods</Label><Input id="g-count" type="number" min={1} max={12} value={gen.count} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) || 1 })} /></div>
            <div><Label htmlFor="g-break">Break after period</Label><Input id="g-break" type="number" min={0} max={12} value={gen.breakAfter} onChange={(e) => setGen({ ...gen, breakAfter: Number(e.target.value) })} /></div>
            <div><Label htmlFor="g-blen">Break minutes</Label><Input id="g-blen" type="number" min={0} max={120} value={gen.breakLen} onChange={(e) => setGen({ ...gen, breakLen: Number(e.target.value) })} /></div>
            <div><Label htmlFor="g-lunch">Lunch after period</Label><Input id="g-lunch" type="number" min={0} max={12} value={gen.lunchAfter} onChange={(e) => setGen({ ...gen, lunchAfter: Number(e.target.value) })} /></div>
            <div><Label htmlFor="g-llen">Lunch minutes</Label><Input id="g-llen" type="number" min={0} max={120} value={gen.lunchLen} onChange={(e) => setGen({ ...gen, lunchLen: Number(e.target.value) })} /></div>
            <div className="flex items-end"><Button size="sm" variant="secondary" onClick={generate} className="w-full"><Wand2 className="h-3.5 w-3.5" /> Fill</Button></div>
          </div>
        </details>

        {problems.length > 0 && <ul role="alert" className="list-inside list-disc rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save()} disabled={busy || problems.length > 0 || items.length === 0} id="save-bell">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save {day === null ? 'default bell' : `${DAY_NAMES[day]}'s bell`}
          </Button>
          {day !== null && own && <Button variant="secondary" disabled={busy} onClick={() => save([])}><RotateCcw className="h-4 w-4" /> Use the default bell on {DAY_NAMES[day]}</Button>}
          {day === null && bell.configured && <Button variant="ghost" disabled={busy} onClick={() => save([])}><RotateCcw className="h-4 w-4" /> Reset default to the built-in bell</Button>}
        </div>
      </CardContent>
    </>
  )
}
