import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import AddRoundMemberSearch from '../components/AddRoundMemberSearch'
import EditRoundForm from '../components/EditRoundForm'
import { useRoundDetails } from '../hooks/useRoundDetails'
import { useRoundMembers } from '../hooks/useRoundMembers'
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
  const { round, membershipRole, isLoading, error, reload } =
    useRoundDetails(roundId, user?.id)
  const {
    members,
    isLoading: areMembersLoading,
    error: membersError,
    reload: reloadMembers,
  } = useRoundMembers(roundId, user?.id)
  const [editingRoundId, setEditingRoundId] = useState<string | null>(
    null,
  )

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
            <div className="round-member-identity">
              <strong>{member.profile.display_name}</strong>
              <span>@{member.profile.username}</span>
            </div>
            <span
              className={`round-badge round-member-role round-member-role-${member.role}`}
            >
              {getRoleLabel(member.role)}
            </span>
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
          onClick={reload}
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
          reload()
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
