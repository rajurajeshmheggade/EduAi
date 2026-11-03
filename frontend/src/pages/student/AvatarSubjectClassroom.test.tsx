import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { curriculumService } from '@/services/curriculumService'
import type { Textbook, UserProfile } from '@/types'
import AvatarSubjectClassroom from './AvatarSubjectClassroom'

const setSubject = vi.fn()
let auth: { user: UserProfile; subject: string | null; setSubject: typeof setSubject }
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/services/curriculumService', async (orig) => {
  const real = await orig<typeof import('@/services/curriculumService')>()
  return { ...real, curriculumService: { ...real.curriculumService, listTextbooks: vi.fn() } }
})
// Proctoring switched off: the gate only asks for the start click (the proctored flow is tested in components/proctoring).
vi.mock('@/services/proctoringService', async (orig) => {
  const real = await orig<typeof import('@/services/proctoringService')>()
  const { proctorConfig } = await import('@/test/proctoring')
  return { ...real, proctoringService: { ...real.proctoringService, config: vi.fn(async () => proctorConfig(false, 'AI_CLASSROOM')) } }
})
// The heavy panes are stand-ins that show what they were given.
vi.mock('@/components/pdf-avatar/SplitScreenPDFReader', () => ({
  SplitScreenPDFReader: ({ url, page }: { url: string; page: number }) => <p data-testid="pdf">{url} @ page {page}</p>,
}))
vi.mock('@/components/pdf-avatar/AvatarTutor', () => ({ AvatarTutor: ({ page }: { page: number }) => <p data-testid="tutor">tutor on page {page}</p> }))
vi.mock('@/components/rag-chat/K3RagChatPanel', () => ({ K3RagChatPanel: () => <p>chat</p> }))
const loadScript = vi.fn(async () => {})
vi.mock('@/components/pdf-avatar/useReadAloud', () => ({
  useReadAloud: () => ({
    whenVoice: async () => ({ voice: 'female' }), loadScript, preload: async () => {}, followPage: () => {},
    reading: false, page: 1, mode: 'explain', segment: null, text: null,
  }),
}))
const svc = vi.mocked(curriculumService)

const student: UserProfile = {
  user_id: '1', user_code: 'S1', full_name: 'Asha Rao', email: 'a@x', role: 'student', org_code: 'O', org_name: 'Org',
  institution_level: 'school', standalone_mode: false, year_code: null, cycle_code: null, class_code: 'G10A',
  allowed_subjects: ['PHY', 'CHEM'], home_route: '/student/dashboard',
}
const book = (id: string, subject: string, over: Partial<Textbook> = {}): Textbook => ({
  textbook_id: id, subject_code: subject, title: `Book ${id}`, total_pages: 120, vector_status: 'indexed', is_published_to_students: true,
  pdf_url: `/files/${id}.pdf`, chapters: [{ chapter_number: 3, chapter_title: 'Atoms', first_page: 41, last_page: 60, chunk_count: 4 }],
  created_at: '', ...over,
})

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.search}</p>
}

async function openAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/student/classroom/textbook" element={<><AvatarSubjectClassroom /><Where /></>} /></Routes>
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /Start classroom session/ }))
  return screen.findByTestId('pdf')
}

describe('AvatarSubjectClassroom — deep link', () => {
  beforeEach(() => {
    auth = { user: student, subject: 'PHY', setSubject }
    svc.listTextbooks.mockImplementation(async (s) => (s === 'CHEM' ? [book('c1', 'CHEM'), book('c2', 'CHEM')] : [book('p1', 'PHY')]))
  })
  afterEach(() => vi.clearAllMocks())

  it('opens the linked subject, book and page, and the workspace subject follows the link', async () => {
    const pdf = await openAt('/student/classroom/textbook?subject=CHEM&textbook=c2&page=41')
    expect(svc.listTextbooks).toHaveBeenCalledWith('CHEM')
    expect(pdf).toHaveTextContent('/files/c2.pdf @ page 41')
    expect(screen.getByTestId('tutor')).toHaveTextContent('tutor on page 41')
    expect(loadScript).toHaveBeenCalledWith(41)                    // the avatar prepares the chapter's first page
    expect(setSubject).toHaveBeenCalledWith('CHEM')
  })

  it('without a link: the workspace subject’s first book at page 1', async () => {
    const pdf = await openAt('/student/classroom/textbook')
    expect(svc.listTextbooks).toHaveBeenCalledWith('PHY')
    expect(pdf).toHaveTextContent('/files/p1.pdf @ page 1')
    expect(setSubject).not.toHaveBeenCalled()
  })

  it('a subject the student does not take is ignored', async () => {
    const pdf = await openAt('/student/classroom/textbook?subject=MATH&textbook=m1&page=9')
    expect(pdf).toHaveTextContent('/files/p1.pdf @ page 1')
  })

  it('picking another subject in the classroom drops the link', async () => {
    await openAt('/student/classroom/textbook?subject=CHEM&textbook=c2&page=41')
    auth = { ...auth, subject: 'CHEM' }
    fireEvent.change(screen.getAllByLabelText('Subject')[0], { target: { value: 'PHY' } })
    expect(setSubject).toHaveBeenLastCalledWith('PHY')
    expect(screen.getByTestId('where')).toBeEmptyDOMElement()
  })
})
