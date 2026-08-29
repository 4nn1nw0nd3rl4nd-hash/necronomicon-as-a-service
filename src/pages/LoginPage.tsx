import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getLoginErrorMessage } from '../lib/authErrors'
import { supabase } from '../lib/supabase'

function getDestination(state: unknown) {
  if (!state || typeof state !== 'object' || !('from' in state)) {
    return '/app'
  }

  const from = state.from

  if (!from || typeof from !== 'object' || !('pathname' in from)) {
    return '/app'
  }

  const pathname = from.pathname

  if (
    typeof pathname !== 'string' ||
    (pathname !== '/app' && !pathname.startsWith('/app/'))
  ) {
    return '/app'
  }

  const search =
    'search' in from && typeof from.search === 'string'
      ? from.search
      : ''
  const hash =
    'hash' in from && typeof from.hash === 'string' ? from.hash : ''

  return `${pathname}${search}${hash}`
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        setErrorMessage(getLoginErrorMessage(error))
        return
      }

      navigate(getDestination(location.state), { replace: true })
    } catch {
      setErrorMessage(getLoginErrorMessage())
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <h1 className="auth-title" id="login-title">
          Login
        </h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>E-Mail</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="auth-field">
            <span>Passwort</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button
            className="auth-submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Einloggen...' : 'Einloggen'}
          </button>
        </form>
        {errorMessage && (
          <p className="auth-error" role="alert">
            {errorMessage}
          </p>
        )}
        <Link className="auth-password-reset" to="/forgot-password">
          Passwort vergessen?
        </Link>
        <Link className="auth-alternate" to="/register">
          Noch kein Konto? Registrieren
        </Link>
      </section>
    </main>
  )
}

export default LoginPage
