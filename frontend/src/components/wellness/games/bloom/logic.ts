/* Breath Bloom: hold while breathing in, let go while breathing out. A longer out-breath than in-breath is the
   calming part. How closely the student's input follows the guide ("harmony") decides whether each breath opens a
   full petal or a bud — there is no failing, only a fuller or quieter flower. */

export interface BloomPattern { inhaleMs: number; exhaleMs: number }
export type BreathPhase = 'in' | 'out'

export const BLOOM_PATTERN: BloomPattern = { inhaleMs: 4000, exhaleMs: 6000 }
export const BLOOM_BREATHS = 6
/** The first moments of each phase always count, so a human reaction delay is never penalised. */
export const GRACE_MS = 700
/** Harmony needed for a full petal (idling or holding throughout gives about 0.55). */
export const BLOOM_THRESHOLD = 0.7

export const bloomLengthMs = (pattern: BloomPattern = BLOOM_PATTERN, breaths = BLOOM_BREATHS) => (pattern.inhaleMs + pattern.exhaleMs) * breaths

export interface BloomMoment {
  /** Breath index (0-based); equals the breath count once done. */
  breath: number
  phase: BreathPhase
  phaseElapsedMs: number
  phaseMs: number
  /** 0 → 1 through the current phase. */
  progress: number
  done: boolean
}

/** Where the guide is after `elapsedMs` of play. */
export function bloomMoment(elapsedMs: number, pattern: BloomPattern = BLOOM_PATTERN, breaths = BLOOM_BREATHS): BloomMoment {
  const cycle = pattern.inhaleMs + pattern.exhaleMs
  if (elapsedMs >= cycle * breaths) {
    return { breath: breaths, phase: 'out', phaseElapsedMs: pattern.exhaleMs, phaseMs: pattern.exhaleMs, progress: 1, done: true }
  }
  const t = Math.max(0, elapsedMs)
  const breath = Math.floor(t / cycle)
  const within = t - breath * cycle
  const phase: BreathPhase = within < pattern.inhaleMs ? 'in' : 'out'
  const phaseMs = phase === 'in' ? pattern.inhaleMs : pattern.exhaleMs
  const phaseElapsedMs = phase === 'in' ? within : within - pattern.inhaleMs
  return { breath, phase, phaseElapsedMs, phaseMs, progress: phaseElapsedMs / phaseMs, done: false }
}

/** Matched and total sampled time per breath, kept separately for the in- and the out-breath. */
export interface Harmony { inMatched: number[]; inTotal: number[]; outMatched: number[]; outTotal: number[] }

const zeros = (n: number) => Array<number>(n).fill(0)
export const newHarmony = (breaths = BLOOM_BREATHS): Harmony => ({ inMatched: zeros(breaths), inTotal: zeros(breaths), outMatched: zeros(breaths), outTotal: zeros(breaths) })

/** Adds a sample of `stepMs` at `moment` with the student holding (breathing in) or not. */
export function sampleHarmony(h: Harmony, moment: BloomMoment, holding: boolean, stepMs: number): Harmony {
  if (moment.done || stepMs <= 0 || moment.breath >= h.inTotal.length) return h
  const ok = holding === (moment.phase === 'in') || moment.phaseElapsedMs < GRACE_MS
  const [matchedKey, totalKey] = moment.phase === 'in' ? (['inMatched', 'inTotal'] as const) : (['outMatched', 'outTotal'] as const)
  const matched = [...h[matchedKey]]
  const total = [...h[totalKey]]
  total[moment.breath] += stepMs
  if (ok) matched[moment.breath] += stepMs
  return { ...h, [matchedKey]: matched, [totalKey]: total }
}

/**
 * 0–1 for one breath: the in-breath and the out-breath count equally (so simply never pressing, or holding the
 * whole time, lands near one half). 0 before the breath is sampled.
 */
export function breathHarmony(h: Harmony, breath: number): number {
  const parts: number[] = []
  if (h.inTotal[breath]) parts.push(h.inMatched[breath] / h.inTotal[breath])
  if (h.outTotal[breath]) parts.push(h.outMatched[breath] / h.outTotal[breath])
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0
}

export type Petal = 'bloom' | 'bud'
export const petalFor = (harmony: number): Petal => (harmony >= BLOOM_THRESHOLD ? 'bloom' : 'bud')

/** Up to 100 per breath for following the guide: half-in-rhythm (what idling gives) scores nothing. */
export const breathPoints = (harmony: number): number => Math.round(Math.max(0, 2 * harmony - 1) * 100)

export function bloomScore(h: Harmony): number {
  return h.inTotal.reduce((sum, _, i) => sum + breathPoints(breathHarmony(h, i)), 0)
}

/** Average harmony over the breaths sampled so far, 0–100. */
export function overallHarmony(h: Harmony): number {
  const sampled = h.inTotal.map((_, i) => i).filter((i) => h.inTotal[i] || h.outTotal[i])
  return sampled.length ? Math.round((sampled.reduce((sum, i) => sum + breathHarmony(h, i), 0) / sampled.length) * 100) : 0
}

/** Orb size through the guide: grows on the in-breath, shrinks on the out-breath. */
export function orbScale(m: BloomMoment, min = 0.72, max = 1.12): number {
  const eased = (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, m.progress)))) / 2
  return m.phase === 'in' ? min + (max - min) * eased : max - (max - min) * eased
}
