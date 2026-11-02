/* Steady Signal: shapes appear one at a time; respond only to the target shape and let every other one pass
   (a go / no-go focus task). Shapes are told apart by outline and name, never by colour. Pure rules for tests. */
import { pickOne, type Rng } from '../rng'

export const SIGNAL_SHAPES = ['star', 'moon', 'leaf', 'drop', 'bolt', 'heart', 'hexagon', 'triangle'] as const
export type SignalShape = (typeof SIGNAL_SHAPES)[number]
export const SHAPE_NAMES: Record<SignalShape, string> = {
  star: 'Star', moon: 'Moon', leaf: 'Leaf', drop: 'Drop', bolt: 'Bolt', heart: 'Heart', hexagon: 'Hexagon', triangle: 'Triangle',
}

export interface Stimulus { shape: SignalShape; isTarget: boolean }

export const STREAM_LENGTH = 30
export const TARGET_RATIO = 0.3
export const LEAD_IN_MS = 1200
/** Longest run of targets, so the student cannot settle into simply pressing. */
const MAX_TARGET_RUN = 2

/** The stimuli for a round: exactly round(count × ratio) targets, never more than two in a row, and no distractor
    shown twice in a row. Targets are dealt into the gaps between distractors, at most two per gap. */
export function buildStream(target: SignalShape, count = STREAM_LENGTH, rng: Rng = Math.random, ratio = TARGET_RATIO): Stimulus[] {
  const distractors = count - Math.round(count * ratio)
  const targets = Math.min(count - distractors, (distractors + 1) * MAX_TARGET_RUN)
  const perGap = Array<number>(distractors + 1).fill(0)
  for (let t = 0; t < targets; t++) {
    const open = perGap.flatMap((n, gap) => (n < MAX_TARGET_RUN ? [gap] : []))
    perGap[pickOne(open, rng)]++
  }
  const flags = perGap.flatMap((n, gap) => [...Array<boolean>(n).fill(true), ...(gap < distractors ? [false] : [])])
  const others = SIGNAL_SHAPES.filter((s) => s !== target)
  let previous: SignalShape | null = null
  return flags.map((isTarget) => {
    const shape: SignalShape = isTarget ? target : pickOne(others.filter((s) => s !== previous), rng)
    previous = shape
    return { shape, isTarget }
  })
}

/** How long stimulus `index` stays up (1 s, tightening to 0.7 s) and the pause after it (0.5–0.8 s). */
export function stimulusTiming(index: number, count = STREAM_LENGTH): { showMs: number; gapMs: number } {
  const t = count > 1 ? index / (count - 1) : 0
  return { showMs: Math.round(1000 - 300 * t), gapMs: 500 + ((index * 7) % 4) * 100 }
}

export type SignalOutcome = 'hit' | 'miss' | 'false-alarm' | 'correct-rejection'
export const judgeSignal = (isTarget: boolean, responded: boolean): SignalOutcome =>
  isTarget ? (responded ? 'hit' : 'miss') : (responded ? 'false-alarm' : 'correct-rejection')

export interface SignalTally { hits: number; misses: number; falseAlarms: number; correctRejections: number; reactionMs: number[] }
export const newTally = (): SignalTally => ({ hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, reactionMs: [] })

export function tallySignal(t: SignalTally, outcome: SignalOutcome, reactionMs?: number): SignalTally {
  switch (outcome) {
    case 'hit': return { ...t, hits: t.hits + 1, reactionMs: reactionMs === undefined ? t.reactionMs : [...t.reactionMs, Math.round(reactionMs)] }
    case 'miss': return { ...t, misses: t.misses + 1 }
    case 'false-alarm': return { ...t, falseAlarms: t.falseAlarms + 1 }
    case 'correct-rejection': return { ...t, correctRejections: t.correctRejections + 1 }
  }
}

export const FAST_MS = 500
/** 10 per hit (+3 when under half a second), 2 per shape let pass, 5 off per false alarm; never below zero. */
export function signalScore(t: SignalTally): number {
  const fast = t.reactionMs.filter((ms) => ms < FAST_MS).length
  return Math.max(0, t.hits * 10 + fast * 3 + t.correctRejections * 2 - t.falseAlarms * 5)
}

export function signalAccuracy(t: SignalTally): number {
  const total = t.hits + t.misses + t.falseAlarms + t.correctRejections
  return total ? Math.round(((t.hits + t.correctRejections) / total) * 100) : 0
}

export const averageReaction = (t: SignalTally): number | null =>
  t.reactionMs.length ? Math.round(t.reactionMs.reduce((a, b) => a + b, 0) / t.reactionMs.length) : null
