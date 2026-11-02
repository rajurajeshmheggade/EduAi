import { Calendar, Pause, Play, SlidersHorizontal, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useFocusTimer, useFocusXp } from '@/components/study/FocusTimerContext'
import { useWellness } from '@/components/wellness/WellnessContext'
import { FOCUS_XP_MIN_MINUTES } from '@/lib/studyFlow/config'
import { formatClock, spokenClock } from '@/lib/studyFlow/focusTimer'
import { cn } from '@/lib/utils'
import type { Countdown } from '@/types/wellness'

const DAY_MS = 86_400_000
const ROSE_BTN = 'from-rose-400 to-rose-600 shadow-[0_10px_28px_-12px_rgb(225_29_72/0.55)]'
const STATUS = { idle: 'Ready', running: 'Focusing…', paused: 'Paused', done: 'Session complete — well done!' } as const

/** Whole days until the date (0 on/after the day), or null without a valid date. */
function daysUntil(day: string | null | undefined): number | null {
  if (!day) return null
  const at = new Date(`${day.slice(0, 10)}T00:00:00`).getTime()
  if (Number.isNaN(at)) return null
  const days = Math.ceil((at - Date.now()) / DAY_MS)
  return days > 0 ? days : 0
}

export interface FocusModeProps {
  /** Next test-like date: the student's own exam date or the next test a teacher assigned (server-chosen). */
  countdown: Countdown | null
}

/**
 * MindAlign Focus Mode: countdown to the next test or exams + the Study Focus Timer. The timer is the student's one
 * floating Focus Timer (components/study): this card shows it and starts / pauses it, and "Timer & sounds" opens its
 * popup (length presets, sound options, volume). Finished sessions' XP lands in the Wellness XP bar from here.
 */
export function FocusMode({ countdown }: FocusModeProps) {
  const { applyXp, meta } = useWellness()
  const focus = useFocusTimer()
  useFocusXp((r) => applyXp(r, 'Focus Session Complete'))

  const daysRemaining = daysUntil(countdown?.date)
  const running = focus?.timer.status === 'running'

  return (
    <div className="flex flex-col gap-6">
      {/* Countdown card */}
      <Card className="relative overflow-hidden p-5">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-purple-500" />
        <div className="mb-3 flex items-center gap-3">
          <Calendar className="h-5 w-5 text-purple-500" aria-hidden />
          <h3 className="font-display text-base font-semibold text-fg">Countdown</h3>
        </div>
        <div className="my-2 flex items-baseline gap-2">
          <span className="text-gradient font-display text-4xl font-extrabold tabular-nums">{daysRemaining ?? '—'}</span>
          <span className="text-sm text-ink-300">{countdown ? `Days until ${countdown.label}` : 'No test date yet'}</span>
        </div>
        {countdown?.source === 'school' && <p className="mb-1 text-[11px] text-ink-500">Assigned by your teacher in EduAI.</p>}
        <p className="text-xs leading-snug text-ink-500">
          “Focus on the process, not the finish line. Each 25-minute study chunk is a victory.”
        </p>
      </Card>

      {/* Study Focus Timer: the floating timer's controls */}
      {focus && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-rose-400" aria-hidden />
            <h3 className="font-display text-base font-semibold text-fg">Study Focus Timer</h3>
          </div>

          <div role="timer" aria-label={`Focus time remaining: ${spokenClock(focus.remainingMs)}`}
            className="mt-5 text-center font-display text-6xl font-extrabold tabular-nums tracking-tighter text-fg">
            {formatClock(focus.remainingMs)}
          </div>
          <p className="mb-5 mt-1 text-center text-xs text-ink-300">{focus.timer.minutes}-minute session · {STATUS[focus.timer.status]}</p>

          <div className="flex items-center gap-3">
            <Button onClick={running ? focus.pause : focus.start} className={cn('flex-1', ROSE_BTN)}
              aria-label={running ? 'Pause focus timer' : 'Start focus timer'}>
              {running ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {running ? 'Pause' : focus.timer.status === 'paused' ? 'Resume' : 'Start Focus'}
            </Button>
            <Button variant="secondary" onClick={focus.openPanel} aria-haspopup="dialog">
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Timer &amp; sounds
            </Button>
          </div>

          <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-500">
            Your timer stays with you on every page — look for the timer button in the bottom-right corner. Pick 15, 25 or 45 minutes
            (or your own), and ocean waves, rain, white or brown noise, or binaural beats. A {FOCUS_XP_MIN_MINUTES}+ minute session
            earns +{meta?.xpRules?.pomodoro ?? 50} XP.
          </p>
        </Card>
      )}
    </div>
  )
}
