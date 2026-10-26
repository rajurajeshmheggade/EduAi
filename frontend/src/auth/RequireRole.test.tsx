import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireRole } from './RequireRole'
import type { UserProfile } from '@/types'

let mockState: { user: UserProfile | null; loading: boolean } = { user: null, loading: false }
vi.mock('./AuthContext', () => ({ useAuth: () => mockState }))

const user = (role: UserProfile['role'], home: string): UserProfile => ({
  user_id: '1', user_code: 'U', full_name: 'Test', email: 't@x', role, org_code: 'O', org_name: 'Org',
  institution_level: 'school', standalone_mode: false, year_code: null, cycle_code: null, class_code: null,
  allowed_subjects: [], home_route: home,
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/teacher/dashboard" element={<div>teacher home</div>} />
        <Route path="/student/dashboard" element={<div>student home</div>} />
        <Route element={<RequireRole roles={['teacher']} />}>
          <Route path="/teacher/secret" element={<div>teacher secret</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireRole', () => {
  beforeEach(() => { mockState = { user: null, loading: false } })

  it('redirects unauthenticated users to /login', () => {
    renderAt('/teacher/secret')
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('renders the route for an allowed role', () => {
    mockState = { user: user('teacher', '/teacher/dashboard'), loading: false }
    renderAt('/teacher/secret')
    expect(screen.getByText('teacher secret')).toBeInTheDocument()
  })

  it('sends a wrong-role user to their own home', () => {
    mockState = { user: user('student', '/student/dashboard'), loading: false }
    renderAt('/teacher/secret')
    expect(screen.getByText('student home')).toBeInTheDocument()
  })

  it('shows a spinner while the session is rehydrating', () => {
    mockState = { user: null, loading: true }
    renderAt('/teacher/secret')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
