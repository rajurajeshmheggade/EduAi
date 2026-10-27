import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WellnessContext, type WellnessCtx } from '@/components/wellness/WellnessContext'
import { wellnessService } from '@/services/wellnessService'
import type { StudentContext, WellnessProfile } from '@/types/wellness'
import { AuraLiveTab } from './AuraLiveTab'

vi.mock('@/services/wellnessService', () => ({ wellnessService: { chat: vi.fn(), transcribe: vi.fn() } }))

const profile: WellnessProfile = {
  examDate: null, avatar: '🧘', breathCycles: 0, xp: 0, level: 1, levelTitle: 'Mindful Rookie', xpToNext: 100, totalXp: 0,
}
const context: StudentContext = {
  className: 'Grade 9 · Section B', gradeLabel: 'Grade 9', grade: 9, section: 'B', term: null, subjects: ['English', 'Physics'],
  knowledge: { level: 'Developing', avgPct: 61, assessments: 3, bySubject: [], strongest: null, needsSupport: null }, upcoming: [], countdown: null,
}
const ctx = {
  me: { student: { name: 'Asha', code: 'S1', classCode: null }, context, profile, stats: null },
  profile,
  context,
  meta: { avatars: [], knowledgeLevels: [], helplines: {}, coping: [], guardrailLayers: [], xpRules: {}, aiEnabled: true },
  stats: { avgStress: 40, journalsCount: 0, moodTrend: [] },
  refresh: vi.fn(), setStats: vi.fn(), applyXp: vi.fn(), alert: vi.fn(), confirm: vi.fn(), setAnalyzing: vi.fn(),
} satisfies WellnessCtx
const wrapper = ({ children }: { children: ReactNode }) => <WellnessContext.Provider value={ctx}>{children}</WellnessContext.Provider>

describe('AuraLiveTab', () => {
  beforeEach(() => { vi.mocked(wellnessService.chat).mockReset() })

  it('runs a session in a browser without speech support: welcome, typed fallback, guardrail helplines, close', async () => {
    vi.mocked(wellnessService.chat).mockResolvedValue({
      reply: 'You matter. Please reach out to someone right now.',
      guardrailTriggered: true,
      guardrailType: 'crisis_self_harm',
      aiSource: 'guardrail',
      helplines: { tele: { name: 'Tele-MANAS', number: '14416', description: '24x7 mental health support', toll_free: true } },
    })
    render(<AuraLiveTab />, { wrapper })

    // jsdom has neither SpeechRecognition nor AudioWorklet
    expect(screen.getByText(/Browser Compatibility Warning/)).toBeInTheDocument()
    const input = screen.getByLabelText('Type a message to Aura')
    expect(input).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Start Live Voice & Video Session' }))
    expect(await screen.findByText(/How are you feeling about your Grade 9 studies today\?/)).toBeInTheDocument()
    // No recognizer and no server recording path: Aura explains and the typed fallback stays available
    expect(await screen.findByRole('alert')).toHaveTextContent(/Type your message below/)
    await waitFor(() => expect(input).toBeEnabled())

    fireEvent.change(input, { target: { value: '  I feel hopeless  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send typed message to Aura' }))
    expect(wellnessService.chat).toHaveBeenCalledWith('I feel hopeless', { channel: 'live' })
    expect(screen.getByText('I feel hopeless')).toBeInTheDocument()
    expect(await screen.findByText(/You matter/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tele-MANAS: 14416/ })).toHaveAttribute('href', 'tel:14416')

    fireEvent.click(screen.getByRole('button', { name: 'Close Live Counseling Session' }))
    expect(screen.getByText(/Session closed\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Live Voice & Video Session' })).toBeInTheDocument()
  })

  it('falls back to a crisis-safe offline reply when the chat request fails', async () => {
    vi.mocked(wellnessService.chat).mockImplementation(() => Promise.reject(new Error('Network Error')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AuraLiveTab />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Start Live Voice & Video Session' }))
    const input = screen.getByLabelText('Type a message to Aura')
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(await screen.findByText(/Tele-MANAS at 14416 or KIRAN at 1800-599-0019/)).toBeInTheDocument()
    expect(console.error).toHaveBeenCalled()
  })
})
