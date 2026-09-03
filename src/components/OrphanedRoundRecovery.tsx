import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useProfileSearch } from '../hooks/useProfileSearch'
import { useRecoverOrphanedRound } from '../hooks/useRecoverOrphanedRound'
import type {
  RecoveryCandidateProfile,
  RoundMember,
} from '../types/round'

type OrphanedRoundRecoveryProps = {
  roundId: string
  roundName: string
  currentUserId: string
  members: RoundMember[]
  areMembersLoading: boolean
  membersError: string | null
  onReloadMembers: () => void
  onRecovered: () => void
}

function getCandidateName(candidate: RecoveryCandidateProfile) {
  return candidate.display_name || candidate.username
}

function OrphanedRoundRecovery({
  roundId,
  roundName,
  currentUserId,
  members,
  areMembersLoading,
  membersError,
  onReloadMembers,
  onRecovered,
}: OrphanedRoundRecoveryProps) {
  const {
    result,
    isSearching,
    error: searchError,
    searchByUsername,
    resetSearch,
  } = useProfileSearch()
  const {
    isSubmitting,
    error: recoveryError,
    recover,
    resetState: resetRecoveryState,
  } = useRecoverOrphanedRound()
  const [isOpen, setIsOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [selectedCandidate, setSelectedCandidate] =
    useState<RecoveryCandidateProfile | null>(null)

  const eligiblePlayers = members.filter(
    (member) =>
      member.role === 'player' &&
      member.user_id !== currentUserId &&
      member.profile.is_superadmin === false &&
      member.profile.deletion_pending_at === null,
  )
  const searchedMembership = result
    ? members.find((member) => member.user_id === result.id)
    : undefined
  const searchedCandidateNotice = !result
    ? null
    : result.id === currentUserId
      ? 'Der Superadmin kann nicht als Spielleitung eingesetzt werden.'
      : result.is_superadmin
        ? 'Ein Superadmin kann nicht als Spielleitung eingesetzt werden.'
        : result.deletion_pending_at !== null
          ? 'Für diesen Nutzer ist bereits eine Löschung vorbereitet.'
          : searchedMembership?.role === 'game_master'
            ? 'Dieser Nutzer ist bereits Spielleitung der Runde.'
            : null

  const openRecovery = () => {
    resetSearch()
    resetRecoveryState()
    setUsername('')
    setSelectedCandidate(null)
    setIsOpen(true)
  }

  const closeRecovery = () => {
    if (isSubmitting) {
      return
    }

    resetSearch()
    resetRecoveryState()
    setUsername('')
    setSelectedCandidate(null)
    setIsOpen(false)
  }

  const handleUsernameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUsername(event.target.value)

    if (searchError || result) {
      resetSearch()
    }

    if (recoveryError) {
      resetRecoveryState()
    }
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    resetRecoveryState()
    void searchByUsername(username)
  }

  const selectCandidate = (candidate: RecoveryCandidateProfile) => {
    resetRecoveryState()
    setSelectedCandidate(candidate)
  }

  const confirmRecovery = async () => {
    if (!selectedCandidate) {
      return
    }

    const wasRecovered = await recover(roundId, selectedCandidate.id)

    if (wasRecovered) {
      setIsOpen(false)
      setUsername('')
      setSelectedCandidate(null)
      resetSearch()
      onRecovered()
    }
  }

  if (!isOpen) {
    return (
      <button
        className="orphaned-round-recovery-trigger"
        type="button"
        onClick={openRecovery}
      >
        Neue Spielleitung festlegen
      </button>
    )
  }

  return (
    <section
      className="orphaned-round-recovery"
      aria-labelledby="orphaned-round-recovery-title"
    >
      <div className="orphaned-round-recovery-header">
        <div>
          <h2 id="orphaned-round-recovery-title">
            Neue Spielleitung festlegen
          </h2>
          <p>Die Runde bleibt anschließend archiviert.</p>
        </div>
        <button
          className="orphaned-round-recovery-cancel"
          type="button"
          disabled={isSubmitting}
          onClick={closeRecovery}
        >
          Abbrechen
        </button>
      </div>

      <div className="orphaned-round-recovery-section">
        <h3>Vorhandene Spieler</h3>
        {areMembersLoading ? (
          <p className="orphaned-round-recovery-note" role="status">
            Spieler werden geladen...
          </p>
        ) : membersError ? (
          <div className="orphaned-round-recovery-note">
            <p role="alert">{membersError}</p>
            <button type="button" onClick={onReloadMembers}>
              Erneut versuchen
            </button>
          </div>
        ) : eligiblePlayers.length === 0 ? (
          <p className="orphaned-round-recovery-note">
            Keine geeigneten vorhandenen Spieler gefunden.
          </p>
        ) : (
          <div
            className="orphaned-round-player-options"
            role="group"
            aria-label="Vorhandenen Spieler auswählen"
          >
            {eligiblePlayers.map((member) => (
              <button
                className="orphaned-round-player-option"
                type="button"
                key={member.id}
                aria-pressed={selectedCandidate?.id === member.user_id}
                disabled={isSubmitting}
                onClick={() => selectCandidate(member.profile)}
              >
                <strong>{member.profile.display_name}</strong>
                <span>@{member.profile.username}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="orphaned-round-recovery-section">
        <h3>Anderen Nutzer auswählen</h3>
        <form
          className="orphaned-round-user-search"
          onSubmit={handleSearch}
          noValidate
        >
          <label className="auth-field" htmlFor="recovery-username">
            <span>Benutzername</span>
            <input
              id="recovery-username"
              type="text"
              autoComplete="off"
              value={username}
              disabled={isSearching || isSubmitting}
              onChange={handleUsernameChange}
            />
          </label>
          <button
            className="auth-submit"
            type="submit"
            disabled={isSearching || isSubmitting || !username.trim()}
            data-submitting={isSearching}
          >
            {isSearching ? 'Suchen...' : 'Suchen'}
          </button>
        </form>
        {searchError && (
          <p className="profile-form-error" role="alert">
            {searchError}
          </p>
        )}
        {result && (
          <div className="orphaned-round-search-result">
            <div className="round-member-identity">
              <strong>{result.display_name}</strong>
              <span>@{result.username}</span>
            </div>
            {searchedCandidateNotice ? (
              <p className="orphaned-round-recovery-note">
                {searchedCandidateNotice}
              </p>
            ) : (
              <button
                className="orphaned-round-select-user"
                type="button"
                disabled={isSubmitting}
                onClick={() => selectCandidate(result)}
              >
                Auswählen
              </button>
            )}
          </div>
        )}
      </div>

      {selectedCandidate && (
        <div className="orphaned-round-recovery-confirmation">
          <p>
            „{getCandidateName(selectedCandidate)}“ als neue Spielleitung
            für „{roundName}“ festlegen?
          </p>
          <p className="orphaned-round-recovery-note">
            Die Runde bleibt anschließend archiviert.
          </p>
          {recoveryError && (
            <p className="profile-form-error" role="alert">
              {recoveryError}
            </p>
          )}
          <div className="orphaned-round-recovery-actions">
            <button
              className="orphaned-round-recovery-confirm"
              type="button"
              disabled={isSubmitting}
              data-submitting={isSubmitting}
              onClick={() => void confirmRecovery()}
            >
              {isSubmitting
                ? 'Wird festgelegt...'
                : 'Spielleitung festlegen'}
            </button>
            <button
              className="orphaned-round-recovery-cancel"
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                resetRecoveryState()
                setSelectedCandidate(null)
              }}
            >
              Auswahl ändern
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default OrphanedRoundRecovery
