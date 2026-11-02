import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '@/components/ui/toast'
import { assessmentService } from '@/services/assessmentService'
import type { StudentAssessment } from '@/types'
import TestRunner from './TestRunner'

vi.mock('@/services/assessmentService', async (orig) => {
  const real = await orig<typeof import('@/services/assessmentService')>()
  return { ...real, assessmentService: { ...real.assessmentService, get: vi.fn(), autosave: vi.fn(), submit: vi.fn() } }
})
const svc = vi.mocked(assessmentService)

const BASE: StudentAssessment = {
  eval_test_id: 't1', assessment_type: 'ONLINE_TEST', test_title: 'Physics Quiz', subject_code: 'PHY101',
  subject_name: 'Physics', class_name: 'Grade 10 A', evaluation_scope: 'SUBJECT_LEVEL', chapter_title: null,
  instructions: null, duration_minutes: 30, available_from: null, due_at: null, allow_late: false,
  results_release: 'INSTANT', total_max_marks: 1, total_questions: 1, question_paper_url: null,
  window: { open: true },
  my: { status: 'IN_PROGRESS', started_at: '2026-01-01T00:00:00Z', deadline: null, seconds_left: 1800,
    submitted_at: null, is_late: false, file_name: null, file_url: null, submitted_by_teacher: false, error: null,
    progress_percentage: 0, progress_flagged: false },
  result_available: false, result_pending_publish: false, score: null,
  questions: [{ sl_no: '1', question_type: 'MCQ', question_text: 'SI unit of force?', mcq_options: ['(a) Joule', '(b) Newton'], max_marks: 1 }],
  answers: {}, flagged: [],
}

async function renderAndLoad() {
  render(<>
    <MemoryRouter initialEntries={['/student/tests/t1/take']}>
      <Routes>
        <Route path="/student/tests/:id/take" element={<TestRunner />} />
        <Route path="/student/tests/:id" element={<p>DETAILS PAGE</p>} />
      </Routes>
    </MemoryRouter>
    <Toaster />
  </>)
  // Real timers for the initial load (findBy* polls with a real setTimeout) — fake timers switch on afterwards,
  // only to control the autosave debounce deterministically.
  expect(await screen.findByText('SI unit of force?')).toBeInTheDocument()
}

describe('TestRunner — 80% progress toast (FR-TST-PROGRESS)', () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('shows a toast the moment the server reports the completion milestone was just reached', async () => {
    svc.get.mockResolvedValue(BASE)
    svc.autosave.mockResolvedValue({ saved: 1, seconds_left: 1800, progress_percentage: 100, milestone_reached: true })
    await renderAndLoad()

    vi.useFakeTimers()
    fireEvent.click(screen.getByLabelText('(b) Newton'))
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })  // AUTOSAVE_MS debounce

    expect(svc.autosave).toHaveBeenCalledWith('t1', { '1': 'b' }, [])
    expect(screen.getByText('You have completed 100% of this test.', { exact: false })).toBeInTheDocument()
  })

  it('does not toast when the server reports the milestone has not been reached', async () => {
    svc.get.mockResolvedValue(BASE)
    svc.autosave.mockResolvedValue({ saved: 1, seconds_left: 1800, progress_percentage: 50, milestone_reached: false })
    await renderAndLoad()

    vi.useFakeTimers()
    fireEvent.click(screen.getByLabelText('(b) Newton'))
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })

    expect(svc.autosave).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/completed \d+% of this test/)).not.toBeInTheDocument()
  })

  it('resuming an attempt that already crossed the threshold earlier does not re-show the toast', async () => {
    svc.get.mockResolvedValue({ ...BASE, my: { ...BASE.my, progress_percentage: 100, progress_flagged: true } })
    await renderAndLoad()
    expect(screen.queryByText(/completed \d+% of this test/)).not.toBeInTheDocument()
  })
})
