import { useState, type FormEvent } from 'react'
import { CheckCircle2, Copy, Eye, Loader2, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { addDays, formatShort, startOfWeek } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { timetableService, type CopyScope } from '@/services/timetableService'
import type { CopyReport, Member, SchoolClass } from '@/types'

type Kind = 'day' | 'week'
type Scope = 'classes' | 'teacher' | 'all'
type Targets = 'dates' | 'range'

const REASON: Record<string, string> = {
  OCCUPIED: 'Period already taken', CONFLICT: 'Conflict', HOLIDAY: 'Holiday', NON_WORKING_DAY: 'Closed day', NOTHING_TO_COPY: 'Nothing to copy',
}

/** Copy a day (to one or more dates, or a range) or a whole week, for classes, one teacher or the whole institution. */
export function CopyDialog({ org, classes, teachers, initial, onClose, onDone }: {
  org?: string | null
  classes: SchoolClass[]
  teachers: Member[]
  initial: { date: string; class_code?: string; teacher_code?: string }
  onClose: () => void
  onDone: () => void
}) {
  const [kind, setKind] = useState<Kind>('day')
  const [scope, setScope] = useState<Scope>(initial.teacher_code ? 'teacher' : initial.class_code ? 'classes' : 'all')
  const [classCodes, setClassCodes] = useState<string[]>(initial.class_code ? [initial.class_code] : [])
  const [teacher, setTeacher] = useState(initial.teacher_code ?? teachers[0]?.user_code ?? '')
  const [source, setSource] = useState(initial.date)
  const [targets, setTargets] = useState<Targets>('dates')
  const [dates, setDates] = useState<string[]>([addDays(initial.date, 1)])
  const [range, setRange] = useState({ start: addDays(initial.date, 1), end: addDays(initial.date, 7) })
  const [targetWeek, setTargetWeek] = useState(addDays(startOfWeek(initial.date), 7))
  const [weeks, setWeeks] = useState(1)
  const [mode, setMode] = useState<'skip' | 'overwrite'>('skip')
  const [replace, setReplace] = useState(false)
  const [report, setReport] = useState<CopyReport | null>(null)
  const [busy, setBusy] = useState<'preview' | 'copy' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scopeBody = (): CopyScope => ({
    class_codes: scope === 'classes' ? classCodes : [],
    teacher_code: scope === 'teacher' ? teacher : null,
    mode, replace_target: scope !== 'teacher' && replace,
  })
  const invalid = (scope === 'classes' && classCodes.length === 0) || (scope === 'teacher' && !teacher)
    || (kind === 'day' && targets === 'dates' && (dates.length === 0 || dates.some((d) => !d || d === source)))
    || (kind === 'day' && targets === 'range' && (!range.start || !range.end || range.end < range.start))

  async function run(dry: boolean, e?: FormEvent) {
    e?.preventDefault()
    setBusy(dry ? 'preview' : 'copy'); setError(null)
    try {
      const r = kind === 'week'
        ? await timetableService.copyWeek({ ...scopeBody(), source_week: source, target_week: targetWeek, weeks, dry_run: dry }, org)
        : await timetableService.copy({ ...scopeBody(), source_date: source, dry_run: dry,
          ...(targets === 'dates' ? { target_dates: [...new Set(dates)] } : { target_start: range.start, target_end: range.end }) }, org)
      setReport(r)
      if (!dry) {
        toast(`Copied ${r.copied.length} session${r.copied.length === 1 ? '' : 's'}${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`, r.skipped.length ? 'info' : 'success')
        onDone()
      }
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(null) }
  }

  const toggleClass = (code: string) => setClassCodes((xs) => xs.includes(code) ? xs.filter((x) => x !== code) : [...xs, code])
  const chip = (on: boolean) => cn('rounded-full border px-3 py-1 text-sm transition-colors cursor-pointer', on ? 'border-brand-400 bg-brand-500/10 font-medium text-brand-600' : 'border-line text-ink-300 hover:text-fg')

  return (
    <Dialog open onClose={onClose} title="Copy timetable" description="Copies the sessions as they run on the source date (weekly periods and that day's changes)." className="w-[min(44rem,calc(100vw-2rem))]">
      <form onSubmit={(e) => run(false, e)} className="space-y-4">
        <fieldset className="flex flex-wrap gap-1.5" aria-label="What to copy">
          <legend className="sr-only">What to copy</legend>
          <button type="button" aria-pressed={kind === 'day'} className={chip(kind === 'day')} onClick={() => { setKind('day'); setReport(null) }}>A day</button>
          <button type="button" aria-pressed={kind === 'week'} className={chip(kind === 'week')} onClick={() => { setKind('week'); setReport(null) }}>A whole week</button>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="cp-source">{kind === 'day' ? 'Copy from date' : 'Copy the week of'}</Label>
            <Input id="cp-source" type="date" required value={source} onChange={(e) => { if (e.target.value) { setSource(e.target.value); setReport(null) } }} />
            {kind === 'week' && <p className="mt-1 text-xs text-ink-500">Week of {formatShort(startOfWeek(source))} (Monday–Sunday)</p>}
          </div>
          <div><Label htmlFor="cp-scope">For</Label>
            <Select id="cp-scope" value={scope} onChange={(e) => { setScope(e.target.value as Scope); setReport(null) }}>
              <option value="classes">Selected classes</option>
              <option value="teacher">One teacher's sessions</option>
              <option value="all">The whole institution</option>
            </Select>
          </div>
        </div>

        {scope === 'classes' && (
          <div><Label>Classes</Label>
            <div className="flex flex-wrap gap-1.5">
              {classes.map((c) => <button key={c.class_code} type="button" aria-pressed={classCodes.includes(c.class_code)} className={chip(classCodes.includes(c.class_code))} onClick={() => { toggleClass(c.class_code); setReport(null) }}>{c.class_name}</button>)}
            </div>
          </div>
        )}
        {scope === 'teacher' && (
          <div><Label htmlFor="cp-teacher">Teacher</Label>
            <Select id="cp-teacher" value={teacher} onChange={(e) => { setTeacher(e.target.value); setReport(null) }}>
              {teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name}</option>)}
            </Select>
          </div>
        )}

        {kind === 'day' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" aria-pressed={targets === 'dates'} className={chip(targets === 'dates')} onClick={() => { setTargets('dates'); setReport(null) }}>To specific dates</button>
              <button type="button" aria-pressed={targets === 'range'} className={chip(targets === 'range')} onClick={() => { setTargets('range'); setReport(null) }}>To every working day in a range</button>
            </div>
            {targets === 'dates' ? (
              <div className="flex flex-wrap items-end gap-2">
                {dates.map((d, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input type="date" aria-label={`Target date ${i + 1}`} className="w-40" required value={d}
                      onChange={(e) => { setDates((xs) => xs.map((x, j) => (j === i ? e.target.value : x))); setReport(null) }} />
                    {dates.length > 1 && <Button size="icon" variant="ghost" aria-label={`Remove target date ${i + 1}`} onClick={() => setDates((xs) => xs.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>}
                  </div>
                ))}
                <Button size="sm" variant="secondary" onClick={() => setDates((xs) => [...xs, addDays(xs[xs.length - 1] ?? source, 1)])} disabled={dates.length >= 62}><Plus className="h-3.5 w-3.5" /> Add date</Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor="cp-from">From</Label><Input id="cp-from" type="date" required value={range.start} onChange={(e) => { setRange((r) => ({ ...r, start: e.target.value })); setReport(null) }} /></div>
                <div><Label htmlFor="cp-to">Until</Label><Input id="cp-to" type="date" required min={range.start} value={range.end} onChange={(e) => { setRange((r) => ({ ...r, end: e.target.value })); setReport(null) }} /></div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="cp-week">Into the week of</Label><Input id="cp-week" type="date" required value={targetWeek} onChange={(e) => { if (e.target.value) { setTargetWeek(e.target.value); setReport(null) } }} /></div>
            <div><Label htmlFor="cp-weeks">Repeat for</Label>
              <Select id="cp-weeks" value={weeks} onChange={(e) => { setWeeks(Number(e.target.value)); setReport(null) }}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} week{n === 1 ? '' : 's'}</option>)}
              </Select>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="cp-mode">If a target period is already taken</Label>
            <Select id="cp-mode" value={mode} onChange={(e) => { setMode(e.target.value as 'skip' | 'overwrite'); setReport(null) }}>
              <option value="skip">Keep it (skip that period)</option>
              <option value="overwrite">Replace it with the copied session</option>
            </Select>
          </div>
          {scope !== 'teacher' && (
            <label className="flex items-start gap-2 self-end rounded-xl border border-line p-2.5 text-sm">
              <input type="checkbox" className="mt-0.5" checked={replace} onChange={(e) => { setReplace(e.target.checked); setReport(null) }} />
              <span>Make the target day identical<span className="block text-xs text-ink-500">Also cancels the target's other periods for these classes.</span></span>
            </label>
          )}
        </div>

        {report && <CopyResult report={report} />}
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="secondary" disabled={!!busy || invalid} onClick={() => run(true)} id="preview-copy">
            {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Preview
          </Button>
          <Button type="submit" disabled={!!busy || invalid} id="run-copy">
            {busy === 'copy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Copy
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function CopyResult({ report }: { report: CopyReport }) {
  return (
    <section aria-live="polite" className="space-y-2 rounded-xl border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg">{report.dry_run ? 'Preview — nothing saved yet' : 'Done'}</span>
        <Badge tone="ok"><CheckCircle2 className="h-3 w-3" /> {report.copied.length} {report.dry_run ? 'to copy' : 'copied'}</Badge>
        {report.unchanged > 0 && <Badge>{report.unchanged} already the same</Badge>}
        {report.cancelled.length > 0 && <Badge tone="warn">{report.cancelled.length} {report.dry_run ? 'to cancel' : 'cancelled'}</Badge>}
        {report.skipped.length > 0 && <Badge tone="bad">{report.skipped.length} skipped</Badge>}
        {report.non_working_days_skipped > 0 && <Badge>{report.non_working_days_skipped} closed day(s) left out</Badge>}
      </div>
      {report.copied.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-ink-500">Sessions {report.dry_run ? 'to copy' : 'copied'}</summary>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs text-ink-300">
            {report.copied.map((c, i) => <li key={i}>{formatShort(c.date)} · {c.class_code} P{c.period_number} {c.subject_name} ({c.start_time}–{c.end_time}){c.action === 'REPLACED' ? ' — replaces the existing period' : ''}</li>)}
          </ul>
        </details>
      )}
      {report.cancelled.length > 0 && (
        <ul className="max-h-32 space-y-0.5 overflow-auto text-xs text-warn">
          {report.cancelled.map((c, i) => <li key={i}>{formatShort(c.date)} · {c.class_code} P{c.period_number} {c.subject_name} will not run</li>)}
        </ul>
      )}
      {report.skipped.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-auto text-xs">
          {report.skipped.map((s, i) => (
            <li key={i} className="flex flex-wrap gap-1.5">
              <span className="rounded bg-bad/15 px-1.5 font-semibold text-bad">{REASON[s.reason] ?? s.reason}</span>
              <span className="text-ink-300">{formatShort(s.date)}{s.class_code ? ` · ${s.class_code}` : ''}{s.period_number ? ` P${s.period_number}` : ''}{s.subject_name ? ` ${s.subject_name}` : ''} — {s.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
