import { AlertTriangle, CheckCircle2, ClipboardList, FileWarning, Hourglass, Users } from 'lucide-react'
import { Columns, Empty, Kpi } from '@/components/dashboard/Widgets'
import { Badge } from '@/components/ui/badge'
import { shortDate } from '@/lib/datetime'
import type { AdmissionOverview, Applicant } from '@/services/admissionService'

/** KPI row for admissions staff. `withBreaches` adds the principal-only breach tile. */
export function AdmissionsKpis({ o, withBreaches, links }: { o: AdmissionOverview | null; withBreaches?: boolean; links?: { requests?: string; breaches?: string } }) {
  if (!o) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-32" />)}</div>
  const total = o.applicants.total
  const pct = total ? Math.round((100 * o.consent.granted) / total) : 0
  return (
    <section aria-label="Admissions overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi icon={Users} label="Applicants" value={total} tone="brand" hint={`Classes ${o.applicants.by_grade.map((g) => g.grade).join(', ') || '—'}`} />
      <Kpi icon={CheckCircle2} label="Parental consent given" value={`${o.consent.granted}/${total}`} tone={pct === 100 ? 'ok' : 'aqua'}
        hint={`${pct}% · ${o.consent.withdrawn} withdrawn`} />
      <Kpi icon={Hourglass} label="Consent pending" value={o.consent.pending} tone={o.consent.pending ? 'warn' : 'ok'} hint="No test before consent" />
      {withBreaches ? (
        <Kpi icon={o.breaches_open ? FileWarning : ClipboardList} label={o.breaches_open ? 'Open breach records' : 'Open privacy requests'}
          value={o.breaches_open || o.requests.open} tone={o.breaches_open ? 'bad' : o.requests.overdue ? 'bad' : o.requests.open ? 'warn' : 'ok'}
          hint={o.breaches_open ? 'Report to the Board within 72 hours' : `${o.requests.overdue} overdue`} to={o.breaches_open ? links?.breaches : links?.requests} />
      ) : (
        <Kpi icon={ClipboardList} label="Open privacy requests" value={o.requests.open} tone={o.requests.overdue ? 'bad' : o.requests.open ? 'warn' : 'ok'} hint={`${o.requests.overdue} overdue`} />
      )}
    </section>
  )
}

export function ApplicantsByClass({ o }: { o: AdmissionOverview }) {
  const data = [6, 7, 8, 9, 10, 11, 12].map((g) => ({ key: String(g), label: `Class ${g}`, value: o.applicants.by_grade.find((x) => x.grade === g)?.count ?? 0 }))
  const max = Math.max(1, ...data.map((d) => d.value))
  return <Columns data={data} max={max} unit="" caption="Applicants by class applied for" />
}

export function ConsentStatus({ c }: { c: Applicant['consent'] }) {
  if (!c) return <Badge tone="warn"><AlertTriangle className="h-3 w-3" /> Pending</Badge>
  if (c.decision === 'withdrawn') return <Badge tone="neutral">Withdrawn {shortDate(c.at)}</Badge>
  return <Badge tone="ok"><CheckCircle2 className="h-3 w-3" /> Given v{c.version} · {shortDate(c.at)}</Badge>
}

export function ApplicantsTable({ rows }: { rows: Applicant[] | null }) {
  if (!rows) return <div className="skeleton h-40" />
  if (!rows.length) return <Empty icon={Users}>No applicants yet. Enquiries and applications arrive in Milestone 2 (admissions CRM).</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
          <th scope="col" className="py-2 pr-3 font-medium">Applicant</th><th scope="col" className="py-2 pr-3 font-medium">Class</th>
          <th scope="col" className="py-2 pr-3 font-medium">Parent / guardian</th><th scope="col" className="py-2 pr-3 font-medium">Language</th>
          <th scope="col" className="py-2 font-medium">Consent</th>
        </tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.applicant_id} className="border-b border-line last:border-0">
              <td className="py-2.5 pr-3 font-medium text-fg">{a.full_name}</td>
              <td className="py-2.5 pr-3 tabular-nums">{a.grade_applying}</td>
              <td className="py-2.5 pr-3 text-ink-300">{a.guardians.map((g) => `${g.full_name} (${g.relationship})`).join(', ') || '—'}</td>
              <td className="py-2.5 pr-3 uppercase text-ink-500">{a.preferred_language}</td>
              <td className="py-2.5"><ConsentStatus c={a.consent} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
