import { useEffect, useRef, useState } from 'react'
import { Cloud, Droplet, Eye, Flame, Hand, Leaf, Moon, Shell, Snowflake, Sparkle, Star, Sun, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GameProps } from '../catalog'
import { GameShell } from '../GameShell'
import { PENTATONIC_HZ, TONES, isPlainKey, moveGridFocus, noteTone } from '../gridKeys'
import { useGameRun } from '../useGameRun'
import { MAX_LENGTH, SPARKS, extendSequence, judgeEcho, playbackTiming, startSequence, trailScore } from './logic'

const LANTERN_FACES: { name: string; icon: LucideIcon }[] = [
  { name: 'Moon', icon: Moon }, { name: 'Leaf', icon: Leaf }, { name: 'Star', icon: Star },
  { name: 'Drop', icon: Droplet }, { name: 'Flame', icon: Flame }, { name: 'Shell', icon: Shell },
  { name: 'Cloud', icon: Cloud }, { name: 'Sun', icon: Sun }, { name: 'Frost', icon: Snowflake },
]
const LEAD_MS = 700
const ECHO_GLOW_MS = 260

type Stage = 'watch' | 'echo'

/** Game Zone ▸ Lantern Trail — a sequence-recall game with lanterns, shapes and a pentatonic note for each. */
export default function LanternTrail({ info, onExit }: GameProps) {
  const run = useGameRun(info)
  const { play, announce, active } = run
  const [seq, setSeq] = useState<number[]>([])
  const [inputs, setInputs] = useState<number[]>([])
  const [stage, setStage] = useState<Stage>('watch')
  const [sparks, setSparks] = useState(SPARKS)
  const [cleared, setCleared] = useState<number[]>([])
  const [lit, setLit] = useState<number | null>(null)
  // Bumped to replay the same trail after a slip
  const [replay, setReplay] = useState(0)
  const glowTimer = useRef(0)
  // What to say before the next "Watch: …" (a cleared trail or a slip), so one announcement carries both
  const noteRef = useRef('')
  useEffect(() => () => window.clearTimeout(glowTimer.current), [])

  const start = () => {
    noteRef.current = ''
    setSeq(startSequence())
    setInputs([])
    setSparks(SPARKS)
    setCleared([])
    setLit(null)
    setStage('watch')
    run.start()
  }

  // Playback: glow each lantern of the trail in turn, then hand over. Pausing stops it; resuming replays the trail.
  useEffect(() => {
    if (stage !== 'watch' || !active || !seq.length) return
    const timers: number[] = []
    const { onMs, gapMs } = playbackTiming(seq.length)
    announce(`${noteRef.current}Watch: ${seq.map((i) => LANTERN_FACES[i].name).join(', ')}`)
    noteRef.current = ''
    let t = LEAD_MS
    for (const lantern of seq) {
      timers.push(window.setTimeout(() => { setLit(lantern); play(noteTone(PENTATONIC_HZ[lantern])) }, t))
      t += onMs
      timers.push(window.setTimeout(() => setLit(null), t))
      t += gapMs
    }
    timers.push(window.setTimeout(() => {
      setStage('echo')
      announce(`Your turn: ${seq.length} lanterns.`)
    }, t))
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      setLit(null)
    }
  }, [stage, active, seq, replay, play, announce])

  const finishRound = (clearedNow: number[], headline: string) => {
    const longest = Math.max(0, ...clearedNow)
    play(TONES.done)
    run.finish({
      score: trailScore(clearedNow),
      completed: true,
      headline,
      details: [`Longest trail: ${longest} lanterns`, `Trails cleared: ${clearedNow.length}`],
    })
  }

  const press = (lantern: number) => {
    if (!active || stage !== 'echo') return
    const next = [...inputs, lantern]
    setLit(lantern)
    window.clearTimeout(glowTimer.current)
    glowTimer.current = window.setTimeout(() => setLit(null), ECHO_GLOW_MS)
    const result = judgeEcho(seq, next)
    if (result === 'continue') {
      play(noteTone(PENTATONIC_HZ[lantern]))
      setInputs(next)
      return
    }
    if (result === 'complete') {
      play(TONES.good)
      const clearedNow = [...cleared, seq.length]
      setCleared(clearedNow)
      if (seq.length >= MAX_LENGTH) {
        finishRound(clearedNow, 'You walked the whole trail!')
        return
      }
      noteRef.current = `Trail of ${seq.length} cleared! One more lantern joins. `
      setSeq(extendSequence(seq))
      setInputs([])
      setStage('watch')
      return
    }
    play(TONES.soft)
    const left = sparks - 1
    setSparks(left)
    setInputs([])
    if (left <= 0) {
      finishRound(cleared, cleared.length ? 'Lovely memory work!' : 'A good warm-up!')
      return
    }
    noteRef.current = `Not quite. ${left} ${left === 1 ? 'spark' : 'sparks'} left. `
    setStage('watch')
    setReplay((r) => r + 1)
  }

  // Number keys 1–9 light the lanterns in reading order
  const pressRef = useRef(press)
  useEffect(() => { pressRef.current = press })
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (!isPlainKey(e) || !Number.isInteger(n) || n < 1 || n > 9) return
      e.preventDefault()
      pressRef.current(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  const watching = stage === 'watch'
  return (
    <GameShell run={run} onExit={onExit} onStart={start}
      hud={[
        { label: 'Trail', value: `${seq.length} lanterns` },
        { label: 'Sparks', value: <span><span aria-hidden>{'✦'.repeat(sparks)}{'·'.repeat(SPARKS - sparks)} </span>{sparks} left</span> },
        { label: 'Score', value: trailScore(cleared) },
      ]}>
      <div className="flex flex-col items-center gap-4 rounded-xl bg-gradient-to-b from-indigo-950 via-indigo-900 to-slate-900 px-3 py-5">
        <p className="m-0 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white" aria-hidden>
          {watching ? <><Eye className="h-4 w-4" />Watch the trail…</> : <><Hand className="h-4 w-4" />Your turn: {inputs.length} of {seq.length}</>}
        </p>
        <ul aria-label="Lanterns. Press 1 to 9, or use the arrow keys and Enter." onKeyDown={moveGridFocus}
          className="m-0 grid w-full max-w-sm list-none grid-cols-3 gap-3 p-0">
          {LANTERN_FACES.map(({ name, icon: Icon }, i) => {
            const on = lit === i
            return (
              <li key={name}>
                <button type="button" data-cell data-autofocus={i === 4 || undefined} aria-disabled={watching || undefined} onClick={() => press(i)}
                  aria-label={`${name} lantern, key ${i + 1}`}
                  className={cn('relative flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 transition-all duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-indigo-900',
                    on ? 'border-amber-200 bg-amber-300 text-indigo-950 shadow-[0_0_32px_8px_rgb(252_211_77/0.55)]' : 'border-white/15 bg-white/5 text-amber-100/80 hover:bg-white/10',
                    on && !run.reducedMotion && 'scale-105',
                    watching && 'cursor-default')}>
                  <span aria-hidden className="absolute left-1.5 top-1 text-[10px] font-semibold opacity-70">{i + 1}</span>
                  {on && <Sparkle aria-hidden className="absolute right-1.5 top-1.5 h-3.5 w-3.5" />}
                  <Icon aria-hidden className={cn('h-7 w-7 sm:h-8 sm:w-8', on && 'fill-current')} />
                  <span aria-hidden className="text-[11px] font-semibold">{name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </GameShell>
  )
}
