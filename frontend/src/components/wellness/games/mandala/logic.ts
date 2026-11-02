/* Sand Mandala: every stroke is repeated around the centre (and optionally mirrored), so any doodle becomes a
   symmetric pattern. There is no score to chase: the "score" is calm time, and XP comes after a short stay. */

export interface Pt { x: number; y: number }

export const CANVAS_SIZE = 600
export const SYMMETRIES = [4, 6, 8, 12] as const
export type Symmetry = (typeof SYMMETRIES)[number]
export const MIN_CALM_MS = 45_000
export const BRUSH_STEP = 12
export const FINE_STEP = 4

export const SAND_COLORS = [
  { id: 'terracotta', name: 'Terracotta', hex: '#c2410c' },
  { id: 'sage', name: 'Sage', hex: '#4d7c0f' },
  { id: 'sky', name: 'Sky', hex: '#0369a1' },
  { id: 'lavender', name: 'Lavender', hex: '#7c3aed' },
  { id: 'rose', name: 'Rose', hex: '#be123c' },
  { id: 'ink', name: 'Ink', hex: '#1e293b' },
] as const
export type SandColor = (typeof SAND_COLORS)[number]['id']

export function rotatePoint(p: Pt, c: Pt, angle: number): Pt {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/** Reflection across the vertical line through the centre. */
export const mirrorPoint = (p: Pt, c: Pt): Pt => ({ x: 2 * c.x - p.x, y: p.y })

/** The copies of one segment: `folds` rotations around the centre, doubled with mirror images when `mirror` is on. */
export function symmetricSegments(a: Pt, b: Pt, center: Pt, folds: number, mirror: boolean): [Pt, Pt][] {
  const out: [Pt, Pt][] = []
  for (let k = 0; k < folds; k++) {
    const angle = (2 * Math.PI * k) / folds
    out.push([rotatePoint(a, center, angle), rotatePoint(b, center, angle)])
    if (mirror) out.push([rotatePoint(mirrorPoint(a, center), center, angle), rotatePoint(mirrorPoint(b, center), center, angle)])
  }
  return out
}

/** Arrow-key brush movement, kept on the canvas. Returns null for other keys. */
export function moveBrush(p: Pt, key: string, fine: boolean, size = CANVAS_SIZE): Pt | null {
  const step = fine ? FINE_STEP : BRUSH_STEP
  const d = ({ ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] } as Record<string, [number, number]>)[key]
  if (!d) return null
  const clamp = (v: number) => Math.max(0, Math.min(size, v))
  return { x: clamp(p.x + d[0]), y: clamp(p.y + d[1]) }
}

/** Calm seconds — the only "score" in a game without a fail state. */
export const calmScore = (calmMs: number): number => Math.floor(Math.max(0, calmMs) / 1000)
