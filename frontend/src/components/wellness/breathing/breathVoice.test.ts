import { describe, expect, it } from 'vitest'
import {
  BREATH_VOICE_RATE,
  DEFAULT_VOICE_LEAD_MS,
  MAX_VOICE_LEAD_MS,
  buildSessionEndCue,
  getBreathPosition,
  getPhaseStartMs,
  nextVoiceLead,
  pickCalmVoice,
} from './breathVoice'
import { BREATH_MODES } from './modes'

const BOX = [{ duration: 4 }, { duration: 4 }, { duration: 4 }, { duration: 4 }]
const CALM = [{ duration: 4 }, { duration: 7 }, { duration: 8 }]

describe('getBreathPosition', () => {
  it('starts on the first phase with the full countdown', () => {
    expect(getBreathPosition(BOX, 0)).toEqual({ cycle: 0, stepIdx: 0, phase: 0, secondsRemaining: 4, nextPhaseAtMs: 4000 })
  })

  it('counts down within a phase and never shows zero', () => {
    expect(getBreathPosition(BOX, 1000).secondsRemaining).toBe(3)
    expect(getBreathPosition(BOX, 3001).secondsRemaining).toBe(1)
    expect(getBreathPosition(BOX, 3999).secondsRemaining).toBe(1)
  })

  it('switches phase exactly on the boundary', () => {
    expect(getBreathPosition(BOX, 3999).stepIdx).toBe(0)
    expect(getBreathPosition(BOX, 4000)).toEqual({ cycle: 0, stepIdx: 1, phase: 1, secondsRemaining: 4, nextPhaseAtMs: 8000 })
  })

  it('handles uneven phases (4-7-8)', () => {
    expect(getBreathPosition(CALM, 4000)).toMatchObject({ stepIdx: 1, secondsRemaining: 7, nextPhaseAtMs: 11000 })
    expect(getBreathPosition(CALM, 11000)).toMatchObject({ stepIdx: 2, secondsRemaining: 8, nextPhaseAtMs: 19000 })
    expect(getBreathPosition(CALM, 18500)).toMatchObject({ cycle: 0, stepIdx: 2, secondsRemaining: 1 })
  })

  it('wraps into the next cycle and keeps counting phases', () => {
    expect(getBreathPosition(BOX, 16000)).toEqual({ cycle: 1, stepIdx: 0, phase: 4, secondsRemaining: 4, nextPhaseAtMs: 20000 })
    expect(getBreathPosition(CALM, 19000 * 2 + 5000)).toMatchObject({ cycle: 2, stepIdx: 1, phase: 7, nextPhaseAtMs: 49000 })
  })

  it('stays in step over a long session (no drift)', () => {
    const tenMinutes = 600000 // 37 full box cycles + 8 seconds
    expect(getBreathPosition(BOX, tenMinutes)).toEqual({ cycle: 37, stepIdx: 2, phase: 150, secondsRemaining: 4, nextPhaseAtMs: 604000 })
  })

  it('treats the lead-in (negative time) as the very start', () => {
    expect(getBreathPosition(BOX, -500)).toMatchObject({ cycle: 0, stepIdx: 0, phase: 0 })
  })
})

describe('getPhaseStartMs', () => {
  it('gives the start time of each phase in the first cycle', () => {
    expect([0, 1, 2, 3].map((phase) => getPhaseStartMs(BOX, phase))).toEqual([0, 4000, 8000, 12000])
    expect([0, 1, 2].map((phase) => getPhaseStartMs(CALM, phase))).toEqual([0, 4000, 11000])
  })

  it('continues across cycles', () => {
    expect(getPhaseStartMs(BOX, 4)).toBe(16000)
    expect(getPhaseStartMs(CALM, 7)).toBe(19000 * 2 + 4000)
  })

  it('agrees with getBreathPosition at every phase boundary', () => {
    for (const sequence of [BOX, CALM]) {
      for (let phase = 0; phase < 12; phase++) {
        const startMs = getPhaseStartMs(sequence, phase)
        expect(getBreathPosition(sequence, startMs).phase).toBe(phase)
        if (phase > 0) expect(getBreathPosition(sequence, startMs - 1).phase).toBe(phase - 1)
        expect(getBreathPosition(sequence, startMs).nextPhaseAtMs).toBe(getPhaseStartMs(sequence, phase + 1))
      }
    }
  })
})

describe('nextVoiceLead', () => {
  it('moves halfway towards the measured start-up delay', () => {
    expect(nextVoiceLead(300, 500)).toBe(400)
    expect(nextVoiceLead(300, 100)).toBe(200)
  })

  it('never exceeds the maximum lead', () => {
    expect(nextVoiceLead(MAX_VOICE_LEAD_MS, 5000)).toBe(MAX_VOICE_LEAD_MS)
  })

  it('ignores missing or impossible measurements', () => {
    expect(nextVoiceLead(DEFAULT_VOICE_LEAD_MS, NaN)).toBe(DEFAULT_VOICE_LEAD_MS)
    expect(nextVoiceLead(DEFAULT_VOICE_LEAD_MS, -20)).toBe(DEFAULT_VOICE_LEAD_MS)
  })
})

describe('buildSessionEndCue', () => {
  it('reports the completed cycles with correct plurals', () => {
    expect(buildSessionEndCue(1)).toBe('Well done. You completed 1 cycle.')
    expect(buildSessionEndCue(3)).toBe('Well done. You completed 3 cycles.')
  })

  it('stays neutral when no cycle was completed', () => {
    expect(buildSessionEndCue(0)).toBe('Session ended.')
    expect(buildSessionEndCue(undefined)).toBe('Session ended.')
  })
})

describe('pickCalmVoice', () => {
  const voices = [
    { name: 'Hindi Default', lang: 'hi-IN' },
    { name: 'Plain English', lang: 'en-GB' },
    { name: 'Microsoft Aria Online (Natural)', lang: 'en-US' },
  ]

  it('prefers a natural English voice', () => {
    expect(pickCalmVoice(voices)?.name).toBe('Microsoft Aria Online (Natural)')
  })

  it('falls back to any English voice, then to the browser default', () => {
    expect(pickCalmVoice(voices.slice(0, 2))?.name).toBe('Plain English')
    expect(pickCalmVoice(voices.slice(0, 1))).toBeNull()
    expect(pickCalmVoice([])).toBeNull()
    expect(pickCalmVoice(undefined)).toBeNull()
  })
})

describe('BREATH_VOICE_RATE', () => {
  it('is slower than normal speech', () => {
    expect(BREATH_VOICE_RATE).toBeLessThan(1)
    expect(BREATH_VOICE_RATE).toBeGreaterThan(0.5)
  })
})

describe('BREATH_MODES', () => {
  it('keeps the MindAlign patterns: box 4-4-4-4 and relaxation 4-7-8', () => {
    expect(BREATH_MODES.BOX.sequence.map((s) => s.duration)).toEqual([4, 4, 4, 4])
    expect(BREATH_MODES.CALM.sequence.map((s) => s.duration)).toEqual([4, 7, 8])
  })

  it('gives every phase a short spoken cue', () => {
    for (const mode of Object.values(BREATH_MODES)) {
      for (const step of mode.sequence) expect(step.voice.split(' ').length).toBeLessThanOrEqual(3)
    }
  })
})
