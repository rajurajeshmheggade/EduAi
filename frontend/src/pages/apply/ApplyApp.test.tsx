import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me, PublicInfo } from '@/services/applyService'
import ApplyApp from './ApplyApp'

const SLUG = 'demo-international-school-admissions-a1b2c3'
const INFO: PublicInfo = {
  school: { name: 'Demo International School', accent: '#0f766e', logo_url: null },
  form: { title: 'Admissions 2027–28', description: 'Classes 6 to 8', academic_year: '2027-28', grades: [{ value: 7, label: 'Class 7' }],
    instructions: 'Keep the birth certificate ready.', opens_at: null, closes_at: null, state: 'open', has_test: false,
    documents: [{ label: 'Birth certificate', required: true }] },
}
const ME: Me = {
  application: { status: 'draft', status_label: 'Draft', reference_no: null, answers: { student_name: 'Riya' }, last_saved_at: null, submitted_at: null,
    editable: true, submission_count: 0 },
  form: { title: 'Admissions 2027–28', version: 1, grades: [{ value: 7, label: 'Class 7' }], closes_at: null, has_test: false, definition: {
    instructions: '', declaration: 'I confirm.', documents: [{ key: 'birth_certificate', label: 'Birth certificate', required: true, accept: ['pdf'], max_mb: 5, max_files: 1 }],
    sections: [{ key: 'student', title: 'Student information', kind: 'student', fields: [
      { key: 'student_name', label: "Student's full name", type: 'text', core: 'student_name' },
      { key: 'date_of_birth', label: 'Date of birth', type: 'date', core: 'date_of_birth' },
      { key: 'grade_applying', label: 'Class applying for', type: 'grade', core: 'grade_applying' }] }] } },
  documents: [], corrections: [], credential: { username: 'DEMO-K7QX3P9M', expires_at: '2026-12-01T10:00:00Z' }, consent: null, test: null,
}

const login = vi.fn()
const saveAnswers = vi.fn()
vi.mock('@/services/applyService', async (orig) => {
  const actual = await orig<typeof import('@/services/applyService')>()
  return {
    ...actual,
    applyService: {
      info: vi.fn(async () => INFO),
      login: (...a: unknown[]) => login(...a),
      me: vi.fn(async () => ME),
      saveAnswers: (...a: unknown[]) => saveAnswers(...a),
      logout: vi.fn(async () => { actual.applyStore.clear() }),
    },
  }
})

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path="/apply/:slug/*" element={<ApplyApp />} /></Routes></MemoryRouter>)

describe('standalone admission application', () => {
  beforeEach(() => {
    sessionStorage.clear()
    login.mockReset().mockImplementation(async (slug: string) => {
      sessionStorage.setItem('eduai.apply.slug', slug); sessionStorage.setItem('eduai.apply.access', 'a'); sessionStorage.setItem('eduai.apply.refresh', 'r')
      return {}
    })
    saveAnswers.mockReset().mockResolvedValue({ saved_at: '2026-11-02T10:00:00Z', answers: {} })
  })

  it('has its own branded shell, sign-in, recovery and tracking links — no LMS chrome', async () => {
    const { container } = renderAt(`/apply/${SLUG}`)
    expect(await screen.findByRole('heading', { name: 'Admissions 2027–28' })).toBeInTheDocument()
    const header = screen.getByRole('banner')
    expect(within(header).getByText('Demo International School')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Demo International School · Admissions')
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', `/apply/${SLUG}/forgot`)
    expect(screen.getAllByRole('link', { name: 'Track application' })[0]).toHaveAttribute('href', `/apply/${SLUG}/track`)
    expect(screen.queryByText(/Teach · Learn · Grow/)).toBeNull()
    const root = container.querySelector('[lang="en"]') as HTMLElement
    expect(root.style.getPropertyValue('--color-brand-500')).toMatch(/^hsl\(/)
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeDisabled()
  })

  it('signs in with the one-time credential, keeps its own token storage and opens the dashboard', async () => {
    renderAt(`/apply/${SLUG}`)
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: '  demo-k7qx3p9m ' } })
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'Kq7m-X3pz-9WrT' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }))
    await waitFor(() => expect(login).toHaveBeenCalledWith(SLUG, 'demo-k7qx3p9m', 'Kq7m-X3pz-9WrT'))
    expect(await screen.findByRole('heading', { name: 'Your application' })).toBeInTheDocument()
    expect(screen.getByText('DEMO-K7QX3P9M')).toBeInTheDocument()
    expect(localStorage.getItem('eduai.access')).toBeNull()   // the LMS token store is never touched
    expect(screen.getByRole('link', { name: /Continue the application/ })).toHaveAttribute('href', `/apply/${SLUG}/form`)
  })

  it('walks the form step by step, flags missing answers and blocks submission until complete', async () => {
    sessionStorage.setItem('eduai.apply.slug', SLUG); sessionStorage.setItem('eduai.apply.access', 'a')
    renderAt(`/apply/${SLUG}/form`)
    expect(await screen.findByRole('heading', { name: 'Student information' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Student's full name/)).toHaveValue('Riya')
    fireEvent.change(screen.getByLabelText(/Date of birth/), { target: { value: '2014-05-21' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(saveAnswers).toHaveBeenCalledWith(SLUG, { student_name: 'Riya', date_of_birth: '2014-05-21' }))
    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(await screen.findByRole('heading', { name: 'Review & submit' })).toBeInTheDocument()
    expect(screen.getByText(/2 items still need attention/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('I confirm.'))
    expect(screen.getByRole('button', { name: /Submit application/ })).toBeDisabled()
  })
})
