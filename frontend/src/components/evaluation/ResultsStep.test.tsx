import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/toast'
import { evaluationService } from '@/services/evaluationService'
import type { EvalDashboard, EvalTest, NearCompletionStudent, SubmissionProgress } from '@/types'
import { ResultsStep, SubmissionCard } from './ResultsStep'

vi.mock('@/services/evaluationService', async (orig) => {
  const real = await orig<typeof import('@/services/evaluationService')>()
  return { ...real, evaluationService: { ...real.evaluationService, dashboard: vi.fn(), register: vi.fn(), adminScores: vi.fn() } }
})
const svc = vi.mocked(evaluationService)

// Toasts auto-dismiss after a few seconds (see Toaster), so dedup is asserted against calls to `toast()` itself
// rather than against transient DOM text that would be gone again long before a 15 s poll interval repeats.
vi.mock('@/components/ui/toast', async (orig) => {
  const real = await orig<typeof import('@/components/ui/toast')>()
  return { ...real, toast: vi.fn(real.toast) }
})
const toastSpy = vi.mocked(toast)

const TEST = { eval_test_id: 't1', assessment_type: 'ONLINE_TEST', test_title: 'Unit Test 2',
  class_code: 'Grade-10-A', subject_code: 'PHY101', status: 'READY' } as unknown as EvalTest

const student = (user_code: string, full_name: string, pct: number): NearCompletionStudent =>
  ({ user_code, full_name, roll_number: null, progress_percentage: pct, flagged_at: '2026-01-01T00:00:00Z' })

const progress = (near: NearCompletionStudent[]): SubmissionProgress => ({
  enrolled: 4, submitted: 0, in_progress: near.length, not_submitted: 4 - near.length, late: 0, evaluating: 0,
  not_submitted_students: [], in_progress_students: near.map((s) => s.full_name),
  near_completion_students: near, progress_threshold: 80, due_at: null,
})

const dashboard = (near: NearCompletionStudent[]): EvalDashboard => ({
  test: TEST, submission: progress(near),
  overview: {
    class_students: 4, scripts_uploaded: 0, unmatched_scripts: 0, failed_scripts: 0, in_progress: near.length,
    total_students_evaluated: 0, total_max_marks: 10, class_average_marks: null, class_average_percentage: null,
    median_percentage: null, highest_marks: null, lowest_marks: null, pass_percentage: 40, passed: 0, pass_rate: null,
  },
  top_scoring_students: [], low_scoring_students: [], question_analytics: [], unanswered_by_all: [], most_skipped: [],
  score_distribution: [], grade_distribution: {},
} as unknown as EvalDashboard)

describe('SubmissionCard', () => {
  it('shows students who have crossed the completion threshold, with their name and %', () => {
    render(<SubmissionCard p={progress([student('REG1', 'Rohan Student', 83)])} />)
    expect(screen.getByText(/1 at 80%\+ completion/)).toBeInTheDocument()
    expect(screen.getByText(/Rohan Student \(83%\)/)).toBeInTheDocument()
  })

  it('shows nothing extra when no one has reached the threshold', () => {
    render(<SubmissionCard p={progress([])} />)
    expect(screen.queryByText(/completion:/)).not.toBeInTheDocument()
  })
})

// Fake timers are installed before render() so the component's own 15 s poll interval is fake from the moment
// it is created — switching timer modes mid-test would leave that interval running on the real clock instead.
describe('ResultsStep live progress sync (FR-TST-PROGRESS)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('polls while the test is live, and notifies the teacher only once per newly-flagged student', async () => {
    svc.register.mockResolvedValue({ rows: [] } as never)
    svc.dashboard
      .mockResolvedValueOnce(dashboard([student('REG1', 'Rohan Student', 80)]))
      .mockResolvedValueOnce(dashboard([student('REG1', 'Rohan Student', 95), student('REG2', 'Meera Student', 80)]))
      .mockResolvedValue(dashboard([student('REG1', 'Rohan Student', 95), student('REG2', 'Meera Student', 80)]))

    render(<ResultsStep test={TEST} onChanged={() => {}} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })  // flush the initial load's resolved promises

    expect(svc.dashboard).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/1 at 80%\+ completion/)).toBeInTheDocument()
    // The first load only seeds state: a student already near completion before the teacher opened the tab
    // must not trigger a notification.
    expect(toastSpy).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(svc.dashboard).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/2 at 80%\+ completion/)).toBeInTheDocument()
    // Only Meera is new; Rohan was already known from the first poll, so climbing from 80% to 95% must not re-notify.
    expect(toastSpy).toHaveBeenCalledTimes(1)
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('Meera Student has reached 80% completion'), 'info')

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(svc.dashboard).toHaveBeenCalledTimes(3)
    // Same two students again on the third poll: no new toast for either (duplicate prevention).
    expect(toastSpy).toHaveBeenCalledTimes(1)
  })

  it('does not poll for an offline exam or a read-only (admin) view', async () => {
    svc.adminScores.mockResolvedValue({ rows: [] } as never)
    render(<ResultsStep test={{ ...TEST, assessment_type: 'OFFLINE_EXAM' } as unknown as EvalTest} onChanged={() => {}} readOnly />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(svc.adminScores).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(svc.adminScores).toHaveBeenCalledTimes(1)
  })
})
