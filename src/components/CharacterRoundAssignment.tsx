import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAssignCharacterToRound } from '../hooks/useAssignCharacterToRound'
import { useMyRounds } from '../hooks/useMyRounds'
import { useRemoveCharacterFromRound } from '../hooks/useRemoveCharacterFromRound'
import type { CharacterDetails } from '../types/character'

type CharacterRoundAssignmentProps = {
  character: CharacterDetails
  ownerUserId: string
  onChanged: () => void
}

function CharacterRoundAssignment({
  character,
  ownerUserId,
  onChanged,
}: CharacterRoundAssignmentProps) {
  const { rounds, isLoading, error: roundsError, reload } =
    useMyRounds(ownerUserId)
  const {
    isSubmitting: isAssigning,
    error: assignmentError,
    assignCharacterToRound,
    resetState: resetAssignmentState,
  } = useAssignCharacterToRound()
  const {
    isSubmitting: isRemoving,
    error: removalError,
    removeCharacterFromRound,
    resetState: resetRemovalState,
  } = useRemoveCharacterFromRound()
  const [isSelectingRound, setIsSelectingRound] = useState(false)
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false)
  const [selectedRoundId, setSelectedRoundId] = useState('')

  const availableRounds = rounds.filter(
    ({ round }) =>
      round.status !== 'archived' && round.locked_at === null,
  )
  const assignedRound = rounds.find(
    ({ round_id }) => round_id === character.round_id,
  )
  const roundName = character.round_id
    ? assignedRound?.round.name ?? 'Zugeordnete Runde'
    : 'Keine Runde'

  const openRoundSelection = () => {
    resetAssignmentState()
    setSelectedRoundId('')
    setIsSelectingRound(true)
  }

  const cancelRoundSelection = () => {
    resetAssignmentState()
    setSelectedRoundId('')
    setIsSelectingRound(false)
  }

  const handleAssignment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedRoundId) {
      return
    }

    const wasAssigned = await assignCharacterToRound(
      character.id,
      selectedRoundId,
    )

    if (wasAssigned) {
      setIsSelectingRound(false)
      setSelectedRoundId('')
      onChanged()
    }
  }

  const openRemovalConfirmation = () => {
    resetRemovalState()
    setIsConfirmingRemoval(true)
  }

  const cancelRemoval = () => {
    resetRemovalState()
    setIsConfirmingRemoval(false)
  }

  const confirmRemoval = async () => {
    const wasRemoved = await removeCharacterFromRound(character.id)

    if (wasRemoved) {
      setIsConfirmingRemoval(false)
      onChanged()
    }
  }

  return (
    <section
      aria-labelledby={`character-round-title-${character.id}`}
      className="character-round-assignment"
    >
      <div className="character-round-summary">
        <div>
          <h2 id={`character-round-title-${character.id}`}>Runde</h2>
          <p>{roundName}</p>
        </div>
        {character.round_id ? (
          <button
            className="character-round-secondary-action"
            disabled={isRemoving}
            onClick={openRemovalConfirmation}
            type="button"
          >
            Aus Runde lösen
          </button>
        ) : (
          <button
            className="character-round-secondary-action"
            disabled={isAssigning}
            onClick={openRoundSelection}
            type="button"
          >
            Runde zuweisen
          </button>
        )}
      </div>

      {!character.round_id && isSelectingRound && (
        <div className="character-round-panel">
          {isLoading ? (
            <p role="status">Runden werden geladen...</p>
          ) : roundsError ? (
            <div role="alert">
              <p>{roundsError}</p>
              <button
                className="character-round-secondary-action"
                onClick={reload}
                type="button"
              >
                Erneut versuchen
              </button>
            </div>
          ) : availableRounds.length === 0 ? (
            <p>Du bist aktuell keiner verfügbaren Runde zugeordnet.</p>
          ) : (
            <form className="character-round-form" onSubmit={handleAssignment}>
              <label className="auth-field">
                <span>Runde auswählen</span>
                <select
                  disabled={isAssigning}
                  onChange={(event) => {
                    setSelectedRoundId(event.target.value)
                    resetAssignmentState()
                  }}
                  value={selectedRoundId}
                >
                  <option value="">Keine Auswahl</option>
                  {availableRounds.map(({ round }) => (
                    <option key={round.id} value={round.id}>
                      {round.name}
                    </option>
                  ))}
                </select>
              </label>
              {assignmentError && (
                <p className="profile-form-error" role="alert">
                  {assignmentError}
                </p>
              )}
              <div className="character-round-actions">
                <button
                  className="auth-submit"
                  data-submitting={isAssigning}
                  disabled={isAssigning || !selectedRoundId}
                  type="submit"
                >
                  {isAssigning ? 'Wird zugewiesen...' : 'Zuweisen'}
                </button>
                <button
                  className="character-round-secondary-action"
                  disabled={isAssigning}
                  onClick={cancelRoundSelection}
                  type="button"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          )}
          {(isLoading || roundsError || availableRounds.length === 0) && (
            <button
              className="character-round-secondary-action"
              onClick={cancelRoundSelection}
              type="button"
            >
              Abbrechen
            </button>
          )}
        </div>
      )}

      {character.round_id && isConfirmingRemoval && (
        <div className="character-round-panel character-round-confirmation">
          <p>
            Möchtest du diesen Charakter wirklich aus der Runde lösen? Der
            Charakter bleibt in deiner Charakterbibliothek erhalten.
          </p>
          {removalError && (
            <p className="profile-form-error" role="alert">
              {removalError}
            </p>
          )}
          <div className="character-round-actions">
            <button
              className="character-round-confirm-action"
              data-submitting={isRemoving}
              disabled={isRemoving}
              onClick={() => void confirmRemoval()}
              type="button"
            >
              {isRemoving ? 'Wird gelöst...' : 'Aus Runde lösen'}
            </button>
            <button
              className="character-round-secondary-action"
              disabled={isRemoving}
              onClick={cancelRemoval}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default CharacterRoundAssignment
