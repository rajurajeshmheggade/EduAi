/**
 * Mouth shapes for the AI avatar tutor, driven by wawa-lipsync's viseme (Oculus set: viseme_sil, viseme_PP, … viseme_U).
 * A shape is a few numbers that are blended frame by frame, then turned into SVG paths — so the mouth glides between
 * shapes instead of snapping.
 */
export interface MouthShape {
  open: number    // 0 closed … 1 jaw fully open
  wide: number    // 0 narrow … 1 stretched (smile / "ee")
  round: number   // 0 relaxed … 1 pursed ("oo")
  teeth: number   // upper-teeth visibility 0 … 1
  tongue: number  // tongue visibility 0 … 1
}

export const REST: MouthShape = { open: 0, wide: 0.42, round: 0, teeth: 0, tongue: 0 }

const S = (open: number, wide: number, round: number, teeth: number, tongue: number): MouthShape => ({ open, wide, round, teeth, tongue })

export const VISEME_SHAPES: Record<string, MouthShape> = {
  viseme_sil: REST,
  viseme_PP: S(0, 0.36, 0.1, 0, 0),         // p b m — lips pressed
  viseme_FF: S(0.14, 0.55, 0, 1, 0),        // f v — upper teeth on the lip
  viseme_TH: S(0.26, 0.5, 0, 0.8, 1),       // th — tongue between the teeth
  viseme_DD: S(0.3, 0.55, 0, 0.7, 0.6),     // t d
  viseme_kk: S(0.36, 0.5, 0, 0.5, 0.3),     // k g
  viseme_CH: S(0.3, 0.3, 0.5, 0.8, 0),      // ch j sh
  viseme_SS: S(0.14, 0.72, 0, 1, 0),        // s z
  viseme_nn: S(0.25, 0.55, 0, 0.4, 0.8),    // n l
  viseme_RR: S(0.3, 0.35, 0.45, 0.3, 0),    // r
  viseme_aa: S(1, 0.6, 0.1, 0.35, 0.3),     // a
  viseme_E: S(0.6, 0.85, 0, 0.6, 0.2),      // e
  viseme_I: S(0.4, 0.95, 0, 0.8, 0),        // i
  viseme_O: S(0.75, 0.25, 0.9, 0.1, 0),     // o
  viseme_U: S(0.4, 0.15, 1, 0, 0),          // u
}

export function shapeFor(viseme: string | null | undefined): MouthShape {
  return (viseme && VISEME_SHAPES[viseme]) || REST
}

/** Moves `cur` a fraction `k` of the way to `target` (in place). */
export function blendInto(cur: MouthShape, target: MouthShape, k: number): MouthShape {
  cur.open += (target.open - cur.open) * k
  cur.wide += (target.wide - cur.wide) * k
  cur.round += (target.round - cur.round) * k
  cur.teeth += (target.teeth - cur.teeth) * k
  cur.tongue += (target.tongue - cur.tongue) * k
  return cur
}

/** Loudness from wawa-lipsync (mean band energy, ~0.2 is its silence floor) -> 0..1 jaw gain. */
export function jawGain(volume: number): number {
  return Math.min(1, Math.max(0.35, (volume - 0.08) / 0.3))
}

export interface MouthGeometry {
  path: string          // outer lip line, also the clip for teeth / tongue
  top: number           // y of the upper inner edge
  bottom: number        // y of the lower inner edge
  halfWidth: number
}

/** SVG geometry of the mouth centred on (cx, cy). */
export function mouthGeometry(s: MouthShape, cx: number, cy: number, gain = 1): MouthGeometry {
  const w = 8.5 + s.wide * 6.5 - s.round * 4
  const h = 0.8 + s.open * gain * 11
  const top = cy - h * (0.32 + s.round * 0.15)
  const bottom = cy + h * (0.68 + s.round * 0.12)
  const c = (n: number) => n.toFixed(2)
  const path = `M${c(cx - w)},${c(cy)} C${c(cx - w * 0.55)},${c(top - 0.6)} ${c(cx + w * 0.55)},${c(top - 0.6)} ${c(cx + w)},${c(cy)} `
    + `C${c(cx + w * 0.6)},${c(bottom)} ${c(cx - w * 0.6)},${c(bottom)} ${c(cx - w)},${c(cy)}Z`
  return { path, top, bottom, halfWidth: w }
}
