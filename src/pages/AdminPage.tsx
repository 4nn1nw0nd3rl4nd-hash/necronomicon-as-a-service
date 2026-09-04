import { useState } from 'react'
import {
  Link,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom'
import { useAdminRoleActions } from '../hooks/useAdminRoleActions'
import { useAdminRounds } from '../hooks/useAdminRounds'
import { useAdminUsers } from '../hooks/useAdminUsers'
import { useDeleteUser } from '../hooks/useDeleteUser'
import type { AdminOutletContext } from '../routes/RequireAdmin'
import type { RoundStatus } from '../types/round'

type AdminSection = 'users' | 'rounds'

function getRoundStatusLabel(status: RoundStatus) {
  const labels: Record<RoundStatus, string> = {
    active: 'Aktiv',
    paused: 'Pausiert',
    archived: 'Archiviert',
  }

  return labels[status]
}

function AdminPage() {
  const { currentProfile } =
    useOutletContext<AdminOutletContext>()
  const isCurrentSuperadmin =
    currentProfile.is_superadmin === true
  const [searchParams, setSearchParams] = useSearchParams()
  const activeSection: AdminSection =
    searchParams.get('section') === 'rounds' ? 'rounds' : 'users'
  const [pendingDemotionUserId, setPendingDemotionUserId] =
    useState<string | null>(null)
  const [pendingPromotionUserId, setPendingPromotionUserId] =
    useState<string | null>(null)
  const [pendingDeletionUserId, setPendingDeletionUserId] =
    useState<string | null>(null)
  const { users, isLoading, error, reload } = useAdminUsers()
  const {
    rounds,
    isLoading: areRoundsLoading,
    error: roundsError,
    reload: reloadRounds,
  } = useAdminRounds()
  const {
    isSubmitting: isRoleSubmitting,
    activeUserId,
    error: roleActionError,
    successMessage,
    promoteUser,
    demoteUser,
    resetState: resetRoleActionState,
  } = useAdminRoleActions()
  const {
    isSubmitting: isDeleting,
    error: deleteError,
    isSuccess: isDeleteSuccess,
    deleteUser,
    resetState: resetDeleteState,
  } = useDeleteUser()
  const isAnyActionSubmitting = isRoleSubmitting || isDeleting

  const openPromotionConfirmation = (targetUserId: string) => {
    resetRoleActionState()
    resetDeleteState()
    setPendingDemotionUserId(null)
    setPendingDeletionUserId(null)
    setPendingPromotionUserId(targetUserId)
  }

  const handlePromoteUser = async (targetUserId: string) => {
    setPendingDemotionUserId(null)
    setPendingDeletionUserId(null)
    resetDeleteState()
    const wasPromoted = await promoteUser(targetUserId)

    if (wasPromoted) {
      setPendingPromotionUserId(null)
      reload()
    }
  }

  const openDemotionConfirmation = (targetUserId: string) => {
    resetRoleActionState()
    resetDeleteState()
    setPendingPromotionUserId(null)
    setPendingDeletionUserId(null)
    setPendingDemotionUserId(targetUserId)
  }

  const handleDemoteUser = async (targetUserId: string) => {
    const wasDemoted = await demoteUser(targetUserId)

    if (wasDemoted) {
      setPendingDemotionUserId(null)
      reload()
    }
  }

  const openDeletionConfirmation = (targetUserId: string) => {
    resetDeleteState()
    resetRoleActionState()
    setPendingPromotionUserId(null)
    setPendingDemotionUserId(null)
    setPendingDeletionUserId(targetUserId)
  }

  const handleDeleteUser = async (targetUserId: string) => {
    const wasDeleted = await deleteUser(targetUserId)

    if (wasDeleted) {
      setPendingDeletionUserId(null)
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
          onClick={() => setSearchParams({ section: 'users' })}
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
          onClick={() => setSearchParams({ section: 'rounds' })}
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
            {isDeleteSuccess && (
              <p className="admin-action-message" role="status">
                Nutzer wurde gelöscht.
              </p>
            )}
            {deleteError && (
              <p
                className="admin-action-message admin-action-error"
                role="alert"
              >
                {deleteError}
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
                  const isOwnAccount =
                    user.id === currentProfile.id
                  const isTargetSuperadmin =
                    user.is_superadmin === true
                  const isDeletionPrepared =
                    user.deletion_pending_at !== null
                  const canPromote =
                    isCurrentSuperadmin &&
                    user.role === 'user' &&
                    !isTargetSuperadmin &&
                    !isOwnAccount &&
                    !isDeletionPrepared
                  const canDemote =
                    isCurrentSuperadmin &&
                    user.role === 'admin' &&
                    !isTargetSuperadmin &&
                    !isOwnAccount &&
                    !isDeletionPrepared
                  const isPromotionPending =
                    pendingPromotionUserId === user.id
                  const isDemotionPending =
                    pendingDemotionUserId === user.id
                  const canDelete =
                    !isOwnAccount &&
                    !isTargetSuperadmin &&
                    (isCurrentSuperadmin ||
                      (currentProfile.role === 'admin' &&
                        currentProfile.is_superadmin === false &&
                        user.role === 'user'))
                  const isDeletionConfirmationOpen =
                    pendingDeletionUserId === user.id

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
                        {isDeletionPrepared && (
                          <span className="admin-deletion-pending-badge">
                            Löschung vorbereitet
                          </span>
                        )}
                        {canPromote && !isPromotionPending && (
                          <button
                            type="button"
                            className="admin-promote-button"
                            disabled={isAnyActionSubmitting}
                            onClick={() =>
                              openPromotionConfirmation(user.id)
                            }
                          >
                            Zum Admin machen
                          </button>
                        )}
                        {canDemote && !isDemotionPending && (
                          <button
                            type="button"
                            className="admin-demote-button"
                            disabled={isAnyActionSubmitting}
                            onClick={() =>
                              openDemotionConfirmation(user.id)
                            }
                          >
                            Zum Nutzer zurückstufen
                          </button>
                        )}
                        {canDelete && !isDeletionConfirmationOpen && (
                          <button
                            type="button"
                            className="admin-delete-button"
                            disabled={isAnyActionSubmitting}
                            onClick={() =>
                              openDeletionConfirmation(user.id)
                            }
                          >
                            {isDeletionPrepared
                              ? 'Löschung erneut versuchen'
                              : 'Nutzer löschen'}
                          </button>
                        )}
                      </div>
                      {canPromote && isPromotionPending && (
                        <div className="admin-demote-confirmation">
                          <p>
                            Nutzer „
                            {user.display_name ?? user.username}“ wirklich
                            zum Admin machen? Der Nutzer erhält dadurch
                            globale Adminrechte.
                          </p>
                          <div className="admin-demote-confirmation-actions">
                            <button
                              type="button"
                              className={`admin-promote-button${
                                isRoleSubmitting &&
                                activeUserId === user.id
                                  ? ' is-submitting'
                                  : ''
                              }`}
                              disabled={isAnyActionSubmitting}
                              onClick={() =>
                                void handlePromoteUser(user.id)
                              }
                            >
                              {isRoleSubmitting &&
                              activeUserId === user.id
                                ? 'Wird geändert...'
                                : 'Zum Admin machen'}
                            </button>
                            <button
                              type="button"
                              className="admin-demote-cancel"
                              disabled={isAnyActionSubmitting}
                              onClick={() =>
                                setPendingPromotionUserId(null)
                              }
                            >
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      )}
                      {canDemote && isDemotionPending && (
                        <div className="admin-demote-confirmation">
                          <p>
                            Admin „
                            {user.display_name ?? user.username}“ wirklich
                            zum Nutzer zurückstufen? Dadurch werden die
                            globalen Adminrechte entzogen.
                          </p>
                          <div className="admin-demote-confirmation-actions">
                            <button
                              type="button"
                              className={`admin-demote-confirm${
                                isRoleSubmitting &&
                                activeUserId === user.id
                                  ? ' is-submitting'
                                  : ''
                              }`}
                              disabled={isAnyActionSubmitting}
                              onClick={() =>
                                void handleDemoteUser(user.id)
                              }
                            >
                              {isRoleSubmitting &&
                              activeUserId === user.id
                                ? 'Wird geändert...'
                                : 'Zurückstufen'}
                            </button>
                            <button
                              type="button"
                              className="admin-demote-cancel"
                              disabled={isAnyActionSubmitting}
                              onClick={() =>
                                setPendingDemotionUserId(null)
                              }
                            >
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      )}
                      {canDelete && isDeletionConfirmationOpen && (
                        <div className="admin-delete-confirmation">
                          <p>
                            Nutzer „
                            {user.display_name ?? user.username}“ wirklich
                            löschen? Diese Aktion kann nicht rückgängig
                            gemacht werden. Von diesem Nutzer geleitete
                            Runden bleiben erhalten, werden archiviert und
                            als verwaist markiert. Der Superadmin kann später
                            eine neue Spielleitung festlegen.
                          </p>
                          <div className="admin-delete-confirmation-actions">
                            <button
                              type="button"
                              className={`admin-delete-confirm${
                                isDeleting ? ' is-submitting' : ''
                              }`}
                              disabled={isAnyActionSubmitting}
                              onClick={() =>
                                void handleDeleteUser(user.id)
                              }
                            >
                              {isDeleting
                                ? 'Wird gelöscht...'
                                : isDeletionPrepared
                                  ? 'Löschung erneut versuchen'
                                  : 'Endgültig löschen'}
                            </button>
                            <button
                              type="button"
                              className="admin-delete-cancel"
                              disabled={isAnyActionSubmitting}
                              onClick={() =>
                                setPendingDeletionUserId(null)
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
          <div className="admin-rounds">
            {areRoundsLoading ? (
              <p className="admin-rounds-status" role="status">
                Runden werden geladen...
              </p>
            ) : roundsError ? (
              <div className="admin-rounds-status">
                <p role="alert">{roundsError}</p>
                <button type="button" onClick={reloadRounds}>
                  Erneut versuchen
                </button>
              </div>
            ) : rounds.length === 0 ? (
              <p className="admin-rounds-status">
                Keine Runden gefunden.
              </p>
            ) : (
              <ul className="admin-round-list" role="list">
                {rounds.map((round) => (
                  <li key={round.id}>
                    <Link
                      className="admin-round-card-link"
                      to={`/app/admin/rounds/${round.id}`}
                      aria-label={`Admin-Rundendetails zu ${round.name}`}
                    >
                      <article className="admin-round-card">
                        <header className="admin-round-card-header">
                          <h3>{round.name}</h3>
                          <div className="round-badges">
                            <span
                              className={`round-badge round-status-${round.status}`}
                            >
                              {getRoundStatusLabel(round.status)}
                            </span>
                            {round.orphaned_at !== null && (
                              <span className="round-badge round-orphaned">
                                Verwaist
                              </span>
                            )}
                            {round.locked_at !== null && (
                              <span className="round-badge round-locked">
                                Gesperrt
                              </span>
                            )}
                          </div>
                        </header>
                        <dl className="admin-round-details">
                          {round.system && (
                            <div>
                              <dt>System</dt>
                              <dd>{round.system}</dd>
                            </div>
                          )}
                          {round.appointment && (
                            <div>
                              <dt>Termin</dt>
                              <dd>{round.appointment}</dd>
                            </div>
                          )}
                          <div>
                            <dt>Spielleitung</dt>
                            <dd>
                              {round.gameMaster
                                ? `${round.gameMaster.display_name} (@${round.gameMaster.username})`
                                : 'Keine Spielleitung zugeordnet'}
                            </dd>
                          </div>
                        </dl>
                      </article>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </section>
  )
}

export default AdminPage
