import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthError } from '@supabase/supabase-js'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function getRegistrationError(error: AuthError) {
  const message = error.message.toLowerCase()

  if (
    error.code === 'user_already_exists' ||
    error.code === 'email_exists' ||
    message.includes('already registered')
  ) {
    return 'Diese E-Mail-Adresse ist bereits registriert.'
  }

  if (
    error.code === 'weak_password' ||
    error.code === 'password_too_short' ||
    message.includes('password should be')
  ) {
    return 'Das Passwort erfüllt die Anforderungen nicht.'
  }

  if (
    message.includes('profiles_username_unique_ci') ||
    message.includes('duplicate key') ||
    message.includes('database error saving new user')
  ) {
    return 'Dieser Benutzername ist bereits vergeben.'
  }

  return 'Die Registrierung ist fehlgeschlagen. Bitte versuche es erneut.'
}

function RegisterPage() {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedUsername = username.trim()
    const normalizedDisplayName = displayName.trim()
    const normalizedEmail = email.trim()

    setErrorMessage(null)
    setSuccessMessage(null)

    if (
      !normalizedUsername ||
      !normalizedEmail ||
      !password.trim() ||
      !passwordConfirmation.trim()
    ) {
      setErrorMessage('Bitte fülle alle Pflichtfelder aus.')
      return
    }

    if (password !== passwordConfirmation) {
      setErrorMessage('Die Passwörter stimmen nicht überein.')
      return
    }

    if (password.length < 6) {
      setErrorMessage('Das Passwort erfüllt die Anforderungen nicht.')
      return
    }

    setIsSubmitting(true)

    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            username: normalizedUsername,
            display_name: normalizedDisplayName || null,
          },
        },
      })

      if (error) {
        setErrorMessage(getRegistrationError(error))
        return
      }

      if (data.session) {
        navigate('/app', { replace: true })
        return
      }

      setSuccessMessage(
        'Registrierung erfolgreich. Bitte bestätige deine E-Mail-Adresse.',
      )
    } catch {
      setErrorMessage(
        'Die Registrierung ist fehlgeschlagen. Bitte versuche es erneut.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="register-title">
        <h1 className="auth-title" id="register-title">
          Registrierung
        </h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Benutzername</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="auth-field">
            <span>Anzeigename</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
            />
          </label>
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
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
          <label className="auth-field">
            <span>Passwort bestätigen</span>
            <input
              type="password"
              value={passwordConfirmation}
              onChange={(event) =>
                setPasswordConfirmation(event.target.value)
              }
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
          <button
            className="auth-submit"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Registrieren...' : 'Registrieren'}
          </button>
        </form>
        {errorMessage && (
          <p className="auth-error" role="alert">
            {errorMessage}
          </p>
        )}
        {successMessage && (
          <p className="auth-success" role="status">
            {successMessage}
          </p>
        )}
        <Link className="auth-alternate" to="/login">
          Bereits ein Konto? Einloggen
        </Link>
      </section>
    </main>
  )
}

export default RegisterPage
