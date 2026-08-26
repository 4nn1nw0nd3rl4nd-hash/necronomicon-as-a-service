import { NavLink, Outlet } from 'react-router-dom'

function AppLayout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <span className="app-brand">Necronomicon as a Service</span>
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
            <NavLink
              to="/app/admin"
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              Admin
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

export default AppLayout
