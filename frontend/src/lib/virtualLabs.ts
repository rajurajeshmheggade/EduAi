import { BookOpen, ClipboardCheck, FileText, FlaskConical, ListOrdered, Play, ScrollText, type LucideIcon } from 'lucide-react'
import type { AttemptStatus, LabResource, LabRole, WindowState, Worksheet } from '@/services/virtualLabService'

type Tone = 'brand' | 'ok' | 'warn' | 'bad' | 'aqua' | 'neutral'

export const ROLE_META: Record<LabRole, { label: string; icon: LucideIcon }> = {
  simulation: { label: 'Simulation', icon: FlaskConical },
  manual: { label: 'Lab manual', icon: ScrollText },
  theory: { label: 'Theory', icon: BookOpen },
  procedure: { label: 'Procedure', icon: ListOrdered },
  video: { label: 'Animation', icon: Play },
  self_check: { label: 'Self-check', icon: ClipboardCheck },
  reading: { label: 'Reading', icon: FileText },
  other: { label: 'Resource', icon: FileText },
}

export const ROLE_ORDER: LabRole[] = ['simulation', 'manual', 'theory', 'procedure', 'video', 'self_check', 'reading', 'other']

export const STATUS_META: Record<AttemptStatus, { label: string; tone: Tone }> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'warn' },
  submitted: { label: 'Submitted', tone: 'brand' },
  reviewed: { label: 'Reviewed', tone: 'ok' },
}

/** "7:05" for a running clock. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "12 min", "1 h 5 min", "40 s". */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function windowBadge(state: WindowState, due: string | null, opens: string | null): { label: string; tone: Tone } {
  switch (state) {
    case 'scheduled': return { label: opens ? `Opens ${fmtDateTime(opens)}` : 'Not open yet', tone: 'neutral' }
    case 'closed': return { label: 'Closed', tone: 'neutral' }
    case 'overdue': return { label: 'Past due', tone: 'bad' }
    case 'late': return { label: due ? `Overdue · was due ${fmtDateTime(due)}` : 'Overdue', tone: 'bad' }
    default: return due ? { label: `Due ${fmtDateTime(due)}`, tone: 'warn' } : { label: 'No due date', tone: 'neutral' }
  }
}

/** <input type="datetime-local"> value for a Date (local time). */
export function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export const fmtMarks = (n: number | null | undefined) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1))

export const worksheetMarks = (ws: Worksheet) =>
  Math.round((Number(ws.record_marks || 0) + ws.questions.reduce((n, q) => n + Number(q.marks || 0), 0)) * 100) / 100

/** Drops blank lines / options before sending; returns an error message when an MCQ has no usable correct option. */
export function cleanWorksheet(ws: Worksheet): { worksheet: Worksheet; error: string | null } {
  const trim = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean)
  let error: string | null = null
  const questions = ws.questions.map((q, i) => {
    if (q.type !== 'mcq') return { ...q, prompt: q.prompt.trim() }
    const kept = q.options.map((o, k) => ({ o: o.trim(), k })).filter((x) => x.o)
    const answer = kept.findIndex((x) => x.k === q.answer)
    if (kept.length < 2) error ??= `Question ${i + 1} needs at least two options.`
    else if (answer < 0) error ??= `Question ${i + 1}: the option marked correct is empty.`
    return { ...q, prompt: q.prompt.trim(), options: kept.map((x) => x.o), answer }
  })
  if (!ws.aim.trim()) error ??= 'Write the aim of the experiment.'
  if (questions.some((q) => q.prompt.length < 3)) error ??= 'Every question needs some text.'
  return { worksheet: { ...ws, aim: ws.aim.trim(), materials: trim(ws.materials), steps: trim(ws.steps), observation_columns: trim(ws.observation_columns), questions }, error }
}

const PREFIX = /^\s*(simulation|theory|procedure|animation|video|assessment|self\s*-?\s*evaluation)\s*[-:–]?\s*/i

/** "Simulation - Reactions of HCl" -> "Reactions of HCl" (the role is shown as its own label). */
export function shortName(r: LabResource): string {
  const name = (r.name ?? '').trim()
  return name.replace(PREFIX, '').trim() || name || ROLE_META[r.role].label
}

const SCIENCE = /physics|chemistry|biology|science|evs/i

/** How well a class subject fits a lab collection's subject (2 same, 1 same family e.g. Physics for Science, 0 other). */
export function subjectFit(subjectName: string, labSubject: string | undefined): number {
  if (!labSubject) return 0
  const a = subjectName.toLowerCase()
  const b = labSubject.toLowerCase()
  if (a === b || a.includes(b) || b.includes(a)) return 2
  return SCIENCE.test(a) && SCIENCE.test(b) ? 1 : 0
}
