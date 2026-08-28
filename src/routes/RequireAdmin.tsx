import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useProfile } from '../hooks/useProfile'

function RequireAdmin() {
  const { user, isLoading: isAuthLoading } = useAuth()
  const {
    profile,
    isLoading: isProfileLoading,
    error,
    reload,
  } = useProfile(user?.id)

  if (isAuthLoading || isProfileLoading) {
    return (
      <div className="admin-access-status" role="status">
        <p>Adminzugang wird geprüft...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="admin-access-status">
        <p role="alert">
          Dein Profil konnte nicht geladen werden. Der Adminzugang kann
          deshalb gerade nicht geprüft werden.
        </p>
        <button type="button" onClick={reload}>
          Erneut versuchen
        </button>
      </div>
    )
  }

  const isAdmin =
    profile?.role === 'admin' || profile?.is_superadmin === true

  if (!isAdmin) {
    return <Navigate to="/app" replace />
  }

  return <Outlet />
}

export default RequireAdmin
