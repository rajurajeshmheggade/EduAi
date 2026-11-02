/* Keyboard helpers shared by the board games, plus their synthesised sounds. */
import type { KeyboardEvent } from 'react'
import type { Tone } from './useGameRun'

/** Columns in a CSS grid of items, read from the layout (items on the first row share its top edge). */
function columnsOf(items: HTMLElement[]): number {
  if (items.length < 2) return 1
  const top = items[0].offsetTop
  const n = items.findIndex((el) => el.offsetTop !== top)
  return n <= 0 ? items.length : n
}

/**
 * Arrow keys / Home / End move focus between the `[data-cell]` buttons of a grid board, following the grid's
 * current column count (so it works for the 3-column phone layout and the 4-column desktop one).
 */
export function moveGridFocus(e: KeyboardEvent<HTMLElement>): void {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-cell]'))
  const at = items.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  const cols = columnsOf(items)
  const target = {
    ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + cols, ArrowUp: at - cols, Home: 0, End: items.length - 1,
  }[e.key]
  if (target === undefined) return
  e.preventDefault()
  items[Math.max(0, Math.min(items.length - 1, target))]?.focus()
}

/** Typing in a text field or pressing a modifier combo should never trigger a game shortcut. */
export const isPlainKey = (e: KeyboardEvent | globalThis.KeyboardEvent) =>
  !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)

const tone = (type: OscillatorType, fromHz: number, seconds: number, gain: number, toHz?: number): Tone =>
  ({ type, fromHz, toHz, gain, endGain: 0.001, seconds })

export const TONES = {
  tap: tone('triangle', 520, 0.08, 0.06, 640),
  good: tone('sine', 660, 0.3, 0.1, 990),
  soft: tone('sine', 320, 0.25, 0.06, 230),
  done: tone('sine', 523.25, 0.9, 0.1, 1046.5),
  breatheIn: tone('sine', 262, 0.6, 0.05, 392),
  breatheOut: tone('sine', 392, 0.8, 0.05, 262),
}

/** A calm pentatonic scale (C D E G A, two octaves) — one note per lantern. */
export const PENTATONIC_HZ = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99] as const
export const noteTone = (hz: number): Tone => tone('sine', hz, 0.45, 0.09)
