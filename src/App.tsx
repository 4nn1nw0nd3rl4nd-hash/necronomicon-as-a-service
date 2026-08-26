import { Route, Routes } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import AdminPage from './pages/AdminPage'
import DashboardPage from './pages/DashboardPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import ProfilePage from './pages/ProfilePage'
import RegisterPage from './pages/RegisterPage'
import RoundsPage from './pages/RoundsPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="rounds" element={<RoundsPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
