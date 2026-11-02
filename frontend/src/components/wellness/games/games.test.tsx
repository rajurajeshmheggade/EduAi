import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWellnessCtx } from '@/components/wellness/breathing/testUtils'
import { wellnessService } from '@/services/wellnessService'
import type { XpResult } from '@/types/wellness'
import BreathBloom from './bloom/BreathBloom'
import { gameById, type GameId, type GameProps } from './catalog'
import WordForge from './forge/WordForge'
import LanternTrail from './lantern/LanternTrail'
import SandMandala from './mandala/SandMandala'
import ConceptPairs from './pairs/ConceptPairs'
import SteadySignal from './signal/SteadySignal'
import SortStudio from './sort/SortStudio'
import { SORT_SETS } from './sort/logic'
import NumberSprint from './sprint/NumberSprint'
import { VOCAB_PACKS } from './vocab'

vi.mock('@/services/wellnessService', () => ({ wellnessService: { activity: vi.fn() } }))
vi.mock('@/components/wellness/WellnessContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/wellness/WellnessContext')>()),
  celebrate: vi.fn(),
}))

const XP: XpResult = { xp: 25, level: 1, levelTitle: 'Mindful Rookie', xpToNext: 100, totalXp: 25, awarded: 25, leveledUp: false, capped: false }
const FAKE: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] }

function mount(Game: ComponentType<GameProps>, id: GameId) {
  const { ctx, wrapper } = makeWellnessCtx()
  const onExit = vi.fn()
  render(<Game info={gameById(id)!} onExit={onExit} />, { wrapper })
  return { ctx, onExit }
}
const start = () => fireEvent.click(screen.getByRole('button', { name: 'Start' }))
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
/** The GameShell's polite live region (what a screen reader hears). */
const spoken = () => document.querySelector('[aria-live="polite"].sr-only')?.textContent ?? ''
/** Lets the background XP report (a promise chain) settle. */
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
/** A value in the score bar. */
const hud = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent

const reported = (game: GameId) => vi.mocked(wellnessService.activity).mock.calls.filter(([a, d]) => a === 'game_complete' && d === game)
const MATHS = VOCAB_PACKS.find((p) => p.id === 'maths')!.entries

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(wellnessService.activity).mockReset().mockResolvedValue(XP)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Concept Pairs', () => {
  it('matches every term with its meaning, reports XP once and saves a personal best', async () => {
    const { ctx, onExit } = mount(ConceptPairs, 'concept-pairs')
    expect(screen.getByRole('heading', { name: 'Concept Pairs' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Mathematics' })).toHaveAttribute('aria-pressed', 'true')
    start()
    const cards = () => screen.queryAllByRole('button', { name: /^Card \d+/ })
    expect(cards()).toHaveLength(12)
    expect(cards()[0]).toHaveFocus()

    // Peek at every card once (which also plays a few turns), then pair the rest from what was seen
    const seen: string[] = []
    cards().forEach((_, i) => {
      fireEvent.click(cards()[i])
      seen[i] = cards()[i].getAttribute('aria-label')!.replace(/^Card \d+, (matched )?(term|meaning): /, '')
    })
    for (const { term, def } of MATHS) {
      const t = seen.indexOf(term)
      const m = seen.indexOf(def)
      if (!cards().length) break // the round is over
      if (t < 0 || cards()[t].getAttribute('aria-label')!.includes('matched')) continue
      fireEvent.click(cards()[t])
      fireEvent.click(cards()[m])
    }
    expect(await screen.findByRole('heading', { name: 'Every pair found!' })).toHaveFocus()
    expect(screen.getByText('New personal best!')).toBeInTheDocument()
    await flush()
    expect(reported('concept-pairs')).toHaveLength(1)
    expect(ctx.applyXp).toHaveBeenCalledWith(XP, 'Game Zone · Concept Pairs')
    expect(JSON.parse(window.localStorage.getItem('eduai.gamezone.best.S1')!)['concept-pairs']).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: /back to game zone/i }).at(-1)!)
    expect(onExit).toHaveBeenCalled()
  })
})

describe('Number Sprint', () => {
  beforeEach(() => { vi.useFakeTimers(FAKE) })

  it('runs a one-minute sprint that pauses with the page and the Pause button', async () => {
    mount(NumberSprint, 'number-sprint')
    expect(screen.getByText(/Starting level:/)).toHaveTextContent('Stretch') // Grade 10, not yet assessed
    start()
    expect(spoken()).toMatch(/^One minute\. Press 1 to 4 to answer\. First: /)
    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: String(i + 1) })
    expect(within(screen.getByRole('group', { name: 'Answers' })).getAllByRole('button')).toHaveLength(4)
    tick(30_000)
    expect(hud('Time left')).toBe('0:30')

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByText('Paused')).toBeInTheDocument()
    const resume = () => screen.getAllByRole('button', { name: 'Resume' }).at(-1)! // the overlay's (the header has one too)
    expect(resume()).toHaveFocus()
    fireEvent.keyDown(window, { key: '1' }) // no answering while paused
    tick(20_000)
    expect(hud('Time left')).toBe('0:30')
    fireEvent.click(resume())

    // A hidden browser tab pauses too
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    hidden.mockRestore()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    tick(10_000)
    expect(hud('Time left')).toBe('0:30')
    fireEvent.click(resume())

    tick(30_500)
    expect(screen.getByText(/Answered 4 · \d correct/)).toBeInTheDocument()
    await flush()
    expect(reported('number-sprint')).toHaveLength(1)
  })

  it('needs a few answers before a sprint earns XP', async () => {
    mount(NumberSprint, 'number-sprint')
    start()
    tick(61_000)
    expect(screen.getByText('Answer at least 3 questions to earn XP.')).toBeInTheDocument()
    expect(screen.getByText('Finish a full round to earn XP.')).toBeInTheDocument()
    await flush()
    expect(wellnessService.activity).not.toHaveBeenCalled()
  })
})

describe('Breath Bloom', () => {
  beforeEach(() => { vi.useFakeTimers(FAKE) })

  it('blooms a full flower when the student holds on every in-breath and lets go on every out-breath', async () => {
    mount(BreathBloom, 'breath-bloom')
    start()
    const orb = screen.getByRole('button', { name: /breathing orb/i })
    expect(orb).toHaveFocus()
    for (let b = 0; b < 6; b++) {
      fireEvent.keyDown(orb, { key: ' ' })
      expect(orb).toHaveAttribute('aria-pressed', 'true')
      tick(4000)
      fireEvent.keyUp(orb, { key: ' ' })
      tick(6000)
    }
    tick(200)
    expect(screen.getByRole('heading', { name: 'Your flower is in full bloom' })).toBeInTheDocument()
    expect(screen.getByText('Petals in bloom: 6 of 6')).toBeInTheDocument()
    await flush()
    expect(reported('breath-bloom')).toHaveLength(1)
  })

  it('opens no petals (and no XP) for a minute of not following the guide', async () => {
    mount(BreathBloom, 'breath-bloom')
    start()
    tick(60_500)
    expect(screen.getByRole('heading', { name: 'A quiet minute' })).toBeInTheDocument()
    await flush()
    expect(wellnessService.activity).not.toHaveBeenCalled()
  })
})

describe('Word Forge', () => {
  it('builds words by typing and hints, skips one, and finishes the round', async () => {
    mount(WordForge, 'word-forge')
    start()
    const current = () => MATHS.find((e) => screen.queryByText(e.def))!
    for (let w = 0; w < 6; w++) {
      const word = current().term.toUpperCase()
      if (w === 5) {
        fireEvent.click(screen.getByRole('button', { name: /skip word/i }))
        break
      }
      if (w === 0) fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
      for (const letter of word.slice(w === 0 ? 1 : 0)) fireEvent.keyDown(window, { key: letter.toLowerCase() })
    }
    expect(await screen.findByRole('heading', { name: 'Great recall!' })).toBeInTheDocument()
    expect(screen.getByText('Solved 5 of 6 words')).toBeInTheDocument()
    expect(screen.getByText('Hints used: 1')).toBeInTheDocument()
    await flush()
    expect(reported('word-forge')).toHaveLength(1)
  })

  it('says when a full word is wrong and lets letters be taken back', () => {
    mount(WordForge, 'word-forge')
    start()
    const tiles = within(screen.getByRole('group', { name: /letters to place/i })).getAllByRole('button')
    tiles.forEach((t) => fireEvent.click(t))
    // The scramble never spells the word, so placing tiles in shown order is wrong
    expect(screen.getByText(/Not quite — take a letter back or use a hint/)).toBeInTheDocument()
    expect(tiles[0]).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(tiles.filter((t) => t.getAttribute('aria-disabled') !== 'true')).toHaveLength(1)
  })
})

describe('Lantern Trail', () => {
  beforeEach(() => { vi.useFakeTimers(FAKE) })

  const names = () => spoken().split('Watch: ')[1].trim().split(', ')

  it('plays a trail, takes the echo, grows the trail and ends after three slips', async () => {
    mount(LanternTrail, 'lantern-trail')
    start()
    expect(names()).toHaveLength(3)
    const first = names()
    tick(4000)
    expect(spoken()).toMatch(/Your turn: 3 lanterns/)
    for (const n of first) fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${n} lantern`) }))
    expect(spoken()).toMatch(/^Trail of 3 cleared! One more lantern joins\. Watch: /)
    expect(names()).toHaveLength(4)

    for (let slip = 0; slip < 3; slip++) {
      const wrong = ['Moon', 'Leaf'].find((n) => n !== names()[0])!
      tick(5000)
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${wrong} lantern`) }))
    }
    expect(screen.getByRole('heading', { name: 'Lovely memory work!' })).toBeInTheDocument()
    expect(screen.getByText('Longest trail: 3 lanterns')).toBeInTheDocument()
    await flush()
    expect(reported('lantern-trail')).toHaveLength(1)
  })

  it('ignores taps while the trail is still playing and accepts number keys', () => {
    mount(LanternTrail, 'lantern-trail')
    start()
    fireEvent.keyDown(window, { key: '1' })
    expect(screen.getByText(/Watch the trail/)).toBeInTheDocument()
    tick(4000)
    expect(screen.getByText(/Your turn: 0 of 3/)).toBeInTheDocument()
  })
})

describe('Sort Studio', () => {
  it('sorts by key and by dragging, explains a wrong drop and lists it for review', async () => {
    mount(SortStudio, 'sort-studio')
    expect(screen.getByRole('button', { name: 'States of matter' })).toHaveAttribute('aria-pressed', 'true')
    start()
    const set = SORT_SETS.find((s) => s.id === 'matter')!
    const current = () => {
      const text = screen.getByText('Item to sort:').parentElement!.textContent!.replace('Item to sort: ', '')
      return set.items.find((i) => i.text === text)!
    }
    const keyFor = (bucket: string) => String(set.buckets.findIndex((b) => b.id === bucket) + 1)

    const first = current()
    const wrongKey = keyFor(set.buckets.find((b) => b.id !== first.bucket)!.id)
    fireEvent.keyDown(window, { key: wrongKey })
    expect(screen.getAllByText(new RegExp(`${first.text} goes in`)).length).toBeGreaterThan(0)

    // Drag the next card onto its group (the drop target is found from the group's on-screen box)
    const second = current()
    const target = screen.getByRole('button', { name: new RegExp(`^${set.buckets.find((b) => b.id === second.bucket)!.label}, key`) })
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 200, top: 300, bottom: 400, width: 100, height: 100, x: 100, y: 300, toJSON: () => ({}) })
    const card = screen.getByText('Item to sort:').closest('div')!
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 150, clientY: 350 })
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 150, clientY: 350 })
    expect(screen.getAllByText(new RegExp(`Correct: ${second.text} → `)).length).toBeGreaterThan(0)

    for (let i = 2; i < 10; i++) fireEvent.keyDown(window, { key: keyFor(current().bucket) })
    expect(await screen.findByRole('heading', { name: 'Nicely sorted!' })).toBeInTheDocument()
    expect(screen.getByText('9 of 10 sorted correctly')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`To review: ${first.text} → `))).toBeInTheDocument()
    await flush()
    expect(reported('sort-studio')).toHaveLength(1)
  })
})

describe('Steady Signal', () => {
  beforeEach(() => { vi.useFakeTimers(FAKE) })
  const shown = () => document.querySelector('[aria-live="assertive"]')?.textContent ?? ''

  it('scores responses to the target only', async () => {
    mount(SteadySignal, 'steady-signal')
    start()
    const target = screen.getByText(/^Target:/).querySelector('b')!.textContent!
    expect(spoken()).toBe(`Your target is the ${target}. Press Space only when it appears.`)
    for (let t = 0; t < 70_000 && !screen.queryByRole('button', { name: 'Play again' }); t += 100) {
      if (shown() === target) fireEvent.keyDown(window, { key: ' ' })
      tick(100)
    }
    expect(screen.getByRole('heading', { name: 'Rock-steady focus!' })).toBeInTheDocument()
    expect(screen.getByText('Accuracy: 100%')).toBeInTheDocument()
    expect(screen.getByText('Targets caught: 9 of 9')).toBeInTheDocument()
    await flush()
    expect(reported('steady-signal')).toHaveLength(1)
  })

  it('counts a tap on a distractor and gives no XP without a single catch', async () => {
    mount(SteadySignal, 'steady-signal')
    start()
    const target = screen.getByText(/^Target:/).querySelector('b')!.textContent!
    let tapped = false
    for (let t = 0; t < 70_000 && !screen.queryByRole('button', { name: 'Play again' }); t += 100) {
      if (!tapped && shown() && shown() !== target) {
        fireEvent.click(screen.getByRole('button', { name: /now!/i }))
        tapped = true
      }
      tick(100)
    }
    expect(screen.getByText(/early taps: 1/)).toBeInTheDocument()
    expect(screen.getByText('Catch at least one target to earn XP.')).toBeInTheDocument()
    await flush()
    expect(wellnessService.activity).not.toHaveBeenCalled()
  })
})

describe('Sand Mandala', () => {
  beforeEach(() => { vi.useFakeTimers(FAKE) })

  it('has no fail state: XP comes after a calm stay, and the keyboard brush works', async () => {
    mount(SandMandala, 'sand-mandala')
    start()
    const canvas = screen.getByRole('application', { name: /sand mandala canvas/i })
    expect(canvas).toHaveFocus()
    fireEvent.keyDown(canvas, { key: ' ' })
    fireEvent.keyDown(canvas, { key: 'ArrowUp' })
    fireEvent.keyDown(canvas, { key: 'ArrowLeft', shiftKey: true })
    fireEvent.keyDown(canvas, { key: ' ' })
    expect(hud('Strokes')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: '6-fold' }))
    expect(screen.getByRole('button', { name: '6-fold' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByText('Stay at least 45 seconds to earn XP.')).toBeInTheDocument()
    await flush()
    expect(wellnessService.activity).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    tick(46_000)
    expect(screen.getByText('Finish whenever you feel ready.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByRole('heading', { name: 'A peaceful pattern' })).toBeInTheDocument()
    await flush()
    expect(reported('sand-mandala')).toHaveLength(1)
  })
})

describe('Game shell', () => {
  it('remembers the sound choice and survives blocked storage', () => {
    mount(ConceptPairs, 'concept-pairs')
    const sound = screen.getByRole('button', { name: /^sound/i })
    expect(sound).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(sound)
    expect(sound).toHaveAttribute('aria-pressed', 'false')
    expect(window.localStorage.getItem('eduai.gamezone.muted')).toBe('1')

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    fireEvent.click(sound)
    expect(sound).toHaveAttribute('aria-pressed', 'true')
  })
})
