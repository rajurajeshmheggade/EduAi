import { useEffect, useRef, useState } from 'react'
import { Check, Droplet, Heart, Hexagon, Leaf, Moon, Pause, Star, Triangle, X, Zap, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GameProps } from '../catalog'
import { GameShell } from '../GameShell'
import { TONES, isPlainKey } from '../gridKeys'
import { pickOne } from '../rng'
import { useGameRun } from '../useGameRun'
import {
  LEAD_IN_MS, SHAPE_NAMES, SIGNAL_SHAPES, STREAM_LENGTH, averageReaction, buildStream, judgeSignal, newTally, signalAccuracy,
  signalScore, stimulusTiming, tallySignal, type SignalOutcome, type SignalShape, type SignalTally, type Stimulus,
} from './logic'

const ICONS: Record<SignalShape, LucideIcon> = { star: Star, moon: Moon, leaf: Leaf, drop: Droplet, bolt: Zap, heart: Heart, hexagon: Hexagon, triangle: Triangle }

const FEEDBACK: Record<SignalOutcome, { text: (shape: string) => string; good: boolean }> = {
  hit: { text: () => 'Got it!', good: true },
  miss: { text: (shape) => `That ${shape} slipped by`, good: false },
  'false-alarm': { text: (shape) => `Steady — that was a ${shape}`, good: false },
  'correct-rejection': { text: () => '', good: true },
}

/** Game Zone ▸ Steady Signal — respond to the target shape only; let the distractors pass. */
export default function SteadySignal({ info, onExit }: GameProps) {
  const run = useGameRun(info)
  const { active, play, announce } = run
  const [target, setTarget] = useState<SignalShape>('star')
  const [stream, setStream] = useState<Stimulus[]>([])
  // -1 before the first shape; `visible` is whether stream[index] is on screen
  const [index, setIndex] = useState(-1)
  const [visible, setVisible] = useState(false)
  const [tally, setTally] = useState<SignalTally>(newTally)
  const [feedback, setFeedback] = useState<{ text: string; good: boolean } | null>(null)
  const tallyRef = useRef(tally)
  const respondedRef = useRef(false)
  const shownAtRef = useRef(0)

  const record = (outcome: SignalOutcome, shape: SignalShape, reactionMs?: number) => {
    tallyRef.current = tallySignal(tallyRef.current, outcome, reactionMs)
    setTally(tallyRef.current)
    const f = FEEDBACK[outcome]
    const text = outcome === 'hit' && reactionMs !== undefined ? `Got it! ${Math.round(reactionMs)} ms` : f.text(SHAPE_NAMES[shape])
    setFeedback(text ? { text, good: f.good } : null)
    if (outcome === 'hit') play(TONES.good)
    else if (outcome !== 'correct-rejection') play(TONES.soft)
    if (outcome === 'miss' || outcome === 'false-alarm') announce(text)
  }

  const end = () => {
    const t = tallyRef.current
    const avg = averageReaction(t)
    play(TONES.done)
    run.finish({
      score: signalScore(t),
      completed: t.hits > 0,
      headline: t.falseAlarms === 0 && t.misses === 0 ? 'Rock-steady focus!' : signalAccuracy(t) >= 80 ? 'Steady and sharp!' : 'Good focus practice!',
      details: [
        `Accuracy: ${signalAccuracy(t)}%`,
        `Targets caught: ${t.hits} of ${t.hits + t.misses}`,
        `Shapes let pass: ${t.correctRejections} · early taps: ${t.falseAlarms}`,
        ...(avg !== null ? [`Average reaction: ${avg} ms`] : []),
      ],
      xpNote: 'Catch at least one target to earn XP.',
    })
  }

  const start = () => {
    const next = pickOne(SIGNAL_SHAPES)
    setTarget(next)
    setStream(buildStream(next))
    setIndex(-1)
    setVisible(false)
    tallyRef.current = newTally()
    setTally(tallyRef.current)
    setFeedback(null)
    respondedRef.current = false
    run.start()
    announce(`Your target is the ${SHAPE_NAMES[next]}. Press Space only when it appears.`)
  }

  // The stream: show a shape for its window, then a short gap. Pausing cancels the timer; resuming re-shows the
  // current shape for a full window, so a hidden tab never counts as a miss.
  const endRef = useRef(end)
  const recordRef = useRef(record)
  useEffect(() => {
    endRef.current = end
    recordRef.current = record
  })
  useEffect(() => {
    if (!active || !stream.length) return
    const { showMs, gapMs } = stimulusTiming(Math.max(0, index), stream.length)
    let id: number
    if (visible) {
      shownAtRef.current = performance.now()
      id = window.setTimeout(() => {
        const s = stream[index]
        if (!respondedRef.current) recordRef.current(judgeSignal(s.isTarget, false), s.shape)
        setVisible(false)
      }, showMs)
    } else {
      id = window.setTimeout(() => {
        if (index + 1 >= stream.length) {
          endRef.current()
          return
        }
        respondedRef.current = false
        setIndex(index + 1)
        setVisible(true)
      }, index < 0 ? LEAD_IN_MS : gapMs)
    }
    return () => window.clearTimeout(id)
  }, [active, stream, index, visible])

  const respond = () => {
    if (!active || !visible || respondedRef.current || index < 0) return
    respondedRef.current = true
    const s = stream[index]
    record(judgeSignal(s.isTarget, true), s.shape, performance.now() - shownAtRef.current)
    setVisible(false)
  }

  // Space or Enter responds from anywhere on the page while the round runs
  const respondRef = useRef(respond)
  useEffect(() => { respondRef.current = respond })
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== ' ' && e.key !== 'Enter') || !isPlainKey(e) || e.repeat) return
      // Let Enter/Space activate the header buttons (Pause, Sound, Back) when they have focus
      if (e.target instanceof HTMLElement && e.target.closest('button') && !e.target.closest('[data-signal]')) return
      e.preventDefault()
      respondRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const TargetIcon = ICONS[target]
  const current = visible && index >= 0 ? stream[index] : null
  const CurrentIcon = current ? ICONS[current.shape] : null
  return (
    <GameShell run={run} onExit={onExit} onStart={start}
      hud={[
        { label: 'Shape', value: `${Math.max(0, Math.min(index + 1, STREAM_LENGTH))}/${STREAM_LENGTH}` },
        { label: 'Score', value: signalScore(tally) },
        { label: 'Caught', value: tally.hits },
        { label: 'Early taps', value: tally.falseAlarms },
      ]}>
      <div className="flex flex-col items-center gap-4 rounded-xl bg-gradient-to-b from-sky-50 to-indigo-50/70 px-3 py-5">
        <p className="m-0 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-ink-900 px-3 py-1.5 text-sm font-medium text-fg">
          Target: <TargetIcon className="h-5 w-5 fill-current text-indigo-600" aria-hidden /><b>{SHAPE_NAMES[target]}</b>
        </p>
        <div data-signal onPointerDown={(e) => { e.preventDefault(); respond() }}
          className="relative grid h-52 w-full max-w-sm cursor-pointer select-none place-items-center rounded-2xl border-2 border-slate-700 bg-slate-900 sm:h-60"
          style={{ touchAction: 'manipulation' }} aria-hidden>
          {current && CurrentIcon ? (
            <div key={index} className={cn('flex flex-col items-center gap-2 text-amber-100', !run.reducedMotion && 'animate-[fade-up_0.15s_ease-out_both]')}>
              <CurrentIcon className="h-24 w-24 fill-current sm:h-28 sm:w-28" strokeWidth={1.5} />
              <span className="text-sm font-semibold tracking-wide">{SHAPE_NAMES[current.shape]}</span>
            </div>
          ) : (
            <span className="text-3xl text-slate-600">·</span>
          )}
        </div>
        {/* Screen readers hear each shape as it appears */}
        <p className="sr-only" aria-live="assertive">{current ? SHAPE_NAMES[current.shape] : ''}</p>
        <button type="button" data-signal data-autofocus onClick={respond}
          className="h-14 w-full max-w-sm cursor-pointer rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 font-display text-lg font-semibold text-white shadow-glow transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300">
          Now! <span className="text-sm font-normal opacity-90">(Space)</span>
        </button>
        <p className="m-0 min-h-6 text-sm" aria-hidden>
          {feedback ? (
            <span className={cn('inline-flex items-center gap-1 font-medium', feedback.good ? 'text-ok' : 'text-ink-300')}>
              {feedback.good ? <Check className="h-4 w-4" /> : feedback.text.startsWith('Steady') ? <Pause className="h-4 w-4" /> : <X className="h-4 w-4" />}{feedback.text}
            </span>
          ) : index < 0 ? <span className="text-ink-300">Get ready…</span> : null}
        </p>
      </div>
    </GameShell>
  )
}
