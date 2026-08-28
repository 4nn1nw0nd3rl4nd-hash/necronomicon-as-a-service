import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { useAdminRoleActions } from '../hooks/useAdminRoleActions'
import { useAdminUsers } from '../hooks/useAdminUsers'

type AdminSection = 'users' | 'rounds'

function AdminPage() {
  const { user: currentUser } = useAuth()
  const [activeSection, setActiveSection] =
    useState<AdminSection>('users')
  const [pendingDemotionUserId, setPendingDemotionUserId] =
    useState<string | null>(null)
  const { users, isLoading, error, reload } = useAdminUsers()
  const {
    isSubmitting,
    activeUserId,
    error: roleActionError,
    successMessage,
    promoteUser,
    demoteUser,
    resetState,
  } = useAdminRoleActions()

  const handlePromoteUser = async (targetUserId: string) => {
    setPendingDemotionUserId(null)
    const wasPromoted = await promoteUser(targetUserId)

    if (wasPromoted) {
      reload()
    }
  }

  const openDemotionConfirmation = (targetUserId: string) => {
    resetState()
    setPendingDemotionUserId(targetUserId)
  }

  const handleDemoteUser = async (targetUserId: string) => {
    const wasDemoted = await demoteUser(targetUserId)

    if (wasDemoted) {
      setPendingDemotionUserId(null)
      reload()
    }
  }

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <h1>Administration</h1>
        <p>Verwalte Nutzer und Runden der Plattform.</p>
      </header>

      <div
        className="admin-section-switcher"
        role="group"
        aria-label="Verwaltungsbereich auswählen"
      >
        <button
          type="button"
          className={
            activeSection === 'users'
              ? 'admin-section-button active'
              : 'admin-section-button'
          }
          aria-pressed={activeSection === 'users'}
          onClick={() => setActiveSection('users')}
        >
          Nutzerverwaltung
        </button>
        <button
          type="button"
          className={
            activeSection === 'rounds'
              ? 'admin-section-button active'
              : 'admin-section-button'
          }
          aria-pressed={activeSection === 'rounds'}
          onClick={() => setActiveSection('rounds')}
        >
          Rundenverwaltung
        </button>
      </div>

      <section className="admin-section-content">
        <h2>
          {activeSection === 'users'
            ? 'Nutzerverwaltung'
            : 'Rundenverwaltung'}
        </h2>
        {activeSection === 'users' ? (
          <div className="admin-users">
            {successMessage && (
              <p className="admin-action-message" role="status">
                {successMessage}
              </p>
            )}
            {roleActionError && (
              <p
                className="admin-action-message admin-action-error"
                role="alert"
              >
                {roleActionError}
              </p>
            )}
            {isLoading ? (
              <p className="admin-users-status" role="status">
                Nutzer werden geladen...
              </p>
            ) : error ? (
              <div className="admin-users-status">
                <p role="alert">{error}</p>
                <button type="button" onClick={reload}>
                  Erneut versuchen
                </button>
              </div>
            ) : users.length === 0 ? (
              <p className="admin-users-status">Keine Nutzer gefunden.</p>
            ) : (
              <ul className="admin-user-list" role="list">
                {users.map((user) => {
                  const role = user.is_superadmin
                    ? 'superadmin'
                    : user.role === 'admin'
                      ? 'admin'
                      : 'user'
                  const roleLabel =
                    role === 'superadmin'
                      ? 'Superadmin'
                      : role === 'admin'
                        ? 'Admin'
                        : 'Nutzer'
                  const canDemote =
                    user.role === 'admin' &&
                    user.is_superadmin === false &&
                    user.id !== currentUser?.id
                  const isDemotionPending =
                    pendingDemotionUserId === user.id

                  return (
                    <li
                      className={`admin-user admin-user-${role}`}
                      key={user.id}
                    >
                      <div className="admin-user-identity">
                        <span className="admin-user-display-name">
                          {user.display_name ?? 'Kein Anzeigename'}
                        </span>
                        <span className="admin-user-username">
                          @{user.username}
                        </span>
                      </div>
                      <div className="admin-user-controls">
                        <span
                          className={`admin-role-badge admin-role-${role}`}
                        >
                          {roleLabel}
                        </span>
                        {user.role === 'user' &&
                          user.is_superadmin === false && (
                            <button
                              type="button"
                              className={`admin-promote-button${
                                isSubmitting &&
                                activeUserId === user.id
                                  ? ' is-submitting'
                                  : ''
                              }`}
                              disabled={isSubmitting}
                              onClick={() =>
                                void handlePromoteUser(user.id)
                              }
                            >
                              {isSubmitting &&
                              activeUserId === user.id
                                ? 'Wird geändert...'
                                : 'Zum Admin machen'}
                            </button>
                          )}
                        {canDemote && !isDemotionPending && (
                          <button
                            type="button"
                            className="admin-demote-button"
                            disabled={isSubmitting}
                            onClick={() =>
                              openDemotionConfirmation(user.id)
                            }
                          >
                            Zum Nutzer zurückstufen
                          </button>
                        )}
                      </div>
                      {canDemote && isDemotionPending && (
                        <div className="admin-demote-confirmation">
                          <p>
                            Admin „
                            {user.display_name ?? user.username}“ wirklich
                            zum Nutzer zurückstufen?
                          </p>
                          <div className="admin-demote-confirmation-actions">
                            <button
                              type="button"
                              className={`admin-demote-confirm${
                                isSubmitting &&
                                activeUserId === user.id
                                  ? ' is-submitting'
                                  : ''
                              }`}
                              disabled={isSubmitting}
                              onClick={() =>
                                void handleDemoteUser(user.id)
                              }
                            >
                              {isSubmitting &&
                              activeUserId === user.id
                                ? 'Wird geändert...'
                                : 'Zurückstufen'}
                            </button>
                            <button
                              type="button"
                              className="admin-demote-cancel"
                              disabled={isSubmitting}
                              onClick={() =>
                                setPendingDemotionUserId(null)
                              }
                            >
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          <p>Die Rundenverwaltung wird hier angezeigt.</p>
        )}
      </section>
    </section>
  )
}

export default AdminPage
