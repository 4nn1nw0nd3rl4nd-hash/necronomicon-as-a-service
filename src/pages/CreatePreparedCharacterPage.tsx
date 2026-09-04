import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import CharacterCreationForm from '../components/CharacterCreationForm'
import { useRoundDetails } from '../hooks/useRoundDetails'

function CreatePreparedCharacterPage() {
  const { roundId } = useParams<{ roundId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { round, membershipRole, isLoading, reload } = useRoundDetails(
    roundId,
    user?.id,
  )
  const roundPath = roundId ? `/app/rounds/${roundId}` : '/app/rounds'
  const canCreatePreparedCharacter =
    round &&
    membershipRole === 'game_master' &&
    round.status !== 'archived' &&
    round.locked_at === null

  let content

  if (isLoading) {
    content = (
      <p className="round-detail-state" role="status">
        Runde wird geladen...
      </p>
    )
  } else if (!canCreatePreparedCharacter) {
    content = (
      <div className="round-detail-state" role="alert">
        <p>Diese Aktion ist nicht verfügbar.</p>
        {roundId && (
          <button className="rounds-retry" onClick={reload} type="button">
            Erneut versuchen
          </button>
        )}
      </div>
    )
  } else {
    content = (
      <>
        <h1 className="rounds-title">Vorbereiteten Charakter erstellen</h1>
        <p className="create-character-round-name">Runde: {round.name}</p>
        <CharacterCreationForm
          isPrepared
          onCreated={() => navigate(`/app/rounds/${round.id}`)}
          roundId={round.id}
        />
      </>
    )
  }

  return (
    <section className="create-character-page">
      <Link className="round-detail-back" to={roundPath}>
        Zurück zur Runde
      </Link>
      {content}
    </section>
  )
}

export default CreatePreparedCharacterPage
