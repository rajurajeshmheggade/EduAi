import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { PageLoader } from '@/components/ui/loading'
import { examLock } from '@/lib/proctor/examLock'
import { useAuth } from './AuthContext'
import type { Role } from '@/types'

export function FullPageSpinner() {
  return <PageLoader message="Loading EduAI…" className="h-full" />
}

/** Role-guarded route wrapper (FR-AUTH-03). Unauthenticated -> /login; wrong role -> own home. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <FullPageSpinner />
  // While an admission exam holds this device, portal pages render nothing (ExamLockGate shows the lock screen);
  // redirecting to /login here would also race Launch's navigation into the exam.
  if (!user) return examLock() ? null : <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!roles.includes(user.role)) return <Navigate to={user.home_route} replace />
  return <Outlet />
}

export function HomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  return <Navigate to={user ? user.home_route : '/login'} replace />
}
