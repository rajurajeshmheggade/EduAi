import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdQuiet } from '@/lib/studyFlow/quiet'
import { resetStudyActivity } from '@/lib/studyFlow/activity'
import { wellnessService } from '@/services/wellnessService'
import { advance, nav, person, renderStudyFlow, useFakeClock } from '@/test/studyFlow'
import { playingSources, stubAudioContext } from '@/test/webAudio'
import type { UserProfile } from '@/types'
import type { XpResult } from '@/types/wellness'

let auth: { user: UserProfile | null } = { user: null }
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/services/wellnessService', () => ({ wellnessService: { activity: vi.fn() } }))
const svc = vi.mocked(wellnessService)
const XP: XpResult = { awarded: 50, leveledUp: false, capped: false, xp: 60, level: 1, levelTitle: 'Mindful Rookie', xpToNext: 100, totalXp: 60 }

const fab = () => screen.getByRole('button', { name: /focus timer/i, expanded: false })
const openPanel = () => { fireEvent.click(screen.getByRole('button', { name: /Open the focus timer/ })); return screen.getByRole('dialog', { name: 'Focus timer' }) }
const timer = () => screen.getByRole('timer')

describe('floating Focus Timer', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStudyActivity()
    auth = { user: person('student') }
    useFakeClock()
    svc.activity.mockResolvedValue(XP)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('sits on every student page and opens a popup with a 25-minute default and 15 / 25 / 45 / custom lengths', () => {
    renderStudyFlow('/student/dashboard')
    const panel = openPanel()
    expect(screen.getByRole('button', { name: /Open the focus timer/, expanded: true })).toHaveAttribute('aria-controls', panel.id)
    expect(timer()).toHaveTextContent('25:00')
    expect(within(panel).getByRole('button', { name: 'Start focus' })).toHaveFocus()
    expect(within(panel).getByRole('button', { name: '25 min' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(panel).getByRole('button', { name: '45 min' }))
    expect(timer()).toHaveTextContent('45:00')
    fireEvent.click(within(panel).getByRole('button', { name: 'Custom' }))
    fireEvent.change(within(panel).getByLabelText('Minutes'), { target: { value: '10' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Set' }))
    expect(timer()).toHaveTextContent('10:00')
  })

  it('start / pause / resume / reset, with the time left on the floating button', () => {
    renderStudyFlow('/student/dashboard')
    const panel = openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: '15 min' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Start focus' }))
    advance(60_000)
    expect(timer()).toHaveTextContent('14:00')
    expect(screen.getByRole('button', { name: /^Focus timer running, 14 minutes left/ })).toHaveTextContent('14:00')
    expect(within(panel).getByRole('button', { name: '45 min' })).toBeDisabled()        // pause to change the length

    fireEvent.click(within(panel).getByRole('button', { name: 'Pause' }))
    advance(5 * 60_000)
    expect(timer()).toHaveTextContent('14:00')
    expect(screen.getByRole('button', { name: /^Focus timer paused/ })).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: 'Resume' }))
    advance(30_000)
    expect(timer()).toHaveTextContent('13:30')

    fireEvent.click(within(panel).getByRole('button', { name: 'Reset the timer' }))
    expect(timer()).toHaveTextContent('15:00')
    expect(within(panel).getByRole('button', { name: 'Start focus' })).toBeInTheDocument()
  })

  it('a finished 25-minute session chimes and earns the Wellness focus XP (once)', async () => {
    const made = stubAudioContext()
    renderStudyFlow('/student/dashboard')
    fireEvent.click(within(openPanel()).getByRole('button', { name: 'Start focus' }))
    advance(25 * 60_000)
    expect(timer()).toHaveTextContent('00:00')
    expect(svc.activity).toHaveBeenCalledTimes(1)
    expect(svc.activity).toHaveBeenCalledWith('pomodoro', 'Focus timer · 25 min')
    await act(async () => {})
    expect(screen.getByText('Focus session complete · +50 XP')).toBeInTheDocument()
    expect(made[0].nodes.some((n) => n.kind === 'oscillator')).toBe(true)              // the chime
    expect(screen.getByRole('button', { name: /Focus session complete/ })).toHaveTextContent('Done')
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument()
    advance(60_000)
    expect(svc.activity).toHaveBeenCalledTimes(1)
  })

  it('a short session is praised but earns no XP', async () => {
    renderStudyFlow('/student/dashboard')
    const panel = openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: '15 min' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Start focus' }))
    advance(15 * 60_000)
    await act(async () => {})
    expect(svc.activity).not.toHaveBeenCalled()
    expect(screen.getByText('Focus session complete — nice work!')).toBeInTheDocument()
  })

  it('keeps running across navigation and a reload, per student', () => {
    const first = renderStudyFlow('/student/dashboard')
    fireEvent.click(within(openPanel()).getByRole('button', { name: 'Start focus' }))
    advance(5 * 60_000)
    nav.to('/student/homework')
    expect(screen.getByRole('button', { name: /^Focus timer running, 20 minutes left/ })).toBeInTheDocument()
    first.unmount()

    advance(60_000)                                                                       // the page was closed for a minute
    const second = renderStudyFlow('/student/library')
    advance(500)
    expect(screen.getByRole('button', { name: /^Focus timer running, 19 minutes left/ })).toHaveTextContent('19:00')
    second.unmount()

    auth = { user: person('student', 'S2') }                                              // someone else on this browser
    renderStudyFlow('/student/dashboard')
    expect(screen.getByRole('button', { name: 'Open the focus timer' })).toBeInTheDocument()
  })

  it('sound options: plays the chosen sound while running, switches, pauses with the timer, volume and mute', () => {
    const made = stubAudioContext()
    renderStudyFlow('/student/dashboard')
    const panel = openPanel()
    const sounds = within(panel).getByRole('group', { name: 'Focus sound' })
    expect(within(sounds).getAllByRole('button').map((b) => b.textContent)).toEqual(['Off', 'Ocean waves', 'Rain', 'White noise', 'Brown noise', 'Binaural 10 HzUse headphones'])
    fireEvent.click(within(sounds).getByRole('button', { name: 'Rain' }))
    expect(within(sounds).getByRole('button', { name: 'Rain' })).toHaveAttribute('aria-pressed', 'true')
    const { nodes } = made[0]
    expect(playingSources(nodes)).toHaveLength(0)                                         // only while the timer runs

    fireEvent.click(within(panel).getByRole('button', { name: 'Start focus' }))
    expect(playingSources(nodes)).toHaveLength(1)
    const rain = playingSources(nodes)[0]
    fireEvent.click(within(sounds).getByRole('button', { name: /Brown noise/ }))
    expect(rain.stopped).toBe(true)
    expect(playingSources(nodes)).toHaveLength(1)

    const master = nodes.find((n) => n.kind === 'gain') as unknown as { gain: { value: number } }
    fireEvent.change(within(panel).getByRole('slider', { name: 'Volume' }), { target: { value: '30' } })
    expect(master.gain.value).toBeCloseTo(0.3)
    fireEvent.click(within(panel).getByRole('button', { name: 'Mute' }))
    expect(master.gain.value).toBe(0)
    fireEvent.click(within(panel).getByRole('button', { name: 'Unmute' }))
    expect(master.gain.value).toBeCloseTo(0.3)

    fireEvent.click(within(panel).getByRole('button', { name: 'Pause' }))
    expect(playingSources(nodes)).toHaveLength(0)
    fireEvent.click(within(panel).getByRole('button', { name: 'Resume' }))
    fireEvent.click(within(sounds).getByRole('button', { name: 'Off' }))
    expect(playingSources(nodes)).toHaveLength(0)
    expect(made).toHaveLength(1)
  })

  it('keyboard: Escape closes the popup and returns focus to the button; a click elsewhere closes it too', () => {
    renderStudyFlow('/student/dashboard')
    const panel = openPanel()
    fireEvent.keyDown(within(panel).getByRole('button', { name: 'Start focus' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Focus timer' })).not.toBeInTheDocument()
    expect(fab()).toHaveFocus()
    openPanel()
    fireEvent.pointerDown(screen.getByTestId('where'))
    expect(screen.queryByRole('dialog', { name: 'Focus timer' })).not.toBeInTheDocument()
  })

  it('hides on exams and during classroom sessions, stopping the sound; the timer keeps time', () => {
    const made = stubAudioContext()
    renderStudyFlow('/student/dashboard')
    const panel = openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: 'Ocean waves' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Start focus' }))
    expect(playingSources(made[0].nodes).length).toBeGreaterThan(0)

    nav.to('/student/tests/t1/take')
    expect(screen.queryByRole('button', { name: /focus timer/i })).not.toBeInTheDocument()
    expect(playingSources(made[0].nodes)).toHaveLength(0)                               // silent on the test runner
    nav.to('/student/dashboard')
    expect(screen.getByRole('button', { name: /^Focus timer running/ })).toBeInTheDocument()

    let release = () => {}
    act(() => { release = holdQuiet('session') })                                       // an AI Classroom session
    expect(screen.queryByRole('button', { name: /focus timer/i })).not.toBeInTheDocument()
    expect(playingSources(made[0].nodes)).toHaveLength(0)
    act(() => release())
    expect(screen.getByRole('button', { name: /^Focus timer running/ })).toBeInTheDocument()
    expect(playingSources(made[0].nodes).length).toBeGreaterThan(0)

    let exam = () => {}
    act(() => { exam = holdQuiet('exam') })                                               // a proctored lab attempt
    expect(screen.queryByRole('button', { name: /focus timer/i })).not.toBeInTheDocument()
    act(() => exam())
  })

  it('is for students only', () => {
    for (const role of ['teacher', 'orgadmin', 'parent'] as const) {
      auth = { user: person(role, 'T1') }
      const r = renderStudyFlow(role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard')
      expect(screen.queryByRole('button', { name: /focus timer/i })).not.toBeInTheDocument()
      r.unmount()
    }
  })
})
