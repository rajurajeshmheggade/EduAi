import { useEffect, useState } from 'react'
import { Eye, Keyboard, ShieldCheck, UserCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { AdmissionsKpis } from '@/components/admissions/AdmissionsWidgets'
import { HeroBanner, Panel } from '@/components/dashboard/Widgets'
import { longDate } from '@/lib/datetime'
import { errorMessage } from '@/services/apiClient'
import { admissionService, type AdmissionOverview } from '@/services/admissionService'

const PRINCIPLES = [
  { icon: Eye, title: 'Flags, never verdicts', text: 'Proctoring only raises flags with a timeline and evidence. There is no cheating score and nothing is auto-failed.' },
  { icon: UserCheck, title: 'A person decides', text: 'You clear, escalate or invalidate a session with a note. Invalidations need a second reviewer.' },
  { icon: ShieldCheck, title: 'Minimal evidence', text: 'Event records always; a snapshot only when a serious rule fires, deleted automatically after the review window.' },
  { icon: Keyboard, title: 'Fast, keyboard-first', text: 'C = clear, E = escalate, I = invalidate. Target: a session reviewed in under 30 seconds.' },
]

/** Integrity reviewer home (Milestone 1). The review queue arrives with proctoring in Milestone 5. */
export default function ReviewerHome() {
  const { user } = useAuth()
  const [o, setO] = useState<AdmissionOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { admissionService.overview().then(setO).catch((e) => setError(errorMessage(e))) }, [])
  if (!user) return null
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <HeroBanner eyebrow={`${longDate()} · ${user.org_name ?? ''}`} title="Integrity desk"
        subtitle="Review flagged admission-test sessions fairly. The review queue opens when online tests and proctoring go live (Milestone 5)." />
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <AdmissionsKpis o={o} />
      <Panel icon={ShieldCheck} title="How review works">
        <ul className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3 rounded-xl border border-line p-4">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
              <div><div className="font-medium text-fg">{title}</div><p className="mt-0.5 text-sm text-ink-300">{text}</p></div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
