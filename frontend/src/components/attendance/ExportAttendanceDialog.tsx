import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, Loader2, Sheet, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { classroomService, downloadBlob } from '@/services/classroomService'
import { presetRange, type RangePreset } from '@/lib/datetime'
import { cn } from '@/lib/utils'

type Report = 'register' | 'summary' | 'defaulters'
type Fmt = 'xlsx' | 'csv'
export interface ExportClass { class_code: string; class_name: string; subjects: { subject_code: string; subject_name: string }[] }

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'this_month', label: 'This month' }, { id: 'last_month', label: 'Last month' },
  { id: 'last_3_months', label: 'Last 3 months' }, { id: 'year_to_date', label: 'Academic year' }, { id: 'custom', label: 'Custom' },
]
const REPORTS: { id: Report; label: string; hint: string; icon: typeof Sheet }[] = [
  { id: 'register', label: 'Day-wise register', hint: 'P / A / L / LV for every marked day', icon: Sheet },
  { id: 'summary', label: 'Student summary', hint: 'Totals and % per student', icon: Users },
  { id: 'defaulters', label: 'Defaulters only', hint: 'Students below the threshold', icon: AlertTriangle },
]

/**
 * Attendance export for teachers and admins. `allowAllClasses` (admins) adds an "All classes" scope;
 * the server enforces what each role may export.
 */
export function ExportAttendanceDialog({ open, onClose, classes, allowAllClasses = false, org, initial }: {
  open: boolean
  onClose: () => void
  classes: ExportClass[]
  allowAllClasses?: boolean
  org?: string | null
  initial?: { class_code?: string; subject_code?: string; month?: string }
}) {
  const [klass, setKlass] = useState(initial?.class_code ?? (allowAllClasses ? '' : classes[0]?.class_code ?? ''))
  const [subject, setSubject] = useState(initial?.subject_code ?? '')
  const [preset, setPreset] = useState<RangePreset>(initial?.month ? 'custom' : 'this_month')
  const [range, setRange] = useState(() => initial?.month ? monthRange(initial.month) : presetRange('this_month'))
  const [report, setReport] = useState<Report>('register')
  const [fmt, setFmt] = useState<Fmt>('xlsx')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const cls = classes.find((c) => c.class_code === klass)
  const subjects = cls?.subjects ?? []
  const valid = range.start && range.end && range.start <= range.end && (allowAllClasses || klass)

  function pickPreset(p: RangePreset) {
    setPreset(p); setMsg(null)
    if (p !== 'custom') setRange(presetRange(p))
  }

  async function download() {
    setBusy(true); setMsg(null)
    try {
      const { blob, filename } = await classroomService.exportAttendance({
        start: range.start, end: range.end, report, fmt,
        ...(klass ? { class_code: klass } : {}), ...(subject ? { subject_code: subject } : {}), ...(org ? { org_code: org } : {}),
      })
      downloadBlob(blob, filename)
      setMsg({ ok: true, text: `Downloaded ${filename}` })
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Export attendance" description="Download registers and reports for any period as Excel or CSV." className="w-[min(40rem,calc(100vw-2rem))]">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="x-class">Class</Label>
            <Select id="x-class" value={klass} onChange={(e) => { setKlass(e.target.value); setSubject(''); setMsg(null) }}>
              {allowAllClasses && <option value="">All classes</option>}
              {classes.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="x-subject">Subject</Label>
            <Select id="x-subject" value={subject} onChange={(e) => { setSubject(e.target.value); setMsg(null) }} disabled={!klass}>
              <option value="">{klass ? 'All subjects' : 'All subjects of every class'}</option>
              {subjects.map((s) => <option key={s.subject_code} value={s.subject_code}>{s.subject_name} ({s.subject_code})</option>)}
            </Select>
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-100">Period</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Period">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} onClick={() => pickPreset(p.id)}
                className={cn('cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  preset === p.id ? 'border-brand-400 bg-brand-500/10 text-brand-600' : 'border-line text-ink-300 hover:border-line-strong hover:text-fg')}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div><Label htmlFor="x-start">From</Label><Input id="x-start" type="date" value={range.start} max={range.end} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, start: e.target.value })); setMsg(null) }} /></div>
            <div><Label htmlFor="x-end">To</Label><Input id="x-end" type="date" value={range.end} min={range.start} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, end: e.target.value })); setMsg(null) }} /></div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-100">Report</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Report">
            {REPORTS.map(({ id, label, hint, icon: Icon }) => (
              <button key={id} type="button" role="radio" aria-checked={report === id} onClick={() => { setReport(id); setMsg(null) }}
                className={cn('cursor-pointer rounded-xl border p-3 text-left transition-colors',
                  report === id ? 'border-brand-400 bg-brand-500/8 ring-1 ring-brand-400/30' : 'border-line hover:border-line-strong')}>
                <Icon className={cn('h-4.5 w-4.5', report === id ? 'text-brand-600' : 'text-ink-500')} />
                <div className="mt-1.5 text-sm font-medium text-fg">{label}</div>
                <div className="text-xs text-ink-500">{hint}</div>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-100">Format</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Format">
            {([['xlsx', 'Excel (.xlsx)', FileSpreadsheet], ['csv', 'CSV', FileText]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" role="radio" aria-checked={fmt === id} onClick={() => setFmt(id)}
                className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                  fmt === id ? 'border-brand-400 bg-brand-500/10 font-medium text-brand-600' : 'border-line text-ink-300 hover:text-fg')}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-500">{fmt === 'xlsx' ? 'Formatted workbook: overview sheet, one sheet per class-subject, absences and low attendance highlighted.' : 'Plain table for spreadsheets or other systems.'}</p>
        </fieldset>

        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-sm', msg.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>
            {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}{msg.text}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={download} disabled={busy || !valid} id="export-download">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}
