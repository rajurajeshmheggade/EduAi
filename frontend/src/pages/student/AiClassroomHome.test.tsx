import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { curriculumService } from '@/services/curriculumService'
import type { Textbook, UserProfile } from '@/types'
import AiClassroomHome from './AiClassroomHome'

const setSubject = vi.fn()
let auth: { user: UserProfile | null; subject: string | null; setSubject: typeof setSubject }
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/services/curriculumService', async (orig) => {
  const real = await orig<typeof import('@/services/curriculumService')>()
  return { ...real, curriculumService: { ...real.curriculumService, listTextbooks: vi.fn() } }
})
const svc = vi.mocked(curriculumService)

const student = (subjects: string[]): UserProfile => ({
  user_id: '1', user_code: 'S1', full_name: 'Asha Rao', email: 'a@x', role: 'student', org_code: 'O', org_name: 'Org',
  institution_level: 'school', standalone_mode: false, year_code: null, cycle_code: null, class_code: 'G10A',
  allowed_subjects: subjects, home_route: '/student/dashboard',
})
const book = (id: string, subject: string, title: string, chapters: [number, string, number][], over: Partial<Textbook> = {}): Textbook => ({
  textbook_id: id, subject_code: subject, title, total_pages: 200, vector_status: 'indexed', is_published_to_students: true,
  pdf_url: `/files/${id}.pdf`, created_at: '2026-10-01T00:00:00Z',
  chapters: chapters.map(([n, t, p]) => ({ chapter_number: n, chapter_title: t, first_page: p, last_page: p + 10, chunk_count: 5 })), ...over,
})

const LIBRARY: Record<string, Textbook[]> = {
  PHY: [book('phy-1', 'PHY', 'Physics Part 1', [[1, 'Motion', 1], [2, 'Force and Laws', 23]])],
  CHEM: [
    book('chem-1', 'CHEM', 'Chemistry Part 1', [[1, 'Matter', 1], [3, 'Atoms and Molecules', 41]]),
    book('chem-2', 'CHEM', 'Chemistry Lab Manual', []),
    book('chem-3', 'CHEM', 'Still indexing', [], { vector_status: 'processing' }),
  ],
  BIO: [],
}

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname}{loc.search}</p>
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/student/classroom']}>
      <Routes>
        <Route path="/student/classroom" element={<AiClassroomHome />} />
        <Route path="/student/classroom/textbook" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AI Classroom home', () => {
  beforeEach(() => {
    auth = { user: student(['PHY', 'CHEM', 'BIO']), subject: 'CHEM', setSubject }
    svc.listTextbooks.mockImplementation(async (s) => LIBRARY[s] ?? [])
  })
  afterEach(() => vi.clearAllMocks())

  it('has no class dropdown: only subjects with a textbook, then that subject’s chapters', async () => {
    renderHome()
    const subject = await screen.findByLabelText('Subject')
    expect(screen.queryByLabelText('Class')).not.toBeInTheDocument()
    // BIO has no textbook; the workspace subject (CHEM) is preselected
    expect(within(subject).getAllByRole('option').map((o) => o.textContent)).toEqual(['PHY', 'CHEM'])
    expect(subject).toHaveValue('CHEM')
    // several books: chapters grouped by book; a book without chapters offers page 1; unindexed books are left out
    const chapter = screen.getByLabelText('Chapter')
    const groups = within(chapter).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Chemistry Part 1', 'Chemistry Lab Manual'])
    expect(within(groups[1]).getByRole('option')).toHaveTextContent('Start from page 1')

    fireEvent.change(subject, { target: { value: 'PHY' } })
    expect(within(screen.getByLabelText('Chapter')).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['1. Motion · p. 1', '2. Force and Laws · p. 23'])
    expect(within(screen.getByLabelText('Chapter')).queryAllByRole('group')).toHaveLength(0)
  })

  it('explains how the avatar teaches, and OK opens the avatar classroom at the chapter’s first page', async () => {
    renderHome()
    fireEvent.change(await screen.findByLabelText('Chapter'), { target: { value: 'chem-1:3' } })
    expect(screen.getByText(/You start at/)).toHaveTextContent('You start at Chapter 3 · Atoms and Molecules (page 41) of Chemistry Part 1.')
    const how = screen.getByRole('region', { name: 'How your AI teacher will teach' })
    for (const text of [/Explains every page aloud/, /Highlights as it speaks/, /next page is already prepared/, /Ask in the chat/, /Word for word/, /A classroom session starts first/]) {
      expect(within(how).getByText(text)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(setSubject).toHaveBeenCalledWith('CHEM')
    expect(screen.getByTestId('where')).toHaveTextContent('/student/classroom/textbook?subject=CHEM&textbook=chem-1&page=41')
  })

  it('a textbook without detected chapters starts from page 1', async () => {
    renderHome()
    fireEvent.change(await screen.findByLabelText('Chapter'), { target: { value: 'chem-2:start' } })
    expect(screen.getByText(/Chapters weren't detected/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?subject=CHEM&textbook=chem-2&page=1')
  })

  it('tells the student when no textbook has been published', async () => {
    svc.listTextbooks.mockResolvedValue([])
    renderHome()
    expect(await screen.findByText('No textbooks yet')).toBeInTheDocument()
    expect(screen.getByText(/teacher hasn't published a textbook/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument()
  })

  it('shows the error with a retry that reloads', async () => {
    svc.listTextbooks.mockRejectedValueOnce(new Error('Network down'))
    renderHome()
    expect(await screen.findByText("Couldn't load your textbooks")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByLabelText('Subject')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('without subjects it says so and asks for nothing', () => {
    auth = { user: student([]), subject: null, setSubject }
    renderHome()
    expect(screen.getByText('No subjects assigned yet')).toBeInTheDocument()
    expect(svc.listTextbooks).not.toHaveBeenCalled()
  })
})
