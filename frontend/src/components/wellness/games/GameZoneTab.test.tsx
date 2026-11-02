import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Wellness from '@/pages/student/Wellness'
import { wellnessService } from '@/services/wellnessService'
import type { WellnessMe } from '@/types/wellness'
import { GAMES } from './catalog'

vi.mock('@/services/wellnessService', () => ({ wellnessService: { me: vi.fn(), meta: vi.fn(), activity: vi.fn() } }))
// No WebGL in jsdom: the page background is decorative
vi.mock('@/components/wellness/three/ThreeDimensionalParticles', () => ({ default: () => null }))

const ME: WellnessMe = {
  student: { name: 'Asha', code: 'S1', classCode: 'Grade-10-A' },
  context: {
    className: 'Grade 10 · Section A', gradeLabel: 'Grade 10', grade: 10, section: 'A', term: null, subjects: ['Mathematics', 'Physics'],
    upcoming: [], countdown: null,
    knowledge: { level: 'Not yet assessed', avgPct: null, assessments: 0, bySubject: [], strongest: null, needsSupport: null },
  },
  profile: { examDate: null, avatar: '🧘', breathCycles: 0, xp: 0, level: 1, levelTitle: 'Mindful Rookie', xpToNext: 100, totalXp: 0 },
  stats: { avgStress: 0, journalsCount: 0, moodTrend: [] },
}

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.search}</output>
}

const renderAt = (search: string) => render(
  <MemoryRouter initialEntries={[`/student/wellness${search}`]}>
    <Wellness />
    <Where />
  </MemoryRouter>,
)
const where = () => screen.getByTestId('where').textContent

describe('Wellness ▸ Game Zone', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.mocked(wellnessService.me).mockReset().mockResolvedValue(ME)
    vi.mocked(wellnessService.meta).mockReset().mockResolvedValue({
      avatars: [], knowledgeLevels: [], helplines: {}, coping: [], guardrailLayers: [], aiEnabled: false,
      xpRules: { game_complete: 25, stress_quest: 50 },
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows a picker card for every game under the Game Zone tab', async () => {
    window.localStorage.setItem('eduai.gamezone.best.S1', JSON.stringify({ 'word-forge': 340 }))
    renderAt('?tab=games')
    expect(await screen.findByRole('heading', { name: 'Game Zone' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /game zone/i })).toHaveAttribute('aria-selected', 'true')
    const list = screen.getByRole('list', { name: 'Games' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(GAMES.length)
    for (const g of GAMES) {
      const card = screen.getByRole('button', { name: `Play ${g.name}` }).closest('article')!
      expect(within(card).getByRole('heading', { name: g.name })).toBeInTheDocument()
      expect(within(card).getByText(g.blurb)).toBeInTheDocument()
      expect(within(card).getByText(g.duration)).toBeInTheDocument()
    }
    expect(within(screen.getByRole('button', { name: 'Play Word Forge' }).closest('article')!).getByText('Best 340')).toBeInTheDocument()
    expect(screen.getByText(/Finish a game for \+25 XP/)).toBeInTheDocument()

    // Filter by what a game trains (labelled chips, not colour)
    fireEvent.click(screen.getByRole('button', { name: /^Calm$/ }))
    expect(screen.getByRole('button', { name: /^Calm$/ })).toHaveAttribute('aria-pressed', 'true')
    const calm = GAMES.filter((g) => g.trains.includes('calm'))
    expect(within(list).getAllByRole('listitem')).toHaveLength(calm.length)
    expect(screen.queryByRole('button', { name: 'Play Number Sprint' })).not.toBeInTheDocument()
  })

  it('keeps old ?tab=stress-buster links working: the Game Zone opens on the balloon game', async () => {
    renderAt('?tab=stress-buster')
    expect(await screen.findByRole('button', { name: /start stress buster/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /game zone/i })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(where()).toBe('?tab=games&game=stress-buster'))

    fireEvent.click(screen.getByRole('button', { name: /back to game zone/i }))
    expect(await screen.findByRole('heading', { name: 'Game Zone' })).toBeInTheDocument()
    expect(where()).toBe('?tab=games')
    expect(screen.getByRole('button', { name: 'Play Stress Buster' })).toHaveFocus()
  })

  it('opens a game from its card, lazily, and the tab bar always returns to the picker', async () => {
    renderAt('?tab=games')
    fireEvent.click(await screen.findByRole('button', { name: 'Play Word Forge' }))
    const title = await screen.findByRole('heading', { name: 'Word Forge', level: 2 })
    expect(title).toHaveFocus()
    expect(where()).toBe('?tab=games&game=word-forge')
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Words from' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /breathing/i }))
    await waitFor(() => expect(where()).toBe('?tab=breathing'))
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /game zone/i })) })
    expect(await screen.findByRole('heading', { name: 'Game Zone' })).toBeInTheDocument()
    await waitFor(() => expect(where()).toBe('?tab=games'))
  })

  it('opens a deep link straight into a game and ignores unknown games', async () => {
    renderAt('?tab=games&game=lantern-trail')
    expect(await screen.findByRole('heading', { name: 'Lantern Trail', level: 2 })).toBeInTheDocument()
    expect(screen.getByText(/light them in the same order — tap them or press their number keys/)).toBeInTheDocument()
  })

  it('falls back to the picker for an unknown game id', async () => {
    renderAt('?tab=games&game=not-a-game')
    expect(await screen.findByRole('heading', { name: 'Game Zone' })).toBeInTheDocument()
  })
})
