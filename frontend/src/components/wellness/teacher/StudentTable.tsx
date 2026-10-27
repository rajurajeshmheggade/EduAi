import { useMemo, useState } from 'react'
import { BellRing, Search, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/field'
import type { RiskLevel, WellbeingStudentRow } from '@/types/wellness'
import { RISK, fmtDateTime, relDay } from './labels'
import { RiskBadge } from './RiskBadge'
import { Sparkline } from './Sparkline'

type RiskFilter = RiskLevel | 'all'
type SortKey = 'risk' | 'roll' | 'name' | 'stress' | 'active'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'risk', label: 'Risk (highest first)' },
  { id: 'roll', label: 'Roll number' },
  { id: 'name', label: 'Name' },
  { id: 'stress', label: 'Avg stress (highest)' },
  { id: 'active', label: 'Last active (recent)' },
]
const RISKS: RiskLevel[] = ['high', 'watch', 'ok', 'inactive']

const lastSeen = (s: WellbeingStudentRow) => s.lastActivity ?? s.lastEntry
const nullsLast = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : b - a)
const time = (iso: string | null) => (iso ? new Date(iso).getTime() : null)

const COMPARE: Record<SortKey, (a: WellbeingStudentRow, b: WellbeingStudentRow) => number> = {
  risk: (a, b) => RISK[a.risk].rank - RISK[b.risk].rank || b.openAlerts - a.openAlerts || nullsLast(a.avgStress, b.avgStress) || a.name.localeCompare(b.name),
  roll: (a, b) => (a.rollNumber ?? '￿').localeCompare(b.rollNumber ?? '￿', undefined, { numeric: true }) || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
  stress: (a, b) => nullsLast(a.avgStress, b.avgStress) || a.name.localeCompare(b.name),
  active: (a, b) => nullsLast(time(lastSeen(a)), time(lastSeen(b))) || a.name.localeCompare(b.name),
}

/** Class roster with wellbeing signals. Rows open the student detail; filters never hide the total. */
export function StudentTable({ students, onOpen }: { students: WellbeingStudentRow[]; onOpen: (s: WellbeingStudentRow) => void }) {
  const [risk, setRisk] = useState<RiskFilter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('risk')

  const counts = useMemo(() => {
    const c: Record<RiskLevel, number> = { high: 0, watch: 0, ok: 0, inactive: 0 }
    for (const s of students) c[s.risk] += 1
    return c
  }, [students])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return students
      .filter((s) => (risk === 'all' || s.risk === risk) && (!q || s.name.toLowerCase().includes(q) || (s.rollNumber ?? '').toLowerCase().includes(q)))
      .sort(COMPARE[sort])
  }, [students, risk, query, sort])

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-brand-600" aria-hidden />Students</CardTitle>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
            <Input type="search" aria-label="Search students by name or roll number" placeholder="Search name or roll" value={query}
              onChange={(e) => setQuery(e.target.value)} className="w-56 pl-9" />
          </div>
          <Select aria-label="Filter by risk" value={risk} onChange={(e) => setRisk(e.target.value as RiskFilter)} className="w-44">
            <option value="all">All risk levels ({students.length})</option>
            {RISKS.map((r) => <option key={r} value={r}>{RISK[r].label} ({counts[r]})</option>)}
          </Select>
          <Select aria-label="Sort students" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-48">
            {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
          </Select>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <caption className="sr-only">Students in this class with their wellbeing signals. Select a student to see details.</caption>
            <thead>
              <tr className="border-y border-line bg-ink-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
                <th scope="col" className="px-5 py-2.5 font-medium">Student</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Risk</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Avg stress</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Mood <span className="normal-case">avg / latest</span></th>
                <th scope="col" className="px-3 py-2.5 font-medium">Mood trend</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Entries / check-ins</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Level</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Last active</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const seen = lastSeen(s)
                return (
                  <tr key={s.code} onClick={() => onOpen(s)} className="cursor-pointer border-b border-line last:border-0 hover:bg-brand-500/[0.04]">
                    <th scope="row" className="px-5 py-3 text-left font-normal">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(s) }}
                        className="cursor-pointer text-left font-medium text-fg hover:text-brand-600 hover:underline">{s.name}</button>
                      <div className="text-xs text-ink-500">
                        {s.rollNumber ? `Roll ${s.rollNumber}` : 'No roll no.'} · {s.knowledge.level}{s.hasProfile ? '' : ' · not set up yet'}
                      </div>
                    </th>
                    <td className="px-3 py-3"><RiskBadge risk={s.risk} /></td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-100">{s.avgStress == null ? '—' : `${s.avgStress}%`}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-100">
                      {s.avgMood ?? '—'} <span className="text-ink-500">/</span> {s.latestMood ?? '—'}
                    </td>
                    <td className="px-3 py-3"><Sparkline values={s.moodTrend} /></td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-100">{s.entries} <span className="text-ink-500">/</span> {s.checkins}</td>
                    <td className="px-3 py-3">
                      {s.hasProfile ? <><div className="tabular-nums text-ink-100">Lvl {s.level}</div><div className="text-xs text-ink-500">{s.levelTitle}</div></> : <span className="text-ink-500">—</span>}
                    </td>
                    <td className="px-3 py-3 text-ink-300" title={seen ? fmtDateTime(seen) : undefined}>{relDay(seen)}</td>
                    <td className="px-5 py-3 text-right">
                      {s.openAlerts > 0 ? <Badge tone="bad"><BellRing className="h-3 w-3" aria-hidden />{s.openAlerts}<span className="sr-only"> open alerts</span></Badge> : <span className="text-ink-500">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <p className="py-10 text-center text-sm text-ink-500">{students.length ? 'No students match these filters.' : 'No students in this class yet.'}</p>}
        </div>
        <p className="px-5 pb-2 pt-3 text-xs text-ink-500">
          Showing {rows.length} of {students.length}. <b className="font-medium text-ink-300">High</b>: {RISK.high.hint.toLowerCase()} · <b className="font-medium text-ink-300">Watch</b>: {RISK.watch.hint.toLowerCase()} · <b className="font-medium text-ink-300">Inactive</b>: {RISK.inactive.hint.toLowerCase()}. Mood is a 0–100 score.
        </p>
      </CardContent>
    </Card>
  )
}
