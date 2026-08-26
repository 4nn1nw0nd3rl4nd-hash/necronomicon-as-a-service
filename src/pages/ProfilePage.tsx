import { useAuth } from '../auth/useAuth'
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
  const { profile, isLoading, error, reload } = useProfile(user?.id)

  let content

  if (isLoading) {
    content = <p className="profile-status">Profil wird geladen...</p>
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
      <div className="profile-card">
        <dl className="profile-details">
          <div className="profile-detail">
            <dt>Benutzername</dt>
            <dd>{profile.username}</dd>
          </div>
          <div className="profile-detail">
            <dt>Anzeigename</dt>
            <dd>{profile.display_name?.trim() || 'Nicht gesetzt'}</dd>
          </div>
          <div className="profile-detail">
            <dt>E-Mail</dt>
            <dd>{user?.email ?? 'Nicht verfügbar'}</dd>
          </div>
          <div className="profile-detail">
            <dt>Rolle</dt>
            <dd>
              <span className="profile-role">{getRoleLabel(profile)}</span>
            </dd>
          </div>
        </dl>
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
