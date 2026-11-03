import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWellnessCtx } from '@/components/wellness/breathing/testUtils'
import { celebrate } from '@/components/wellness/WellnessContext'
import { wellnessService } from '@/services/wellnessService'
import type { XpResult } from '@/types/wellness'
import { QUEST_TARGET, SPAWN_EVERY_MS } from './content'
import { StressBusterTab } from './StressBusterTab'

vi.mock('@/services/wellnessService', () => ({ wellnessService: { activity: vi.fn() } }))
vi.mock('@/components/wellness/WellnessContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/wellness/WellnessContext')>()),
  celebrate: vi.fn(),
}))

const XP: XpResult = { xp: 10, level: 1, levelTitle: 'Mindful Rookie', xpToNext: 100, totalXp: 10, awarded: 10, leveledUp: false, capped: false }

describe('StressBusterTab', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    vi.mocked(wellnessService.activity).mockReset().mockResolvedValue(XP)
    // jsdom has no layout: give the play area a real size so balloons take seconds to float away
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(460)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('floats worries customised to the class, pops them for XP and completes the quest', async () => {
    const { ctx, wrapper } = makeWellnessCtx({}, { gradeLabel: 'Grade 7' })
    render(<StressBusterTab />, { wrapper })
    expect(screen.getByText(/customized for your Grade 7 subjects/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /start stress buster/i }))
    const arena = screen.getByRole('group', { name: /stress balloons/i })
    expect(arena).toHaveFocus()

    for (let i = 0; i < QUEST_TARGET; i++) {
      act(() => { vi.advanceTimersByTime(SPAWN_EVERY_MS) })
      const [balloon] = screen.getAllByRole('button', { name: /pop stress balloon/i })
      fireEvent.click(balloon)
    }
    await act(async () => { await vi.runOnlyPendingTimersAsync() })

    const calls = vi.mocked(wellnessService.activity).mock.calls
    expect(calls.filter(([a]) => a === 'balloon_pop')).toHaveLength(QUEST_TARGET)
    expect(calls.at(-1)?.[0]).toBe('stress_quest') // sent after the last pop, so the header ends on the newest total
    expect(ctx.applyXp).toHaveBeenLastCalledWith(XP, 'Stress Buster Quest Completed')
    expect(celebrate).toHaveBeenCalledWith({ particleCount: 150, spread: 80, origin: { y: 0.6 } })
    expect(ctx.alert).toHaveBeenCalledWith('🎉 Quest Completed! (+50 XP)', expect.stringContaining('popped 10 stress thoughts'))
    expect(screen.getByText(`${QUEST_TARGET}/${QUEST_TARGET}`)).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText(/popped! ➔/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start stress buster/i })).toBeInTheDocument()
  })

  it('pops the highest balloon from the keyboard', () => {
    const { wrapper } = makeWellnessCtx()
    render(<StressBusterTab />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: /start stress buster/i }))
    act(() => { vi.advanceTimersByTime(SPAWN_EVERY_MS * 2) })
    expect(screen.getAllByRole('button', { name: /pop stress balloon/i })).toHaveLength(2)
    fireEvent.keyDown(screen.getByRole('group', { name: /stress balloons/i }), { key: 'Enter' })
    expect(screen.getAllByRole('button', { name: /pop stress balloon/i })).toHaveLength(1)
    expect(screen.getByText('1/10')).toBeInTheDocument()
  })
})
