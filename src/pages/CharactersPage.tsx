import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { findCharacterTemplate } from '../characterTemplates'
import { useMyCharacters } from '../hooks/useMyCharacters'
import { useMyDeletedCharacters } from '../hooks/useMyDeletedCharacters'
import { useMyRounds } from '../hooks/useMyRounds'
import { useRestoreCharacter } from '../hooks/useRestoreCharacter'
import {
  formatCharacterDeletedAt,
  getCharacterRecoveryStatus,
} from '../lib/characterRecovery'

type CharacterSection = 'characters' | 'trash'

function getTemplateLabel(templateKey: string, templateVersion: number) {
  const template = findCharacterTemplate(templateKey, templateVersion)

  return template?.name ?? 'Unbekannte Charaktervorlage'
}

function CharactersPage() {
  const { user } = useAuth()
  const {
    characters,
    isLoading,
    error,
    reload: reloadCharacters,
  } = useMyCharacters()
  const {
    characters: deletedCharacters,
    isLoading: isTrashLoading,
    error: trashError,
    reload: reloadTrash,
  } = useMyDeletedCharacters()
  const { rounds: myRounds } = useMyRounds(user?.id)
  const {
    isSubmitting: isRestoring,
    error: restoreError,
    restoreCharacter,
    resetState: resetRestoreState,
  } = useRestoreCharacter()
  const [activeSection, setActiveSection] =
    useState<CharacterSection>('characters')
  const [restoreCharacterId, setRestoreCharacterId] = useState<string | null>(
    null,
  )

  const getRoundLabel = (
    roundId: string | null,
    missingRoundLabel = 'Einer Runde zugeordnet',
  ) => {
    if (!roundId) {
      return 'Keine Runde'
    }

    return (
      myRounds.find(({ round_id }) => round_id === roundId)?.round.name ??
      missingRoundLabel
    )
  }

  const changeSection = (section: CharacterSection) => {
    setActiveSection(section)
    setRestoreCharacterId(null)
    resetRestoreState()
  }

  const openRestoreConfirmation = (characterId: string) => {
    resetRestoreState()
    setRestoreCharacterId(characterId)
  }

  const closeRestoreConfirmation = () => {
    if (isRestoring) {
      return
    }

    setRestoreCharacterId(null)
    resetRestoreState()
  }

  const confirmRestore = async (characterId: string) => {
    const wasRestored = await restoreCharacter(characterId)

    if (!wasRestored) {
      return
    }

    setRestoreCharacterId(null)
    reloadTrash()
    reloadCharacters()
  }

  let charactersContent

  if (isLoading) {
    charactersContent = (
      <p className="rounds-state" role="status">
        Charaktere werden geladen...
      </p>
    )
  } else if (error) {
    charactersContent = (
      <div className="rounds-state" role="alert">
        <p>{error}</p>
        <button
          className="rounds-retry"
          type="button"
          onClick={reloadCharacters}
        >
          Erneut versuchen
        </button>
      </div>
    )
  } else if (characters.length === 0) {
    charactersContent = (
      <p className="rounds-state">Du hast noch keine Charaktere.</p>
    )
  } else {
    charactersContent = (
      <ul className="rounds-list">
        {characters.map((character) => (
          <li key={character.id}>
            <Link
              aria-label={`Charakter ${character.name} öffnen`}
              className="round-card-link"
              state={{
                characterReturnContext: { source: 'characters' },
              }}
              to={`/app/characters/${character.id}`}
            >
              <article className="round-card">
                <header className="round-card-header">
                  <h2>{character.name}</h2>
                </header>
                <dl className="round-details">
                  <div>
                    <dt>System</dt>
                    <dd>
                      {getTemplateLabel(
                        character.template_key,
                        character.template_version,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Rundenzuordnung</dt>
                    <dd>{getRoundLabel(character.round_id)}</dd>
                  </div>
                </dl>
              </article>
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  let trashContent

  if (isTrashLoading) {
    trashContent = (
      <p className="rounds-state" role="status">
        Papierkorb wird geladen...
      </p>
    )
  } else if (trashError) {
    trashContent = (
      <div className="rounds-state" role="alert">
        <p>{trashError}</p>
        <button className="rounds-retry" type="button" onClick={reloadTrash}>
          Erneut versuchen
        </button>
      </div>
    )
  } else if (deletedCharacters.length === 0) {
    trashContent = <p className="rounds-state">Dein Papierkorb ist leer.</p>
  } else {
    trashContent = (
      <ul className="rounds-list">
        {deletedCharacters.map((character) => {
          const recoveryStatus = getCharacterRecoveryStatus(
            character.deleted_at,
          )
          const isConfirmingRestore = restoreCharacterId === character.id

          return (
            <li key={character.id}>
              <article className="round-card character-trash-card">
                <header className="round-card-header">
                  <h2>{character.name}</h2>
                </header>
                <dl className="round-details">
                  <div>
                    <dt>System</dt>
                    <dd>
                      {getTemplateLabel(
                        character.template_key,
                        character.template_version,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Rundenzuordnung</dt>
                    <dd>
                      {getRoundLabel(
                        character.round_id,
                        'Zugeordnete Runde',
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Gelöscht am</dt>
                    <dd>
                      <time dateTime={character.deleted_at}>
                        {formatCharacterDeletedAt(character.deleted_at)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>Wiederherstellung</dt>
                    <dd>{recoveryStatus.label}</dd>
                  </div>
                </dl>

                {!isConfirmingRestore && !recoveryStatus.isExpired ? (
                  <button
                    className="character-restore-trigger"
                    type="button"
                    disabled={isRestoring}
                    onClick={() => openRestoreConfirmation(character.id)}
                  >
                    Wiederherstellen
                  </button>
                ) : null}

                {isConfirmingRestore ? (
                  <div className="character-restore-confirmation">
                    <p>
                      Möchtest du den Charakter „{character.name}“ wirklich
                      wiederherstellen?
                    </p>
                    <p>
                      Er erscheint anschließend wieder unter „Meine Charaktere“.
                      Eine bestehende Rundenzuordnung bleibt erhalten.
                    </p>
                    {restoreError ? <p role="alert">{restoreError}</p> : null}
                    <div className="character-restore-actions">
                      <button
                        className="character-restore-confirm"
                        type="button"
                        data-submitting={isRestoring}
                        disabled={isRestoring}
                        onClick={() => void confirmRestore(character.id)}
                      >
                        {isRestoring
                          ? 'Wird wiederhergestellt...'
                          : 'Wiederherstellen'}
                      </button>
                      <button
                        className="character-restore-cancel"
                        type="button"
                        disabled={isRestoring}
                        onClick={closeRestoreConfirmation}
                      >
                        Abbrechen
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <section className="rounds-page" aria-labelledby="characters-title">
      <h1 className="rounds-title" id="characters-title">
        Meine Charaktere
      </h1>
      <p>
        Hier findest du deine Charaktere – unabhängig davon, ob sie bereits
        einer Runde zugeordnet sind.
      </p>

      <div className="character-section-switch" aria-label="Charakterbereiche">
        <button
          className="character-section-button"
          type="button"
          aria-pressed={activeSection === 'characters'}
          data-active={activeSection === 'characters'}
          onClick={() => changeSection('characters')}
        >
          Charaktere
        </button>
        <button
          className="character-section-button"
          type="button"
          aria-pressed={activeSection === 'trash'}
          data-active={activeSection === 'trash'}
          onClick={() => changeSection('trash')}
        >
          Papierkorb
        </button>
      </div>

      {activeSection === 'characters' ? (
        <>
          <Link className="characters-create-link" to="/app/characters/new">
            Charakter erstellen
          </Link>
          {charactersContent}
        </>
      ) : (
        trashContent
      )}
    </section>
  )
}

export default CharactersPage
