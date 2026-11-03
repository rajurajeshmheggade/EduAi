import { fireEvent, render, screen } from '@testing-library/react'
import { Home, KeyRound, Users } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { CommandPalette } from './CommandPalette'
import { CopilotDrawer } from './CopilotDrawer'

describe('CommandPalette', () => {
  const run = { home: vi.fn(), team: vi.fn(), pw: vi.fn() }
  const commands = [
    { id: 'home', label: 'Admissions home', hint: 'Admissions', icon: Home, run: run.home },
    { id: 'team', label: 'Admissions team', hint: 'Admissions', icon: Users, run: run.team },
    { id: 'pw', label: 'Change password', hint: 'Account', icon: KeyRound, run: run.pw },
  ]

  it('filters as you type and runs the highlighted command with Enter', () => {
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} commands={commands} />)
    const box = screen.getByRole('combobox', { name: 'Search pages and actions' })
    expect(screen.getAllByRole('option')).toHaveLength(3)
    fireEvent.change(box, { target: { value: 'admissions' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Admissions homeAdmissions', 'Admissions teamAdmissions'])
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(run.team).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('says when nothing matches', () => {
    render(<CommandPalette open onClose={() => {}} commands={commands} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })
    expect(screen.getByText('No matches.')).toBeInTheDocument()
  })
})

describe('CopilotDrawer', () => {
  it('is hidden when closed, focuses the question box when opened and closes with Escape', () => {
    const onClose = vi.fn()
    const { rerender } = render(<AuthProvider><CopilotDrawer open={false} onClose={onClose} /></AuthProvider>)
    expect(screen.getByLabelText('Copilot', { selector: 'aside' })).toHaveAttribute('aria-hidden', 'true')
    rerender(<AuthProvider><CopilotDrawer open onClose={onClose} /></AuthProvider>)
    expect(screen.getByRole('textbox', { name: 'Ask Copilot' })).toHaveFocus()
    expect(screen.getByText(/never sees a\s+child's name/)).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Ask Copilot' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('streams an answer when an example question is clicked', async () => {
    const encoder = new TextEncoder()
    const sse = 'event: token\ndata: {"text":"5 teachers."}\n\nevent: done\ndata: {}\n\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => { let sent = false; return { read: async () => { if (sent) return { done: true, value: undefined }; sent = true; return { done: false, value: encoder.encode(sse) } } } } },
    }))
    render(<AuthProvider><CopilotDrawer open onClose={() => {}} /></AuthProvider>)
    fireEvent.click(screen.getByRole('button', { name: /How many students and teachers/ }))
    expect(await screen.findByText('5 teachers.')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
