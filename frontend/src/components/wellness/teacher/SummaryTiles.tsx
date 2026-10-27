import { Activity, AlertTriangle, BellRing, Eye, Gauge, UserCheck } from 'lucide-react'
import { StatCard } from '@/components/ui/stat'
import type { WellbeingOverview } from '@/types/wellness'

/** Class summary: onboarding, activity, average stress and the three attention counts. */
export function SummaryTiles({ summary, days }: { summary: WellbeingOverview['summary']; days: number }) {
  const s = summary
  return (
    <section aria-label="Class wellbeing summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Onboarded" icon={UserCheck} value={`${s.onboarded}/${s.students}`} hint="Set up their wellness profile" />
      <StatCard label="Active" icon={Activity} value={s.active} hint={`Logged a check-in or journal in ${days} days`} />
      <StatCard label="Avg stress" icon={Gauge} value={s.avgStress == null ? '—' : `${s.avgStress}%`}
        tone={s.avgStress == null ? 'text-ink-500' : s.avgStress >= 70 ? 'text-bad' : s.avgStress >= 50 ? 'text-warn' : 'text-fg'}
        hint="Self-reported, active students" />
      <StatCard label="Needs attention" icon={AlertTriangle} value={s.high} tone={s.high ? 'text-bad' : 'text-fg'} hint="High risk" />
      <StatCard label="Watch" icon={Eye} value={s.watch} tone={s.watch ? 'text-warn' : 'text-fg'} hint="Early warning signs" />
      <StatCard label="Open alerts" icon={BellRing} value={s.openAlerts} tone={s.openAlerts ? 'text-bad' : 'text-fg'} hint="Safety alerts to review" />
    </section>
  )
}
