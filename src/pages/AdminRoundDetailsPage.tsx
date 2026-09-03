import { useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import OrphanedRoundRecovery from '../components/OrphanedRoundRecovery'
import { useAdminRoundDetails } from '../hooks/useAdminRoundDetails'
import { useRoundMembers } from '../hooks/useRoundMembers'
import { useSetRoundArchived } from '../hooks/useSetRoundArchived'
import type { AdminOutletContext } from '../routes/RequireAdmin'
import type { RoundStatus } from '../types/round'

function getStatusLabel(status: RoundStatus) {
  const labels: Record<RoundStatus, string> = {
    active: 'Aktiv',
    paused: 'Pausiert',
    archived: 'Archiviert',
  }

  return labels[status]
}

function AdminRoundDetailsPage() {
  const { roundId } = useParams<{ roundId: string }>()
  const { currentProfile } = useOutletContext<AdminOutletContext>()
  const { round, isLoading, error, reload } =
    useAdminRoundDetails(roundId)
  const {
    members,
    isLoading: areMembersLoading,
    error: membersError,
    reload: reloadMembers,
  } = useRoundMembers(roundId, currentProfile.id)
  const {
    isSubmitting: isArchiveSubmitting,
    error: archiveError,
    setRoundArchived,
    resetState: resetArchiveState,
  } = useSetRoundArchived()
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false)

  const openArchiveConfirmation = () => {
    resetArchiveState()
    setIsConfirmingArchive(true)
  }

  const cancelArchiveConfirmation = () => {
    resetArchiveState()
    setIsConfirmingArchive(false)
  }

  const handleArchiveChange = async (
    targetRoundId: string,
    archived: boolean,
  ) => {
    resetArchiveState()
    const wasChanged = await setRoundArchived(targetRoundId, archived)

    if (wasChanged) {
      setIsConfirmingArchive(false)
      reload()
    }
  }

  let content

  if (isLoading) {
    content = (
      <p className="round-detail-state" role="status">
        Runde wird geladen...
      </p>
    )
  } else if (error) {
    content = (
      <div className="round-detail-state">
        <p role="alert">{error}</p>
        <button
          className="rounds-retry"
          type="button"
          onClick={reload}
        >
          Erneut versuchen
        </button>
      </div>
    )
  } else if (round) {
    const isArchived = round.status === 'archived'
    const isOrphaned = round.orphaned_at !== null
    const gameMaster = members.find(
      (member) => member.role === 'game_master',
    )

    content = (
      <article className="round-detail-card">
        <header className="round-detail-header">
          <div className="round-detail-title-row">
            <h1>{round.name}</h1>
            {!isConfirmingArchive &&
              !(isArchived && isOrphaned) && (
                <button
                  className={`admin-round-archive-trigger${
                    isArchived ? ' is-unarchive' : ''
                  }`}
                  type="button"
                  disabled={isArchiveSubmitting}
                  data-submitting={isArchiveSubmitting}
                  onClick={() => {
                    if (isArchived) {
                      void handleArchiveChange(round.id, false)
                    } else {
                      openArchiveConfirmation()
                    }
                  }}
                >
                  {isArchiveSubmitting
                    ? 'Wird geändert...'
                    : isArchived
                      ? 'Aus Archiv holen'
                      : 'Archivieren'}
                </button>
              )}
          </div>
          <div className="round-badges">
            <span
              className={`round-badge round-status-${round.status}`}
            >
              {getStatusLabel(round.status)}
            </span>
            {isOrphaned && (
              <span className="round-badge round-orphaned">
                Verwaist
              </span>
            )}
          </div>
        </header>
        {isOrphaned && (
          <div className="orphaned-round-notice">
            <p>Dieser Runde ist derzeit keine Spielleitung zugeordnet.</p>
            <p>
              Vor dem Reaktivieren muss eine neue Spielleitung festgelegt
              werden.
            </p>
          </div>
        )}
        {isConfirmingArchive && (
          <section className="admin-round-archive-confirmation">
            <p>
              Runde „{round.name}“ wirklich archivieren?
            </p>
            {archiveError && (
              <p className="profile-form-error" role="alert">
                {archiveError}
              </p>
            )}
            <div className="admin-round-archive-confirmation-actions">
              <button
                className="admin-round-archive-confirm"
                type="button"
                disabled={isArchiveSubmitting}
                data-submitting={isArchiveSubmitting}
                onClick={() => void handleArchiveChange(round.id, true)}
              >
                {isArchiveSubmitting ? 'Wird archiviert...' : 'Archivieren'}
              </button>
              <button
                className="admin-round-archive-cancel"
                type="button"
                disabled={isArchiveSubmitting}
                onClick={cancelArchiveConfirmation}
              >
                Abbrechen
              </button>
            </div>
          </section>
        )}
        {!isConfirmingArchive && archiveError && (
          <p className="profile-form-error" role="alert">
            {archiveError}
          </p>
        )}
        {isOrphaned && currentProfile.is_superadmin === true && (
          <OrphanedRoundRecovery
            roundId={round.id}
            roundName={round.name}
            currentUserId={currentProfile.id}
            members={members}
            areMembersLoading={areMembersLoading}
            membersError={membersError}
            onReloadMembers={reloadMembers}
            onRecovered={() => {
              reloadMembers()
              reload()
            }}
          />
        )}
        {(round.system || round.appointment) && (
          <dl className="round-detail-meta">
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
          </dl>
        )}
        <dl className="round-detail-meta admin-round-game-master-meta">
          <div>
            <dt>Spielleitung</dt>
            <dd>
              {areMembersLoading
                ? 'Wird geladen...'
                : membersError
                  ? 'Nicht verfügbar'
                  : gameMaster
                    ? `${gameMaster.profile.display_name} (@${gameMaster.profile.username})`
                    : 'Keine Spielleitung zugeordnet'}
            </dd>
          </div>
        </dl>
        <section
          className="round-detail-description"
          aria-labelledby="admin-round-description-title"
        >
          <h2 id="admin-round-description-title">Beschreibung</h2>
          <p>
            {round.description?.trim()
              ? round.description
              : 'Keine Beschreibung hinterlegt.'}
          </p>
        </section>
      </article>
    )
  } else {
    content = (
      <p className="round-detail-state" role="alert">
        Die Runde ist nicht verfügbar.
      </p>
    )
  }

  return (
    <section className="round-detail-page">
      <Link
        className="round-detail-back"
        to="/app/admin?section=rounds"
      >
        Zurück zur Administration
      </Link>
      {content}
    </section>
  )
}

export default AdminRoundDetailsPage
