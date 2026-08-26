import { NavLink, Outlet } from 'react-router-dom'

function AppLayout() {
  return (
    <>
      <header>
        Necronomicon as a Service
        <nav>
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
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}

export default AppLayout
