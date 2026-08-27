import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import EmailChangeForm from '../components/EmailChangeForm'
import PasswordChangeForm from '../components/PasswordChangeForm'
import { useProfile } from '../hooks/useProfile'
import type { Profile } from '../types/profile'

function getRoleLabel(profile: Profile) {
  if (profile.is_superadmin) {
    return 'Superadmin'
  }

  return profile.role === 'admin' ? 'Admin' : 'Nutzer'
}

function ProfilePage() {
  const { user } = useAuth()
  const {
    profile,
    isLoading,
    error,
    reload,
    updateDisplayName,
    isSaving,
    saveError,
  } = useProfile(user?.id)
  const [displayNameDraft, setDisplayNameDraft] = useState<{
    profileUpdatedAt: string
    value: string
  } | null>(null)
  const [saveSucceeded, setSaveSucceeded] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(
    null,
  )
  const [isSaveErrorDismissed, setIsSaveErrorDismissed] = useState(false)

  const displayName =
    profile && displayNameDraft?.profileUpdatedAt === profile.updated_at
      ? displayNameDraft.value
      : (profile?.display_name ?? '')
  const normalizedDisplayName = displayName.trim()
  const isDisplayNameChanged = Boolean(
    profile && normalizedDisplayName !== profile.display_name,
  )

  const handleDisplayNameChange = (value: string) => {
    if (!profile) {
      return
    }

    setDisplayNameDraft({
      profileUpdatedAt: profile.updated_at,
      value,
    })
    setSaveSucceeded(false)
    setDisplayNameError(null)
    setIsSaveErrorDismissed(true)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isDisplayNameChanged || isSaving) {
      return
    }

    setSaveSucceeded(false)
    setIsSaveErrorDismissed(false)

    if (!normalizedDisplayName) {
      setDisplayNameError('Der Anzeigename darf nicht leer sein.')
      return
    }

    setDisplayNameError(null)
    const updatedProfile = await updateDisplayName(displayName)

    if (updatedProfile) {
      setDisplayNameDraft(null)
      setSaveSucceeded(true)
    }
  }

  let content

  if (isLoading) {
    content = (
      <p className="profile-status" role="status">
        Profil wird geladen...
      </p>
    )
  } else if (error) {
    content = (
      <div className="profile-status" role="alert">
        <p>{error}</p>
        <button className="profile-retry" type="button" onClick={reload}>
          Erneut versuchen
        </button>
      </div>
    )
  } else if (!profile) {
    content = (
      <p className="profile-status">
        Das Profil wurde nicht gefunden.
      </p>
    )
  } else {
    content = (
      <div className="profile-sections">
        <div className="profile-card">
          <dl className="profile-details">
            <div className="profile-detail">
              <dt>Benutzername</dt>
              <dd>{profile.username}</dd>
            </div>
            <div className="profile-detail">
              <dt>
                <label htmlFor="display-name">Anzeigename</label>
              </dt>
              <dd>
                <form
                  className="profile-display-form"
                  onSubmit={handleSubmit}
                >
                  <div className="profile-display-controls">
                    <input
                      id="display-name"
                      type="text"
                      value={displayName}
                      onChange={(event) =>
                        handleDisplayNameChange(event.target.value)
                      }
                      disabled={isSaving}
                    />
                    <button
                      className="profile-save"
                      type="submit"
                      disabled={!isDisplayNameChanged || isSaving}
                    >
                      {isSaving ? 'Speichern...' : 'Speichern'}
                    </button>
                  </div>
                  {(displayNameError ||
                    (!isSaveErrorDismissed && saveError)) && (
                    <p className="profile-form-error" role="alert">
                      {displayNameError || saveError}
                    </p>
                  )}
                  {saveSucceeded && (
                    <p className="profile-form-success" role="status">
                      Profil wurde gespeichert.
                    </p>
                  )}
                </form>
              </dd>
            </div>
            <div className="profile-detail">
              <dt>Rolle</dt>
              <dd>
                <span className="profile-role">
                  {getRoleLabel(profile)}
                </span>
              </dd>
            </div>
          </dl>
        </div>
        <section
          className="profile-security"
          aria-labelledby="account-security-title"
        >
          <h2
            className="profile-section-title"
            id="account-security-title"
          >
            Kontosicherheit
          </h2>
          <div className="profile-security-forms">
            <EmailChangeForm />
            <PasswordChangeForm />
          </div>
        </section>
      </div>
    )
  }

  return (
    <section className="profile-page" aria-labelledby="profile-title">
      <h1 className="profile-title" id="profile-title">
        Profil
      </h1>
      {content}
    </section>
  )
}

export default ProfilePage
