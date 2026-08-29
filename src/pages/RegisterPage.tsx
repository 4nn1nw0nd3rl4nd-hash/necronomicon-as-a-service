import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  authErrorMessages,
  getRegistrationErrorMessage,
} from '../lib/authErrors'
import {
  isPasswordValid,
  passwordRequirementsHint,
} from '../lib/passwordValidation'
import { supabase } from '../lib/supabase'

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

    if (!normalizedDisplayName) {
      setErrorMessage('Bitte gib einen Anzeigenamen ein.')
      return
    }

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

    if (!isPasswordValid(password)) {
      setErrorMessage(authErrorMessages.invalidPassword)
      return
    }

    setIsSubmitting(true)

    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            username: normalizedUsername,
            display_name: normalizedDisplayName,
          },
        },
      })

      if (error) {
        setErrorMessage(getRegistrationErrorMessage(error))
        return
      }

      if (data.session) {
        navigate('/app', { replace: true })
        return
      }

      setPassword('')
      setPasswordConfirmation('')
      setSuccessMessage('Bitte bestätige deine E-Mail-Adresse.')
    } catch {
      setErrorMessage(getRegistrationErrorMessage())
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="register-title">
        <h1 className="auth-title" id="register-title">
          {successMessage ? 'Registrierung erfolgreich' : 'Registrierung'}
        </h1>
        {successMessage ? (
          <>
            <p className="auth-success" role="status">
              {successMessage}
            </p>
            <Link className="auth-alternate" to="/login">
              Zum Login
            </Link>
          </>
        ) : (
          <>
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
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
                  required
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
                  aria-describedby="password-requirements"
                  required
                />
                <small className="auth-hint" id="password-requirements">
                  {passwordRequirementsHint}
                </small>
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
            <Link className="auth-alternate" to="/login">
              Bereits ein Konto? Einloggen
            </Link>
          </>
        )}
      </section>
    </main>
  )
}

export default RegisterPage
