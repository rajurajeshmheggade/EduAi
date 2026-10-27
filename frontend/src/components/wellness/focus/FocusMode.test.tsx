import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWellnessCtx } from '@/components/wellness/breathing/testUtils'
import { FocusMode } from './FocusMode'

describe('FocusMode', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-27T09:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('counts the days to the next test', () => {
    const { wrapper } = makeWellnessCtx()
    render(<FocusMode countdown={{ label: 'Physics · Unit Test 2', date: '2026-11-06', source: 'school' }} onSessionComplete={() => {}} />, { wrapper })
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('Days until Physics · Unit Test 2')).toBeInTheDocument()
    expect(screen.getByText('Assigned by your teacher in EduAI.')).toBeInTheDocument()
  })

  it('shows a dash without a test date', () => {
    const { wrapper } = makeWellnessCtx()
    render(<FocusMode countdown={null} onSessionComplete={() => {}} />, { wrapper })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('No test date yet')).toBeInTheDocument()
  })

  it('completes a 25-minute study block, then switches to a 5-minute break', () => {
    const onSessionComplete = vi.fn()
    const { ctx, wrapper } = makeWellnessCtx()
    render(<FocusMode countdown={null} onSessionComplete={onSessionComplete} />, { wrapper })
    const timer = screen.getByRole('timer')
    expect(timer).toHaveTextContent('25:00')

    fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(timer).toHaveTextContent('24:00')

    // Pause holds the remaining time
    fireEvent.click(screen.getByRole('button', { name: 'Pause focus timer' }))
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(timer).toHaveTextContent('24:00')

    fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }))
    act(() => { vi.advanceTimersByTime(24 * 60_000 + 500) })
    expect(onSessionComplete).toHaveBeenCalledTimes(1)
    expect(ctx.alert).toHaveBeenCalledWith('🍅 Pomodoro Completed! (+50 XP)', expect.stringContaining('25-minute Pomodoro'))
    expect(screen.getByRole('button', { name: /break mode/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('timer')).toHaveTextContent('05:00')
  })

  it('resets to the full block', () => {
    const { wrapper } = makeWellnessCtx()
    render(<FocusMode countdown={null} onSessionComplete={() => {}} />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Start focus timer' }))
    act(() => { vi.advanceTimersByTime(90_000) })
    fireEvent.click(screen.getByRole('button', { name: 'Reset study timer' }))
    expect(screen.getByRole('timer')).toHaveTextContent('25:00')
    expect(screen.getByRole('button', { name: 'Start focus timer' })).toBeInTheDocument()
  })
})
