import { AlertTriangle, Ban, CheckCircle2, Info } from 'lucide-react'
import { formatShort } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import type { TimetableConflict } from '@/types'

const KIND_LABEL: Record<string, string> = {
  TEACHER_CLASH: 'Teacher busy',
  CLASS_CLASH: 'Overlapping period',
  ROOM_CLASH: 'Room taken',
  NON_WORKING_DAY: 'Closed day',
  HOLIDAY: 'Holiday',
  BREAK_OVERLAP: 'Break',
}

/** Conflicts from a 409 or a dry-run check: errors (block saving) first, then warnings (advisory). */
export function ConflictList({ conflicts, checked, className }: { conflicts: TimetableConflict[]; checked?: boolean; className?: string }) {
  if (!conflicts.length) {
    return checked ? (
      <p role="status" className={cn('flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok', className)}>
        <CheckCircle2 className="h-4 w-4" /> No conflicts — teacher, class and room are free.
      </p>
    ) : null
  }
  const errors = conflicts.filter((c) => c.severity === 'error')
  const warnings = conflicts.filter((c) => c.severity !== 'error')
  return (
    <div role="alert" className={cn('space-y-2 text-sm', className)}>
      {errors.length > 0 && (
        <div className="rounded-lg border border-bad/30 bg-bad/10 p-3">
          <p className="mb-1.5 flex items-center gap-2 font-medium text-bad"><Ban className="h-4 w-4" /> {errors.length} conflict{errors.length === 1 ? '' : 's'} — not saved</p>
          <ul className="space-y-1">{errors.map((c, i) => <Row key={i} c={c} />)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn/10 p-3">
          <p className="mb-1.5 flex items-center gap-2 font-medium text-warn"><AlertTriangle className="h-4 w-4" /> Heads-up</p>
          <ul className="space-y-1">{warnings.map((c, i) => <Row key={i} c={c} />)}</ul>
        </div>
      )}
    </div>
  )
}

function Row({ c }: { c: TimetableConflict }) {
  return (
    <li className="flex flex-wrap items-start gap-2 text-xs text-ink-300">
      <span className={cn('rounded px-1.5 py-0.5 font-semibold', c.severity === 'error' ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn')}>{KIND_LABEL[c.kind] ?? c.kind}</span>
      <span className="min-w-0 flex-1">{c.message}</span>
      {c.conflict_date && <span className="flex items-center gap-1 text-ink-500"><Info className="h-3 w-3" />{formatShort(c.conflict_date)}</span>}
    </li>
  )
}
