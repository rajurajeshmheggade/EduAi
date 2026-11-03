import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exam, type ExamView, type FlagRule, type StatusInfo } from '@/lib/proctor/examApi'
import { ProctorMedia } from '@/lib/proctor/media'
import { expectAllOff, installMediaEnv, type MediaEnv, trackIntervals, trackListeners } from '@/test/fakeMedia'
import { Runner } from './Runner'

/**
 * The admission exam: at the end (submitted, time up, ended by the teacher / supervisor) the camera, microphone and
 * entire-screen share are switched off at once — not after the answers left on the device are synced — and the
 * hand-back screen comes up with no proctoring left running.
 */
vi.mock('@/lib/proctor/examApi', async (orig) => {
  const real = await orig<typeof import('@/lib/proctor/examApi')>()
  let seq = 0
  return {
    ...real,
    exam: {
      events: vi.fn(), heartbeat: vi.fn(), evidence: vi.fn(async () => ({ stored: true })), submit: vi.fn(), status: vi.fn(), answer: vi.fn(),
      release: vi.fn(), supervisorEnd: vi.fn(),
    },
    examStore: { ...real.examStore, get: () => ({ sessionId: 'x1', token: 'tok', device: 'dev' }), nextSeq: () => ++seq },
  }
})
const api = vi.mocked(exam)

const rule = (over: Partial<FlagRule> = {}): FlagRule => ({ enabled: true, label: 'Copy or paste', severity: 'Low', warn: 'never', pause: false, evidence: null, duration_ms: 0, ...over })
const STATUS: StatusInfo = { status: 'IN_PROGRESS', submit_reason: null, warnings_count: 0, max_warnings: 3, deadline_at: null, server_time: new Date().toISOString(), ended: false, locked: false }
const ENDED = (reason: StatusInfo['submit_reason']): StatusInfo => ({ ...STATUS, status: reason === 'ENDED_BY_TEACHER' ? 'ENDED' : 'SUBMITTED', submit_reason: reason, ended: true })

function view(secondsLeft = 1800): ExamView {
  return {
    ...STATUS, deadline_at: new Date(Date.now() + secondsLeft * 1000).toISOString(),
    session_id: 'x1', candidate: { full_name: 'Asha Rao', first_name: 'Asha' },
    test: { title: 'Admission test', grade_applying: '6', instructions: null, duration_minutes: 30, extra_time_minutes: 0, sections: [{ key: 'A', title: 'Aptitude', kind: 'mcq', count: 1 }] },
    rules: { preset: 'standard', max_warnings: 3, calibration_seconds: 0, require_camera: true, require_screen_share: true, face_fps: 2, object_fps: 0.5,
      face_match_interval_s: 30, face_match_threshold: 0.6, voice_db: 18, presence_snapshot_s: 60, flags: { COPY_PASTE: rule({ warn: 'always' }) } },
    consent_notice: { version: '1', captured: [], not_captured: [], who_sees: '', retention: '', deletion: '', alternative: '' },
    steps: { confirmed: true, consent: true, system_check: true, id_photo: true, started: true }, started_at: new Date().toISOString(),
    questions: [{ question_id: 'q1', number: 1, section: 'A', qtype: 'MCQ', prompt: '2 + 2 = ?', options: [{ id: 1, text: '3' }, { id: 2, text: '4' }], marks: 1 }],
    answers: {},
  }
}

const SENSORS = ['visibilitychange', 'fullscreenchange', 'copy', 'cut', 'paste', 'contextmenu', 'keydown', 'beforeinput', 'beforeprint', 'offline', 'online', 'pagehide', 'popstate']

let env: MediaEnv
let intervals: ReturnType<typeof trackIntervals>
let listeners: ReturnType<typeof trackListeners>

beforeEach(() => {
  env = installMediaEnv()
  listeners = trackListeners([document, window])
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  api.events.mockImplementation(async (events) => ({ ...STATUS, accepted: events.map((e) => e.seq) }))
  api.heartbeat.mockResolvedValue({ ...STATUS, server_flags: [] })
  api.answer.mockResolvedValue({ saved_at: '' })
})
afterEach(() => {
  listeners.restore()
  intervals.restore()
  env.restore()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

/** What ExamView does: the runner while the test runs, the hand-back screen once it ended. */
function Exam({ v, media }: { v: ExamView; media: ProctorMedia }) {
  const [ended, setEnded] = useState<string | null | undefined>(undefined)
  return ended !== undefined ? <p>HAND BACK {ended}</p> : <Runner view={v} media={media} reference={null} baseline={{ yaw: 0, pitch: 0 }} onEnded={setEnded} />
}

/** Camera, microphone, entire screen and the models, as after the system check; full screen; then the test runs. */
async function startExam(v = view()) {
  const media = new ProctorMedia()
  await media.startCamera()
  await media.startMic()
  await media.startScreen()
  await media.loadModels({ embed: true, objects: true })
  env.enterFullscreen()
  intervals = trackIntervals()
  render(<Exam v={v} media={media} />)
  expect(await screen.findByTestId('exam-runner')).toBeInTheDocument()
  expect(env.live()).toHaveLength(3)
  expect(intervals.open).toBeGreaterThan(0)
  return media
}

/** (after React has run the effect clean-ups of what just unmounted) */
async function expectEverythingOff(reason: string) {
  await act(async () => {})
  expect(screen.getByText(`HAND BACK ${reason}`)).toBeInTheDocument()
  expectAllOff(env)
  expect(env.tracks.map((t) => t.label)).toEqual(['Integrated Camera', 'Built-in Mic', 'screen:0'])
  expect(intervals.where).toEqual([])
  expect(listeners.active(SENSORS)).toEqual([])
  expect(document.fullscreenElement).toBeNull()
  expect(screen.queryByTestId('exam-runner')).toBeNull()
}

describe('Admission exam: everything is switched off when the test ends', () => {
  it('the candidate submits', async () => {
    api.submit.mockResolvedValue(ENDED('MANUAL'))
    await startExam()
    fireEvent.click(screen.getByLabelText(/4/))
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Submit now' }))
    expect(await screen.findByText('HAND BACK MANUAL')).toBeInTheDocument()
    expect(api.answer).toHaveBeenCalledWith('q1', { option: 2 }, expect.any(Number))
    await expectEverythingOff('MANUAL')
  })

  it('the server ends it (teacher / auto-submit): devices off before the answers left on the device are synced', async () => {
    await startExam()
    let sync!: () => void
    api.answer.mockImplementation(() => new Promise((r) => { sync = () => r({ saved_at: '' }) }))
    fireEvent.click(screen.getByLabelText(/4/))                       // an answer still on its way when the test ends
    await waitFor(() => expect(api.answer).toHaveBeenCalled(), { timeout: 2000 })
    api.events.mockResolvedValue({ ...ENDED('ENDED_BY_TEACHER'), accepted: [] })
    act(() => { document.dispatchEvent(new Event('copy')) })         // the reply to the next flag says it is over
    await waitFor(() => expect(env.live()).toEqual([]))
    expect(screen.queryByText(/HAND BACK/)).toBeNull()                 // still syncing the answer — the camera is already off
    await act(async () => { sync() })
    expect(await screen.findByText('HAND BACK ENDED_BY_TEACHER')).toBeInTheDocument()
    await expectEverythingOff('ENDED_BY_TEACHER')
  })

  it('the supervisor ends it on the device', async () => {
    api.supervisorEnd.mockResolvedValue(ENDED('ENDED_BY_TEACHER'))
    await startExam()
    fireEvent.click(screen.getByRole('button', { name: /Supervisor/ }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'teacher@demo.edu' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'End test' }))
    expect(await screen.findByText('HAND BACK ENDED_BY_TEACHER')).toBeInTheDocument()
    await expectEverythingOff('ENDED_BY_TEACHER')
  })

  it('time runs out', async () => {
    api.status.mockResolvedValue(ENDED('TIME_UP'))
    await startExam(view(1))
    expect(await screen.findByText('HAND BACK TIME_UP', undefined, { timeout: 4000 })).toBeInTheDocument()
    await expectEverythingOff('TIME_UP')
  })
})
