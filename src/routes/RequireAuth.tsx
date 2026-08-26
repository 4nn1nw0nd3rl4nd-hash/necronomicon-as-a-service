import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AuthLoadingScreen from '../components/AuthLoadingScreen'

function RequireAuth() {
  const { session, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <AuthLoadingScreen />
  }

  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location }}
      />
    )
  }

  return <Outlet />
}

export default RequireAuth
