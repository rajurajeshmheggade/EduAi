import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import type { Role } from '@/types'

export function FullPageSpinner() {
  return (
    <div className="grid h-full place-items-center" role="status" aria-label="Loading">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
    </div>
  )
}

/** Role-guarded route wrapper (FR-AUTH-03). Unauthenticated -> /login; wrong role -> own home. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!roles.includes(user.role)) return <Navigate to={user.home_route} replace />
  return <Outlet />
}

export function HomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  return <Navigate to={user ? user.home_route : '/login'} replace />
}
