import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readerAudio } from '@/lib/readerAudio'
import { readAloudService, type ReadMode } from '@/services/readAloudService'
import { AvatarTutor } from './AvatarTutor'
import { useReadAloud } from './useReadAloud'

const connectAudio = vi.fn()
vi.mock('wawa-lipsync', () => ({
  Lipsync: class { viseme = 'viseme_sil'; features = null; connectAudio = connectAudio; processAudio = vi.fn() },
}))

const LESSON = {
  title: 'Motion', intro: 'Let us look at motion.', recap: 'Motion is change of position.', question: 'What is speed?',
  key_points: [{ heading: 'Speed', explanation: 'Speed tells how fast something moves.', quote: 'Speed is the distance travelled' }],
  terms: [{ term: 'Velocity', meaning: 'Speed in a direction.' }],
}
const PAGES: Record<number, { text: string; quote?: string; point?: number }[]> = {
  1: [{ text: 'Let us look at motion.' }, { text: 'First, Speed. Speed tells how fast something moves.', quote: 'Speed is the distance travelled', point: 0 }],
  2: [{ text: 'Page two.' }],
}
vi.mock('@/services/readAloudService', () => ({
  readAloudService: {
    voice: vi.fn(),
    page: vi.fn(async (_id: string, p: number, mode: ReadMode) => ({
      page: p, total_pages: 2, mode, engine: 'azure-gpt-4o',
      lesson: mode === 'explain' && p === 1 ? LESSON : null,
      segments: (mode === 'read' ? [{ text: `Word for word ${p}.` }] : PAGES[p]).map((s, index) => ({ index, ...s })),
    })),
    audio: vi.fn(async () => new Blob(['x'], { type: 'audio/wav' })),
  },
}))

const svc = vi.mocked(readAloudService)
const RAJU = { teacher: { name: 'Raju', gender: 'male' }, voice: 'male' as const, engine: 'Neural voice (offline)' }

function Classroom({ onTurn }: { onTurn: (p: number) => void }) {
  const reader = useReadAloud('tb1', onTurn)
  return <AvatarTutor reader={reader} page={1} />
}

const ended = () => act(async () => { readerAudio().dispatchEvent(new Event('ended')) })

describe('AvatarTutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    URL.createObjectURL = vi.fn(() => `blob:clip-${Math.random()}`)
    URL.revokeObjectURL = vi.fn()
  })

  it("explains the page in the male teacher's voice, with notes, and turns the page", async () => {
    svc.voice.mockResolvedValue(RAJU)
    const onTurn = vi.fn()
    render(<Classroom onTurn={onTurn} />)
    expect(await screen.findByText('Male voice')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: "Raju's avatar" })).toHaveAttribute('data-avatar', 'male')

    fireEvent.click(screen.getByRole('button', { name: /^Explain page/ }))
    expect(await screen.findByText('Let us look at motion.', { selector: '#avatar-caption' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Pause/ })).toBeInTheDocument()
    expect(connectAudio).toHaveBeenCalledWith(readerAudio())          // lip-sync listens to the tutor's audio
    expect(svc.page).toHaveBeenCalledWith('tb1', 1, 'explain', expect.anything())
    expect(svc.audio).toHaveBeenCalledWith('tb1', 1, 0, 'explain', expect.anything())
    const notes = screen.getByRole('region', { name: /Teacher's notes/ })
    expect(within(notes).getByText('Speed')).toBeInTheDocument()
    expect(within(notes).getByText(/Words to remember/).closest('li')).toHaveTextContent('Words to remember: Velocity')

    await ended()
    expect(await screen.findByText(/^First, Speed\./, { selector: '#avatar-caption' })).toBeInTheDocument()
    expect(within(notes).getByRole('listitem', { current: true })).toHaveTextContent('Speed')   // the point being explained
    await ended()                                                     // last part of page 1 -> page 2
    expect(await screen.findByText('Page two.')).toBeInTheDocument()
    expect(onTurn).toHaveBeenCalledWith(2)
    await ended()
    expect(await screen.findByText(/That's all for page 2/)).toBeInTheDocument()
  })

  it('reads word for word when asked', async () => {
    svc.voice.mockResolvedValue(RAJU)
    render(<Classroom onTurn={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Word for word/ }))
    expect(screen.getByRole('button', { name: /Word for word/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^Read page/ }))
    expect(await screen.findByText('Word for word 1.')).toBeInTheDocument()
    expect(svc.audio).toHaveBeenCalledWith('tb1', 1, 0, 'read', expect.anything())
  })

  it('uses the female avatar when the teacher is not male', async () => {
    svc.voice.mockResolvedValue({ teacher: { name: 'Priya', gender: null }, voice: 'female', engine: 'Neural voice (offline)' })
    render(<Classroom onTurn={() => {}} />)
    expect(await screen.findByText('Female voice')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: "Priya's avatar" })).toHaveAttribute('data-avatar', 'female')
  })

  it('explains why a page cannot be spoken', async () => {
    svc.voice.mockResolvedValue(RAJU)
    svc.audio.mockRejectedValueOnce(new Error('This page is not in English.'))
    render(<Classroom onTurn={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Explain page/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This page is not in English.')
  })
})
