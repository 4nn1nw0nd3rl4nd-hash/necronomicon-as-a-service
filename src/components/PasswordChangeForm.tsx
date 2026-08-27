import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { usePasswordChange } from '../hooks/usePasswordChange'

type PasswordFields = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const initialFields: PasswordFields = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

function PasswordChangeForm() {
  const {
    isSubmitting,
    error,
    isSuccess,
    changePassword,
    resetState,
  } = usePasswordChange()
  const [fields, setFields] = useState<PasswordFields>(initialFields)

  const handleChange =
    (field: keyof PasswordFields) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setFields((currentFields) => ({
        ...currentFields,
        [field]: event.target.value,
      }))

      if (error || isSuccess) {
        resetState()
      }
    }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const passwordWasChanged = await changePassword(
      fields.currentPassword,
      fields.newPassword,
      fields.confirmPassword,
    )

    if (passwordWasChanged) {
      setFields(initialFields)
    }
  }

  const isSubmitDisabled =
    isSubmitting ||
    !fields.currentPassword ||
    !fields.newPassword ||
    !fields.confirmPassword

  return (
    <div className="profile-card">
      <form
        className="password-change-form"
        onSubmit={handleSubmit}
        noValidate
      >
        <h3 className="password-change-title">Passwort ändern</h3>
        <div className="password-change-fields">
          <label className="auth-field" htmlFor="current-password">
            <span>Aktuelles Passwort</span>
            <input
              id="current-password"
              type="password"
              value={fields.currentPassword}
              onChange={handleChange('currentPassword')}
              autoComplete="current-password"
              disabled={isSubmitting}
            />
          </label>
          <label className="auth-field" htmlFor="new-password">
            <span>Neues Passwort</span>
            <input
              id="new-password"
              type="password"
              value={fields.newPassword}
              onChange={handleChange('newPassword')}
              autoComplete="new-password"
              disabled={isSubmitting}
            />
          </label>
          <label className="auth-field" htmlFor="confirm-password">
            <span>Neues Passwort bestätigen</span>
            <input
              id="confirm-password"
              type="password"
              value={fields.confirmPassword}
              onChange={handleChange('confirmPassword')}
              autoComplete="new-password"
              disabled={isSubmitting}
            />
          </label>
        </div>
        <button
          className="auth-submit"
          type="submit"
          disabled={isSubmitDisabled}
        >
          {isSubmitting ? 'Passwort ändern...' : 'Passwort ändern'}
        </button>
        {error && (
          <p className="profile-form-error" role="alert">
            {error}
          </p>
        )}
        {isSuccess && (
          <p className="profile-form-success" role="status">
            Das Passwort wurde geändert.
          </p>
        )}
      </form>
    </div>
  )
}

export default PasswordChangeForm
