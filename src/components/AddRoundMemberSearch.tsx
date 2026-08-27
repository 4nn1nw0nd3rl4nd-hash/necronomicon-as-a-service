import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useAddRoundPlayer } from '../hooks/useAddRoundPlayer'
import { useProfileSearch } from '../hooks/useProfileSearch'
import type { RoundMember } from '../types/round'

type AddRoundMemberSearchProps = {
  roundId: string
  currentUserId: string
  members: RoundMember[]
  onPlayerAdded: () => void
}

function AddRoundMemberSearch({
  roundId,
  currentUserId,
  members,
  onPlayerAdded,
}: AddRoundMemberSearchProps) {
  const {
    result,
    isSearching,
    error,
    searchByUsername,
    resetSearch,
  } = useProfileSearch()
  const {
    isSubmitting,
    error: addError,
    isSuccess,
    addPlayer,
    resetState: resetAddState,
  } = useAddRoundPlayer()
  const [username, setUsername] = useState('')

  const handleUsernameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUsername(event.target.value)

    if (error || result) {
      resetSearch()
    }

    if (addError || isSuccess) {
      resetAddState()
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (addError || isSuccess) {
      resetAddState()
    }

    void searchByUsername(username)
  }

  const handleAddPlayer = async () => {
    if (!result) {
      return
    }

    const wasAdded = await addPlayer(roundId, result.id)

    if (wasAdded) {
      setUsername('')
      resetSearch()
      onPlayerAdded()
    }
  }

  const isCurrentUser = result?.id === currentUserId
  const isExistingMember = result
    ? members.some((member) => member.user_id === result.id)
    : false
  const membershipNotice = isCurrentUser
    ? 'Du bist bereits Mitglied dieser Runde.'
    : isExistingMember
      ? 'Dieser Nutzer ist bereits Mitglied der Runde.'
      : null

  return (
    <section
      className="add-round-member-search"
      aria-labelledby="add-round-member-search-title"
    >
      <h3
        className="add-round-member-search-title"
        id="add-round-member-search-title"
      >
        Spieler hinzufügen
      </h3>
      <form
        className="add-round-member-search-form"
        aria-labelledby="add-round-member-search-title"
        onSubmit={handleSubmit}
        noValidate
      >
        <label className="auth-field" htmlFor="round-member-username">
          <span>Benutzername</span>
          <input
            id="round-member-username"
            type="text"
            autoComplete="off"
            value={username}
            onChange={handleUsernameChange}
            disabled={isSearching || isSubmitting}
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
      {error && (
        <p className="profile-form-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="round-member-search-result" role="status">
          <div className="round-member-identity">
            <strong>{result.display_name}</strong>
            <span>@{result.username}</span>
          </div>
          {membershipNotice && (
            <p className="round-member-search-notice">
              {membershipNotice}
            </p>
          )}
          {!isCurrentUser && !isExistingMember && (
            <button
              className="auth-submit round-member-search-action"
              type="button"
              disabled={isSubmitting}
              data-submitting={isSubmitting}
              onClick={handleAddPlayer}
            >
              {isSubmitting
                ? 'Wird hinzugefügt...'
                : 'Spieler hinzufügen'}
            </button>
          )}
        </div>
      )}
      {addError && (
        <p className="profile-form-error" role="alert">
          {addError}
        </p>
      )}
      {isSuccess && (
        <p className="profile-form-success" role="status">
          Spieler wurde hinzugefügt.
        </p>
      )}
    </section>
  )
}

export default AddRoundMemberSearch
