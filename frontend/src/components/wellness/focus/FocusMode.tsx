import { useEffect, useRef, useState } from 'react'
import { Calendar, Pause, Play, RotateCcw, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AmbientSoundControls } from '@/components/wellness/audio/AmbientSoundControls'
import { useAmbientSound, useAudioContext } from '@/components/wellness/audio/ambientAudio'
import { playChime } from '@/components/wellness/audio/sfx'
import { useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import type { Countdown } from '@/types/wellness'

type TimerMode = 'study' | 'break'
const MODES: { id: TimerMode; label: string; minutes: number; aria: string }[] = [
  { id: 'study', label: 'Study', minutes: 25, aria: 'Set timer to Study mode (twenty-five minutes)' },
  { id: 'break', label: 'Break', minutes: 5, aria: 'Set timer to Break mode (five minutes)' },
]
const fullMs = (mode: TimerMode) => (MODES.find((m) => m.id === mode)?.minutes ?? 25) * 60_000
const DAY_MS = 86_400_000
const ROSE_BTN = 'from-rose-400 to-rose-600 shadow-[0_10px_28px_-12px_rgb(225_29_72/0.55)]'

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
  /** A 25-minute study block finished (the Dashboard awards the Pomodoro XP). */
  onSessionComplete: () => void
}

/** MindAlign Focus Mode: countdown to the next test or exams + Pomodoro study/break timer with synthesised ambient sound. */
export function FocusMode({ countdown, onSessionComplete }: FocusModeProps) {
  const { alert, meta } = useWellness()
  // One AudioContext for the ambient sound and the end-of-session chime, created on the first click
  const audio = useAudioContext()
  const { soundPlaying, toggleSound, stopSound } = useAmbientSound(audio)

  const [mode, setMode] = useState<TimerMode>('study')
  const [isActive, setIsActive] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(fullMs('study') / 1000)
  // The countdown runs off a deadline rather than counting ticks, so a throttled background tab still ends on time
  const endAtRef = useRef(0)
  const leftMsRef = useRef(fullMs('study'))
  const completeRef = useRef<() => void>(() => {})

  const resetTimer = (m: TimerMode = mode) => {
    setIsActive(false)
    leftMsRef.current = fullMs(m)
    setSecondsLeft(fullMs(m) / 1000)
  }
  const switchMode = (m: TimerMode) => {
    setMode(m)
    resetTimer(m)
  }

  const handleComplete = () => {
    setIsActive(false)
    // A gentle chime (the context was unlocked by the Start click)
    const ctx = audio.ensure()
    if (ctx) playChime(ctx)
    if (mode === 'study') {
      onSessionComplete()
      alert(
        `🍅 Pomodoro Completed! (+${meta?.xpRules?.pomodoro ?? 50} XP)`,
        'Incredible focus! You completed your 25-minute Pomodoro study chunk. Taking a 5-minute breather now prevents fatigue.',
      )
      switchMode('break')
    } else {
      alert('🌸 Break Session Ended', "You are fully recharged and ready. Let's return to our next focused topic block!")
      switchMode('study')
    }
  }
  useEffect(() => { completeRef.current = handleComplete })

  useEffect(() => {
    if (!isActive) return
    const id = window.setInterval(() => {
      const leftMs = Math.max(0, endAtRef.current - Date.now())
      leftMsRef.current = leftMs
      setSecondsLeft(Math.ceil(leftMs / 1000))
      if (leftMs === 0) {
        window.clearInterval(id)
        completeRef.current()
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [isActive])

  const startPauseTimer = () => {
    if (isActive) {
      leftMsRef.current = Math.max(0, endAtRef.current - Date.now())
      setSecondsLeft(Math.ceil(leftMsRef.current / 1000))
      setIsActive(false)
      return
    }
    audio.ensure() // inside the click, so the chime is allowed to play when the block ends
    endAtRef.current = Date.now() + leftMsRef.current
    setIsActive(true)
  }

  const daysRemaining = daysUntil(countdown?.date)
  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60

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

      {/* Pomodoro timer */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-rose-400" aria-hidden />
            <h3 className="font-display text-base font-semibold text-fg">Study Focus Timer</h3>
          </div>
          <div className="flex gap-1 rounded-lg border border-line bg-ink-800 p-0.5" role="group" aria-label="Timer mode">
            {MODES.map((m) => (
              <button key={m.id} type="button" onClick={() => { if (m.id !== mode) switchMode(m.id) }}
                aria-pressed={mode === m.id} aria-label={m.aria}
                className={cn('cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  mode === m.id ? 'bg-ink-900 text-rose-600 shadow-sm ring-1 ring-line' : 'text-ink-300 hover:text-fg')}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div role="timer" aria-label={`${mode === 'study' ? 'Study' : 'Break'} time remaining`}
          className="my-6 text-center font-display text-6xl font-extrabold tabular-nums tracking-tighter text-fg">
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>

        <div className="mb-6 flex items-center gap-3">
          <Button onClick={startPauseTimer} className={cn('flex-1', ROSE_BTN)}
            aria-label={isActive ? 'Pause focus timer' : 'Start focus timer'}>
            {isActive ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {isActive ? 'Pause' : 'Start Focus'}
          </Button>
          <Button variant="secondary" size="icon" className="h-10 w-10" onClick={() => resetTimer()} aria-label="Reset study timer">
            <RotateCcw className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <AmbientSoundControls title="Focus Synthesized Audio" muteLabel="Mute focus audio"
          soundPlaying={soundPlaying} onToggle={toggleSound} onMute={stopSound} />
      </Card>
    </div>
  )
}
