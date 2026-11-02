import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Check, Wind } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GameProps } from '../catalog'
import { useGameClock } from '../clock'
import { ChoiceChips, GameShell } from '../GameShell'
import { TONES } from '../gridKeys'
import { useGameRun } from '../useGameRun'
import {
  BLOOM_BREATHS, bloomLengthMs, bloomMoment, bloomScore, breathHarmony, newHarmony, orbScale, overallHarmony, petalFor,
  sampleHarmony, type BreathPhase, type Petal,
} from './logic'

type InputMode = 'hold' | 'tap'
const MODES: { id: InputMode; label: string }[] = [
  { id: 'hold', label: 'Hold while breathing in' },
  { id: 'tap', label: 'Tap to switch' },
]
const RING_R = 54
const RING_C = 2 * Math.PI * RING_R
const isActivateKey = (k: string) => k === ' ' || k === 'Enter'

/** Game Zone ▸ Breath Bloom — a breathing-paced game: follow the guide and grow a six-petal flower. */
export default function BreathBloom({ info, onExit }: GameProps) {
  const run = useGameRun(info)
  const [mode, setMode] = useState<InputMode>('hold')
  const [holding, setHoldingState] = useState(false)
  const holdingRef = useRef(false)
  const [petals, setPetals] = useState<Petal[]>([])
  const [harmonyPct, setHarmonyPct] = useState(0)
  const harmonyRef = useRef(newHarmony())
  const lastRef = useRef<{ breath: number; phase: BreathPhase } | null>(null)

  const setHolding = (v: boolean) => {
    holdingRef.current = v
    setHoldingState(v)
  }

  // A held key or finger can be lost when the window loses focus — let go rather than "hold" forever
  useEffect(() => {
    const release = () => { if (holdingRef.current) setHolding(false) }
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)
    return () => {
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
    }
  }, [])

  const breathDone = (breath: number) => {
    const petal = petalFor(breathHarmony(harmonyRef.current, breath))
    setPetals((p) => [...p, petal])
    setHarmonyPct(overallHarmony(harmonyRef.current))
    run.play(petal === 'bloom' ? TONES.good : TONES.tap)
    run.announce(petal === 'bloom' ? `Breath ${breath + 1}: a petal opens.` : `Breath ${breath + 1}: a bud appears.`)
  }

  const onTick = (elapsed: number, step: number) => {
    harmonyRef.current = sampleHarmony(harmonyRef.current, bloomMoment(elapsed - step / 2), holdingRef.current, step)
    const now = bloomMoment(elapsed)
    const prev = lastRef.current
    if (prev && prev.breath === now.breath && prev.phase === now.phase) return
    if (prev && now.breath > prev.breath) breathDone(prev.breath)
    lastRef.current = { breath: now.breath, phase: now.phase }
    if (now.done) return
    run.play(now.phase === 'in' ? TONES.breatheIn : TONES.breatheOut)
    run.announce(now.phase === 'in' ? 'Breathe in' : 'Breathe out')
  }

  const end = () => {
    const h = harmonyRef.current
    const all = h.inTotal.map((_, i) => petalFor(breathHarmony(h, i)))
    const blooms = all.filter((p) => p === 'bloom').length
    run.play(TONES.done)
    run.finish({
      score: bloomScore(h),
      // A minute of breathing counts once the student has followed the guide for at least one breath
      completed: blooms > 0,
      headline: blooms === BLOOM_BREATHS ? 'Your flower is in full bloom' : blooms > 0 ? 'A calm minute, well spent' : 'A quiet minute',
      details: [
        `Petals in bloom: ${blooms} of ${BLOOM_BREATHS}`,
        `Breathing in rhythm: ${overallHarmony(h)}%`,
        ...(blooms > 0 ? [] : ['Hold the orb as you breathe in and let go as you breathe out to open petals and earn XP.']),
      ],
    })
  }

  const clock = useGameClock(run.active, { tickMs: 50, limitMs: bloomLengthMs(), onTick, onLimit: end })

  const start = () => {
    harmonyRef.current = newHarmony()
    lastRef.current = null
    setPetals([])
    setHarmonyPct(0)
    setHolding(false)
    clock.reset()
    run.start()
  }

  const press = (v: boolean) => { if (run.active) setHolding(v) }
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (mode !== 'hold' || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    press(true)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!isActivateKey(e.key)) return
    e.preventDefault()
    if (e.repeat) return
    press(mode === 'hold' ? true : !holdingRef.current)
  }
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!isActivateKey(e.key)) return
    e.preventDefault()
    if (mode === 'hold') press(false)
  }

  const m = bloomMoment(clock.elapsedMs)
  const inhale = m.phase === 'in'
  const inRhythm = holding === inhale
  const secondsLeft = Math.max(1, Math.ceil((m.phaseMs - m.phaseElapsedMs) / 1000))
  const scale = run.reducedMotion ? 1 : orbScale(m)
  const blooms = petals.filter((p) => p === 'bloom').length

  return (
    <GameShell run={run} onExit={onExit} onStart={start}
      hud={[
        { label: 'Breath', value: `${Math.min(m.breath + 1, BLOOM_BREATHS)}/${BLOOM_BREATHS}` },
        { label: 'Petals', value: `${blooms} in bloom` },
        { label: 'In rhythm', value: `${harmonyPct}%` },
      ]}
      setup={<ChoiceChips label="Controls" options={MODES} value={mode} onChange={setMode} />}>
      <div className="flex flex-col items-center gap-4 rounded-xl bg-gradient-to-b from-emerald-50 via-teal-50/60 to-sky-50 px-3 py-5">
        <div className="relative aspect-square w-full max-w-[300px]">
          <svg viewBox="-120 -120 240 240" className="absolute inset-0 h-full w-full" aria-hidden>
            {Array.from({ length: BLOOM_BREATHS }, (_, i) => {
              const petal = petals[i]
              const current = i === petals.length && i === m.breath
              return (
                <g key={i} transform={`rotate(${i * (360 / BLOOM_BREATHS)})`}>
                  {petal === 'bloom' ? (
                    <ellipse cx={0} cy={-80} rx={24} ry={36} fill="#fb7185" fillOpacity={0.85} stroke="#e11d48" strokeWidth={2} />
                  ) : petal === 'bud' ? (
                    <ellipse cx={0} cy={-74} rx={10} ry={16} fill="#34d399" stroke="#047857" strokeWidth={2} />
                  ) : (
                    <ellipse cx={0} cy={-80} rx={24} ry={36} fill="none" stroke={current ? '#4f46e5' : '#94a3b8'}
                      strokeWidth={current ? 2.5 : 1.5} strokeDasharray="5 5" />
                  )}
                </g>
              )
            })}
            <circle r={RING_R} fill="none" stroke="#cbd5e1" strokeWidth={5} />
            <circle r={RING_R} fill="none" stroke={inhale ? '#0f766e' : '#4f46e5'} strokeWidth={5} strokeLinecap="round"
              strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - m.progress)} transform="rotate(-90)" />
          </svg>
          <button type="button" data-autofocus aria-pressed={holding}
            aria-label={mode === 'hold' ? 'Breathing orb. Hold to breathe in, let go to breathe out.' : 'Breathing orb. Press to switch between breathing in and breathing out.'}
            onPointerDown={onPointerDown}
            onPointerUp={() => { if (mode === 'hold') press(false) }}
            onPointerCancel={() => { if (mode === 'hold') press(false) }}
            onLostPointerCapture={() => { if (mode === 'hold' && holdingRef.current) press(false) }}
            onClick={(e) => { if (mode === 'tap' && e.detail > 0) press(!holdingRef.current) }}
            onKeyDown={onKeyDown} onKeyUp={onKeyUp} onContextMenu={(e) => e.preventDefault()}
            style={{ transform: `translate(-50%, -50%) scale(${scale})`, touchAction: 'none', WebkitTouchCallout: 'none' }}
            className={cn('absolute left-1/2 top-1/2 flex h-24 w-24 cursor-pointer select-none flex-col items-center justify-center rounded-full text-white sm:h-28 sm:w-28',
              'shadow-[0_10px_30px_-10px_rgb(13_148_136/0.6)] transition-[background-color,box-shadow] duration-500',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/60',
              inhale ? 'bg-teal-700' : 'bg-indigo-600',
              holding && 'ring-4 ring-white/70')}>
            <span className="font-display text-lg font-bold" aria-hidden>{inhale ? 'In' : 'Out'}</span>
            <span className="text-sm tabular-nums opacity-90" aria-hidden>{secondsLeft}s</span>
          </button>
        </div>

        <div className="flex flex-col items-center gap-1 text-center" aria-hidden>
          <p className="m-0 font-display text-xl font-semibold text-fg">{inhale ? 'Breathe in…' : 'Breathe out…'}</p>
          <p className="m-0 text-sm text-ink-300">
            {mode === 'hold' ? (inhale ? 'Hold the orb (or Space)' : 'Let go') : (inhale ? 'Tap the orb as you breathe in' : 'Tap again as you breathe out')}
          </p>
          <p className={cn('m-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
            inRhythm ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line bg-ink-900 text-ink-300')}>
            {inRhythm ? <><Check className="h-3.5 w-3.5" />In rhythm</> : <><Wind className="h-3.5 w-3.5" />Follow the guide</>}
          </p>
        </div>
      </div>
    </GameShell>
  )
}
