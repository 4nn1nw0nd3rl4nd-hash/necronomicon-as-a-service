import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useProfile } from '../hooks/useProfile'
import { supabase } from '../lib/supabase'

function AppLayout() {
  const { user } = useAuth()
  const { profile } = useProfile(user?.id)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const isAdmin =
    profile?.role === 'admin' || profile?.is_superadmin === true

  const handleLogout = async () => {
    setIsSigningOut(true)
    setLogoutError(null)

    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })

      if (error) {
        setLogoutError(
          'Abmelden fehlgeschlagen. Bitte versuche es erneut.',
        )
        setIsSigningOut(false)
      }
    } catch {
      setLogoutError(
        'Abmelden fehlgeschlagen. Bitte versuche es erneut.',
      )
      setIsSigningOut(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <span className="app-brand">Necronomicon as a Service</span>
          <div className="app-header-controls">
            <nav className="app-nav" aria-label="App-Navigation">
              <NavLink
                to="/app"
                end
                className={({ isActive }) =>
                  isActive ? 'nav-link active' : 'nav-link'
                }
              >
                Übersicht
              </NavLink>
              <NavLink
                to="/app/rounds"
                className={({ isActive }) =>
                  isActive ? 'nav-link active' : 'nav-link'
                }
              >
                Meine Runden
              </NavLink>
              <NavLink
                to="/app/profile"
                className={({ isActive }) =>
                  isActive ? 'nav-link active' : 'nav-link'
                }
              >
                Profil
              </NavLink>
            </nav>
            <button
              className="app-logout"
              type="button"
              onClick={handleLogout}
              disabled={isSigningOut}
            >
              {isSigningOut ? 'Ausloggen...' : 'Ausloggen'}
            </button>
          </div>
        </div>
        {logoutError && (
          <p className="app-logout-error" role="alert">
            {logoutError}
          </p>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      {isAdmin && (
        <footer className="app-footer">
          <Link className="app-admin-link" to="/app/admin">
            Adminbereich
          </Link>
        </footer>
      )}
    </div>
  )
}

export default AppLayout
