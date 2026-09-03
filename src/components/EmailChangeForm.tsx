import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useEmailChange } from '../hooks/useEmailChange'

function EmailChangeForm() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [hasAuthCallbackError] = useState(() => {
    const callbackUrl = new URL(window.location.href)
    const hashParams = new URLSearchParams(
      callbackUrl.hash.slice(1),
    )
    const errorKeys = ['error', 'error_code', 'error_description']

    return errorKeys.some(
      (key) =>
        callbackUrl.searchParams.has(key) || hashParams.has(key),
    )
  })
  const {
    isSubmitting,
    error,
    status,
    pendingEmail,
    changeEmail,
    resetState,
  } = useEmailChange()
  const [newEmail, setNewEmail] = useState('')

  const normalizedEmail = newEmail.trim()
  const isUnchanged =
    user?.email?.trim().toLowerCase() === normalizedEmail.toLowerCase()
  const isEmailChangeConfirmed =
    searchParams.get('email_change') === 'confirmed' &&
    !hasAuthCallbackError &&
    Boolean(user?.email) &&
    !user?.new_email?.trim()
  const isSubmitDisabled =
    !normalizedEmail || isUnchanged || isSubmitting

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setNewEmail(event.target.value)

    if (error || status !== 'idle') {
      resetState()
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void changeEmail(newEmail)
  }

  return (
    <div className="profile-card">
      <h3 className="profile-form-title" id="email-change-title">
        E-Mail-Adresse ändern
      </h3>
      <div className="email-change-current">
        <span>Aktuelle E-Mail-Adresse</span>
        <strong>{user?.email ?? 'Nicht verfügbar'}</strong>
      </div>
      <form
        className="email-change-form"
        aria-labelledby="email-change-title"
        onSubmit={handleSubmit}
        noValidate
      >
        <label htmlFor="new-email">Neue E-Mail-Adresse</label>
        <div className="profile-display-controls">
          <input
            id="new-email"
            type="email"
            maxLength={254}
            value={newEmail}
            onChange={handleChange}
            autoComplete="email"
            disabled={isSubmitting}
          />
          <button
            className="profile-save"
            type="submit"
            disabled={isSubmitDisabled}
            data-submitting={isSubmitting}
          >
            {isSubmitting
              ? 'Änderung anfordern...'
              : 'Änderung anfordern'}
          </button>
        </div>
        {error && (
          <p className="profile-form-error" role="alert">
            {error}
          </p>
        )}
        {status === 'pending' && (
          <p className="profile-form-success" role="status">
            E-Mail-Änderung angefordert
            <span className="email-change-pending">
              Wir haben einen Bestätigungslink an deine neue
              E-Mail-Adresse gesendet. Öffne den Link, um die Änderung
              abzuschließen.
            </span>
            {pendingEmail && (
              <span className="email-change-pending">
                Ausstehende Adresse: {pendingEmail}
              </span>
            )}
          </p>
        )}
        {isEmailChangeConfirmed && (
          <p className="profile-form-success" role="status">
            E-Mail-Adresse geändert
            <span className="email-change-pending">
              Deine neue E-Mail-Adresse ist jetzt aktiv.
            </span>
          </p>
        )}
      </form>
    </div>
  )
}

export default EmailChangeForm
