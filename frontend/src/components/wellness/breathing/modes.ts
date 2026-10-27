/* The two MindAlign breathing patterns. `voice` is the cue read aloud as the phase starts: a word or two, so it is
   over long before the next phase. `color` tints the bubble for the phase (rose in, violet hold, indigo out, teal rest). */

export interface BreathStep {
  action: 'Inhale' | 'Hold' | 'Exhale'
  /** Seconds. */
  duration: number
  /** Bubble size while in this phase (the bubble grows/shrinks to it over the whole phase). */
  scale: number
  color: string
  voice: string
}

export interface BreathMode {
  name: string
  short: string
  aria: string
  description: string
  sequence: readonly BreathStep[]
}

export type BreathModeKey = 'BOX' | 'CALM'

const INHALE = '#f43f5e'
const HOLD_FULL = '#8b5cf6'
const EXHALE = '#6366f1'
const HOLD_EMPTY = '#0d9488'

export const BREATH_MODES: Record<BreathModeKey, BreathMode> = {
  BOX: {
    name: 'Box Breathing (4-4-4-4)',
    short: 'Box (4-4-4-4)',
    aria: 'Box breathing mode, four-four-four-four pattern',
    description: 'Used by high-performers & Navy SEALs to relieve acute stress and restore focus.',
    sequence: [
      { action: 'Inhale', duration: 4, scale: 1.2, color: INHALE, voice: 'Breathe in' },
      { action: 'Hold', duration: 4, scale: 1.2, color: HOLD_FULL, voice: 'Hold' },
      { action: 'Exhale', duration: 4, scale: 0.85, color: EXHALE, voice: 'Breathe out' },
      { action: 'Hold', duration: 4, scale: 0.85, color: HOLD_EMPTY, voice: 'Hold' },
    ],
  },
  CALM: {
    name: 'Relaxation Breathing (4-7-8)',
    short: 'Relax (4-7-8)',
    aria: 'Relaxation breathing mode, four-seven-eight pattern',
    description: 'A classic pranayama technique that acts as a natural nervous system tranquilizer.',
    sequence: [
      { action: 'Inhale', duration: 4, scale: 1.2, color: INHALE, voice: 'Breathe in' },
      { action: 'Hold', duration: 7, scale: 1.2, color: HOLD_FULL, voice: 'Hold' },
      { action: 'Exhale', duration: 8, scale: 0.85, color: EXHALE, voice: 'Breathe out slowly' },
    ],
  },
}

export const BREATH_MODE_KEYS: readonly BreathModeKey[] = ['BOX', 'CALM']
