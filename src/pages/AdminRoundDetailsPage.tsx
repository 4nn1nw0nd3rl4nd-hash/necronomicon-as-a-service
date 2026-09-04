import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import OrphanedRoundRecovery from '../components/OrphanedRoundRecovery'
import { useAdminRoundDetails } from '../hooks/useAdminRoundDetails'
import { useRoundMembers } from '../hooks/useRoundMembers'
import { useSetRoundArchived } from '../hooks/useSetRoundArchived'
import { useSetRoundLocked } from '../hooks/useSetRoundLocked'
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
  const {
    isSubmitting: isLockSubmitting,
    error: lockError,
    setRoundLocked,
    resetState: resetLockState,
  } = useSetRoundLocked()
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false)
  const [lockReason, setLockReason] = useState('')
  const [lockValidationError, setLockValidationError] = useState<
    string | null
  >(null)
  const [isConfirmingUnlock, setIsConfirmingUnlock] = useState(false)

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

  const handleLockSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (
      !round ||
      round.locked_at !== null ||
      currentProfile.is_superadmin !== true
    ) {
      return
    }

    const normalizedReason = lockReason.trim()

    if (normalizedReason.length === 0) {
      setLockValidationError('Bitte gib einen Sperrgrund ein.')
      return
    }

    if (normalizedReason.length > 500) {
      setLockValidationError(
        'Der Sperrgrund darf höchstens 500 Zeichen lang sein.',
      )
      return
    }

    setLockValidationError(null)
    resetLockState()
    const wasLocked = await setRoundLocked(
      round.id,
      true,
      normalizedReason,
    )

    if (wasLocked) {
      setLockReason('')
      reload()
    }
  }

  const openUnlockConfirmation = () => {
    resetLockState()
    setIsConfirmingUnlock(true)
  }

  const cancelUnlockConfirmation = () => {
    if (isLockSubmitting) {
      return
    }

    resetLockState()
    setIsConfirmingUnlock(false)
  }

  const handleUnlock = async () => {
    if (
      !round ||
      round.locked_at === null ||
      currentProfile.is_superadmin !== true
    ) {
      return
    }

    resetLockState()
    const wasUnlocked = await setRoundLocked(round.id, false)

    if (wasUnlocked) {
      setIsConfirmingUnlock(false)
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
    const isLocked = round.locked_at !== null
    const gameMaster = members.find(
      (member) => member.role === 'game_master',
    )

    content = (
      <article className="round-detail-card">
        <header className="round-detail-header">
          <div className="round-detail-title-row">
            <h1>{round.name}</h1>
            {!isLocked &&
              !isConfirmingArchive &&
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
            {isLocked && (
              <span className="round-badge round-locked">Gesperrt</span>
            )}
          </div>
        </header>
        {isLocked && (
          <div className="locked-round-notice">
            <p>Diese Runde wurde administrativ gesperrt.</p>
            <p>
              <strong>Grund:</strong>{' '}
              {round.locked_reason?.trim() || 'Kein Grund angegeben.'}
            </p>
          </div>
        )}
        {currentProfile.is_superadmin === true &&
          (isLocked ? (
            <section
              aria-labelledby="admin-round-unlock-title"
              className="admin-round-lock-form"
            >
              <h2 id="admin-round-unlock-title">Sperre aufheben</h2>
              {isConfirmingUnlock ? (
                <>
                  <p>
                    Sperre für Runde „{round.name}“ wirklich aufheben?
                  </p>
                  {lockError && (
                    <p className="profile-form-error" role="alert">
                      {lockError}
                    </p>
                  )}
                  <div className="admin-round-lock-actions">
                    <button
                      className="auth-submit"
                      data-submitting={isLockSubmitting}
                      disabled={isLockSubmitting}
                      onClick={() => void handleUnlock()}
                      type="button"
                    >
                      {isLockSubmitting
                        ? 'Sperre wird aufgehoben...'
                        : 'Sperre aufheben'}
                    </button>
                    <button
                      className="admin-round-archive-cancel"
                      disabled={isLockSubmitting}
                      onClick={cancelUnlockConfirmation}
                      type="button"
                    >
                      Abbrechen
                    </button>
                  </div>
                </>
              ) : (
                <div className="admin-round-lock-actions">
                  <button
                    className="auth-submit"
                    disabled={isLockSubmitting}
                    onClick={openUnlockConfirmation}
                    type="button"
                  >
                    Sperre aufheben
                  </button>
                </div>
              )}
            </section>
          ) : (
            <form
              aria-labelledby="admin-round-lock-title"
              className="admin-round-lock-form"
              noValidate
              onSubmit={handleLockSubmit}
            >
              <h2 id="admin-round-lock-title">Runde sperren</h2>
              <label className="auth-field" htmlFor="admin-round-lock-reason">
                <span>Sperrgrund</span>
                <textarea
                  disabled={isLockSubmitting}
                  id="admin-round-lock-reason"
                  maxLength={500}
                  onChange={(event) => {
                    setLockReason(event.target.value)
                    setLockValidationError(null)

                    if (lockError) {
                      resetLockState()
                    }
                  }}
                  required
                  rows={4}
                  value={lockReason}
                />
              </label>
              {(lockValidationError || lockError) && (
                <p className="profile-form-error" role="alert">
                  {lockValidationError ?? lockError}
                </p>
              )}
              <div className="admin-round-lock-actions">
                <button
                  className="auth-submit"
                  data-submitting={isLockSubmitting}
                  disabled={isLockSubmitting || !lockReason.trim()}
                  type="submit"
                >
                  {isLockSubmitting ? 'Wird gesperrt...' : 'Runde sperren'}
                </button>
              </div>
            </form>
          ))}
        {isOrphaned && (
          <div className="orphaned-round-notice">
            <p>Dieser Runde ist derzeit keine Spielleitung zugeordnet.</p>
            <p>
              Vor dem Reaktivieren muss eine neue Spielleitung festgelegt
              werden.
            </p>
          </div>
        )}
        {!isLocked && isConfirmingArchive && (
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
        {!isLocked && !isConfirmingArchive && archiveError && (
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
