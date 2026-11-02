import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, FileCheck2, Languages, Map as RoadmapIcon, Users } from 'lucide-react'
import { AdmissionsKpis, ApplicantsByClass, ApplicantsTable } from '@/components/admissions/AdmissionsWidgets'
import { Empty, Panel } from '@/components/dashboard/Widgets'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/ui/loading'
import { adminTabLink } from '@/lib/adminTabs'
import { errorMessage } from '@/services/apiClient'
import { admissionService, type AdmissionOverview, type Applicant } from '@/services/admissionService'

const ROADMAP = [
  ['M2', 'Admissions CRM: enquiry → applicant pipeline, documents, seat matrix, e-call letters, principal funnel'],
  ['M3', 'Item Studio and paper builder (AI drafts need staff approval)'],
  ['M4', 'Admission test app: autosave, resume, accommodations, practice round'],
  ['M5', 'In-browser proctoring flags and the integrity review desk'],
  ['M6–M8', 'Dashboards and reports, AI copilot on anonymised data, hardening'],
] as const

/** Principal / owner admissions home (Milestone 1: live counts, consent coverage, applicants). */
export function AdmissionsHome({ org }: { org?: string | null }) {
  const [o, setO] = useState<AdmissionOverview | null>(null)
  const [rows, setRows] = useState<Applicant[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    admissionService.overview(org).then(setO).catch((e) => setError(errorMessage(e)))
    admissionService.applicants(org).then(setRows).catch((e) => setError(errorMessage(e)))
  }, [org, reload])

  return (
    <div className="space-y-6">
      {error && <ErrorState title="Couldn’t load admissions" message={error} onRetry={() => { setError(null); setReload((n) => n + 1) }} />}
      <AdmissionsKpis o={o} withBreaches links={{ requests: adminTabLink('privacy'), breaches: adminTabLink('privacy') }} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel icon={BarChart3} title="Applicants by class">{o ? <ApplicantsByClass o={o} /> : <div className="skeleton h-44" />}</Panel>
        <Panel icon={FileCheck2} title="Parental consent notice" action={{ to: adminTabLink('privacy'), label: 'Manage' }}>
          {!o ? <div className="skeleton h-32" /> : !o.consent_version ? (
            <Empty icon={FileCheck2}>No consent notice published yet. Parents cannot consent, so no test can start. <Link to={adminTabLink('privacy')} className="text-brand-600 hover:underline">Publish one</Link></Empty>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="ok">Version {o.consent_version.version} active</Badge>
                {o.consent_version.languages.map((l) => <Badge key={l} tone="neutral"><Languages className="h-3 w-3" /> {l.toUpperCase()}</Badge>)}</div>
              <p className="text-ink-300">{o.consent.granted} of {o.applicants.total} families have consented; {o.consent.pending} pending, {o.consent.withdrawn} withdrawn.
                Every consent stores the notice version, language, time and IP address.</p>
              <p className="text-xs text-ink-500">Team: {o.team.counsellors} counsellor(s), {o.team.reviewers} integrity reviewer(s). <Link to={adminTabLink('admissions-team')} className="text-brand-600 hover:underline">Manage team</Link></p>
            </div>
          )}
        </Panel>
      </div>
      <Panel icon={Users} title="Applicants"><ApplicantsTable rows={rows} /></Panel>
      <Panel icon={RoadmapIcon} title="Pravesh roadmap">
        <ol className="space-y-2 text-sm">
          {ROADMAP.map(([m, text]) => <li key={m} className="flex gap-3"><Badge tone="brand" className="shrink-0">{m}</Badge><span className="text-ink-300">{text}</span></li>)}
        </ol>
      </Panel>
    </div>
  )
}
