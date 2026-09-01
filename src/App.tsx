import { Route, Routes } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import AdminPage from './pages/AdminPage'
import AdminRoundDetailsPage from './pages/AdminRoundDetailsPage'
import CharacterPage from './pages/CharacterPage'
import CharactersPage from './pages/CharactersPage'
import CreateCharacterPage from './pages/CreateCharacterPage'
import CreatePreparedCharacterPage from './pages/CreatePreparedCharacterPage'
import DashboardPage from './pages/DashboardPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import ProfilePage from './pages/ProfilePage'
import RegisterPage from './pages/RegisterPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import RoundDetailsPage from './pages/RoundDetailsPage'
import RoundsPage from './pages/RoundsPage'
import GuestOnly from './routes/GuestOnly'
import RequireAdmin from './routes/RequireAdmin'
import RequireAuth from './routes/RequireAuth'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/forgot-password"
          element={<ForgotPasswordPage />}
        />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="characters" element={<CharactersPage />} />
          <Route path="characters/new" element={<CreateCharacterPage />} />
          <Route path="characters/:characterId" element={<CharacterPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="rounds" element={<RoundsPage />} />
          <Route
            path="rounds/:roundId/characters/new"
            element={<CreatePreparedCharacterPage />}
          />
          <Route path="rounds/:roundId" element={<RoundDetailsPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="admin" element={<AdminPage />} />
            <Route
              path="admin/rounds/:roundId"
              element={<AdminRoundDetailsPage />}
            />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
