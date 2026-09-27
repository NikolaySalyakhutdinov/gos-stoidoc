import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../store/AuthStore'

export default function RequireAuth({ children }) {
  const { isAuthenticated, authLoading } = useAuth()
  const location = useLocation()

  if (authLoading) return null

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}
