import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { findCharacterTemplate } from '../characterTemplates'
import { useAssignPreparedCharacter } from '../hooks/useAssignPreparedCharacter'
import { useAssignPreparedCharacterKeepCopy } from '../hooks/useAssignPreparedCharacterKeepCopy'
import { useRoundCharacters } from '../hooks/useRoundCharacters'
import { useSetActiveCharacter } from '../hooks/useSetActiveCharacter'
import type { RoundCharacterSummary } from '../types/character'
import type {
  RoundMember,
  RoundMembershipRole,
  RoundStatus,
} from '../types/round'

type RoundCharactersSectionProps = {
  roundId: string
  roundStatus: RoundStatus
  membershipRole: RoundMembershipRole | null
  members: RoundMember[]
  currentUserId: string | undefined
  onMembershipsReload: () => void
}

function getTemplateName(templateKey: string, templateVersion: number) {
  return (
    findCharacterTemplate(templateKey, templateVersion)?.name ??
    'Unbekannte Charaktervorlage'
  )
}

function getMemberName(member: RoundMember) {
  return member.profile.display_name.trim() || 'Mitglied'
}

function normalizeCharacterName(name: string) {
  return name.trim().toLocaleLowerCase('de-DE')
}

function getActiveCharacterStatus(
  member: RoundMember,
  characters: RoundCharacterSummary[],
) {
  const ownedCharacters = characters.filter(
    ({ owner_user_id }) => owner_user_id === member.user_id,
  )

  if (ownedCharacters.length === 0) {
    return 'Kein Charakter zugeordnet'
  }

  if (!member.active_character_id) {
    return 'Kein aktiver Charakter ausgewählt'
  }

  const activeCharacter = ownedCharacters.find(
    ({ id }) => id === member.active_character_id,
  )

  return activeCharacter
    ? `Aktiver Charakter: ${activeCharacter.name}`
    : 'Aktiver Charakter ist nicht verfügbar'
}

function RoundCharactersSection({
  roundId,
  roundStatus,
  membershipRole,
  members,
  currentUserId,
  onMembershipsReload,
}: RoundCharactersSectionProps) {
  const { characters, isLoading, error, reload } =
    useRoundCharacters(roundId)
  const {
    isSubmitting: isAssigningWithoutCopy,
    error: assignmentWithoutCopyError,
    assignPreparedCharacter,
    resetState: resetAssignmentWithoutCopyState,
  } = useAssignPreparedCharacter()
  const {
    isSubmitting: isAssigningWithCopy,
    error: assignmentWithCopyError,
    assignPreparedCharacterKeepCopy,
    resetState: resetAssignmentWithCopyState,
  } = useAssignPreparedCharacterKeepCopy()
  const {
    isSubmitting: isSettingActiveCharacter,
    activeCharacterId: activeCharacterRequestId,
    error: setActiveCharacterError,
    setActiveCharacter,
    resetState: resetSetActiveCharacterState,
  } = useSetActiveCharacter()
  const [assignmentCharacterId, setAssignmentCharacterId] = useState<
    string | null
  >(null)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [isConfirmingAssignment, setIsConfirmingAssignment] =
    useState(false)
  const isAssignmentRequestInFlightRef = useRef(false)
  const isGameMaster = membershipRole === 'game_master'
  const isAssignmentSubmitting =
    isAssigningWithoutCopy || isAssigningWithCopy
  const assignmentError =
    assignmentWithoutCopyError ?? assignmentWithCopyError

  const resetAssignmentState = () => {
    resetAssignmentWithoutCopyState()
    resetAssignmentWithCopyState()
  }

  const handleSetActiveCharacter = async (characterId: string) => {
    resetSetActiveCharacterState()
    const wasSet = await setActiveCharacter(characterId)

    if (wasSet) {
      onMembershipsReload()
    }
  }

  const openAssignment = (characterId: string) => {
    if (
      isAssignmentRequestInFlightRef.current ||
      isAssignmentSubmitting
    ) {
      return
    }

    resetAssignmentState()
    setAssignmentCharacterId(characterId)
    setSelectedUserId('')
    setIsConfirmingAssignment(false)
  }

  const cancelAssignment = () => {
    if (
      isAssignmentRequestInFlightRef.current ||
      isAssignmentSubmitting
    ) {
      return
    }

    resetAssignmentState()
    setAssignmentCharacterId(null)
    setSelectedUserId('')
    setIsConfirmingAssignment(false)
  }

  const confirmAssignment = async (keepCopy: boolean) => {
    if (
      !assignmentCharacterId ||
      !selectedUserId ||
      isAssignmentRequestInFlightRef.current
    ) {
      return
    }

    isAssignmentRequestInFlightRef.current = true
    resetAssignmentState()

    try {
      const wasAssigned = keepCopy
        ? await assignPreparedCharacterKeepCopy(
            assignmentCharacterId,
            selectedUserId,
          )
        : await assignPreparedCharacter(
            assignmentCharacterId,
            selectedUserId,
          )

      if (wasAssigned) {
        setAssignmentCharacterId(null)
        setSelectedUserId('')
        setIsConfirmingAssignment(false)
        reload()
        onMembershipsReload()
      }
    } finally {
      isAssignmentRequestInFlightRef.current = false
    }
  }

  let content

  if (isLoading) {
    content = (
      <p className="round-members-state" role="status">
        Charaktere werden geladen...
      </p>
    )
  } else if (error) {
    content = (
      <div className="round-members-state" role="alert">
        <p>{error}</p>
        <button className="rounds-retry" onClick={reload} type="button">
          Erneut versuchen
        </button>
      </div>
    )
  } else if (characters.length === 0) {
    content = (
      <p className="round-members-state">
        {isGameMaster
          ? 'Dieser Runde sind noch keine Charaktere zugeordnet.'
          : 'Du hast dieser Runde noch keinen Charakter zugeordnet.'}
      </p>
    )
  } else {
    content = (
      <ul className="round-characters-list">
        {characters.map((character) => {
          const owner = character.owner_user_id
            ? members.find(
                ({ user_id }) => user_id === character.owner_user_id,
              )
            : null
          const ownerMembership = character.owner_user_id
            ? members.find(
                ({ user_id }) => user_id === character.owner_user_id,
              )
            : null
          const isActiveCharacter =
            ownerMembership?.active_character_id === character.id
          const canSetActiveCharacter = Boolean(
            character.owner_user_id &&
              ownerMembership &&
              !isActiveCharacter &&
              (isGameMaster ||
                character.owner_user_id === currentUserId),
          )
          const selectedMember = members.find(
            ({ user_id }) => user_id === selectedUserId,
          )
          const hasVisibleNameCollision =
            Boolean(selectedUserId) &&
            characters.some(
              (visibleCharacter) =>
                visibleCharacter.id !== character.id &&
                visibleCharacter.owner_user_id === selectedUserId &&
                normalizeCharacterName(visibleCharacter.name) ===
                  normalizeCharacterName(character.name),
            )
          const isAssignmentOpen =
            assignmentCharacterId === character.id
          const canAssignCharacter =
            isGameMaster &&
            roundStatus !== 'archived' &&
            character.owner_user_id === null

          return (
            <li className="round-character-item" key={character.id}>
              <Link
                aria-label={`Charakter ${character.name} öffnen`}
                className="round-character-link"
                state={{
                  characterReturnContext: { source: 'round', roundId },
                }}
                to={`/app/characters/${character.id}`}
              >
                <article className="round-character-card">
                  <h3>{character.name}</h3>
                  <p>
                    {getTemplateName(
                      character.template_key,
                      character.template_version,
                    )}
                  </p>
                  {isGameMaster && (
                    <span className="round-character-owner">
                      {character.owner_user_id
                        ? owner?.profile.display_name ?? 'Spieler'
                        : 'Vorbereitet'}
                    </span>
                  )}
                  {isActiveCharacter && (
                    <span className="round-character-active-badge">
                      Aktiv
                    </span>
                  )}
                </article>
              </Link>
              {canSetActiveCharacter && (
                <button
                  className="round-character-set-active"
                  data-submitting={
                    isSettingActiveCharacter &&
                    activeCharacterRequestId === character.id
                  }
                  disabled={isSettingActiveCharacter}
                  onClick={() =>
                    void handleSetActiveCharacter(character.id)
                  }
                  type="button"
                >
                  {isSettingActiveCharacter &&
                  activeCharacterRequestId === character.id
                    ? 'Wird als aktiv gesetzt...'
                    : 'Als aktiv setzen'}
                </button>
              )}
              {canAssignCharacter && (
                <button
                  aria-controls={`round-character-assignment-${character.id}`}
                  aria-expanded={isAssignmentOpen}
                  className="round-character-assign-trigger"
                  disabled={isAssignmentSubmitting}
                  onClick={() => openAssignment(character.id)}
                  type="button"
                >
                  Spieler zuweisen
                </button>
              )}
              {canAssignCharacter && isAssignmentOpen && (
                <div
                  className="round-character-assignment-panel"
                  id={`round-character-assignment-${character.id}`}
                >
                  {!isConfirmingAssignment ? (
                    <>
                      {members.length > 0 ? (
                        <label className="auth-field">
                          <span>Spieler auswählen</span>
                          <select
                            onChange={(event) => {
                              setSelectedUserId(event.target.value)
                              resetAssignmentState()
                            }}
                            value={selectedUserId}
                          >
                            <option value="">Keine Auswahl</option>
                            {members.map((member) => (
                              <option
                                key={member.user_id}
                                value={member.user_id}
                              >
                                {getMemberName(member)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <p>Keine Mitglieder verfügbar.</p>
                      )}
                      <div className="round-character-assignment-actions">
                        {members.length > 0 && (
                          <button
                            className="round-character-assignment-primary"
                            disabled={!selectedUserId}
                            onClick={() => setIsConfirmingAssignment(true)}
                            type="button"
                          >
                            Weiter
                          </button>
                        )}
                        <button
                          className="round-character-assignment-secondary"
                          onClick={cancelAssignment}
                          type="button"
                        >
                          Abbrechen
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>
                        {`Möchtest du „${character.name}“ wirklich „${
                          selectedMember
                            ? getMemberName(selectedMember)
                            : 'Mitglied'
                        }“ zuweisen?`}
                      </p>
                      {hasVisibleNameCollision && (
                        <p className="round-character-name-collision">
                          Dieser Spieler hat in dieser Runde bereits einen
                          Charakter namens „{character.name.trim()}“. Beide
                          Charaktere bleiben unabhängig voneinander und dürfen
                          denselben Namen tragen.
                        </p>
                      )}
                      <p>
                        Nach der Zuweisung gehört der Charakter dauerhaft
                        diesem Spieler. Du kannst ihn als Spielleitung dieser
                        Runde weiterhin ansehen und bearbeiten, aber nicht mehr
                        löschen, kopieren oder einem anderen Spieler zuweisen.
                      </p>
                      <div className="round-character-assignment-options">
                        <p>
                          <strong>Dauerhaft zuweisen:</strong> Der Charakter
                          geht an den Spieler. Es wird keine Kopie erstellt.
                        </p>
                        <p>
                          <strong>
                            Kopie behalten &amp; dauerhaft zuweisen:
                          </strong>{' '}
                          Der Charakter geht an den Spieler. Zusätzlich bleibt
                          eine unabhängige vorbereitete Kopie in dieser Runde
                          erhalten.
                        </p>
                      </div>
                      {assignmentError && (
                        <p className="profile-form-error" role="alert">
                          {assignmentError}
                        </p>
                      )}
                      <div className="round-character-assignment-actions">
                        <button
                          className="round-character-assignment-primary"
                          data-submitting={isAssignmentSubmitting}
                          disabled={
                            isAssignmentSubmitting || !selectedMember
                          }
                          onClick={() => void confirmAssignment(false)}
                          type="button"
                        >
                          {isAssigningWithoutCopy
                            ? 'Wird zugewiesen...'
                            : hasVisibleNameCollision
                              ? 'Trotzdem dauerhaft zuweisen'
                              : 'Dauerhaft zuweisen'}
                        </button>
                        <button
                          className="round-character-assignment-primary"
                          data-submitting={isAssignmentSubmitting}
                          disabled={
                            isAssignmentSubmitting || !selectedMember
                          }
                          onClick={() => void confirmAssignment(true)}
                          type="button"
                        >
                          {isAssigningWithCopy
                            ? 'Kopie wird erstellt und zugewiesen...'
                            : hasVisibleNameCollision
                              ? 'Kopie behalten & trotzdem zuweisen'
                              : 'Kopie behalten & dauerhaft zuweisen'}
                        </button>
                        <button
                          className="round-character-assignment-secondary"
                          disabled={isAssignmentSubmitting}
                          onClick={cancelAssignment}
                          type="button"
                        >
                          Abbrechen
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <section
      aria-labelledby="round-characters-title"
      className="round-members-card round-characters-card"
    >
      <div className="round-characters-header">
        <h2 className="round-members-title" id="round-characters-title">
          Charaktere
        </h2>
        {isGameMaster && roundStatus !== 'archived' && (
          <Link
            className="round-characters-create-link"
            to={`/app/rounds/${roundId}/characters/new`}
          >
            Vorbereiteten Charakter erstellen
          </Link>
        )}
      </div>
      {!isLoading && !error && isGameMaster && members.length > 0 && (
        <ul
          aria-label="Aktive Charaktere der Rundenmitglieder"
          className="round-character-active-overview"
        >
          {members.map((member) => (
            <li key={member.id}>
              <strong>{getMemberName(member)}</strong>
              <span>{getActiveCharacterStatus(member, characters)}</span>
            </li>
          ))}
        </ul>
      )}
      {!isLoading &&
        !error &&
        !isGameMaster &&
        currentUserId &&
        members.find(({ user_id }) => user_id === currentUserId) &&
        characters.some(
          ({ owner_user_id }) => owner_user_id === currentUserId,
        ) && (
          <p className="round-character-player-active-status">
            {getActiveCharacterStatus(
              members.find(
                ({ user_id }) => user_id === currentUserId,
              )!,
              characters,
            )}
          </p>
        )}
      {setActiveCharacterError && (
        <p className="profile-form-error" role="alert">
          {setActiveCharacterError}
        </p>
      )}
      {content}
    </section>
  )
}

export default RoundCharactersSection
