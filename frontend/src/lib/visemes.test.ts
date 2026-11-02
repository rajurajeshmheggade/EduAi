import { describe, expect, it } from 'vitest'
import { blendInto, jawGain, mouthGeometry, REST, shapeFor, VISEME_SHAPES } from './visemes'

const OCULUS = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'].map((v) => `viseme_${v}`)

describe('viseme mouth shapes', () => {
  it('has a shape for every wawa-lipsync viseme and rests on unknown input', () => {
    for (const v of OCULUS) expect(VISEME_SHAPES[v]).toBeDefined()
    expect(shapeFor('viseme_unknown')).toBe(REST)
    expect(shapeFor(null)).toBe(REST)
  })

  it('opens wide for "aa", rounds for "oo" and closes for p / b / m', () => {
    const cy = 124
    const aa = mouthGeometry(shapeFor('viseme_aa'), 100, cy)
    const u = mouthGeometry(shapeFor('viseme_U'), 100, cy)
    const pp = mouthGeometry(shapeFor('viseme_PP'), 100, cy)
    expect(aa.bottom - aa.top).toBeGreaterThan(10)
    expect(u.halfWidth).toBeLessThan(aa.halfWidth)
    expect(pp.bottom - pp.top).toBeLessThan(1)
    expect(aa.path).toMatch(/^M[\d.]+,124\.00 C.+Z$/)
  })

  it('glides between shapes instead of snapping', () => {
    const cur = { ...REST }
    blendInto(cur, shapeFor('viseme_aa'), 0.5)
    expect(cur.open).toBeCloseTo(0.5)
    blendInto(cur, shapeFor('viseme_aa'), 0.5)
    expect(cur.open).toBeCloseTo(0.75)
  })

  it('scales the jaw with loudness within limits', () => {
    expect(jawGain(0)).toBe(0.35)
    expect(jawGain(0.25)).toBeGreaterThan(0.5)
    expect(jawGain(2)).toBe(1)
  })
})
