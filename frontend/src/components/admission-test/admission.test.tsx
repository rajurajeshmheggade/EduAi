import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import axios from 'axios'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/auth/AuthContext'
import { ExamLockGate } from '@/components/exam/ExamLockGate'
import { EXAM_LOCK_KEY } from '@/lib/proctor/examLock'
import AdmissionReport from '@/pages/admissions/AdmissionReport'
import { admissionTestService } from '@/services/admissionTestService'
import { tokenStore } from '@/services/apiClient'
import { LaunchTab } from './LaunchTab'
import { REPORT } from './reportFixture'

vi.mock('@/services/admissionTestService', async (orig) => {
  const real = await orig<typeof import('@/services/admissionTestService')>()
  return { ...real, admissionTestService: { launch: vi.fn(), report: vi.fn(), regenerate: vi.fn() } }
})
vi.mock('@/lib/proctor/browserGate', () => ({ browserGate: () => null }))
const svc = vi.mocked(admissionTestService)

const TEST = { test_id: 't1', title: 'Class 6 admission', grade_applying: 'Class 6', status: 'PUBLISHED' } as never
const CAND = { candidate_id: 'c1', full_name: 'Aarav Menon', grade_applying: 'Class 6', minor: true, age: 11, guardian_name: 'L Menon', accommodations: {}, sessions: [] } as never

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(4))))
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Launch', () => {
  it('goes full screen, hands the device to the exam and leaves no teacher token behind', async () => {
    tokenStore.set('teacher-access', 'teacher-refresh')
    const fs = vi.fn(() => Promise.resolve())
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: fs, configurable: true })
    const heard: unknown[] = []
    const other = new BroadcastChannel('eduai-auth')
    other.onmessage = (e) => heard.push(e.data)
    svc.launch.mockResolvedValue({ session_id: 's1', exam_token: 'tok-123', expires_at: '', candidate_name: 'Aarav Menon' })

    render(<AuthProvider><MemoryRouter initialEntries={['/teacher/admissions?tab=launch']}><Routes>
      <Route path="/teacher/admissions" element={<LaunchTab tests={[TEST]} candidates={[CAND]} />} />
      <Route path="/admission/exam/:id" element={<p>EXAM VIEW</p>} />
    </Routes></MemoryRouter></AuthProvider>)

    fireEvent.change(screen.getByLabelText('Candidate'), { target: { value: 'c1' } })
    expect(screen.getByRole('button', { name: /Launch exam/ })).toBeDisabled()          // minor: guardian consent first
    fireEvent.change(screen.getByLabelText('Guardian name'), { target: { value: 'Lakshmi Menon' } })
    fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'Mother' } })
    fireEvent.click(screen.getByRole('button', { name: /Launch exam/ }))
    expect(fs).toHaveBeenCalledWith({ navigationUI: 'hide' })                             // inside the click

    expect(await screen.findByText('EXAM VIEW')).toBeInTheDocument()
    expect(svc.launch.mock.calls[0][0]).toMatchObject({ test_id: 't1', candidate_id: 'c1', guardian_consent: { guardian_name: 'Lakshmi Menon', method: 'in_person' } })
    expect(sessionStorage.getItem('eduai.exam.token')).toBe('tok-123')
    expect(tokenStore.access).toBeNull()
    expect(tokenStore.refresh).toBeNull()
    expect(Object.keys(localStorage).filter((k) => k.includes('access') || k.includes('refresh'))).toEqual([])
    expect(JSON.parse(localStorage.getItem(EXAM_LOCK_KEY)!).session_id).toBe('s1')
    await waitFor(() => expect(heard).toContainEqual({ type: 'logout' }))
    other.close()
  })
})

describe('ExamLockGate', () => {
  it('replaces portal pages while an exam runs and tells the exam tab; the exam route still renders', async () => {
    localStorage.setItem(EXAM_LOCK_KEY, JSON.stringify({ session_id: 's1', at: Date.now() }))
    const heard: unknown[] = []
    const exam = new BroadcastChannel('eduai-exam')
    exam.onmessage = (e) => heard.push(e.data)
    const { unmount } = render(<AuthProvider><MemoryRouter initialEntries={['/teacher/dashboard']}><ExamLockGate><p>PORTAL</p></ExamLockGate></MemoryRouter></AuthProvider>)
    expect(screen.getByTestId('exam-in-progress')).toBeInTheDocument()
    expect(screen.queryByText('PORTAL')).not.toBeInTheDocument()
    await waitFor(() => expect(heard).toContainEqual({ type: 'portal-access', path: '/teacher/dashboard' }))
    unmount()
    render(<AuthProvider><MemoryRouter initialEntries={['/admission/exam/s1']}><ExamLockGate><p>EXAM ONLY</p></ExamLockGate></MemoryRouter></AuthProvider>)
    expect(screen.getByText('EXAM ONLY')).toBeInTheDocument()
    exam.close()
  })

  it('recovers from a stuck lock: signing in as the teacher unlocks this device even without the exam tab', async () => {
    localStorage.setItem(EXAM_LOCK_KEY, JSON.stringify({ session_id: 's1', at: Date.now() }))
    // AuthContext.login calls axios.post directly (not the shared `api` client).
    const login = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'tok-a', refresh_token: 'tok-r', user: { role: 'teacher', home_route: '/teacher/dashboard', allowed_subjects: [] } },
    })
    render(<AuthProvider><MemoryRouter initialEntries={['/teacher/dashboard']}><ExamLockGate><p>PORTAL</p></ExamLockGate></MemoryRouter></AuthProvider>)
    expect(screen.getByTestId('exam-in-progress')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'teacher@demo.edu' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Passw0rd!' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in and unlock/ }))
    expect(await screen.findByText('PORTAL')).toBeInTheDocument()
    expect(localStorage.getItem(EXAM_LOCK_KEY)).toBeNull()
    login.mockRestore()
  })
})

describe('AdmissionReport', () => {
  it('renders every section from the cached report JSON', async () => {
    svc.report.mockResolvedValue({ status: 'READY', error: null, generated_at: '', version: 1, report: REPORT, photo_url: null,
      evidence_urls: { 11: 'https://example.org/e.jpg' }, url_minutes: 5 })
    await act(async () => {
      render(<AuthProvider><MemoryRouter initialEntries={['/teacher/admissions/reports/s1']}><Routes>
        <Route path="/teacher/admissions/reports/:sessionId" element={<AdmissionReport />} /></Routes></MemoryRouter></AuthProvider>)
    })
    expect(await screen.findByRole('heading', { name: 'Admission Assessment Report' })).toBeInTheDocument()
    for (const s of ['Executive summary', 'Academic performance', 'Human Quotient (HQ) profile', 'Proctoring and integrity', 'Question-wise review', 'Methodology and disclaimer']) {
      expect(screen.getByRole('region', { name: s })).toBeInTheDocument()
    }
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /HQ profile: IQ 70, EQ 80/ })).toBeInTheDocument()
    expect(screen.getByText('Phone in view')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Evidence: Phone in view at 2:05/ })).toBeInTheDocument()
    expect(screen.getByText(/integrity = max\(0/)).toBeInTheDocument()
  })
})
