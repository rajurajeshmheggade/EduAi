import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assessmentService } from '@/services/assessmentService'
import { proctoringService, type StudentSession } from '@/services/proctoringService'
import { expectAllOff, installMediaEnv, type MediaEnv, trackIntervals, trackListeners } from '@/test/fakeMedia'
import { clientRules, proctorConfig } from '@/test/proctoring'
import type { StudentAssessment } from '@/types'
import TestRunner from './TestRunner'

/** A proctored online test, end to end in the page: when it is handed in — by the student or at time-up — the camera,
 * microphone, detector, timers, listeners, full screen and the proctoring HUD are all gone. */
vi.mock('@/services/assessmentService', async (orig) => {
  const real = await orig<typeof import('@/services/assessmentService')>()
  return { ...real, assessmentService: { ...real.assessmentService, get: vi.fn(), autosave: vi.fn(), submit: vi.fn() } }
})
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
const tests = vi.mocked(assessmentService)
const svc = vi.mocked(proctoringService)

const RULES = { mic_required: true, fullscreen_required: true }
const SESSION: StudentSession = {
  session_id: 's1', module: 'ONLINE_TEST', ref_id: 't1', title: 'Physics Quiz', status: 'INTERRUPTED', started_at: 'earlier', resumed: true,
  rules_version: '2026-11-v1', client_rules: clientRules(RULES), last_seq: 3, end_reason: null,
}
const ATTEMPT = (secondsLeft: number): StudentAssessment => ({
  eval_test_id: 't1', assessment_type: 'ONLINE_TEST', test_title: 'Physics Quiz', subject_code: 'PHY101',
  subject_name: 'Physics', class_name: 'Grade 10 A', evaluation_scope: 'SUBJECT_LEVEL', chapter_title: null,
  instructions: null, duration_minutes: 30, available_from: null, due_at: null, allow_late: false,
  results_release: 'INSTANT', total_max_marks: 1, total_questions: 1, question_paper_url: null,
  window: { open: true },
  my: { status: 'IN_PROGRESS', started_at: '2026-01-01T00:00:00Z', deadline: null, seconds_left: secondsLeft,
    submitted_at: null, is_late: false, file_name: null, file_url: null, submitted_by_teacher: false, error: null,
    progress_percentage: 0, progress_flagged: false },
  result_available: false, result_pending_publish: false, score: null,
  questions: [{ sl_no: '1', question_type: 'MCQ', question_text: 'SI unit of force?', mcq_options: ['(a) Joule', '(b) Newton'], max_marks: 1 }],
  answers: {}, flagged: [],
})
const SENSORS = ['visibilitychange', 'fullscreenchange', 'copy', 'cut', 'paste', 'offline', 'online', 'pagehide', 'devicechange', 'keydown', 'beforeunload']

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
  svc.start.mockResolvedValue({ ...SESSION, status: 'ACTIVE' })
  svc.heartbeat.mockResolvedValue({ status: 'ACTIVE', ended: false, end_reason: null, server_time: '', warnings: [] })
  tests.submit.mockResolvedValue(ATTEMPT(0))
})
afterEach(() => {
  listeners.restore()
  intervals.restore()
  env.restore()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

/** Open the test, go through the preparation window (rules, camera, microphone, face) and resume the attempt. */
async function takeTest(secondsLeft: number) {
  tests.get.mockResolvedValue(ATTEMPT(secondsLeft))
  render(
    <MemoryRouter initialEntries={['/student/tests/t1/take']}>
      <Routes>
        <Route path="/student/tests/:id/take" element={<TestRunner />} />
        <Route path="/student/tests/:id" element={<p>DETAILS PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByLabelText(/I have read and understood/))
  fireEvent.click(screen.getByRole('button', { name: /Continue to device check/ }))
  const window_ = screen.getByTestId('pre-exam-window')
  await waitFor(() => expect(within(window_).getByRole('button', { name: /Resume test/ })).toBeEnabled(), { timeout: 5000 })
  fireEvent.click(within(window_).getByRole('button', { name: /Resume test/ }))
  expect(await screen.findByText('SI unit of force?')).toBeInTheDocument()
  expect(screen.getByLabelText('Proctoring status')).toBeInTheDocument()
  expect(env.live()).toHaveLength(2)
}

/** (after React has run the effect clean-ups of what just unmounted) */
async function expectEverythingOff() {
  await act(async () => {})
  expect(screen.getByText('DETAILS PAGE')).toBeInTheDocument()
  expectAllOff(env)
  expect(env.workers).toHaveLength(1)
  expect(env.audioContexts).toHaveLength(1)
  expect(intervals.where).toEqual([])
  expect(listeners.active(SENSORS)).toEqual([])
  expect(document.fullscreenElement).toBeNull()
  expect(screen.queryByLabelText('Proctoring status')).toBeNull()
  expect(svc.finish.mock.calls).toEqual([['s1', 'submitted']])         // handed in, never "left"
}

describe('Proctored online test: everything is switched off when the test ends', () => {
  it('the student submits', async () => {
    await takeTest(1800)
    fireEvent.click(screen.getByLabelText('(b) Newton'))
    fireEvent.click(screen.getByRole('button', { name: /^Submit$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Submit test/ }))
    expect(await screen.findByText('DETAILS PAGE')).toBeInTheDocument()
    expect(tests.submit).toHaveBeenCalledWith('t1', { '1': 'b' }, [])
    await waitFor(() => expect(svc.finish).toHaveBeenCalled())
    await expectEverythingOff()
  })

  it('time runs out (auto-submit)', async () => {
    await takeTest(1)
    expect(await screen.findByText('DETAILS PAGE', undefined, { timeout: 4000 })).toBeInTheDocument()
    expect(tests.submit).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(svc.finish).toHaveBeenCalled())
    await expectEverythingOff()
  })
})
