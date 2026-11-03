/* eslint-disable react-refresh/only-export-components -- test helpers next to the harness component */
import { act, fireEvent, render } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { vi } from 'vitest'
import { StudyFlowProvider } from '@/components/study/StudyFlowProvider'
import { Toaster } from '@/components/ui/toast'
import type { UserProfile } from '@/types'

/** Test harness for the student study flow (floating Focus Timer + study-break cycle) inside a router. */

export const person = (role: UserProfile['role'], code = 'S1'): UserProfile => ({
  user_id: code, user_code: code, full_name: 'Asha Rao', email: 'a@x', role, org_code: 'O', org_name: 'Org',
  institution_level: 'school', standalone_mode: false, year_code: null, cycle_code: null, class_code: 'G10A',
  allowed_subjects: ['PHY'], home_route: `/${role}/dashboard`,
})

export const nav: { to: (path: string) => void } = { to: () => {} }

function Where() {
  const loc = useLocation()
  const navigate = useNavigate()
  useEffect(() => { nav.to = (path) => act(() => { void navigate(path) }) }, [navigate])
  return <p data-testid="where">{loc.pathname}{loc.search}</p>
}

export function renderStudyFlow(path: string, extra?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StudyFlowProvider>
        <Routes><Route path="*" element={<><Where />{extra}</>} /></Routes>
      </StudyFlowProvider>
      <Toaster />
    </MemoryRouter>,
  )
}

/** Fake clock for intervals, timeouts and Date. */
export function useFakeClock(at = new Date(2026, 10, 2, 10, 0)) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(at)
}

export const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

/** Minutes of active study: some input every minute while the clock runs. */
export function studyFor(minutes: number) {
  for (let i = 0; i < minutes; i++) {
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    advance(60_000)
  }
}
