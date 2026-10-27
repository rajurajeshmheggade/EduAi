import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { wellnessService } from '@/services/wellnessService'
import type { XpResult } from '@/types/wellness'
import { BreathingTab } from './BreathingTab'
import { BREATH_LEAD_IN_MS } from './breathVoice'
import { makeWellnessCtx } from './testUtils'

vi.mock('@/services/wellnessService', () => ({ wellnessService: { activity: vi.fn() } }))

const XP: XpResult = { xp: 30, level: 1, levelTitle: 'Mindful Rookie', xpToNext: 100, totalXp: 30, awarded: 30, leveledUp: false, capped: false }
const BOX_CYCLE_MS = 16_000

describe('BreathingTab', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] })
    vi.mocked(wellnessService.activity).mockReset().mockResolvedValue(XP)
  })
  afterEach(() => vi.useRealTimers())

  it('runs the box pattern, reports each cycle for server XP and reloads the profile afterwards', async () => {
    const { ctx, wrapper } = makeWellnessCtx()
    const { unmount } = render(<BreathingTab />, { wrapper })
    expect(screen.getByRole('button', { name: /box breathing mode/i })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /begin breathing/i }))
    // Shown in the bubble and announced to screen readers (no speech engine in jsdom, so phases are announced)
    expect(screen.getAllByText('Get ready')).toHaveLength(2)
    // Patterns cannot be switched mid-session
    expect(screen.getByRole('button', { name: /relaxation breathing mode/i })).toBeDisabled()

    act(() => { vi.advanceTimersByTime(BREATH_LEAD_IN_MS + 100) })
    expect(screen.getAllByText('Inhale')).toHaveLength(2)

    act(() => { vi.advanceTimersByTime(BOX_CYCLE_MS * 2) })
    expect(screen.getByText('Cycles Completed:').nextSibling).toHaveTextContent('2')
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(wellnessService.activity).toHaveBeenCalledTimes(2)
    expect(wellnessService.activity).toHaveBeenCalledWith('breathing_cycle', 'Box Breathing (4-4-4-4)')
    expect(ctx.applyXp).toHaveBeenCalledWith(XP, 'Breathing Cycle Done')

    fireEvent.click(screen.getByRole('button', { name: /stop session/i }))
    expect(ctx.alert).toHaveBeenCalledWith('Breathing Stopped', expect.stringContaining('You completed 2 cycles'))
    await act(async () => { await Promise.resolve() })
    expect(ctx.refresh).toHaveBeenCalledTimes(1)
    unmount()
    expect(ctx.refresh).toHaveBeenCalledTimes(1) // nothing new to sync
  })

  it('speaks the guide with captions and stops talking when the tab is left', () => {
    class FakeUtterance { text: string; rate = 1; voice: unknown = null; onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t } }
    const spoken: FakeUtterance[] = []
    const synth = {
      speaking: false, pending: false,
      speak: vi.fn((u: FakeUtterance) => { spoken.push(u) }),
      cancel: vi.fn(),
      getVoices: () => [{ name: 'Microsoft Aria Online (Natural)', lang: 'en-US' }],
    }
    vi.stubGlobal('speechSynthesis', synth)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    try {
      const { wrapper } = makeWellnessCtx()
      const { unmount } = render(<BreathingTab />, { wrapper })
      const voice = screen.getByRole('button', { name: 'Voice guide' })
      expect(voice).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(screen.getByRole('button', { name: /begin breathing/i }))
      expect(spoken.map((u) => u.text)).toEqual(["Let's begin."])
      expect(spoken[0].rate).toBeLessThan(1)
      act(() => { spoken[0].onstart?.() })
      expect(screen.getByRole('status')).toHaveTextContent("Let's begin.")

      // The first cue is sent just before the inhale starts, and the bubble waits for the voice to start it
      act(() => { vi.advanceTimersByTime(BREATH_LEAD_IN_MS - 200) })
      expect(spoken.at(-1)?.text).toBe('Breathe in')
      act(() => { vi.advanceTimersByTime(300); spoken.at(-1)?.onstart?.() })
      expect(screen.getByText('Inhale')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Breathe in')

      unmount()
      expect(synth.cancel).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the exercise going when the XP request fails', async () => {
    vi.mocked(wellnessService.activity).mockRejectedValue(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ctx, wrapper } = makeWellnessCtx()
    render(<BreathingTab />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: /relaxation breathing mode/i }))
    fireEvent.click(screen.getByRole('button', { name: /begin breathing/i }))
    act(() => { vi.advanceTimersByTime(BREATH_LEAD_IN_MS + 19_000 + 100) })
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(wellnessService.activity).toHaveBeenCalledWith('breathing_cycle', 'Relaxation Breathing (4-7-8)')
    expect(ctx.applyXp).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /stop session/i })).toBeInTheDocument()
  })
})
