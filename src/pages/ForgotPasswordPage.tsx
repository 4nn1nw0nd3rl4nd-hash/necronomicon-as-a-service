import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { usePasswordResetRequest } from '../hooks/usePasswordResetRequest'

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const {
    isSubmitting,
    error,
    isSuccess,
    requestPasswordReset,
    resetState,
  } = usePasswordResetRequest()

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value)

    if (error || isSuccess) {
      resetState()
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void requestPasswordReset(email)
  }

  return (
    <main className="auth-page">
      <section
        className="auth-card"
        aria-labelledby="forgot-password-title"
      >
        <div className="auth-heading">
          <h1 className="auth-title" id="forgot-password-title">
            Passwort vergessen?
          </h1>
          <p className="auth-description">
            Gib deine E-Mail-Adresse ein, um einen Link zum Zurücksetzen
            deines Passworts anzufordern.
          </p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field" htmlFor="reset-email">
            <span>E-Mail</span>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={handleChange}
              autoComplete="email"
              disabled={isSubmitting}
              required
            />
          </label>
          <button
            className="auth-submit"
            type="submit"
            disabled={isSubmitting || !email.trim()}
          >
            {isSubmitting ? 'Link wird gesendet...' : 'Reset-Link senden'}
          </button>
        </form>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {isSuccess && (
          <p className="auth-success" role="status">
            Wenn für diese Adresse ein Konto existiert, wurde ein Link zum
            Zurücksetzen des Passworts gesendet.
          </p>
        )}
        <Link className="auth-alternate" to="/login">
          Zurück zum Login
        </Link>
      </section>
    </main>
  )
}

export default ForgotPasswordPage
