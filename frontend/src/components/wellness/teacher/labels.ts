import type { RiskLevel } from '@/types/wellness'

export const ACTIVITY_LABELS: Record<string, string> = {
  mood_checkin: 'Mood check-ins',
  journal: 'Journals',
  coping_task: 'Coping tasks',
  breathing_cycle: 'Breathing cycles',
  pomodoro: 'Focus sessions',
  balloon_pop: 'Stress Buster pops',
  stress_quest: 'Stress Buster quests',
  quiz_correct: 'Quiz',
  quiz_participation: 'Quiz',
}

export const ALERT_LABELS: Record<string, string> = {
  crisis_self_harm: 'Crisis / self-harm language',
  medical_substance: 'Asked about medication / stimulants',
  academic_catastrophizing: 'Academic catastrophizing',
  jailbreak_attempt: 'Tried to misuse the assistant',
}

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
export const activityLabel = (a: string) => ACTIVITY_LABELS[a] ?? humanize(a)
export const alertLabel = (t: string) => ALERT_LABELS[t] ?? humanize(t)

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'aqua'

export const severityTone = (s: string): Tone => (s === 'CRITICAL' || s === 'HIGH' ? 'bad' : s === 'MEDIUM' ? 'warn' : 'neutral')

export const RISK: Record<RiskLevel, { label: string; tone: Tone; rank: number; hint: string }> = {
  high: { label: 'High', tone: 'bad', rank: 0, hint: 'Crisis language in this period, or average mood under 35' },
  watch: { label: 'Watch', tone: 'warn', rank: 1, hint: 'Open safety alert, average stress 70+ or latest mood under 40' },
  ok: { label: 'OK', tone: 'ok', rank: 2, hint: 'No warning signs in this period' },
  inactive: { label: 'Inactive', tone: 'neutral', rank: 3, hint: 'No journal entries or check-ins in this period' },
}

export const HELPLINES = 'Tele-MANAS 14416, KIRAN 1800-599-0019'

export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** "today", "3d ago", "5w ago" — compact relative day for table cells. */
export function relDay(iso: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days}d ago`
  if (days < 60) return `${Math.floor(days / 7)}w ago`
  return fmtDay(iso)
}

