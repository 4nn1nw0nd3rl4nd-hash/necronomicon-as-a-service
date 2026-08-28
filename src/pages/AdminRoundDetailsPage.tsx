import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import EditRoundForm from '../components/EditRoundForm'
import { useAdminRoundDetails } from '../hooks/useAdminRoundDetails'
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
  const { round, isLoading, error, reload } =
    useAdminRoundDetails(roundId)
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
    content =
      editingRoundId === round.id ? (
        <EditRoundForm
          round={round}
          onCancel={() => setEditingRoundId(null)}
          onUpdated={() => {
            setEditingRoundId(null)
            reload()
          }}
        />
      ) : (
      <article className="round-detail-card">
        <header className="round-detail-header">
          <div className="round-detail-title-row">
            <h1>{round.name}</h1>
            <button
              className="round-edit-button"
              type="button"
              onClick={() => setEditingRoundId(round.id)}
            >
              Bearbeiten
            </button>
          </div>
          <div className="round-badges">
            <span
              className={`round-badge round-status-${round.status}`}
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
