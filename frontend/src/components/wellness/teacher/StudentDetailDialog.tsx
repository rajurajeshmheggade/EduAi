import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isAxiosError } from 'axios'
import { Activity, BellRing, CheckCircle2, Gamepad2, LifeBuoy, Loader2, Lock, RotateCw, TrendingUp, Zap, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'
import type { WellbeingAlert, WellbeingStudentDetail, WellbeingStudentRow } from '@/types/wellness'
import { HBarList, type HBarItem } from './HBarList'
import { HELPLINES, activityLabel, alertLabel, fmtDateTime, severityTone } from './labels'
import { MoodStressChart } from './MoodStressChart'
import { RiskBadge } from './RiskBadge'

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-ink-500" aria-hidden />{title}</h3>
      {children}
    </section>
  )
}

/** Student drill-down: mood & stress over time, triggers, activity and safety alerts (never journal text). */
export function StudentDetailDialog({ classCode, student, days, onClose, onAcknowledged }: {
  classCode: string
  student: WellbeingStudentRow
  days: number
  onClose: () => void
  onAcknowledged: () => void
}) {
  const [detail, setDetail] = useState<WellbeingStudentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [acking, setAcking] = useState<number | null>(null)

  const fetchDetail = useCallback(() => wellnessService.studentDetail(classCode, student.code, days)
    .then((d) => { setDetail(d); setError(null) })
    .catch((e: unknown) => setError(errorMessage(e, 'Could not load this student'))), [classCode, student.code, days])
  useEffect(() => { void fetchDetail() }, [fetchDetail])
  const load = () => { setError(null); void fetchDetail() }

  const activity = useMemo<HBarItem[]>(() => {
    const byLabel = new Map<string, { count: number; xp: number }>()
    for (const a of detail?.activity ?? []) {
      const k = activityLabel(a.activity)
      const cur = byLabel.get(k) ?? { count: 0, xp: 0 }
      byLabel.set(k, { count: cur.count + a.count, xp: cur.xp + (a.xp ?? 0) })
    }
    return [...byLabel].map(([label, v]) => ({ label, value: v.count, note: `${v.xp} XP` })).sort((a, b) => b.value - a.value)
  }, [detail])

  async function acknowledge(a: WellbeingAlert) {
    setAcking(a.id)
    try {
      await wellnessService.acknowledgeAlert(a.id)
      setDetail((d) => d && { ...d, alerts: d.alerts.map((x) => (x.id === a.id ? { ...x, acknowledgedAt: new Date().toISOString(), acknowledgedBy: 'you' } : x)) })
      toast('Alert acknowledged', 'success')
      onAcknowledged()
    } catch (e) {
      if (isAxiosError(e) && e.response?.status === 404) { toast('This alert was already acknowledged', 'info'); void load(); onAcknowledged() }
      else toast(errorMessage(e, 'Could not acknowledge the alert'), 'error')
    } finally {
      setAcking(null)
    }
  }

  const p = detail?.profile
  const k = detail?.knowledge ?? student.knowledge
  const knowledgeText = k.avgPct === null ? 'Not yet assessed' : `${k.level} (${Math.round(k.avgPct)}% avg)`
  const description = [student.rollNumber && `Roll ${student.rollNumber}`, `Knowledge: ${knowledgeText}`, `last ${days} days`].filter(Boolean).join(' · ')
  const openAlerts = detail?.alerts.filter((a) => !a.acknowledgedAt) ?? []

  return (
    <Dialog open onClose={onClose} title={student.name} description={description}
      className="max-h-[calc(100dvh-2rem)] w-[min(60rem,calc(100vw-2rem))] overflow-y-auto">
      {error ? (
        <div className="space-y-3 py-6 text-center">
          <p role="alert" className="text-sm text-bad">{error}</p>
          <Button size="sm" variant="secondary" onClick={() => void load()}><RotateCw className="h-3.5 w-3.5" />Try again</Button>
        </div>
      ) : !detail ? (
        <div className="space-y-3" aria-busy="true"><div className="skeleton h-10" /><div className="skeleton h-56" /><div className="skeleton h-32" /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
            <RiskBadge risk={student.risk} />
            {p ? (
              <>
                <Badge tone="brand"><Zap className="h-3 w-3" aria-hidden />Lvl {p.level} · {p.levelTitle}</Badge>
                <span>{p.totalXp} XP total</span><span aria-hidden>·</span>
                <span>{p.breathCycles} breathing cycles</span>
                {p.examDate && <><span aria-hidden>·</span><span>Next exams {new Date(`${p.examDate.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></>}
              </>
            ) : <span>Has not set up a wellness profile yet.</span>}
            <span className="ml-auto flex items-center gap-1 text-ink-500"><Lock className="h-3 w-3" aria-hidden />Journal text and chats stay private</span>
          </div>

          {openAlerts.some((a) => a.type === 'crisis_self_harm') && (
            <p role="note" className="flex gap-2 rounded-xl border border-bad/30 bg-bad/5 px-3.5 py-3 text-sm text-ink-100">
              <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden />
              <span>Follow your school&apos;s safeguarding procedure; helplines: <b className="text-fg">{HELPLINES}</b>.</span>
            </p>
          )}

          <Section title="Mood & stress over time" icon={TrendingUp}><MoodStressChart series={detail.series} /></Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Top stress triggers" icon={Activity}>
              <HBarList label="Top stress triggers from journal entries" unit="mention" barClass="bg-rose-400"
                items={detail.triggers.map((t) => ({ label: t.trigger, value: t.count }))} empty="No journal triggers in this period." />
            </Section>
            <Section title="Activity breakdown" icon={Gamepad2}>
              <HBarList label="Wellness activity" unit="time" barClass="bg-aqua-500" items={activity} empty="No wellness activity in this period." />
            </Section>
          </div>

          <Section title={`Safety alerts${openAlerts.length ? ` (${openAlerts.length} open)` : ''}`} icon={BellRing}>
            {!detail.alerts.length ? <p className="py-4 text-center text-sm text-ink-500">No safety alerts for this student.</p> : (
              <ul className="divide-y divide-line">
                {detail.alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                    <div className="min-w-48 flex-1">
                      <div className="text-sm font-medium text-fg">{alertLabel(a.type)}</div>
                      <div className="text-xs text-ink-500">{fmtDateTime(a.date)}</div>
                    </div>
                    <Badge tone={severityTone(a.severity)}>{a.severity.charAt(0) + a.severity.slice(1).toLowerCase()}</Badge>
                    {a.acknowledgedAt ? (
                      <span className="flex items-center gap-1 text-xs text-ok"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        Acknowledged {fmtDateTime(a.acknowledgedAt)}{a.acknowledgedBy ? ` by ${a.acknowledgedBy}` : ''}</span>
                    ) : (
                      <Button size="sm" variant="secondary" disabled={acking !== null} onClick={() => void acknowledge(a)}
                        aria-label={`Acknowledge alert: ${alertLabel(a.type)}, ${fmtDateTime(a.date)}`}>
                        {acking === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Acknowledge
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </Dialog>
  )
}
