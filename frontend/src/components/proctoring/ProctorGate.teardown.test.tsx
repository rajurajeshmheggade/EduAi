import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { proctoringService, type StudentSession, type StudentStatus } from '@/services/proctoringService'
import { expectAllOff, installMediaEnv, type MediaEnv, trackIntervals, trackListeners } from '@/test/fakeMedia'
import { clientRules, proctorConfig } from '@/test/proctoring'
import { ProctorGate } from './ProctorGate'
import { useProctor } from './proctorContext'

/**
 * However a proctored session ends, EVERYTHING proctoring-related shuts down: every camera / microphone track (also
 * preview streams of the device check, a camera the student switched away from, and a stream whose permission prompt
 * was answered too late), the detection worker, the audio analyser, the monitor's timers / heartbeat / listeners, full
 * screen, and the HUD with its preview. Real gate, real preparation window, real ProctorMedia and monitor; fake devices.
 */
vi.mock('@/services/proctoringService', async (orig) => {
  const real = await orig<typeof import('@/services/proctoringService')>()
  return {
    ...real,
    proctoringService: {
      config: vi.fn(), prepare: vi.fn(), start: vi.fn(), events: vi.fn(), heartbeat: vi.fn(), finish: vi.fn(async () => ({})), ackWarning: vi.fn(),
      finishOnUnload: vi.fn(),
    },
  }
})
const svc = vi.mocked(proctoringService)

const RULES = { mic_required: true, fullscreen_required: true }
const SESSION: StudentSession = {
  session_id: 's1', module: 'ONLINE_TEST', ref_id: 't1', title: 'Quiz', status: 'PRECHECK', started_at: null, resumed: false, rules_version: '2026-11-v1',
  client_rules: clientRules(RULES), last_seq: 0, end_reason: null,
}
const ACTIVE: StudentStatus = { status: 'ACTIVE', ended: false, end_reason: null, server_time: '', warnings: [] }
const SENSORS = ['visibilitychange', 'fullscreenchange', 'copy', 'cut', 'paste', 'offline', 'online', 'pagehide', 'devicechange', 'keydown']

let env: MediaEnv
let intervals: ReturnType<typeof trackIntervals>
let listeners: ReturnType<typeof trackListeners>

beforeEach(() => {
  env = installMediaEnv()
  intervals = trackIntervals()
  listeners = trackListeners([document, window, navigator.mediaDevices])
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  svc.config.mockResolvedValue(proctorConfig(true, 'ONLINE_TEST', RULES))
  svc.prepare.mockResolvedValue(SESSION)
  svc.start.mockResolvedValue({ ...SESSION, status: 'ACTIVE', started_at: 'now' })
  svc.heartbeat.mockResolvedValue(ACTIVE)
  svc.events.mockImplementation(async (_s, events) => ({ ...ACTIVE, accepted: events.map((e) => e.seq) }))
})
afterEach(() => {
  listeners.restore()
  intervals.restore()
  env.restore()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function Exam() {
  const p = useProctor()
  return <div><p>EXAM CONTENT</p><button onClick={() => void p.finish('submitted')}>HAND IN</button></div>
}

function mount(strict = false) {
  const tree = <MemoryRouter><ProctorGate module="ONLINE_TEST" refId="t1" title="Quiz" autoOpen><Exam /></ProctorGate></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

async function toDeviceCheck() {
  fireEvent.click(await screen.findByLabelText(/I have read and understood/))
  fireEvent.click(screen.getByRole('button', { name: /Continue to device check/ }))
}

async function checksPass() {
  await waitFor(() => expect(document.querySelector('[data-check="face"]')).toHaveAttribute('data-status', 'pass'), { timeout: 5000 })
  await waitFor(() => expect(document.querySelector('[data-check="microphone"]')).toHaveAttribute('data-status', 'pass'))
}

/** Rules -> device check (camera, microphone, detector, face) -> Begin -> the exam runs under proctoring. */
async function begin() {
  await toDeviceCheck()
  await checksPass()
  fireEvent.click(screen.getByRole('button', { name: /Begin exam/ }))
  expect(await screen.findByText('EXAM CONTENT')).toBeInTheDocument()
  await act(async () => {})                                             // the closed window's effect clean-ups have run
  expect(screen.getByLabelText('Proctoring status')).toBeInTheDocument()
  expect(document.fullscreenElement).not.toBeNull()
  expect(env.live().map((t) => t.kind).sort()).toEqual(['audio', 'video'])
  expect(intervals.open).toBeGreaterThan(0)
  expect(listeners.active(SENSORS).length).toBeGreaterThan(0)
}

/** (after React has run the effect clean-ups of what just unmounted) */
async function expectEverythingOff() {
  await act(async () => {})
  expectAllOff(env)
  expect(env.workers).toHaveLength(1)
  expect(env.audioContexts).toHaveLength(1)
  expect(intervals.where).toEqual([])
  expect(listeners.active(SENSORS)).toEqual([])
  expect(document.fullscreenElement).toBeNull()
  expect(screen.queryByLabelText('Proctoring status')).toBeNull()
  expect(screen.queryByLabelText(/Your camera preview/)).toBeNull()
  expect(screen.queryByTestId('pre-exam-window')).toBeNull()
}

describe('ProctorGate switches everything off when the session ends', () => {
  it('handed in: devices off at once, the exam stays on screen without the HUD, flags sent before the session closes', async () => {
    mount()
    await begin()
    document.dispatchEvent(new Event('copy'))                         // a flag still queued when the exam is handed in
    fireEvent.click(screen.getByText('HAND IN'))
    expect(env.live()).toEqual([])                                     // synchronously, before any network round trip
    await waitFor(() => expect(svc.finish).toHaveBeenCalledWith('s1', 'submitted'))
    await expectEverythingOff()
    expect(screen.getByText('EXAM CONTENT')).toBeInTheDocument()
    expect(svc.events.mock.invocationCallOrder[0]).toBeLessThan(svc.finish.mock.invocationCallOrder[0])
    fireEvent.click(screen.getByText('HAND IN'))                       // twice: nothing stopped twice, closed once
    await expectEverythingOff()
    expect(svc.finish).toHaveBeenCalledTimes(1)
  })

  it('ended by the teacher', async () => {
    svc.heartbeat.mockResolvedValue({ ...ACTIVE, status: 'ENDED_BY_TEACHER', ended: true, end_reason: 'ENDED_BY_TEACHER' })
    mount()
    await toDeviceCheck()
    await checksPass()
    fireEvent.click(screen.getByRole('button', { name: /Begin exam/ }))
    expect(await screen.findByText('Your teacher ended this session')).toBeInTheDocument()
    await expectEverythingOff()
    expect(screen.queryByText('EXAM CONTENT')).toBeNull()
    expect(svc.finish).not.toHaveBeenCalled()
  })

  it('handed in or closed elsewhere (the next reply says the session is over)', async () => {
    mount()
    await begin()
    svc.events.mockResolvedValue({ ...ACTIVE, status: 'SUBMITTED', ended: true, end_reason: 'SUBMITTED', accepted: [] })
    act(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')) })   // a flag goes out
    expect(await screen.findByText('This session has ended')).toBeInTheDocument()
    await expectEverythingOff()
    expect(svc.finish).not.toHaveBeenCalled()
  })

  it('the student leaves the page mid-exam', async () => {
    const view = mount()
    await begin()
    view.unmount()
    expectAllOff(env)
    expect(intervals.where).toEqual([])
    expect(listeners.active(SENSORS)).toEqual([])
    expect(document.fullscreenElement).toBeNull()
    await waitFor(() => expect(svc.finish).toHaveBeenCalledWith('s1', 'left'))
  })

  it('the tab is closed (pagehide)', async () => {
    mount()
    await begin()
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expectAllOff(env)
    expect(intervals.where).toEqual([])
    expect(listeners.active(SENSORS)).toEqual([])
    expect(svc.finishOnUnload).toHaveBeenCalledWith('s1', 'left', expect.any(Array))   // with any flag not sent yet
  })

  it('a camera switched away from in the device check is stopped too — every stream exactly once', async () => {
    mount()
    await toDeviceCheck()
    await checksPass()
    fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'cam-b' } })
    await waitFor(() => expect(env.getUserMedia).toHaveBeenCalledTimes(3))
    expect(env.tracks[0].stop).toHaveBeenCalledTimes(1)               // the first camera went off when switching
    await checksPass()
    await waitFor(() => expect(screen.getByRole('button', { name: /Begin exam/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Begin exam/ }))
    fireEvent.click(await screen.findByText('HAND IN'))
    await waitFor(() => expect(svc.finish).toHaveBeenCalled())
    expect(env.tracks.map((t) => t.label)).toEqual(['Integrated Camera', 'Built-in Mic', 'USB Camera'])
    await expectEverythingOff()
  })

  it('leaving while the camera permission prompt is open: the late stream is stopped, nothing else is opened', async () => {
    const view = mount()
    const prompt = env.holdNext()
    await toDeviceCheck()
    await waitFor(() => expect(env.getUserMedia).toHaveBeenCalledTimes(1))
    view.unmount()
    await act(async () => { prompt.release() })
    await new Promise((r) => setTimeout(r, 50))
    expect(env.tracks).toHaveLength(1)
    expectAllOff(env)
    expect(env.getUserMedia).toHaveBeenCalledTimes(1)                  // the microphone was never asked for
    expect(env.workers).toEqual([])                                     // nor the detector loaded
    expect(intervals.where).toEqual([])
    expect(listeners.active(SENSORS)).toEqual([])
    await waitFor(() => expect(svc.finish).toHaveBeenCalledWith('s1', 'left'))
  })

  it('closing the preparation window while the microphone prompt is open: no microphone, no detector afterwards', async () => {
    mount()
    const prompt = env.holdNext('audio')
    await toDeviceCheck()
    await waitFor(() => expect(env.getUserMedia).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Close and go back' }))
    expect(env.live()).toEqual([])                                      // the camera preview went off with the window
    await act(async () => { prompt.release() })                         // the student answers the prompt too late
    await new Promise((r) => setTimeout(r, 100))
    expect(env.tracks.map((t) => t.kind)).toEqual(['video', 'audio'])
    expectAllOff(env)
    expect(env.workers).toEqual([])                                     // the device check did not go on
    expect(env.audioContexts).toEqual([])
    expect(intervals.where).toEqual([])
    expect(listeners.active(SENSORS)).toEqual([])
    expect(screen.queryByTestId('pre-exam-window')).toBeNull()
    expect(svc.finish).toHaveBeenCalledWith('s1', 'left')
  })

  it('the exam could not start (server error), then the student gives up', async () => {
    svc.start.mockRejectedValue(new Error('Mandatory checks have not passed'))
    const view = mount()
    await toDeviceCheck()
    await checksPass()
    fireEvent.click(screen.getByRole('button', { name: /Begin exam/ }))
    expect(await screen.findByText('Mandatory checks have not passed')).toBeInTheDocument()
    expect(document.fullscreenElement).toBeNull()
    view.unmount()
    expectAllOff(env)
    expect(intervals.where).toEqual([])
    expect(listeners.active(SENSORS)).toEqual([])
  })

  it('React StrictMode (double mount in development) leaves no orphaned stream', async () => {
    mount(true)
    await begin()
    expect(svc.prepare).toHaveBeenCalledTimes(1)
    expect(env.getUserMedia).toHaveBeenCalledTimes(2)                  // one camera, one microphone: nothing doubled
    fireEvent.click(screen.getByText('HAND IN'))
    await waitFor(() => expect(svc.finish).toHaveBeenCalledWith('s1', 'submitted'))
    await expectEverythingOff()
  })

  it('React StrictMode: leaving in the middle of the device check', async () => {
    const view = mount(true)
    await toDeviceCheck()
    await waitFor(() => expect(document.querySelector('[data-check="detector"]')).not.toHaveAttribute('data-status', 'pending'))
    view.unmount()
    await new Promise((r) => setTimeout(r, 400))
    expectAllOff(env)
    expect(env.workers.every((w) => w.terminate.mock.calls.length === 1)).toBe(true)
    expect(intervals.where).toEqual([])
    expect(listeners.active(SENSORS)).toEqual([])
  })
})
