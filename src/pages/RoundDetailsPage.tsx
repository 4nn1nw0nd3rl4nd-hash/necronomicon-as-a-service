import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import EditRoundForm from '../components/EditRoundForm'
import { useRoundDetails } from '../hooks/useRoundDetails'
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
  const [editingRoundId, setEditingRoundId] = useState<string | null>(
    null,
  )

  let content

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
    </section>
  )
}

export default RoundDetailsPage
