import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

function GuestOnly() {
  const { session, isLoading } = useAuth()

  if (isLoading) {
    return <p>Session wird geprüft...</p>
  }

  if (session) {
    return <Navigate to="/app" replace />
  }

  return <Outlet />
}

export default GuestOnly
