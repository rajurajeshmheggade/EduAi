import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserProfile } from '@/types'

const h = vi.hoisted(() => ({ user: null as UserProfile | null }))

vi.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ user: h.user, loading: false, logout: vi.fn(), login: vi.fn(), refreshUser: vi.fn(), subject: null, setSubject: vi.fn() }),
}))
vi.mock('@/services/notificationService', () => ({
  notificationService: { list: vi.fn().mockResolvedValue({ notifications: [], unread: 0 }), markRead: vi.fn(), markAllRead: vi.fn() },
}))
vi.mock('@/services/copilotService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/copilotService')>()
  return { ...actual, copilotService: { status: vi.fn(), transcribe: vi.fn() } }
})

import { AppShell } from '@/components/AppShell'
import { CopilotDrawer } from '@/components/shell/CopilotDrawer'
import { speechLang } from '@/components/shell/copilot/useVoiceInput'
import { copilotService } from '@/services/copilotService'

const status = vi.mocked(copilotService.status)
const transcribe = vi.mocked(copilotService.transcribe)

function makeUser(role: UserProfile['role'], over: Partial<UserProfile> = {}): UserProfile {
  return {
    user_id: 'u1', user_code: role === 'teacher' ? 'EMP1001' : role === 'student' ? 'REG2026001' : 'ADM1', full_name: 'Priya Teacher',
    email: `${role}@demo.edu`, role, org_code: 'DEMO', org_name: 'Demo School', institution_level: 'school', standalone_mode: false,
    year_code: null, cycle_code: null, class_code: null, allowed_subjects: [], home_route: '/', ...over,
  }
}

function setViewport(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const flush = () => act(async () => {})

async function renderShell() {
  const r = render(
    <MemoryRouter initialEntries={['/teacher/dashboard']}>
      <Routes><Route element={<AppShell />}><Route path="*" element={<p>Page content</p>} /></Route></Routes>
    </MemoryRouter>,
  )
  await flush() // notification count + Copilot status requests settle
  return r
}

async function renderPanel() {
  const r = render(<CopilotDrawer open onClose={() => {}} docked />)
  await flush()
  return r
}

const panel = () => document.getElementById('copilot-panel') as HTMLElement
const offset = () => document.documentElement.style.getPropertyValue('--copilot-offset')

/** A fetch stub that answers each Copilot question with one SSE stream. */
function sseFetch(answer: string, suggestions: string[]) {
  const sse = `event: token\ndata: ${JSON.stringify({ text: answer })}\n\nevent: done\ndata: {}\n\n`
    + `event: suggestions\ndata: ${JSON.stringify({ items: suggestions })}\n\n`
  const encoder = new TextEncoder()
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    body: { getReader: () => { let sent = false; return { read: async () => { if (sent) return { done: true, value: undefined }; sent = true; return { done: false, value: encoder.encode(sse) } } } } },
  }))
}

beforeEach(() => {
  localStorage.clear()
  h.user = makeUser('teacher')
  status.mockResolvedValue({ mode: 'mock', ai_ready: false, voice_transcription: false })
  setViewport(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  const w = window as unknown as Record<string, unknown>
  delete w.SpeechRecognition
  delete w.webkitSpeechRecognition
})

describe('Copilot docked layout (AppShell)', () => {
  it('docks below the header beside the page on wide screens: the page column shrinks, nothing is covered', async () => {
    await renderShell()
    expect(panel()).toHaveAttribute('data-mode', 'docked')
    expect(panel()).toHaveAttribute('aria-hidden', 'true')
    expect(panel().style.width).toBe('0px')
    expect(offset()).toBe('0px')

    fireEvent.click(screen.getByRole('button', { name: 'Copilot' }))
    await flush()
    expect(screen.getByRole('button', { name: 'Copilot' })).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).toHaveAttribute('aria-hidden', 'false')
    expect(panel().style.width).toBe('384px')
    expect(panel().className).not.toMatch(/\bfixed\b/)
    // Same flex row as the page column (which is flex-1 / min-w-0, so it gives up the panel's width) — and the
    // header is outside that row, so the panel never covers it.
    const main = screen.getByRole('main')
    const row = panel().parentElement!
    expect(row).toContainElement(main)
    expect(main.closest('div.flex-1')).toHaveClass('min-w-0')
    expect(row).not.toContainElement(screen.getByRole('banner'))
    expect(offset()).toBe('384px') // floating widgets / toasts move left of the panel
    expect(screen.getByText('Page content')).toBeVisible()
    await waitFor(() => expect(status).toHaveBeenCalled())
  })

  it('remembers open/closed per user and restores it docked', async () => {
    const first = await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Copilot' }))
    await flush()
    expect(JSON.parse(localStorage.getItem('eduai.copilot.EMP1001')!)).toMatchObject({ open: true })
    first.unmount()
    await renderShell()
    expect(panel()).toHaveAttribute('aria-hidden', 'false')
    expect(localStorage.getItem('eduai.copilot.REG2026001')).toBeNull() // another user's preference is separate
  })

  it('opens over the content on narrow screens (and never auto-opens there)', async () => {
    localStorage.setItem('eduai.copilot.EMP1001', JSON.stringify({ open: true, width: 400 }))
    setViewport(false)
    await renderShell()
    expect(panel()).toHaveAttribute('data-mode', 'overlay')
    expect(panel()).toHaveAttribute('aria-hidden', 'true') // remembered "open" is not restored as an overlay
    fireEvent.click(screen.getByRole('button', { name: 'Copilot' }))
    await flush()
    expect(panel()).toHaveClass('fixed', 'top-16', 'translate-x-0')
    expect(offset()).toBe('0px')
  })

  it('is resizable from its left edge with the keyboard, and stores the width', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Copilot' }))
    await flush()
    const handle = screen.getByRole('separator', { name: 'Resize Copilot panel' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(panel().style.width).toBe('400px')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(panel().style.width).toBe('320px')
    expect(JSON.parse(localStorage.getItem('eduai.copilot.EMP1001')!)).toEqual({ open: true, width: 320 })
  })
})

describe('Copilot keyboard shortcut', () => {
  it('Ctrl/⌘ + J toggles Copilot anywhere; other combos do not', async () => {
    await renderShell()
    expect(screen.getByRole('button', { name: 'Copilot' })).toHaveAttribute('aria-keyshortcuts', 'Control+J Meta+J')
    expect(screen.getByRole('button', { name: 'Copilot' })).toHaveAttribute('title', 'Open Copilot (Ctrl J)')
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    await flush()
    expect(panel()).toHaveAttribute('aria-hidden', 'false')
    expect(screen.getByRole('textbox', { name: 'Ask Copilot' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'J', metaKey: true })
    expect(panel()).toHaveAttribute('aria-hidden', 'true')
    fireEvent.keyDown(window, { key: 'J', ctrlKey: true, shiftKey: true }) // browser devtools: left alone
    fireEvent.keyDown(window, { key: 'j' })
    expect(panel()).toHaveAttribute('aria-hidden', 'true')
  })

  it('is listed in the command palette with its shortcut', async () => {
    await renderShell()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const option = screen.getByRole('option', { name: /Open Copilot/ })
    expect(within(option).getByText('Ctrl J')).toBeInTheDocument()
    fireEvent.click(option)
    await flush()
    expect(panel()).toHaveAttribute('aria-hidden', 'false')
  })

  it('does nothing for roles without Copilot', async () => {
    h.user = makeUser('parent')
    await renderShell()
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    expect(panel()).toBeNull()
  })

  it('Escape inside the panel closes it and returns focus to the header button', async () => {
    await renderShell()
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true })
    await flush()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask Copilot' }), { key: 'Escape' })
    expect(panel()).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Copilot' })).toHaveFocus()
  })
})

describe('Copilot offline note', () => {
  it('shows a small note with the .env hint for admins when the AI key is missing', async () => {
    h.user = makeUser('orgadmin')
    await renderPanel()
    expect(await screen.findByRole('note')).toHaveTextContent('Offline demo answers — add the AI key in .env to get full answers.')
  })

  it('words it for teachers and students without the .env instruction', async () => {
    await renderPanel()
    expect(await screen.findByRole('note')).toHaveTextContent(/Offline demo answers — full AI answers turn on/)
    expect(screen.getByRole('note')).not.toHaveTextContent('.env')
  })

  it('is absent when a live provider is configured', async () => {
    status.mockResolvedValue({ mode: 'azure', ai_ready: true, voice_transcription: true })
    await renderPanel()
    await waitFor(() => expect(status).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('Copilot follow-up suggestions', () => {
  it('renders the suggestion chips after an answer and asks one when clicked', async () => {
    const fetch = sseFetch('You have 3 periods today.', ['Which of today\'s periods still need attendance?', 'What homework is waiting for my review?'])
    vi.stubGlobal('fetch', fetch)
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'What periods do I have today?' }))
    expect(await screen.findByText('You have 3 periods today.')).toBeInTheDocument()
    const group = await screen.findByRole('group', { name: 'Suggested follow-up questions' })
    const chips = within(group).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(["Which of today's periods still need attendance?", 'What homework is waiting for my review?'])
    fireEvent.click(chips[1])
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ query: 'What homework is waiting for my review?', stream: true })
    expect(await screen.findAllByText('You have 3 periods today.')).toHaveLength(2)
    // only the latest answer carries chips
    expect(screen.getAllByRole('group', { name: 'Suggested follow-up questions' })).toHaveLength(1)
  })

  it('offers teacher, student and staff examples, including asking for suggestions', async () => {
    const { unmount } = await renderPanel()
    expect(screen.getByRole('button', { name: "Which of today's periods still need attendance?" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What should I focus on this week?' })).toBeInTheDocument()
    unmount()
    h.user = makeUser('student')
    await renderPanel()
    expect(screen.getByRole('button', { name: 'Suggest how I can improve this week' })).toBeInTheDocument()
  })
})

// ── voice input
class FakeRecognizer {
  static last: FakeRecognizer | null = null
  lang = ''
  continuous = true
  interimResults = false
  onstart: (() => void) | null = null
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
  constructor() { FakeRecognizer.last = this }
}
const result = (transcript: string, isFinal: boolean) => Object.assign([{ transcript }], { isFinal })

class FakeMediaRecorder {
  static last: FakeMediaRecorder | null = null
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  stream: unknown
  constructor(stream: unknown) { this.stream = stream; FakeMediaRecorder.last = this }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) }); this.onstop?.() }
}

function installMic(getUserMedia: () => Promise<unknown>) {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(getUserMedia) } })
}

describe('Copilot voice input: browser speech recognition', () => {
  beforeEach(() => { (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognizer })

  it('dictates live into the box (interim results) for review, without sending', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await renderPanel()
    const box = screen.getByRole('textbox', { name: 'Ask Copilot' })
    fireEvent.change(box, { target: { value: 'Hey' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    const rec = FakeRecognizer.last!
    expect(rec.start).toHaveBeenCalled()
    expect(rec.interimResults).toBe(true)
    expect(rec.continuous).toBe(false) // stops by itself on silence
    expect(rec.lang).toBe(speechLang('en'))
    expect(screen.getByRole('button', { name: 'Stop voice input' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Listening')
    act(() => rec.onresult!({ results: [result('which periods', false)] }))
    expect(box).toHaveValue('Hey which periods')
    act(() => rec.onresult!({ results: [result('which periods need attendance', true)] }))
    expect(box).toHaveValue('Hey which periods need attendance')
    act(() => rec.onend!())
    expect(screen.getByRole('button', { name: 'Ask by voice' })).toHaveAttribute('aria-pressed', 'false')
    expect(box).toHaveValue('Hey which periods need attendance')
    expect(box).toHaveFocus()
    expect(fetch).not.toHaveBeenCalled() // the user reviews, then sends
  })

  it('a second click stops listening', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice input' }))
    expect(FakeRecognizer.last!.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Ask by voice' })).toBeInTheDocument()
  })

  it('sending mid-dictation stops listening without refilling the box or sending twice', async () => {
    const fetch = sseFetch('Done.', ['A?', 'B?'])
    vi.stubGlobal('fetch', fetch)
    await renderPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: /Send voice questions automatically/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    const rec = FakeRecognizer.last!
    rec.abort.mockImplementation(() => rec.onend?.())
    act(() => rec.onresult!({ results: [result('what homework is waiting', true)] }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(rec.abort).toHaveBeenCalled()
    act(() => rec.onresult?.({ results: [result('late words', true)] }))
    await screen.findByText('Done.')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body).query).toBe('what homework is waiting')
    expect(screen.getByRole('textbox', { name: 'Ask Copilot' })).toHaveValue('')
  })

  it('explains a blocked microphone', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    act(() => { FakeRecognizer.last!.onerror!({ error: 'not-allowed' }); FakeRecognizer.last!.onend!() })
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access is blocked')
  })

  it('auto-sends after speaking when that setting is on', async () => {
    const fetch = sseFetch('Done.', ['A?', 'B?'])
    vi.stubGlobal('fetch', fetch)
    await renderPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: /Send voice questions automatically/ }))
    expect(localStorage.getItem('eduai.copilot.autosend')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    const rec = FakeRecognizer.last!
    act(() => { rec.onresult!({ results: [result('what periods do I have today', true)] }); rec.onend!() })
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(JSON.parse(fetch.mock.calls[0][1].body).query).toBe('what periods do I have today')
  })

  it('dictates in the UI language when it is an Indian-language UI', async () => {
    expect(speechLang('hi')).toBe('hi-IN')
    expect(speechLang('ta')).toBe('ta-IN')
    expect(speechLang('en')).toMatch(/^en/)
  })
})

describe('Copilot voice input: recorded voice message fallback (no speech recognition)', () => {
  it('records, shows a recording indicator, and puts the server transcript in the box', async () => {
    status.mockResolvedValue({ mode: 'azure', ai_ready: true, voice_transcription: true })
    transcribe.mockResolvedValue('how many scripts are waiting')
    installMic(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))
    await renderPanel()
    await waitFor(() => expect(status).toHaveBeenCalled())
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    expect(await screen.findByText(/Recording 0:00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop voice input' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice input' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ask Copilot' })).toHaveValue('how many scripts are waiting'))
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob))
    expect(screen.getByRole('button', { name: 'Ask by voice' })).toBeEnabled()
  })

  it('explains a denied microphone permission', async () => {
    status.mockResolvedValue({ mode: 'azure', ai_ready: true, voice_transcription: true })
    installMic(async () => { throw new DOMException('denied', 'NotAllowedError') })
    await renderPanel()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access is blocked')
  })

  it('explains a missing microphone', async () => {
    status.mockResolvedValue({ mode: 'azure', ai_ready: true, voice_transcription: true })
    installMic(async () => { throw new DOMException('none', 'NotFoundError') })
    await renderPanel()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No microphone was found')
  })

  it('in offline demo mode says voice messages need the AI key, without opening the mic', async () => {
    const getUserMedia = vi.fn()
    installMic(getUserMedia)
    await renderPanel()
    await screen.findByRole('note')
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/need the AI key/)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('shows the server transcription error in a friendly way', async () => {
    status.mockResolvedValue({ mode: 'azure', ai_ready: true, voice_transcription: true })
    transcribe.mockRejectedValue(new Error('Voice messages need the AI key — offline demo mode. Please type your question.'))
    installMic(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))
    await renderPanel()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Ask by voice' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop voice input' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please type your question')
  })
})
