import { describe, expect, it } from 'vitest'
import { cameraBlocked } from '../rules'
import { beginState, canLeaveRules, type Checks, faceVerdict, initialChecks, requiredChecks, startChecks } from './gating'

const pass = (keys: (keyof Checks)[]): Checks => {
  const c = initialChecks()
  for (const k of keys) c[k] = { status: 'pass' }
  return c
}
const ONLINE = { camera_required: true, mic_required: true, fullscreen_required: true }
const LAB = { camera_required: true, mic_required: false, fullscreen_required: false }

describe('pre-exam gating', () => {
  it('the rules step needs the acknowledgement', () => {
    expect(canLeaveRules(false)).toBe(false)
    expect(canLeaveRules(true)).toBe(true)
  })

  it('requires camera, detector and face when the camera is mandatory, and the microphone only when required', () => {
    expect(requiredChecks(ONLINE)).toEqual(['camera', 'detector', 'face', 'microphone'])
    expect(requiredChecks(LAB)).toEqual(['camera', 'detector', 'face'])
    expect(requiredChecks({ camera_required: false, mic_required: false })).toEqual([])
  })

  it('cannot begin until the rules are acknowledged and every mandatory check passed', () => {
    const all = pass(['camera', 'detector', 'face', 'microphone'])
    expect(beginState(ONLINE, true, all, true)).toEqual({ ready: true, blocking: [] })
    expect(beginState(ONLINE, false, all, true).blocking.map((b) => b.key)).toEqual(['ack'])
    const noMic = pass(['camera', 'detector', 'face'])
    expect(beginState(ONLINE, true, noMic, true)).toMatchObject({ ready: false, blocking: [{ key: 'microphone' }] })
    expect(beginState(LAB, true, noMic, true).ready).toBe(true)              // labs do not need the microphone
    const failedFace = { ...all, face: { status: 'fail' as const } }
    expect(beginState(ONLINE, true, failedFace, true).blocking[0].message).toMatch(/failed/)
  })

  it('blocks a full-screen exam in a browser without full screen', () => {
    const all = pass(['camera', 'detector', 'face', 'microphone'])
    expect(beginState(ONLINE, true, all, false).blocking.map((b) => b.key)).toEqual(['fullscreen'])
    expect(beginState(LAB, true, all, false).ready).toBe(true)
  })

  it('reports the device results to the server as booleans', () => {
    expect(startChecks(pass(['camera', 'face']), true)).toEqual({ camera: true, face: true, microphone: false, fullscreen: true, lighting: true })
  })

  it('judges one face, enough light and nobody else in a frame', () => {
    const light = { mean: 110, std: 35 }
    expect(faceVerdict({ faces: 1, luma: light }, cameraBlocked).ok).toBe(true)
    expect(faceVerdict({ faces: 0, luma: light }, cameraBlocked).hint).toMatch(/cannot see your face/)
    expect(faceVerdict({ faces: 2, luma: light }, cameraBlocked).hint).toMatch(/Only you/)
    expect(faceVerdict({ faces: 1, luma: { mean: 8, std: 2 } }, cameraBlocked).hint).toMatch(/too dark/)
  })
})
