import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CheckCircle2, Coffee, Pause, Play, RotateCcw, Timer, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FocusSoundId } from '@/components/wellness/audio/ambientAudio'
import { BREAK_MINUTES, FOCUS_MAX_MINUTES, FOCUS_MIN_MINUTES, FOCUS_PRESETS, FOCUS_XP_MIN_MINUTES, STUDY_BLOCK_MINUTES } from '@/lib/studyFlow/config'
import { formatClock, spokenClock } from '@/lib/studyFlow/focusTimer'
import type { CycleState } from '@/lib/studyFlow/studyCycle'
import { useNow } from '@/lib/studyFlow/useNow'
import { cn } from '@/lib/utils'
import type { FocusTimerApi } from './FocusTimerContext'
import { FOCUS_SOUND_OPTIONS } from './focusSound'

const STATUS_TEXT = { idle: 'Ready when you are', running: 'Focusing…', paused: 'Paused', done: 'Session complete — well done!' } as const

/**
 * Sticky Focus Timer: a floating button (bottom-right) that shows the time left while a session or a break runs,
 * and opens a non-modal popup with the timer, its length, controls and sound options.
 */
export function FocusTimerWidget({ focus, cycle }: { focus: FocusTimerApi; cycle: CycleState | null }) {
  const onBreak = cycle?.phase === 'break' && cycle.breakEndsAt !== null
  const now = useNow(onBreak)
  const breakLeft = onBreak ? Math.max(0, cycle.breakEndsAt! - now) : 0
  const { timer, remainingMs, panelOpen } = focus
  const fab = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  let label: string, text: string | null, Icon = Timer
  if (onBreak) {
    Icon = Coffee; text = `Break ${formatClock(breakLeft)}`
    label = `Break time, ${spokenClock(breakLeft)} left. Open the focus timer`
  } else if (timer.status === 'running' || timer.status === 'paused') {
    Icon = timer.status === 'paused' ? Pause : Timer; text = formatClock(remainingMs)
    label = `Focus timer ${timer.status === 'paused' ? 'paused' : 'running'}, ${spokenClock(remainingMs)} left. Open the focus timer`
  } else if (timer.status === 'done') {
    Icon = CheckCircle2; text = 'Done'
    label = 'Focus session complete. Open the focus timer'
  } else {
    text = null; label = 'Open the focus timer'
  }

  const close = (refocus: boolean) => {
    focus.closePanel()
    if (refocus) fab.current?.focus()
  }

  return (
    <div className="fixed bottom-4 z-[35] print:hidden md:bottom-6" style={{ right: 'calc(var(--study-fab-right-offset, 0px) + 1rem)' }} data-study-fab="">
      {panelOpen && <FocusTimerPanel id={panelId} focus={focus} cycle={cycle} breakLeft={breakLeft} onClose={close} fab={fab} />}
      <button ref={fab} type="button" onClick={focus.togglePanel} aria-label={label} aria-haspopup="dialog" aria-expanded={panelOpen}
        aria-controls={panelOpen ? panelId : undefined} title="Focus timer"
        className={cn('flex h-12 min-w-12 cursor-pointer items-center justify-center gap-2 rounded-full px-3.5 font-display text-sm font-semibold tabular-nums text-white shadow-lg ring-1 ring-white/20 transition-transform',
          'motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-300/60',
          onBreak ? 'bg-gradient-to-br from-purple-500 to-indigo-600' : 'bg-gradient-to-br from-rose-400 to-rose-600')}>
        <Icon className="h-5 w-5 shrink-0" aria-hidden />
        {text && <span aria-hidden>{text}</span>}
      </button>
    </div>
  )
}

function FocusTimerPanel({ id, focus, cycle, breakLeft, onClose, fab }: {
  id: string
  focus: FocusTimerApi
  cycle: CycleState | null
  breakLeft: number
  onClose: (refocus: boolean) => void
  fab: React.RefObject<HTMLButtonElement | null>
}) {
  const { timer, remainingMs, prefs } = focus
  const ref = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const [custom, setCustom] = useState(() => String(timer.minutes))
  const titleId = `${id}-title`
  const running = timer.status === 'running'
  const isPreset = (FOCUS_PRESETS as readonly number[]).includes(timer.minutes)
  const [customOpen, setCustomOpen] = useState(!isPreset)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  // Focus moves into the popup when it opens.
  useEffect(() => { primary.current?.focus() }, [])
  // A click elsewhere closes it (focus stays where the student clicked).
  useEffect(() => {
    const on = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !fab.current?.contains(t)) closeRef.current(false)
    }
    document.addEventListener('pointerdown', on)
    return () => document.removeEventListener('pointerdown', on)
  }, [fab])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(true) }
  }
  const applyCustom = () => {
    const m = Number(custom)
    if (Number.isFinite(m) && m >= FOCUS_MIN_MINUTES) focus.setMinutes(m)
  }
  const total = timer.minutes * 60_000
  const progress = total ? Math.min(100, Math.max(0, ((total - remainingMs) / total) * 100)) : 0
  const studyPct = cycle ? Math.round((cycle.activeMs / (STUDY_BLOCK_MINUTES * 60_000)) * 100) : 0

  return (
    <div ref={ref} id={id} role="dialog" aria-modal="false" aria-labelledby={titleId} onKeyDown={onKeyDown}
      className={cn('fixed inset-x-3 bottom-20 max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-2xl border border-line bg-ink-900 p-4 text-ink-100 shadow-2xl',
        'motion-safe:animate-fade-up sm:absolute sm:inset-x-auto sm:bottom-16 sm:right-0 sm:w-[22rem]')}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="flex items-center gap-2 font-display text-base font-semibold text-fg"><Timer className="h-5 w-5 text-rose-500" aria-hidden /> Focus timer</h2>
        <button type="button" onClick={() => onClose(true)} aria-label="Close the focus timer" className="cursor-pointer rounded-lg p-1 text-ink-500 hover:bg-ink-800 hover:text-fg"><X className="h-4 w-4" /></button>
      </div>

      {cycle?.phase === 'break' && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-purple-300/40 bg-purple-500/8 px-3 py-2 text-xs text-ink-300">
          <Coffee className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" aria-hidden />
          <span><b className="text-fg">Break time · {formatClock(breakLeft)} left.</b> Enjoy the Game Zone — after {BREAK_MINUTES} minutes we’ll take you back to the AI Classroom.</span>
        </p>
      )}

      <div className="mt-3 text-center">
        <div role="timer" aria-label={`Focus time remaining: ${spokenClock(remainingMs)}`}
          className="font-display text-5xl font-extrabold tabular-nums tracking-tight text-fg">{formatClock(remainingMs)}</div>
        <p className="mt-1 text-xs text-ink-300" aria-live="polite">{STATUS_TEXT[timer.status]}</p>
        <div className="mx-auto mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-ink-700" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-rose-400 to-purple-500 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button ref={primary} className="flex-1 bg-gradient-to-br from-rose-400 to-rose-600" onClick={running ? focus.pause : focus.start}>
          {running ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {running ? 'Pause' : timer.status === 'paused' ? 'Resume' : timer.status === 'done' ? 'Start again' : 'Start focus'}
        </Button>
        <Button variant="secondary" size="icon" className="h-10 w-10" onClick={focus.reset} aria-label="Reset the timer"
          disabled={timer.status === 'idle'}><RotateCcw className="h-4 w-4" aria-hidden /></Button>
      </div>

      <fieldset className="mt-4" disabled={running}>
        <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-300">Length {running && <span className="normal-case tracking-normal text-ink-500">(pause to change)</span>}</legend>
        <div className="flex flex-wrap gap-1.5">
          {FOCUS_PRESETS.map((m) => (
            <button key={m} type="button" aria-pressed={timer.minutes === m && !customOpen} onClick={() => { setCustomOpen(false); focus.setMinutes(m) }}
              className={cn('cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                timer.minutes === m && !customOpen ? 'border-rose-400/60 bg-rose-500/10 text-rose-600' : 'border-line text-ink-300 hover:text-fg')}>
              {m} min
            </button>
          ))}
          <button type="button" aria-pressed={customOpen} onClick={() => setCustomOpen(true)}
            className={cn('cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              customOpen ? 'border-rose-400/60 bg-rose-500/10 text-rose-600' : 'border-line text-ink-300 hover:text-fg')}>
            Custom
          </button>
        </div>
        {customOpen && (
          <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); applyCustom() }}>
            <label htmlFor={`${id}-custom`} className="text-xs text-ink-300">Minutes</label>
            <input id={`${id}-custom`} type="number" inputMode="numeric" min={FOCUS_MIN_MINUTES} max={FOCUS_MAX_MINUTES} value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="h-9 w-20 rounded-lg border border-line bg-ink-900/70 px-2 text-sm text-ink-100 focus:border-brand-400/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            <Button type="submit" size="sm" variant="secondary">Set</Button>
          </form>
        )}
        {timer.minutes >= FOCUS_XP_MIN_MINUTES && <p className="mt-2 text-[11px] text-ink-500">Finishing a {FOCUS_XP_MIN_MINUTES}+ minute session earns Wellness XP.</p>}
      </fieldset>

      {focus.audioAvailable && (
        <fieldset className="mt-4 border-t border-line pt-3">
          <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-300">Sound <span className="normal-case tracking-normal text-ink-500">· plays while the timer runs</span></legend>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Focus sound">
            <SoundTile label="Off" checked={!prefs.sound} onSelect={() => focus.chooseSound(null)} />
            {FOCUS_SOUND_OPTIONS.map((o) => (
              <SoundTile key={o.id} label={o.label} hint={o.hint} checked={prefs.sound === o.id} onSelect={() => focus.chooseSound(o.id as FocusSoundId)} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={focus.toggleMute} aria-pressed={prefs.muted} aria-label={prefs.muted ? 'Unmute' : 'Mute'}
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-300 hover:bg-ink-800 hover:text-fg">
              {prefs.muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
            </button>
            <input type="range" min={0} max={100} step={5} value={Math.round(prefs.volume * 100)} aria-label="Volume"
              aria-valuetext={prefs.muted ? 'Muted' : `${Math.round(prefs.volume * 100)}%`}
              onChange={(e) => focus.setVolume(Number(e.target.value) / 100)} className="h-1.5 flex-1 cursor-pointer accent-rose-500" />
          </div>
        </fieldset>
      )}

      {cycle && cycle.phase === 'studying' && (
        <p className="mt-3 border-t border-line pt-3 text-[11px] text-ink-500">
          Study time towards your next break: <b className="text-ink-300">{Math.floor(cycle.activeMs / 60_000)} of {STUDY_BLOCK_MINUTES} min</b> ({studyPct}%).
        </p>
      )}
    </div>
  )
}

function SoundTile({ label, hint, checked, onSelect }: { label: string; hint?: string; checked: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-pressed={checked} onClick={onSelect} title={hint}
      className={cn('flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-lg border px-1.5 py-1.5 text-center text-xs font-medium leading-tight transition-colors',
        checked ? 'border-rose-400/60 bg-rose-500/10 text-rose-600' : 'border-line text-ink-300 hover:text-fg')}>
      {label}
      {hint && <span className="text-[10px] font-normal text-ink-500">{hint}</span>}
    </button>
  )
}
