/* Lantern Trail: nine lanterns, each with its own shape, name and note. Watch a trail of glows, then repeat it;
   each cleared trail grows by one. Pure sequence rules for tests. */
import { randInt, type Rng } from '../rng'

export const LANTERNS = 9
export const START_LENGTH = 3
export const MAX_LENGTH = 12
export const SPARKS = 3

/** Adds one lantern to the trail, never the same as the one before it (a repeat is hard to see). */
export function extendSequence(seq: readonly number[], rng: Rng = Math.random, count = LANTERNS): number[] {
  const last = seq[seq.length - 1]
  let next = randInt(0, count - 2, rng)
  if (last !== undefined && next >= last) next += 1
  return [...seq, next]
}

export function startSequence(rng: Rng = Math.random, length = START_LENGTH): number[] {
  let seq: number[] = []
  while (seq.length < length) seq = extendSequence(seq, rng)
  return seq
}

export type EchoResult = 'continue' | 'complete' | 'wrong'

/** Checks the student's taps so far against the trail. */
export function judgeEcho(seq: readonly number[], inputs: readonly number[]): EchoResult {
  if (!inputs.length) return 'continue'
  if (inputs.length > seq.length || inputs.some((v, i) => v !== seq[i])) return 'wrong'
  return inputs.length === seq.length ? 'complete' : 'continue'
}

/** Glow and gap per lantern: a little quicker as the trail grows, never rushed. */
export function playbackTiming(length: number): { onMs: number; gapMs: number } {
  const extra = Math.max(0, length - START_LENGTH)
  return { onMs: Math.max(340, 620 - extra * 30), gapMs: Math.max(150, 260 - extra * 12) }
}

/** Ten points per lantern in every trail cleared. */
export const trailScore = (cleared: readonly number[]): number => cleared.reduce((sum, len) => sum + len * 10, 0)
