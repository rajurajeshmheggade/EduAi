import { Navigate, useLocation, useParams } from 'react-router-dom'
import { EXPLORE_ROUTE } from '@/services/dikshaService'

/** Old catalogue reader URLs (`/library/diksha/:sourceId?…`) keep working: same item, same query string, new path. */
export default function LegacyLibraryRedirect() {
  const { sourceId = '' } = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={`${EXPLORE_ROUTE}/${encodeURIComponent(sourceId)}${search}${hash}`} replace />
}
