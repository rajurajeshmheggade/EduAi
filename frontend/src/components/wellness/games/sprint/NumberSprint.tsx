import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import type { GameProps } from '../catalog'
import { formatClock, useGameClock } from '../clock'
import { GameShell } from '../GameShell'
import { TONES, isPlainKey } from '../gridKeys'
import { useGameRun } from '../useGameRun'
import { MIN_ANSWERS_FOR_XP, SPRINT_MS, TIER_LABELS, fmt, makeQuestion, nextTier, sprintPoints, tierForStudent, type MathsQuestion, type Tier } from './logic'

interface SprintState {
  q: MathsQuestion
  tier: Tier
  streak: number
  slips: number
  answered: number
  correct: number
  score: number
  bestStreak: number
  topTier: Tier
  last: { text: string; answer: number; right: boolean } | null
}

const fresh = (tier: Tier): SprintState => ({
  q: makeQuestion(tier), tier, streak: 0, slips: 0, answered: 0, correct: 0, score: 0, bestStreak: 0, topTier: tier, last: null,
})

/** Game Zone ▸ Number Sprint — a one-minute mental maths sprint pitched at the student's level. */
export default function NumberSprint({ info, onExit }: GameProps) {
  const run = useGameRun(info)
  const { context } = useWellness()
  const base = useMemo(() => tierForStudent(context), [context])
  const [s, setS] = useState<SprintState>(() => fresh(base))
  const sRef = useRef(s)
  const update = (next: SprintState) => {
    sRef.current = next
    setS(next)
  }

  const end = () => {
    const f = sRef.current
    const pct = f.answered ? Math.round((f.correct / f.answered) * 100) : 0
    const completed = f.answered >= MIN_ANSWERS_FOR_XP
    run.play(TONES.done)
    run.finish({
      score: f.score,
      completed,
      headline: f.correct >= 15 ? 'Lightning quick!' : f.correct >= 8 ? 'Sharp thinking!' : 'Time! Nice warm-up',
      details: [
        `Answered ${f.answered} · ${f.correct} correct (${pct}%)`,
        `Longest streak: ${f.bestStreak}`,
        `Highest level: ${TIER_LABELS[f.topTier]}`,
        ...(completed ? [] : [`Answer at least ${MIN_ANSWERS_FOR_XP} questions to earn XP.`]),
      ],
    })
  }
  const clock = useGameClock(run.active, { limitMs: SPRINT_MS, onLimit: end })

  const start = () => {
    const first = fresh(base)
    update(first)
    clock.reset()
    run.start()
    run.announce(`One minute. Press 1 to 4 to answer. First: ${first.q.text}`)
  }

  const answer = (choice: number) => {
    if (!run.active) return
    const cur = sRef.current
    const right = choice === cur.q.answer
    const streak = right ? cur.streak + 1 : 0
    const slips = right ? 0 : cur.slips + 1
    const tier = nextTier(cur.tier, base, streak, slips)
    const q = makeQuestion(tier)
    update({
      q, tier, streak,
      slips: tier !== cur.tier ? 0 : slips,
      answered: cur.answered + 1,
      correct: cur.correct + (right ? 1 : 0),
      score: cur.score + (right ? sprintPoints(cur.tier, streak) : 0),
      bestStreak: Math.max(cur.bestStreak, streak),
      topTier: Math.max(cur.topTier, tier) as Tier,
      last: { text: cur.q.text, answer: cur.q.answer, right },
    })
    run.play(right ? TONES.good : TONES.soft)
    const level = tier > cur.tier ? ` Level up: ${TIER_LABELS[tier]}.` : tier < cur.tier ? ` Easing to ${TIER_LABELS[tier]}.` : ''
    run.announce(`${right ? 'Correct' : `Not quite, ${cur.q.text} is ${fmt(cur.q.answer)}`}.${level} Next: ${q.text}`)
  }

  // Number keys 1–4 answer from anywhere on the page while the sprint runs
  const answerRef = useRef(answer)
  useEffect(() => { answerRef.current = answer })
  useEffect(() => {
    if (!run.active) return
    const onKey = (e: KeyboardEvent) => {
      const i = ['1', '2', '3', '4'].indexOf(e.key)
      if (i < 0 || !isPlainKey(e)) return
      e.preventDefault()
      answerRef.current(sRef.current.q.options[i])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run.active])

  const left = SPRINT_MS - clock.elapsedMs
  return (
    <GameShell run={run} onExit={onExit} onStart={start}
      hud={[
        { label: 'Time left', value: formatClock(left) },
        { label: 'Score', value: s.score },
        { label: 'Streak', value: s.streak },
        { label: 'Level', value: TIER_LABELS[s.tier] },
      ]}
      setup={<p className="m-0 text-xs text-ink-300">Starting level: <b className="text-fg">{TIER_LABELS[base]}</b>, from your maths results.</p>}>
      <div className="flex flex-col items-center gap-5 rounded-xl bg-gradient-to-b from-amber-50 to-rose-50/60 px-3 py-6">
        <div aria-hidden className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-ink-700">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-400 transition-[width] duration-200" style={{ width: `${(left / SPRINT_MS) * 100}%` }} />
        </div>
        <p className="m-0 font-display text-4xl font-bold tabular-nums text-fg sm:text-5xl">
          <span aria-hidden>{s.q.text} <span className="text-ink-500">= ?</span></span>
          <span className="sr-only">What is {s.q.text}?</span>
        </p>
        <div className="grid w-full max-w-md grid-cols-2 gap-3" role="group" aria-label="Answers">
          {s.q.options.map((o, i) => (
            <button key={i} type="button" data-autofocus={i === 0 || undefined} onClick={() => answer(o)}
              className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-line bg-ink-900 font-display text-2xl font-semibold tabular-nums text-fg shadow-sm transition-colors hover:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 active:scale-[0.98]">
              <span aria-hidden className="rounded-md border border-line px-1.5 text-xs font-medium text-ink-500">{i + 1}</span>
              {fmt(o)}
            </button>
          ))}
        </div>
        <p className="m-0 min-h-6 text-sm" aria-hidden>
          {s.last && (
            <span className={cn('inline-flex items-center gap-1 font-medium', s.last.right ? 'text-ok' : 'text-ink-300')}>
              {s.last.right ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              {s.last.right ? 'Correct' : 'Not quite'}: {s.last.text} = {fmt(s.last.answer)}
            </span>
          )}
        </p>
      </div>
    </GameShell>
  )
}
