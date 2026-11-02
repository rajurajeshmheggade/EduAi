import { describe, expect, it } from 'vitest'
import { deviceOptions, mediaErrorHelp, micLevel, pickDevice } from './devices'

const dev = (deviceId: string, kind: MediaDeviceKind, label = '') => ({ deviceId, kind, label })

describe('device picker', () => {
  it('lists one kind, skips Chromium aliases and duplicates, and names unlabelled devices', () => {
    const all = [dev('default', 'videoinput', 'Default'), dev('cam1', 'videoinput', 'Integrated Camera'), dev('mic1', 'audioinput', 'Mic'),
      dev('cam2', 'videoinput'), dev('cam1', 'videoinput', 'Integrated Camera'), dev('communications', 'audioinput', 'Comms')]
    expect(deviceOptions(all, 'videoinput')).toEqual([{ id: 'cam1', label: 'Integrated Camera' }, { id: 'cam2', label: 'Camera 2' }])
    expect(deviceOptions(all, 'audioinput')).toEqual([{ id: 'mic1', label: 'Mic' }])
  })

  it("keeps the student's choice while it is connected", () => {
    const opts = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
    expect(pickDevice(opts, 'b', 'a')).toEqual({ id: 'b', lost: false })
    expect(pickDevice(opts, null, 'b')).toEqual({ id: 'b', lost: false })
    expect(pickDevice(opts, null, null)).toEqual({ id: 'a', lost: false })
  })

  it('reports an unplugged choice instead of silently switching', () => {
    const opts = [{ id: 'a', label: 'A' }]
    expect(pickDevice(opts, 'usb-cam', 'usb-cam')).toEqual({ id: 'a', lost: true })
    expect(pickDevice(opts, 'usb-cam', 'a')).toEqual({ id: 'a', lost: true })
    expect(pickDevice([], 'usb-cam', null)).toEqual({ id: null, lost: true })
  })

  it('maps level in dB to a 0..1 meter', () => {
    expect(micLevel(null)).toBe(0)
    expect(micLevel(-120)).toBe(0)
    expect(micLevel(-60)).toBeCloseTo(0.5)
    expect(micLevel(0)).toBe(1)
  })
})

describe('permission help', () => {
  const err = (name: string) => Object.assign(new Error(name), { name })

  it('explains a blocked permission with browser and OS steps', () => {
    const h = mediaErrorHelp(err('NotAllowedError'), 'camera', true)
    expect(h.problem).toBe('denied')
    expect(h.title).toBe('Camera permission was blocked')
    expect(h.steps.join(' ')).toMatch(/address bar/)
  })

  it('tells missing, busy and unsupported devices apart', () => {
    expect(mediaErrorHelp(err('NotFoundError'), 'microphone', true).problem).toBe('not_found')
    expect(mediaErrorHelp(err('OverconstrainedError'), 'camera', true).problem).toBe('not_found')
    expect(mediaErrorHelp(err('NotReadableError'), 'camera', true).problem).toBe('in_use')
    expect(mediaErrorHelp(err('TypeError'), 'camera', true).problem).toBe('unsupported')
    expect(mediaErrorHelp(new Error('?'), 'camera', true).problem).toBe('unknown')
  })

  it('needs a secure page first', () => {
    expect(mediaErrorHelp(err('NotAllowedError'), 'camera', false).problem).toBe('insecure')
  })
})
