import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AddRoundMemberSearch from '../components/AddRoundMemberSearch'
import EditRoundForm from '../components/EditRoundForm'
import { useRoundDetails } from '../hooks/useRoundDetails'
import { useRoundMembers } from '../hooks/useRoundMembers'
import { useRemoveRoundPlayer } from '../hooks/useRemoveRoundPlayer'
import { useTransferGameMaster } from '../hooks/useTransferGameMaster'
import type {
  RoundMembershipRole,
  RoundStatus,
} from '../types/round'

function getRoleLabel(role: RoundMembershipRole) {
  return role === 'game_master' ? 'Spielleitung' : 'Spieler'
}

function getStatusLabel(status: RoundStatus) {
  const labels: Record<RoundStatus, string> = {
    active: 'Aktiv',
    paused: 'Pausiert',
    archived: 'Archiviert',
  }

  return labels[status]
}

function RoundDetailsPage() {
  const { roundId } = useParams<{ roundId: string }>()
  const { user } = useAuth()
  const {
    round,
    membershipRole,
    isLoading,
    error,
    reload: reloadRoundDetails,
  } = useRoundDetails(roundId, user?.id)
  const {
    members,
    isLoading: areMembersLoading,
    error: membersError,
    reload: reloadMembers,
  } = useRoundMembers(roundId, user?.id)
  const {
    isSubmitting: isRemovingPlayer,
    error: removePlayerError,
    isSuccess: wasPlayerRemoved,
    removePlayer,
    resetState: resetRemovePlayer,
  } = useRemoveRoundPlayer()
  const {
    isSubmitting: isTransferringGameMaster,
    error: transferGameMasterError,
    isSuccess: wasGameMasterTransferred,
    transferGameMaster,
    resetState: resetTransferGameMaster,
  } = useTransferGameMaster()
  const [editingRoundId, setEditingRoundId] = useState<string | null>(
    null,
  )
  const [playerPendingRemovalId, setPlayerPendingRemovalId] = useState<
    string | null
  >(null)
  const [playerPendingTransferId, setPlayerPendingTransferId] = useState<
    string | null
  >(null)

  const openRemoveConfirmation = (memberId: string) => {
    resetTransferGameMaster()
    setPlayerPendingTransferId(null)
    resetRemovePlayer()
    setPlayerPendingRemovalId(memberId)
  }

  const cancelRemoveConfirmation = () => {
    resetRemovePlayer()
    setPlayerPendingRemovalId(null)
  }

  const confirmPlayerRemoval = async (memberUserId: string) => {
    if (!roundId) {
      return
    }

    const wasRemoved = await removePlayer(roundId, memberUserId)

    if (wasRemoved) {
      setPlayerPendingRemovalId(null)
      reloadMembers()
    }
  }

  const openTransferConfirmation = (memberId: string) => {
    resetRemovePlayer()
    setPlayerPendingRemovalId(null)
    resetTransferGameMaster()
    setPlayerPendingTransferId(memberId)
  }

  const cancelTransferConfirmation = () => {
    resetTransferGameMaster()
    setPlayerPendingTransferId(null)
  }

  const confirmGameMasterTransfer = async (newGameMasterId: string) => {
    if (!roundId) {
      return
    }

    const wasTransferred = await transferGameMaster(
      roundId,
      newGameMasterId,
    )

    if (wasTransferred) {
      setPlayerPendingTransferId(null)
      reloadMembers()
      reloadRoundDetails()
    }
  }

  let content
  let membersContent

  if (areMembersLoading) {
    membersContent = (
      <p className="round-members-state" role="status">
        Mitglieder werden geladen...
      </p>
    )
  } else if (membersError) {
    membersContent = (
      <div className="round-members-state" role="alert">
        <p>{membersError}</p>
        <button
          className="rounds-retry"
          type="button"
          onClick={reloadMembers}
        >
          Erneut versuchen
        </button>
      </div>
    )
  } else if (members.length === 0) {
    membersContent = (
      <p className="round-members-state">Keine Mitglieder gefunden.</p>
    )
  } else {
    membersContent = (
      <ul className="round-members-list">
        {members.map((member) => (
          <li className="round-member" key={member.id}>
            <div className="round-member-summary">
              <div className="round-member-identity">
                <strong>{member.profile.display_name}</strong>
                <span>@{member.profile.username}</span>
              </div>
              <div className="round-member-controls">
                <span
                  className={`round-badge round-member-role round-member-role-${member.role}`}
                >
                  {getRoleLabel(member.role)}
                </span>
                {membershipRole === 'game_master' &&
                  member.role === 'player' && (
                    <>
                      <button
                        className="round-member-remove-trigger"
                        type="button"
                        disabled={
                          isRemovingPlayer || isTransferringGameMaster
                        }
                        onClick={() =>
                          openRemoveConfirmation(member.id)
                        }
                      >
                        Entfernen
                      </button>
                      <button
                        className="round-member-transfer-trigger"
                        type="button"
                        disabled={
                          isRemovingPlayer || isTransferringGameMaster
                        }
                        onClick={() =>
                          openTransferConfirmation(member.id)
                        }
                      >
                        Spielleitung übertragen
                      </button>
                    </>
                  )}
              </div>
            </div>
            {playerPendingRemovalId === member.id && (
              <div className="round-member-remove-confirmation">
                <p>
                  Spieler „{member.profile.display_name}“ wirklich aus
                  der Runde entfernen?
                </p>
                {removePlayerError && (
                  <p className="profile-form-error" role="alert">
                    {removePlayerError}
                  </p>
                )}
                <div className="round-member-remove-actions">
                  <button
                    className="round-member-remove-confirm"
                    type="button"
                    disabled={isRemovingPlayer}
                    data-submitting={isRemovingPlayer}
                    onClick={() =>
                      void confirmPlayerRemoval(member.user_id)
                    }
                  >
                    {isRemovingPlayer ? 'Wird entfernt...' : 'Entfernen'}
                  </button>
                  <button
                    className="round-member-remove-cancel"
                    type="button"
                    disabled={isRemovingPlayer}
                    onClick={cancelRemoveConfirmation}
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
            {playerPendingTransferId === member.id && (
              <div className="round-member-transfer-confirmation">
                <p>
                  Spielleitung an „{member.profile.display_name}“
                  übertragen?
                  <br />
                  Du wirst anschließend als Spieler geführt.
                </p>
                {transferGameMasterError && (
                  <p className="profile-form-error" role="alert">
                    {transferGameMasterError}
                  </p>
                )}
                <div className="round-member-transfer-actions">
                  <button
                    className="round-member-transfer-confirm"
                    type="button"
                    disabled={isTransferringGameMaster}
                    data-submitting={isTransferringGameMaster}
                    onClick={() =>
                      void confirmGameMasterTransfer(member.user_id)
                    }
                  >
                    {isTransferringGameMaster
                      ? 'Wird übertragen...'
                      : 'Spielleitung übertragen'}
                  </button>
                  <button
                    className="round-member-transfer-cancel"
                    type="button"
                    disabled={isTransferringGameMaster}
                    onClick={cancelTransferConfirmation}
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    )
  }

  if (isLoading) {
    content = (
      <p className="round-detail-state" role="status">
        Runde wird geladen...
      </p>
    )
  } else if (error) {
    content = (
      <div className="round-detail-state" role="alert">
        <p>{error}</p>
        <button
          className="rounds-retry"
          type="button"
          onClick={reloadRoundDetails}
        >
          Erneut versuchen
        </button>
      </div>
    )
  } else if (round) {
    const isEditing =
      editingRoundId === round.id && membershipRole === 'game_master'

    content = isEditing ? (
      <EditRoundForm
        round={round}
        onUpdated={() => {
          setEditingRoundId(null)
          reloadRoundDetails()
        }}
        onCancel={() => setEditingRoundId(null)}
      />
    ) : (
      <article className="round-detail-card">
        <header className="round-detail-header">
          <div className="round-detail-title-row">
            <h1>{round.name}</h1>
            {membershipRole === 'game_master' && (
              <button
                className="round-edit-button"
                type="button"
                onClick={() => setEditingRoundId(round.id)}
              >
                Bearbeiten
              </button>
            )}
          </div>
          <div className="round-badges">
            {membershipRole && (
              <span className="round-badge round-role">
                {getRoleLabel(membershipRole)}
              </span>
            )}
            <span
              className={`round-badge round-status round-status-${round.status}`}
            >
              {getStatusLabel(round.status)}
            </span>
          </div>
        </header>
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
        <section
          className="round-detail-description"
          aria-labelledby="round-description-title"
        >
          <h2 id="round-description-title">Beschreibung</h2>
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
      <Link className="round-detail-back" to="/app/rounds">
        Zurück zu Meine Runden
      </Link>
      {content}
      {round && (
        <section
          className="round-members-card"
          aria-labelledby="round-members-title"
        >
          <h2 className="round-members-title" id="round-members-title">
            Mitglieder
          </h2>
          {membersContent}
          {wasPlayerRemoved && (
            <p className="round-member-remove-success" role="status">
              Spieler wurde entfernt.
            </p>
          )}
          {wasGameMasterTransferred && (
            <p className="round-member-transfer-success" role="status">
              Spielleitung wurde übertragen.
            </p>
          )}
          {membershipRole === 'game_master' && user && roundId && (
            <AddRoundMemberSearch
              roundId={roundId}
              currentUserId={user.id}
              members={members}
              onPlayerAdded={reloadMembers}
            />
          )}
        </section>
      )}
    </section>
  )
}

export default RoundDetailsPage
