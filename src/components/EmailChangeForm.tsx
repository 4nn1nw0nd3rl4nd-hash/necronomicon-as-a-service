import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { useEmailChange } from '../hooks/useEmailChange'

function EmailChangeForm() {
  const { user } = useAuth()
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
      <div className="email-change-current">
        <span>Aktuelle E-Mail-Adresse</span>
        <strong>{user?.email ?? 'Nicht verfügbar'}</strong>
      </div>
      <form
        className="email-change-form"
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
          >
            {isSubmitting ? 'Anfordern...' : 'Änderung anfordern'}
          </button>
        </div>
        {error && (
          <p className="profile-form-error" role="alert">
            {error}
          </p>
        )}
        {status === 'pending' && (
          <p className="profile-form-success" role="status">
            Änderung angefordert. Bitte bestätige die neue E-Mail-Adresse.
            {pendingEmail && (
              <span className="email-change-pending">
                Ausstehende Adresse: {pendingEmail}
              </span>
            )}
          </p>
        )}
        {status === 'changed' && (
          <p className="profile-form-success" role="status">
            Die E-Mail-Adresse wurde geändert.
          </p>
        )}
      </form>
    </div>
  )
}

export default EmailChangeForm
