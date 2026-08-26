import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AuthLoadingScreen from '../components/AuthLoadingScreen'

function GuestOnly() {
  const { session, isLoading } = useAuth()

  if (isLoading) {
    return <AuthLoadingScreen />
  }

  if (session) {
    return <Navigate to="/app" replace />
  }

  return <Outlet />
}

export default GuestOnly
