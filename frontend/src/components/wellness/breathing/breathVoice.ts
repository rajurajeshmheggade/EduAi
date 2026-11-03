/* Timing and voice-over for the breathing exercises (MindAlign utils/breathVoice.js).
   The bubble and the spoken guide both follow one session clock, and that clock is re-locked to the voice
   every time a cue starts, so the two cannot drift apart. */

// Slower than normal speech so the guide sounds calm (cues are a word or two, so they still finish early in a phase)
export const BREATH_VOICE_RATE = 0.85
// "Get ready" time between pressing Begin and the first inhale (also lets the speech engine warm up)
export const BREATH_LEAD_IN_MS = 3000
// Spoken during the lead-in
export const BREATH_INTRO_CUE = "Let's begin."
// Speech engines start talking a moment after speak() is called. Each cue is sent this much before its phase
// starts so the word lands on the phase change; the value is then refined from the measured start-up delay.
export const DEFAULT_VOICE_LEAD_MS = 300
export const MAX_VOICE_LEAD_MS = 800
// The bubble changes phase the instant the voice starts. If the voice is late, the bubble waits at most this long for it.
export const MAX_VOICE_WAIT_MS = 600

/** Anything with a phase length in seconds (a breathing step). */
export interface TimedStep { duration: number }

export interface BreathPosition {
  /** Completed cycles. */
  cycle: number
  /** Index of the current step within the cycle. */
  stepIdx: number
  /** Phases started before the current one, counted across cycles. */
  phase: number
  /** Whole seconds left in the current phase (never 0). */
  secondsRemaining: number
  /** Session time (ms) at which the next phase starts. */
  nextPhaseAtMs: number
}

const cycleLengthMs = (sequence: readonly TimedStep[]) => sequence.reduce((sum, step) => sum + step.duration * 1000, 0)

/**
 * Session time at which a phase starts (the counterpart of getBreathPosition().phase).
 * @param sequence Phases of one cycle, durations in seconds.
 * @param phase Phase number counted across cycles (0 = the first inhale).
 * @returns Milliseconds since the first inhale started.
 */
export function getPhaseStartMs(sequence: readonly TimedStep[], phase: number): number {
  let startMs = Math.floor(phase / sequence.length) * cycleLengthMs(sequence)
  for (let i = 0; i < phase % sequence.length; i++) startMs += sequence[i].duration * 1000
  return startMs
}

/**
 * Works out where a breathing session is at a given moment on the session clock.
 * @param sequence Phases of one cycle, durations in seconds.
 * @param elapsedMs Milliseconds since the first inhale started (negative during the lead-in counts as the start).
 */
export function getBreathPosition(sequence: readonly TimedStep[], elapsedMs: number): BreathPosition {
  const stepMs = (idx: number) => sequence[idx].duration * 1000
  const cycleMs = cycleLengthMs(sequence)
  const elapsed = Math.max(0, elapsedMs)
  const cycle = Math.floor(elapsed / cycleMs)
  let intoStep = elapsed - cycle * cycleMs
  let stepIdx = 0
  while (stepIdx < sequence.length - 1 && intoStep >= stepMs(stepIdx)) {
    intoStep -= stepMs(stepIdx)
    stepIdx++
  }
  return {
    cycle,
    stepIdx,
    phase: cycle * sequence.length + stepIdx,
    secondsRemaining: Math.max(1, Math.ceil((stepMs(stepIdx) - intoStep) / 1000)),
    nextPhaseAtMs: elapsed - intoStep + stepMs(stepIdx),
  }
}

/**
 * Refines how early cues are sent, from how long the speech engine just took to start talking.
 * @param currentLeadMs Lead time in use.
 * @param measuredDelayMs Time from speak() to the utterance's start event.
 * @returns The lead time to use for the next cue.
 */
export function nextVoiceLead(currentLeadMs: number, measuredDelayMs: number): number {
  if (!Number.isFinite(measuredDelayMs) || measuredDelayMs < 0) return currentLeadMs
  // Average with the previous value so one slow start doesn't throw the next cue off
  return Math.min(MAX_VOICE_LEAD_MS, (currentLeadMs + measuredDelayMs) / 2)
}

/** The line spoken when the student stops the session. */
export function buildSessionEndCue(cyclesCompleted: number | null | undefined): string {
  if (!cyclesCompleted || cyclesCompleted < 1) return 'Session ended.'
  return `Well done. You completed ${cyclesCompleted} ${cyclesCompleted === 1 ? 'cycle' : 'cycles'}.`
}

/**
 * Picks the most natural-sounding English voice the browser offers (null = use the browser default).
 * @param voices From speechSynthesis.getVoices(); may be empty while voices load.
 */
export function pickCalmVoice<V extends { name?: string; lang?: string }>(voices: readonly V[] | null | undefined): V | null {
  if (!Array.isArray(voices)) return null
  const english = voices.filter((v) => typeof v?.lang === 'string' && v.lang.toLowerCase().startsWith('en'))
  return english.find((v) => /natural|google|microsoft/i.test(v.name || '')) || english[0] || null
}
