import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ArrowLeft, Clock, LayoutGrid, Medal, Pause, Play, RotateCcw, Trophy, Volume2, VolumeX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { SKILLS, type GameSkill } from './catalog'
import type { GameRun } from './useGameRun'

export interface HudItem { label: string; value: ReactNode }

/** "Calm · Focus" chips: icon + text, never colour alone. */
export function SkillTags({ trains, className }: { trains: readonly GameSkill[]; className?: string }) {
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="sr-only">Trains:</span>
      {trains.map((s) => {
        const { icon: Icon, label, hint } = SKILLS[s]
        return (
          <span key={s} title={hint} className="inline-flex items-center gap-1 rounded-full border border-line bg-ink-900/80 px-2 py-0.5 text-[11px] font-medium text-ink-300">
            <Icon className="h-3 w-3" aria-hidden />{label}
          </span>
        )
      })}
    </span>
  )
}

/** Topic chips for a start screen (subject vocabulary, sorting sets…). */
export function ChoiceChips<T extends string>({ label, options, value, onChange }: {
  label: string
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-ink-300">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
            className={cn('cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              value === o.id ? 'border-brand-400 bg-brand-500/10 text-brand-600' : 'border-line bg-ink-900 text-ink-300 hover:border-line-strong hover:text-fg')}>
            {value === o.id && <span aria-hidden>✓ </span>}{o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const focusFirst = (root: HTMLElement | null) => {
  const el = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]')
  el?.focus({ preventScroll: true })
}

/**
 * The frame every Game Zone game sits in: back link, title, pause and sound toggles, a score bar while playing, the
 * start screen (how to play + options), a pause overlay and the end screen with "Play again" / "Back to Game Zone".
 * Focus follows the flow: the title when the game opens, the board (its `data-autofocus` control) on start and
 * resume, Resume while paused, and the result heading at the end.
 */
export function GameShell({ run, onExit, onStart, hud, setup, children, boardClassName }: {
  run: GameRun
  onExit: () => void
  /** The game's own reset, which must call run.start(). */
  onStart: () => void
  hud?: HudItem[]
  /** Extra start-screen content: topic or difficulty choices. */
  setup?: ReactNode
  /** The board, shown while playing. */
  children: ReactNode
  boardClassName?: string
}) {
  const { info, phase, paused, result, best, muted } = run
  const Icon = info.icon
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const resumeRef = useRef<HTMLButtonElement>(null)
  const endRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    if (phase === 'playing' && !paused) focusFirst(boardRef.current)
    else if (phase === 'playing' && paused) resumeRef.current?.focus({ preventScroll: true })
    else if (phase === 'over') endRef.current?.focus({ preventScroll: true })
  }, [phase, paused, run.round])

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6" role="region" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onExit} aria-label="Back to Game Zone" className="-ml-2">
            <ArrowLeft className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Game Zone</span>
          </Button>
          <Icon className="h-5 w-5 shrink-0 text-rose-400" aria-hidden />
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="truncate font-display text-lg font-semibold text-fg outline-none">{info.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          {phase === 'playing' && (
            <Button variant="secondary" size="sm" onClick={paused ? run.resume : run.pause}>
              {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}{paused ? 'Resume' : 'Pause'}
            </Button>
          )}
          {/* The state is announced by aria-pressed, so the accessible name stays "Sound" */}
          <Button variant="secondary" size="sm" onClick={run.toggleMute} aria-pressed={!muted} title={muted ? 'Turn game sounds on' : 'Mute game sounds'}>
            {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
            <span>Sound <span aria-hidden>{muted ? 'off' : 'on'}</span></span>
          </Button>
        </div>
      </div>

      {phase === 'playing' && hud && hud.length > 0 && (
        <dl className="flex flex-wrap gap-2" aria-label="Score">
          {hud.map((h) => (
            <div key={h.label} className="min-w-20 rounded-lg border border-line bg-ink-900/80 px-3 py-1.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{h.label}</dt>
              <dd className="m-0 font-display text-base font-semibold tabular-nums text-fg">{h.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {phase === 'ready' && (
        <div className={cn('grid items-center gap-5 rounded-xl border border-line bg-gradient-to-br p-5 md:grid-cols-[1fr_auto]', info.art)}>
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm font-medium text-fg">{info.blurb}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{info.duration}</span>
              <SkillTags trains={info.trains} />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-fg">How to play</h3>
              <ul className="m-0 list-disc space-y-1 pl-5 text-sm leading-snug text-ink-300">
                {info.howTo.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
            {setup}
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button size="lg" onClick={onStart} className="min-w-40"><Play className="h-4 w-4" aria-hidden />Start</Button>
            <span className="text-xs text-ink-300">{best > 0 ? <>Your best: <b className="tabular-nums text-fg">{best}</b></> : 'No best score yet'}</span>
          </div>
        </div>
      )}

      {phase === 'playing' && (
        <div className="relative">
          <div ref={boardRef} inert={paused} aria-hidden={paused || undefined} className={cn(boardClassName, paused && 'blur-sm')}>
            {children}
          </div>
          {paused && (
            <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-ink-900/70 p-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <Pause className="h-8 w-8 text-brand-500" aria-hidden />
                <p className="m-0 font-display text-lg font-semibold text-fg">Paused</p>
                <p className="m-0 max-w-64 text-sm text-ink-300">Take your time. The clock waits for you.</p>
                <Button ref={resumeRef} onClick={run.resume}><Play className="h-4 w-4" aria-hidden />Resume</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'over' && result && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-ink-900/80 px-4 py-8 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-amber-100"><Trophy className="h-7 w-7 text-amber-400" aria-hidden /></div>
          <h3 ref={endRef} tabIndex={-1} className="font-display text-xl font-semibold text-fg outline-none">{result.headline}</h3>
          <p className="m-0 text-sm text-ink-300">{result.scoreLabel ?? 'Score'} <b className="block font-display text-4xl tabular-nums text-fg">{result.score}</b></p>
          {result.isNewBest
            ? <Badge tone="ok"><Medal className="h-3.5 w-3.5" aria-hidden />New personal best!</Badge>
            : <p className="m-0 text-xs text-ink-300">Your best: <b className="tabular-nums text-fg">{result.best}</b></p>}
          {result.details.length > 0 && (
            <ul className="m-0 list-none space-y-1 p-0 text-sm text-ink-300">
              {result.details.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
          {result.extra}
          <p className="m-0 text-xs text-ink-500">
            {result.completed ? `+${run.xpEach} XP for finishing (game XP has a daily limit).` : (result.xpNote ?? 'Finish a full round to earn XP.')}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button onClick={onStart}><RotateCcw className="h-4 w-4" aria-hidden />Play again</Button>
            <Button variant="secondary" onClick={onExit}><LayoutGrid className="h-4 w-4" aria-hidden />Back to Game Zone</Button>
          </div>
        </div>
      )}

      <p className="sr-only" aria-live="polite">{run.announcement}</p>
    </Card>
  )
}
