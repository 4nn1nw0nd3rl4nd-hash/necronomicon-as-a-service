import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import CreateRoundForm from '../components/CreateRoundForm'
import { useMyRounds } from '../hooks/useMyRounds'
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

function RoundsPage() {
  const { user } = useAuth()
  const { rounds, isLoading, error, reload } = useMyRounds(user?.id)

  let content

  if (isLoading) {
    content = (
      <p className="rounds-state" role="status">
        Runden werden geladen...
      </p>
    )
  } else if (error) {
    content = (
      <div className="rounds-state" role="alert">
        <p>Die Runden konnten nicht geladen werden.</p>
        <button className="rounds-retry" type="button" onClick={reload}>
          Erneut versuchen
        </button>
      </div>
    )
  } else if (rounds.length === 0) {
    content = (
      <p className="rounds-state">
        Du gehörst derzeit keiner Runde an.
      </p>
    )
  } else {
    content = (
      <ul className="rounds-list">
        {rounds.map((membership) => (
          <li key={membership.round_id}>
            <Link
              className="round-card-link"
              to={`/app/rounds/${membership.round.id}`}
              aria-label={`Rundendetails zu ${membership.round.name}`}
            >
              <article className="round-card">
                <header className="round-card-header">
                  <h2>{membership.round.name}</h2>
                  <div className="round-badges">
                    <span className="round-badge round-role">
                      {getRoleLabel(membership.role)}
                    </span>
                    <span
                      className={`round-badge round-status round-status-${membership.round.status}`}
                    >
                      {getStatusLabel(membership.round.status)}
                    </span>
                  </div>
                </header>
                {(membership.round.system ||
                  membership.round.appointment) && (
                  <dl className="round-details">
                    {membership.round.system && (
                      <div>
                        <dt>System</dt>
                        <dd>{membership.round.system}</dd>
                      </div>
                    )}
                    {membership.round.appointment && (
                      <div>
                        <dt>Termin</dt>
                        <dd>{membership.round.appointment}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </article>
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="rounds-page" aria-labelledby="rounds-title">
      <h1 className="rounds-title" id="rounds-title">
        Meine Runden
      </h1>
      <CreateRoundForm onCreated={reload} />
      {content}
    </section>
  )
}

export default RoundsPage
