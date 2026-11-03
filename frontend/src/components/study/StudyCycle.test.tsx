import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetStudyActivity } from '@/lib/studyFlow/activity'
import { holdQuiet } from '@/lib/studyFlow/quiet'
import { readStored } from '@/lib/studyFlow/storage'
import type { CycleState } from '@/lib/studyFlow/studyCycle'
import { wellnessService } from '@/services/wellnessService'
import { advance, nav, person, renderStudyFlow, studyFor, useFakeClock } from '@/test/studyFlow'
import type { UserProfile } from '@/types'

let auth: { user: UserProfile | null } = { user: null }
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/services/wellnessService', () => ({ wellnessService: { activity: vi.fn() } }))

const KEY = 'eduai.studyCycle.O.S1'
const stored = () => readStored<CycleState>(KEY)
const where = () => screen.getByTestId('where').textContent
const breakDue = () => screen.queryByRole('alertdialog', { name: 'Time for a 5-minute break' })
const breakOver = () => screen.queryByRole('alertdialog', { name: /Break’s over/ })
const studiedMinutes = () => {
  fireEvent.click(screen.getByRole('button', { name: /focus timer/i, expanded: false }))
  const text = within(screen.getByRole('dialog', { name: 'Focus timer' })).getByText(/Study time towards your next break/).textContent
  fireEvent.click(screen.getByRole('button', { name: 'Close the focus timer' }))
  return Number(/(\d+) of 25 min/.exec(text ?? '')?.[1])
}

describe('study-break cycle (25 min study → 5 min break)', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStudyActivity()
    auth = { user: person('student') }
    useFakeClock()
    vi.mocked(wellnessService.activity).mockResolvedValue({ awarded: 0, leveledUp: false, capped: true, xp: 0, level: 1, levelTitle: '', xpToNext: 100, totalXp: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('counts active time on study pages only', () => {
    renderStudyFlow('/student/dashboard')
    studyFor(3)                                                    // dashboard: not a study page
    expect(studiedMinutes()).toBe(0)
    nav.to('/student/classroom/textbook')
    studyFor(4)
    nav.to('/library/read/b1')
    studyFor(3)
    expect(studiedMinutes()).toBe(7)
    expect(stored()).toMatchObject({ day: '2026-11-02', phase: 'studying' })
  })

  it('idle time and a hidden tab do not count', () => {
    renderStudyFlow('/student/homework')
    fireEvent.keyDown(window, { key: 'a' })
    advance(10 * 60_000)                                           // no input for 10 minutes: only the first 2 count
    expect(studiedMinutes()).toBe(2)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    studyFor(5)
    expect(studiedMinutes()).toBe(2)
  })

  it('after 25 active minutes: OK only → Game Zone break → after 5 minutes back to the AI Classroom', () => {
    renderStudyFlow('/student/classroom')
    studyFor(24)
    expect(breakDue()).not.toBeInTheDocument()
    studyFor(1)
    const due = breakDue()!
    expect(due).toBeInTheDocument()
    expect(within(due).getAllByRole('button').map((b) => b.textContent)).toEqual(['OK'])
    fireEvent(due, new Event('cancel', { cancelable: true }))      // Escape does not dismiss it
    expect(breakDue()).toBeInTheDocument()

    fireEvent.click(within(due).getByRole('button', { name: 'OK' }))
    expect(where()).toBe('/student/wellness?tab=games')
    expect(breakDue()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Break time, 5 minutes left/ })).toHaveTextContent('Break 05:00')
    advance(60_000)
    expect(screen.getByRole('button', { name: /^Break time, 4 minutes left/ })).toHaveTextContent('Break 04:00')
    expect(stored()?.phase).toBe('break')

    advance(4 * 60_000)
    expect(breakOver()).toBeInTheDocument()
    expect(where()).toBe('/student/wellness?tab=games')
    advance(10_000)                                                // the notice counts down, then takes the student back
    expect(where()).toBe('/student/classroom')
    expect(breakOver()).not.toBeInTheDocument()
    expect(stored()).toMatchObject({ phase: 'studying', activeMs: 0, cycles: 1 })

    studyFor(25)                                                   // and the cycle starts again
    expect(breakDue()).toBeInTheDocument()
  })

  it('“Back to the AI Classroom” goes at once', () => {
    renderStudyFlow('/student/virtual-labs')
    studyFor(25)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    advance(5 * 60_000)
    fireEvent.click(within(breakOver()!).getByRole('button', { name: /Back to the AI Classroom/ }))
    expect(where()).toBe('/student/classroom')
  })

  it('back on a study page before the break ends: no notice, no move', () => {
    renderStudyFlow('/student/classroom')
    studyFor(25)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    nav.to('/student/homework')
    advance(5 * 60_000 + 1000)
    expect(breakOver()).not.toBeInTheDocument()
    expect(where()).toBe('/student/homework')
    expect(screen.getByText(/Break’s over — welcome back/)).toBeInTheDocument()
    expect(stored()).toMatchObject({ phase: 'studying', cycles: 1 })
  })

  it('never interrupts an exam: the reminder waits until it ends', () => {
    renderStudyFlow('/student/virtual-labs/v1')
    let release = () => {}
    act(() => { release = holdQuiet('exam') })                     // a proctored lab attempt is running
    studyFor(26)
    expect(stored()?.phase).toBe('due')
    expect(breakDue()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /focus timer/i })).not.toBeInTheDocument()
    act(() => release())
    expect(breakDue()).toBeInTheDocument()

    // the online-test runner and the admission exam are exam routes
    nav.to('/student/tests/t1/take')
    expect(breakDue()).not.toBeInTheDocument()
    nav.to('/student/tests/t1')
    expect(breakDue()).toBeInTheDocument()
  })

  it('a classroom session may be interrupted for the break (it closes normally when the student leaves)', () => {
    renderStudyFlow('/student/classroom/textbook')
    let release = () => {}
    act(() => { release = holdQuiet('session') })
    studyFor(25)
    expect(breakDue()).toBeInTheDocument()
    act(() => release())
  })

  it('lets a running focus session finish before the break reminder', () => {
    renderStudyFlow('/student/classroom')
    fireEvent.click(screen.getByRole('button', { name: 'Open the focus timer' }))
    fireEvent.click(screen.getByRole('button', { name: '45 min' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close the focus timer' }))
    studyFor(30)
    expect(stored()?.phase).toBe('due')
    expect(breakDue()).not.toBeInTheDocument()
    studyFor(15)                                                   // the 45-minute focus session ends
    expect(breakDue()).toBeInTheDocument()
  })

  it('remembers today’s progress across a reload', () => {
    const first = renderStudyFlow('/student/library')
    studyFor(20)
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    first.unmount()
    renderStudyFlow('/student/library')
    studyFor(5)
    expect(breakDue()).toBeInTheDocument()
  })

  it('is for students only', () => {
    localStorage.setItem('eduai.studyCycle.O.T1', JSON.stringify({ day: '2026-11-02', phase: 'due', activeMs: 1_500_000, breakEndsAt: null, cycles: 0 }))
    auth = { user: person('teacher', 'T1') }
    renderStudyFlow('/student/classroom')
    studyFor(30)
    expect(breakDue()).not.toBeInTheDocument()
    expect(localStorage.getItem('eduai.studyCycle.O.T1')).toContain('"phase":"due"')   // untouched
    expect(screen.queryByRole('button', { name: /focus timer/i })).not.toBeInTheDocument()
  })
})
