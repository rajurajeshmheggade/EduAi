import { useEffect, useState } from 'react'
import { Info, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/field'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import type { Member, SchoolClass } from '@/types'

/** Read-only student directory for admins. Enrolment is done by each class's class teacher. */
export function StudentsPanel({ org }: { org?: string | null }) {
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [klass, setKlass] = useState('')
  const [rows, setRows] = useState<Member[] | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { adminService.classes(org).then(setClasses).catch(() => setClasses([])) }, [org])
  useEffect(() => {
    setRows(null)
    adminService.students(klass || null, org).then(setRows).catch((e) => setError(errorMessage(e)))
  }, [klass, org])

  const f = filter.toLowerCase()
  const shown = rows?.filter((r) => !f || `${r.full_name} ${r.user_code} ${r.email} ${r.guardian_name ?? ''}`.toLowerCase().includes(f))
  const teacherOf = (code: string | null) => classes.find((c) => c.class_code === code)?.class_teacher_name

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Students {rows && <span className="text-ink-500">({rows.length})</span>}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Filter by class" className="w-52" value={klass} onChange={(e) => setKlass(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
          </Select>
          <div className="relative w-56"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-500" /><Input aria-label="Search students" className="pl-9" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-ink-800 px-3 py-2 text-xs text-ink-300"><Info className="h-3.5 w-3.5 shrink-0" /> Students are enrolled by their class teacher (Teacher portal → My classes).</p>
        {error && <p role="alert" className="mb-3 text-sm text-bad">{error}</p>}
        {!shown ? <div className="skeleton h-40" /> : shown.length === 0 ? <p className="py-10 text-center text-sm text-ink-300">No students found.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="py-2 pr-3 font-medium">Roll</th><th className="py-2 pr-3 font-medium">Student</th><th className="py-2 pr-3 font-medium">Admission no.</th>
                <th className="py-2 pr-3 font-medium">Class</th><th className="py-2 pr-3 font-medium">Guardian</th><th className="py-2 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.user_code} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3 tabular-nums text-ink-500">{s.roll_number ?? '—'}</td>
                    <td className="py-2.5 pr-3"><div className="font-medium text-fg">{s.full_name}</div>{!s.email.endsWith('.noemail.local') && <div className="text-xs text-ink-500">{s.email}</div>}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{s.user_code}</td>
                    <td className="py-2.5 pr-3"><div>{s.class_code}</div><div className="text-xs text-ink-500">{teacherOf(s.class_code) ?? ''}</div></td>
                    <td className="py-2.5 pr-3 text-xs"><div>{s.guardian_name ?? '—'}</div><div className="text-ink-500">{s.guardian_phone ?? ''}</div></td>
                    <td className="py-2.5"><Badge tone={s.is_active ? 'ok' : 'neutral'}>{s.is_active ? 'Active' : 'Inactive'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
