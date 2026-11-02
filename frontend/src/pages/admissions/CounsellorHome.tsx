import { useEffect, useState } from 'react'
import { BarChart3, CalendarClock, KanbanSquare, MessageSquareText, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { AdmissionsKpis, ApplicantsByClass, ApplicantsTable } from '@/components/admissions/AdmissionsWidgets'
import { Empty, HeroBanner, Panel } from '@/components/dashboard/Widgets'
import { greeting, longDate } from '@/lib/datetime'
import { errorMessage } from '@/services/apiClient'
import { admissionService, type AdmissionOverview, type Applicant } from '@/services/admissionService'

/** Counsellor / front office home (Milestone 1: live counts and applicants; pipeline arrives in Milestone 2). */
export default function CounsellorHome() {
  const { user } = useAuth()
  const [o, setO] = useState<AdmissionOverview | null>(null)
  const [rows, setRows] = useState<Applicant[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hello] = useState(() => greeting())
  useEffect(() => {
    admissionService.overview().then(setO).catch((e) => setError(errorMessage(e)))
    admissionService.applicants().then(setRows).catch((e) => setError(errorMessage(e)))
  }, [])
  if (!user) return null
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <HeroBanner eyebrow={`${longDate()} · ${user.org_name ?? ''}`} title={<>{hello}, {user.full_name.split(' ')[0]}</>}
        subtitle={o ? <>{o.applicants.total} applicants · <b>{o.consent.pending}</b> waiting for parental consent.</> : 'Loading admissions…'} />
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <AdmissionsKpis o={o} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <Panel icon={BarChart3} title="Applicants by class">{o ? <ApplicantsByClass o={o} /> : <div className="skeleton h-44" />}</Panel>
        <Panel icon={Users} title="Applicants"><ApplicantsTable rows={rows} /></Panel>
      </div>
      <Panel icon={KanbanSquare} title="Coming in Milestone 2">
        <Empty icon={CalendarClock}>
          <span className="block max-w-xl">Enquiry → application pipeline (Kanban), follow-up tasks and reminders, WhatsApp / SMS / email templates, campus-visit and interview slots, and e-call letters with QR codes.</span>
          <span className="mt-2 inline-flex items-center gap-1 text-xs text-ink-500"><MessageSquareText className="h-3.5 w-3.5" /> Messaging providers will plug in through an adapter (mocked until a provider is chosen).</span>
        </Empty>
      </Panel>
    </div>
  )
}
