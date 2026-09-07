import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useProfile } from '../hooks/useProfile'
import { supabase } from '../lib/supabase'
import { isProductionEnvironment } from '../lib/environment'

function AppLayout() {
  const { user } = useAuth()
  const location = useLocation()
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [openContext, setOpenContext] = useState<string | null>(null)
  const menuContext = `${location.key}:${user?.id ?? 'guest'}`
  const isMenuOpen = openContext === menuContext

  useLayoutEffect(() => {
    if (!isMenuOpen) return
    const positionPanel = () => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!trigger || !panel) return
      const rect = trigger.getBoundingClientRect()
      const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 96))
      panel.style.top = `${top}px`
      panel.style.right = `${Math.max(16, window.innerWidth - rect.right)}px`
      panel.style.maxHeight = `${Math.max(0, window.innerHeight - top - 16)}px`
    }
    positionPanel()
    const observer = new ResizeObserver(positionPanel)
    if (menuRef.current?.parentElement) observer.observe(menuRef.current.parentElement)
    window.addEventListener('resize', positionPanel)
    window.addEventListener('scroll', positionPanel)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', positionPanel)
      window.removeEventListener('scroll', positionPanel)
    }
  }, [isMenuOpen])

  useEffect(() => {
    if (!isMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setOpenContext(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpenContext(null)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isMenuOpen])
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
      <header
        className="app-header"
        data-environment={isProductionEnvironment ? undefined : 'staging'}
      >
        <div className="app-header-inner">
          <span className="app-brand">
            Necronomicon as a Service
            {!isProductionEnvironment && (
              <span className="app-environment-badge">TESTSYSTEM</span>
            )}
          </span>
          <div className="app-header-actions">
            {user && profile?.id === user.id && profile.username && (
              <p className="app-account-identity" title={`Beschworen als: ${profile.username}`}>
                <span className="app-account-label">Beschworen als: </span>
                <strong>{profile.username}</strong>
              </p>
            )}
            <div className="app-menu" ref={menuRef}>
              <button
                className="app-menu-trigger"
                ref={triggerRef}
                type="button"
                aria-expanded={isMenuOpen}
                aria-controls={menuId}
                onClick={() => setOpenContext(isMenuOpen ? null : menuContext)}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                  <path d="M2 4h14M2 9h14M2 14h14" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                Menü
              </button>
              <div className="app-menu-panel" ref={panelRef} id={menuId} hidden={!isMenuOpen}>
                <nav className="app-nav" aria-label="App-Navigation">
                  {(user ? [
                    ['/app', 'Übersicht'],
                    ['/app/rounds', 'Meine Runden'],
                    ['/app/characters', 'Charaktere'],
                    ['/app/profile', 'Profil'],
                  ] : [
                    ['/login', 'Einloggen'],
                    ['/register', 'Registrieren'],
                  ]).map(([to, label]) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/app'}
                      className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
                      onClick={() => setOpenContext(null)}
                    >
                      {label}
                    </NavLink>
                  ))}
                </nav>
                {user && (
                  <div className="app-account-controls">
                    <button
                      className="app-logout"
                      type="button"
                      onClick={handleLogout}
                      disabled={isSigningOut}
                    >
                      {isSigningOut ? 'Ausloggen...' : 'Ausloggen'}
                    </button>
                  </div>
                )}
              </div>
            </div>
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
