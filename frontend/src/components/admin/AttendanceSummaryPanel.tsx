import { useEffect, useState } from 'react'
import { Download, Eye } from 'lucide-react'
import { ExportAttendanceDialog } from '@/components/attendance/ExportAttendanceDialog'
import { MonthPicker, RegisterGrid } from '@/components/attendance/RegisterGrid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fmtPct, pctTone } from '@/components/ui/stat'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import { classroomService, isoMonth } from '@/services/classroomService'
import type { AttendanceRegister, SchoolClass } from '@/types'

type Summary = Awaited<ReturnType<typeof adminService.attendanceSummary>>

/** Institution-wide, month-wise attendance per class & subject, with drill-down into the register. */
export function AttendanceSummaryPanel({ org }: { org?: string | null }) {
  const [month, setMonth] = useState(isoMonth())
  const [data, setData] = useState<Summary | null>(null)
  const [open, setOpen] = useState<{ class_code: string; subject_code: string } | null>(null)
  const [reg, setReg] = useState<AttendanceRegister | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [classes, setClasses] = useState<SchoolClass[] | null>(null)
  const [exporting, setExporting] = useState<{ class_code?: string; subject_code?: string } | null>(null)

  useEffect(() => { adminService.classes(org).then(setClasses).catch(() => setClasses([])) }, [org])

  useEffect(() => {
    setData(null); setOpen(null)
    adminService.attendanceSummary(month, org).then(setData).catch((e) => setError(errorMessage(e)))
  }, [month, org])

  useEffect(() => {
    setReg(null)
    if (open) classroomService.register({ ...open, month, ...(org ? { org_code: org } : {}) }).then(setReg).catch((e) => setError(errorMessage(e)))
  }, [open, month, org])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Attendance by class & subject</CardTitle>
          <div className="flex items-center gap-3">
            {data && <span className="text-sm text-ink-300">Overall <b className={pctTone(data.overall.percentage, data.threshold)}>{fmtPct(data.overall.percentage)}</b></span>}
            <MonthPicker value={month} onChange={setMonth} />
            <Button size="sm" variant="secondary" id="open-export" disabled={!classes?.length} onClick={() => setExporting({})}><Download className="h-3.5 w-3.5" /> Export</Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p role="alert" className="mb-3 text-sm text-bad">{error}</p>}
          {!data ? <div className="skeleton h-32" /> : data.rows.length === 0 ? <p className="py-8 text-center text-sm text-ink-300">No attendance recorded this month.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3 font-medium">Class</th><th className="py-2 pr-3 font-medium">Subject</th><th className="py-2 pr-3 text-right font-medium">Sessions</th>
                  <th className="py-2 pr-3 text-right font-medium">Present</th><th className="py-2 pr-3 text-right font-medium">Absent</th><th className="py-2 pr-3 text-right font-medium">Attendance</th><th />
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={`${r.class_code}-${r.subject_code}`} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-fg">{r.class_code}</td>
                      <td className="py-2.5 pr-3">{r.subject_code}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{r.sessions}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-ok">{r.present + r.late}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-bad">{r.absent}</td>
                      <td className="py-2.5 pr-3 text-right">{r.is_below_threshold ? <Badge tone="bad">{fmtPct(r.percentage)}</Badge> : <span className={`font-semibold ${pctTone(r.percentage, data.threshold)}`}>{fmtPct(r.percentage)}</span>}</td>
                      <td className="py-2.5 text-right"><Button size="sm" variant="ghost" onClick={() => setOpen({ class_code: r.class_code, subject_code: r.subject_code })}><Eye className="h-3.5 w-3.5" /> Register</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {open && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>{open.class_code} · {open.subject_code}</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => setExporting(open)}><Download className="h-3.5 w-3.5" /> Export</Button>
          </CardHeader>
          <CardContent>{reg ? <RegisterGrid reg={reg} /> : <div className="skeleton h-40" />}</CardContent>
        </Card>
      )}

      {exporting && classes && (
        <ExportAttendanceDialog open onClose={() => setExporting(null)} classes={classes.filter((c) => c.is_active)} allowAllClasses org={org}
          initial={{ ...exporting, month }} />
      )}
    </div>
  )
}
