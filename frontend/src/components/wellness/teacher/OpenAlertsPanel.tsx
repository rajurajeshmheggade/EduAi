import { BellRing, ChevronRight, LifeBuoy, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { WellbeingStudentRow } from '@/types/wellness'
import { HELPLINES, relDay } from './labels'
import { RiskBadge } from './RiskBadge'

/** Shown above everything when any student in the class has an unacknowledged safety alert. */
export function OpenAlertsPanel({ students, onOpen }: { students: WellbeingStudentRow[]; onOpen: (s: WellbeingStudentRow) => void }) {
  const flagged = students
    .filter((s) => s.openAlerts > 0)
    .sort((a, b) => b.crisisEvents - a.crisisEvents || b.openAlerts - a.openAlerts || a.name.localeCompare(b.name))
  if (!flagged.length) return null
  const crisis = flagged.some((s) => s.crisisEvents > 0)
  const total = flagged.reduce((n, s) => n + s.openAlerts, 0)

  return (
    <section aria-labelledby="open-alerts-title" className="rounded-2xl border border-bad/30 bg-bad/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="open-alerts-title" className="flex items-center gap-2 text-lg font-semibold">
          <BellRing className="h-5 w-5 text-bad" aria-hidden /> Open safety alerts
          <Badge tone="bad">{total}</Badge>
        </h2>
        <span className="text-xs text-ink-500">Open a student to review and acknowledge their alerts.</span>
      </div>

      {crisis ? (
        <p role="note" className="mt-3 flex gap-2 rounded-xl border border-bad/30 bg-ink-900 px-3.5 py-3 text-sm leading-relaxed text-ink-100">
          <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden />
          <span>
            <b className="text-fg">Crisis language was detected.</b> Follow your school&apos;s safeguarding procedure; helplines: <b className="text-fg">{HELPLINES}</b>.
            Reach out to the student privately and promptly.
          </span>
        </p>
      ) : (
        <p className="mt-3 flex gap-2 text-sm text-ink-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          Check in with these students privately, then acknowledge the alert so your colleagues know it has been handled.
        </p>
      )}

      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-ink-900">
        {flagged.map((s) => (
          <li key={s.code} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-40 flex-1">
              <div className="font-medium text-fg">{s.name}</div>
              <div className="text-xs text-ink-500">{s.rollNumber ? `Roll ${s.rollNumber} · ` : ''}last active {relDay(s.lastActivity ?? s.lastEntry)}</div>
            </div>
            <RiskBadge risk={s.risk} />
            {s.crisisEvents > 0 && <Badge tone="bad"><LifeBuoy className="h-3 w-3" aria-hidden />Crisis language</Badge>}
            <span className="text-sm tabular-nums text-ink-300">{s.openAlerts} open</span>
            <Button size="sm" variant="secondary" onClick={() => onOpen(s)} aria-label={`Review alerts for ${s.name}`}>
              Review<ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
