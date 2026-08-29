import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { usePasswordReset } from '../hooks/usePasswordReset'
import { passwordRequirementsHint } from '../lib/passwordValidation'

type PasswordFields = {
  newPassword: string
  passwordConfirmation: string
}

const initialFields: PasswordFields = {
  newPassword: '',
  passwordConfirmation: '',
}

function ResetPasswordPage() {
  const { session, isLoading, isPasswordRecovery } = useAuth()
  const [fields, setFields] =
    useState<PasswordFields>(initialFields)
  const {
    isSubmitting,
    error,
    isSuccess,
    resetPassword,
    resetState,
  } = usePasswordReset()

  const handleChange =
    (field: keyof PasswordFields) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setFields((currentFields) => ({
        ...currentFields,
        [field]: event.target.value,
      }))

      if (error) {
        resetState()
      }
    }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const wasReset = await resetPassword(
      fields.newPassword,
      fields.passwordConfirmation,
    )

    if (wasReset) {
      setFields(initialFields)
    }
  }

  let content

  if (isSuccess) {
    content = (
      <>
        <p className="auth-success" role="status">
          Dein Passwort wurde erfolgreich geändert.
        </p>
        <Link className="auth-alternate" to="/login">
          Zum Login
        </Link>
      </>
    )
  } else if (isLoading) {
    content = (
      <p className="auth-success" role="status">
        Recovery-Link wird geprüft...
      </p>
    )
  } else if ((!isPasswordRecovery || !session) && !isSubmitting) {
    content = (
      <>
        <p className="auth-error" role="alert">
          Dieser Link zum Zurücksetzen des Passworts ist ungültig oder
          abgelaufen.
        </p>
        <Link className="auth-alternate" to="/forgot-password">
          Neuen Reset-Link anfordern
        </Link>
      </>
    )
  } else {
    content = (
      <>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="auth-field" htmlFor="reset-password">
            <span>Neues Passwort</span>
            <input
              id="reset-password"
              type="password"
              value={fields.newPassword}
              onChange={handleChange('newPassword')}
              autoComplete="new-password"
              aria-describedby="reset-password-requirements"
              disabled={isSubmitting}
              required
            />
            <small
              className="auth-hint"
              id="reset-password-requirements"
            >
              {passwordRequirementsHint}
            </small>
          </label>
          <label
            className="auth-field"
            htmlFor="reset-password-confirmation"
          >
            <span>Passwort wiederholen</span>
            <input
              id="reset-password-confirmation"
              type="password"
              value={fields.passwordConfirmation}
              onChange={handleChange('passwordConfirmation')}
              autoComplete="new-password"
              disabled={isSubmitting}
              required
            />
          </label>
          <button
            className="auth-submit"
            type="submit"
            disabled={
              isSubmitting ||
              !fields.newPassword ||
              !fields.passwordConfirmation
            }
          >
            {isSubmitting ? 'Passwort wird gespeichert...' : 'Passwort speichern'}
          </button>
        </form>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </>
    )
  }

  return (
    <main className="auth-page">
      <section
        className="auth-card"
        aria-labelledby="reset-password-title"
      >
        <h1 className="auth-title" id="reset-password-title">
          Neues Passwort festlegen
        </h1>
        {content}
      </section>
    </main>
  )
}

export default ResetPasswordPage
