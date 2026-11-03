import { CalendarClock, GraduationCap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeLevel, StudentContext, UpcomingWork } from '@/types/wellness'

/** Badge colours per knowledge level (bands match EduAI's grade scale: see backend services/wellness/context.py). */
const LEVEL_TONE: Record<KnowledgeLevel, string> = {
  Advanced: 'border-ok/30 bg-ok/10 text-ok',
  Proficient: 'border-brand-400/30 bg-brand-500/10 text-brand-600',
  Developing: 'border-warn/30 bg-warn/10 text-warn',
  Foundational: 'border-rose-400/30 bg-rose-400/10 text-rose-500',
  'Not yet assessed': 'border-line bg-ink-800 text-ink-300',
}
const BAR_TONE: Record<KnowledgeLevel, string> = {
  Advanced: 'bg-ok', Proficient: 'bg-brand-500', Developing: 'bg-warn', Foundational: 'bg-rose-400', 'Not yet assessed': 'bg-ink-500',
}

export function KnowledgeBadge({ level, className }: { level: KnowledgeLevel; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', LEVEL_TONE[level] ?? LEVEL_TONE['Not yet assessed'], className)}>
      {level}
    </span>
  )
}

function formatDay(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function knowledgeNote(ctx: StudentContext) {
  const k = ctx.knowledge
  if (k.avgPct === null) return `No graded assessments yet. Aura pitches tips and quizzes at the standard ${ctx.gradeLabel} level until your first results are released.`
  return `Average ${Math.round(k.avgPct)}% across your last ${k.assessments} graded assessment${k.assessments === 1 ? '' : 's'}. Tips, quizzes and Aura's advice are pitched at this level.`
}

function UpcomingList({ items }: { items: UpcomingWork[] }) {
  if (!items.length) return <p className="text-xs text-ink-500">Nothing due right now.</p>
  return (
    <ul className="space-y-1.5">
      {items.slice(0, 4).map((u) => (
        <li key={`${u.kind}-${u.title}-${u.date}`} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink-900 px-3 py-2 text-xs">
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{u.title}</span>
            <span className="text-ink-500">{u.subject} · {u.kindLabel}</span>
          </span>
          <span className="shrink-0 tabular-nums text-ink-300">{formatDay(u.date)}</span>
        </li>
      ))}
    </ul>
  )
}

/** "Your learning profile": class, section, subjects, knowledge level and upcoming work, all from EduAI records.
    Read-only — the student cannot change what the AI is told about their level. */
export function AcademicProfileCard({ ctx, compact = false }: { ctx: StudentContext; compact?: boolean }) {
  const k = ctx.knowledge
  return (
    <section className={cn(compact ? 'rounded-xl border border-line bg-ink-900 p-4' : 'glass rounded-2xl p-5')} aria-labelledby="academic-profile-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id="academic-profile-title" className="flex items-center gap-2 text-base font-semibold text-fg">
          <GraduationCap className="h-5 w-5 text-brand-500" aria-hidden /> Your learning profile
        </h3>
        <KnowledgeBadge level={k.level} />
      </div>
      <p className="mt-1 text-sm text-ink-300">
        <b className="text-fg">{ctx.className}</b>{ctx.term ? <> · {ctx.term}</> : null}
      </p>
      {ctx.subjects.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Class subjects">
          {ctx.subjects.map((s) => <span key={s} className="rounded-full border border-line bg-ink-800 px-2.5 py-0.5 text-xs text-ink-300">{s}</span>)}
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-ink-500">{knowledgeNote(ctx)}</p>
      {k.bySubject.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Knowledge level by subject">
          {k.bySubject.map((s) => (
            <li key={s.subject} className="text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-fg">{s.subject}{s.subject === k.needsSupport && <span className="ml-1.5 font-normal text-warn">· focus area</span>}</span>
                <span className="flex items-center gap-2 tabular-nums text-ink-300">{Math.round(s.avgPct)}% <KnowledgeBadge level={s.level} /></span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.avgPct)} aria-label={`${s.subject} average`}>
                <div className={cn('h-full rounded-full', BAR_TONE[s.level])} style={{ width: `${Math.min(100, s.avgPct)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <div className="mt-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-300">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Coming up
          </h4>
          <UpcomingList items={ctx.upcoming} />
        </div>
      )}
    </section>
  )
}
