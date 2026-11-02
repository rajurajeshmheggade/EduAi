import { describe, expect, it } from 'vitest'
import {
  cameraBlocked, ConfirmRule, ConsecutiveRule, devtoolsSuspected, euclidean, headPose, HoldRule, inCalibration, isBlockedShortcut, isVirtualCamera,
  lookingAway, luminance, median, Merger, PasteBurst, speechBandDb, windowTooSmall,
} from './rules'

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })

describe('HoldRule', () => {
  it('trigger mode fires once after the duration and never on a short blip', () => {
    const r = new HoldRule('MULTIPLE_FACES', 2000)
    expect(r.update(true, 0)).toBeNull()
    expect(r.update(true, 1500)).toBeNull()
    expect(r.update(false, 1600)).toBeNull()               // 1.6 s blip: nothing
    r.update(true, 2000)
    const ev = r.update(true, 4100)
    expect(ev).toMatchObject({ code: 'MULTIPLE_FACES', duration_ms: 2100 })
    expect(r.update(true, 9000)).toBeNull()                // once per episode
    r.update(false, 9100)
    r.update(true, 10_000)
    expect(r.update(true, 12_000)?.code).toBe('MULTIPLE_FACES')
  })

  it('end mode reports the full duration when the episode ends, and splits very long ones', () => {
    const r = new HoldRule('NO_FACE', 5000, 'end', 60_000)
    r.update(true, 0)
    expect(r.update(true, 30_000)).toBeNull()
    expect(r.update(false, 32_000)).toMatchObject({ code: 'NO_FACE', at: 0, duration_ms: 32_000 })
    r.update(true, 40_000)
    expect(r.update(false, 43_000)).toBeNull()             // under 5 s
    r.update(true, 50_000)
    expect(r.update(true, 110_000)).toMatchObject({ duration_ms: 60_000 })
  })
})

describe('confirmation, consecutive checks and merging', () => {
  it('2-of-3 samples confirm an object once per episode', () => {
    const r = new ConfirmRule('PHONE_DETECTED')
    expect(r.update(true, 0.7, 0)).toBeNull()
    expect(r.update(false, 0, 1)).toBeNull()
    expect(r.update(true, 0.8, 2)).toMatchObject({ code: 'PHONE_DETECTED', confidence: 0.8 })
    expect(r.update(true, 0.9, 3)).toBeNull()
    r.update(false, 0, 4); r.update(false, 0, 5); r.update(false, 0, 6)
    r.update(true, 0.6, 7)
    expect(r.update(true, 0.6, 8)?.code).toBe('PHONE_DETECTED')
  })

  it('face mismatch needs two consecutive failed checks', () => {
    const r = new ConsecutiveRule('FACE_MISMATCH', 2)
    expect(r.update(true, 0)).toBeNull()
    expect(r.update(false, 1)).toBeNull()
    expect(r.update(true, 2)).toBeNull()
    expect(r.update(true, 3)?.code).toBe('FACE_MISMATCH')
    expect(r.update(true, 4)).toBeNull()
  })

  it('same-type events within 2 s merge with summed duration', () => {
    const m = new Merger(2000)
    const a = m.push({ code: 'COPY_PASTE', at: 0, duration_ms: 1 })!
    expect(m.push({ code: 'COPY_PASTE', at: 1500, duration_ms: 2 })).toBeNull()
    expect(m.push({ code: 'COPY_PASTE', at: 3000, duration_ms: 3 })).toBeNull()      // window slides with each merge
    expect(a.duration_ms).toBe(6)
    expect(a.details?.merged).toBe(3)
    expect(m.push({ code: 'COPY_PASTE', at: 6000, duration_ms: 1 })).not.toBeNull()
    expect(m.push({ code: 'CONTEXT_MENU', at: 6100, duration_ms: 0 })).not.toBeNull()
  })

  it('calibration window', () => {
    expect(inCalibration(30_000, 0, 60)).toBe(true)
    expect(inCalibration(61_000, 0, 60)).toBe(false)
    expect(inCalibration(5, null, 60)).toBe(true)
  })
})

describe('keyboard and paste', () => {
  it('blocks the forbidden combinations only', () => {
    for (const k of ['c', 'v', 'x', 'a', 'p', 's', 'u', 'f']) expect(isBlockedShortcut(key(k, { ctrlKey: true }))).toBe(true)
    expect(isBlockedShortcut(key('V', { metaKey: true }))).toBe(true)
    expect(isBlockedShortcut(key('F12'))).toBe(true)
    expect(isBlockedShortcut(key('PrintScreen'))).toBe(true)
    expect(isBlockedShortcut(key('I', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isBlockedShortcut(key('a'))).toBe(false)
    expect(isBlockedShortcut(key('z', { ctrlKey: true }))).toBe(false)
    expect(isBlockedShortcut(key('Enter'))).toBe(false)
  })

  it('detects 40+ characters inserted with fewer than 3 key presses', () => {
    const p = new PasteBurst()
    p.keydown()
    expect(p.input(120)).toBe(true)
    for (let i = 0; i < 5; i++) p.keydown()
    expect(p.input(45)).toBe(false)                      // typed (e.g. autocorrect of a typed word)
    expect(p.input(1)).toBe(false)
  })
})

describe('vision and audio maths', () => {
  it('camera blocked from luminance', () => {
    const dark = new Uint8ClampedArray(64 * 4).fill(5)
    expect(cameraBlocked(luminance(dark))).toBe(true)
    const flat = new Uint8ClampedArray(64 * 4).fill(128)
    expect(cameraBlocked(luminance(flat))).toBe(true)     // no texture: covered
    const scene = new Uint8ClampedArray(Array.from({ length: 64 * 4 }, (_, i) => (i % 8 < 4 ? 40 : 200)))
    expect(cameraBlocked(luminance(scene))).toBe(false)
  })

  it('head pose from the transformation matrix and looking-away thresholds', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    expect(headPose(identity)).toEqual({ yaw: 0, pitch: 0, roll: 0 })
    const a = (40 * Math.PI) / 180   // yaw 40°: rotation about Y
    const yaw40 = [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]
    expect(Math.abs(headPose(yaw40).yaw)).toBeCloseTo(40, 0)
    expect(lookingAway({ yaw: 35, pitch: 0 })).toBe(true)
    expect(lookingAway({ yaw: 10, pitch: -30 })).toBe(true)
    expect(lookingAway({ yaw: 10, pitch: 22 })).toBe(true)
    expect(lookingAway({ yaw: 32, pitch: 0 }, { yaw: 10, pitch: 0 })).toBe(false)   // relative to the calibrated pose
  })

  it('distances, speech band, floor and helpers', () => {
    expect(euclidean([0, 0], [3, 4])).toBe(5)
    const quiet = new Array(1024).fill(-90)
    const speech = quiet.map((v, i) => (i * (48000 / 2048) > 300 && i * (48000 / 2048) < 3400 ? -40 : v))
    expect(speechBandDb(speech, 48000, 2048) - speechBandDb(quiet, 48000, 2048)).toBeGreaterThan(40)
    expect(median([3, 1, 2])).toBe(2)
    expect(isVirtualCamera('OBS Virtual Camera')).toBe(true)
    expect(isVirtualCamera('Integrated Webcam')).toBe(false)
    expect(devtoolsSuspected({ outerWidth: 1600, innerWidth: 1200, outerHeight: 900, innerHeight: 860 })).toBe(true)
    expect(windowTooSmall(1000, 1920)).toBe(true)
  })
})
