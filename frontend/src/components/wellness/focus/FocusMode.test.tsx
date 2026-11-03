import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FocusTimerProvider } from '@/components/study/FocusTimerContext'
import { StudyFlowLayer } from '@/components/study/StudyFlowProvider'
import { StudyCycleProvider } from '@/components/study/StudyCycleContext'
import { makeWellnessCtx } from '@/components/wellness/breathing/testUtils'
import { wellnessService } from '@/services/wellnessService'
import { stubAudioContext } from '@/test/webAudio'
import type { XpResult } from '@/types/wellness'
import { FocusMode } from './FocusMode'

vi.mock('@/services/wellnessService', () => ({ wellnessService: { activity: vi.fn() } }))
const XP: XpResult = { awarded: 50, leveledUp: false, capped: false, xp: 50, level: 1, levelTitle: 'Mindful Rookie', xpToNext: 100, totalXp: 50 }

/** The Wellness dashboard inside a student session (the floating Focus Timer is mounted app-wide). */
function setup(scope: string | null = 'O.S1') {
  const { ctx, wrapper: Wellness } = makeWellnessCtx()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/student/wellness']}>
      <FocusTimerProvider scope={scope}>
        <StudyCycleProvider scope={scope}>
          <Wellness>{children}</Wellness>
          {scope && <StudyFlowLayer />}
        </StudyCycleProvider>
      </FocusTimerProvider>
    </MemoryRouter>
  )
  return { ctx, wrapper }
}

describe('FocusMode', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-27T09:00:00Z'))
    vi.mocked(wellnessService.activity).mockResolvedValue(XP)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('counts the days to the next test', () => {
    const { wrapper } = setup()
    render(<FocusMode countdown={{ label: 'Physics · Unit Test 2', date: '2026-11-06', source: 'school' }} />, { wrapper })
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('Days until Physics · Unit Test 2')).toBeInTheDocument()
    expect(screen.getByText('Assigned by your teacher in EduAI.')).toBeInTheDocument()
  })

  it('shows a dash without a test date', () => {
    const { wrapper } = setup()
    render(<FocusMode countdown={null} />, { wrapper })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('No test date yet')).toBeInTheDocument()
  })

  it('drives the student’s one focus timer: start, pause, and the XP of a finished session lands in the Wellness XP bar', async () => {
    const { ctx, wrapper } = setup()
    render(<FocusMode countdown={null} />, { wrapper })
    const card = screen.getAllByRole('timer')[0]
    expect(card).toHaveTextContent('25:00')

    fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(card).toHaveTextContent('24:00')
    // the same timer shows on the floating button
    expect(screen.getByRole('button', { name: /^Focus timer running, 24 minutes left/ })).toHaveTextContent('24:00')

    fireEvent.click(screen.getByRole('button', { name: 'Pause focus timer' }))
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(card).toHaveTextContent('24:00')

    fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }))
    act(() => { vi.advanceTimersByTime(24 * 60_000 + 500) })
    await act(async () => {})
    expect(wellnessService.activity).toHaveBeenCalledWith('pomodoro', 'Focus timer · 25 min')
    expect(ctx.applyXp).toHaveBeenCalledWith(XP, 'Focus Session Complete')
  })

  it('“Timer & sounds” opens the floating timer’s popup', () => {
    stubAudioContext()
    const { wrapper } = setup()
    render(<FocusMode countdown={null} />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: /Timer & sounds/ }))
    expect(screen.getByRole('dialog', { name: 'Focus timer' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Focus sound' })).toBeInTheDocument()
  })

  it('without a student session only the countdown shows', () => {
    const { wrapper } = setup(null)
    render(<FocusMode countdown={null} />, { wrapper })
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.getByText('No test date yet')).toBeInTheDocument()
  })
})
