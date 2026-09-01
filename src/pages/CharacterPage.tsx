import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import CharacterRoundAssignment from '../components/CharacterRoundAssignment'
import { CharacterSheetRenderer } from '../components/CharacterSheetRenderer'
import { findCharacterTemplate } from '../characterTemplates'
import { useCharacter } from '../hooks/useCharacter'
import { useCopyCharacter } from '../hooks/useCopyCharacter'
import { useSetCharacterCheck } from '../hooks/useSetCharacterCheck'
import { useUpdateCharacter } from '../hooks/useUpdateCharacter'

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getReturnLink(locationState: unknown) {
  const fallback = {
    label: 'Zurück zu Meine Charaktere',
    to: '/app/characters',
  }

  if (!locationState || typeof locationState !== 'object') {
    return fallback
  }

  const context = Reflect.get(locationState, 'characterReturnContext')

  if (!context || typeof context !== 'object') {
    return fallback
  }

  const source = Reflect.get(context, 'source')

  if (source === 'characters') {
    return fallback
  }

  const roundId = Reflect.get(context, 'roundId')

  if (
    source === 'round' &&
    typeof roundId === 'string' &&
    uuidPattern.test(roundId)
  ) {
    return {
      label: 'Zurück zur Runde',
      to: `/app/rounds/${roundId}`,
    }
  }

  return fallback
}

function CharacterPage() {
  const { characterId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const returnLink = getReturnLink(location.state)
  const { user } = useAuth()
  const {
    character,
    isLoading,
    error,
    reload,
    updateCharacterDataField,
  } = useCharacter(characterId)
  const {
    error: checkError,
    hasPendingRequests: hasPendingCheckRequests,
    isFieldSubmitting: isCheckSubmitting,
    setCharacterCheck,
    resetState: resetCheckState,
  } = useSetCharacterCheck(characterId)
  const {
    isSubmitting,
    error: updateError,
    updateCharacter,
    resetState: resetUpdateState,
  } = useUpdateCharacter()
  const {
    isSubmitting: isCopying,
    error: copyError,
    copyCharacter,
    resetState: resetCopyState,
  } = useCopyCharacter()
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(
    null,
  )
  const [draftName, setDraftName] = useState('')
  const [draftData, setDraftData] = useState<Record<string, unknown>>({})
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isCopyConfirmationOpen, setIsCopyConfirmationOpen] =
    useState(false)

  const isEditing = editingCharacterId === character?.id

  const resetEditMessages = () => {
    setValidationError(null)
    resetUpdateState()
  }

  const startEditing = () => {
    if (!character || hasPendingCheckRequests || isCopying) {
      return
    }

    setIsCopyConfirmationOpen(false)
    resetCopyState()
    setDraftName(character.name)
    setDraftData({ ...character.data })
    resetEditMessages()
    resetCheckState()
    setEditingCharacterId(character.id)
  }

  const openCopyConfirmation = () => {
    if (isCopying) {
      return
    }

    resetCopyState()
    setIsCopyConfirmationOpen(true)
  }

  const cancelCopyConfirmation = () => {
    if (isCopying) {
      return
    }

    resetCopyState()
    setIsCopyConfirmationOpen(false)
  }

  const confirmCopy = async () => {
    if (!character) {
      return
    }

    const newCharacterId = await copyCharacter(character.id)

    if (newCharacterId) {
      setIsCopyConfirmationOpen(false)
      navigate(`/app/characters/${newCharacterId}`, {
        state: {
          characterReturnContext: { source: 'characters' },
        },
      })
    }
  }

  const cancelEditing = () => {
    setEditingCharacterId(null)
    setDraftName('')
    setDraftData({})
    resetEditMessages()
  }

  const handleNameChange = (value: string) => {
    setDraftName(value)
    resetEditMessages()
  }

  const handleDataFieldChange = (key: string, value: string | boolean) => {
    setDraftData((currentData) => ({
      ...currentData,
      [key]: value,
    }))
    resetEditMessages()
  }

  const handleViewCheckChange = async (
    fieldKey: string,
    checked: boolean,
  ) => {
    if (!character || isEditing) {
      return
    }

    const request = setCharacterCheck(fieldKey, checked)

    if (!request) {
      return
    }

    const previousValue = character.data?.[fieldKey] === true
    updateCharacterDataField(fieldKey, checked)

    const wasSaved = await request

    if (!wasSaved) {
      updateCharacterDataField(fieldKey, previousValue)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedName = draftName.trim()

    if (!normalizedName) {
      setValidationError('Bitte gib einen Namen für den Charakter ein.')
      return
    }

    if (normalizedName.length > 100) {
      setValidationError('Der Name darf höchstens 100 Zeichen lang sein.')
      return
    }

    if (!character) {
      return
    }

    const wasUpdated = await updateCharacter(
      character.id,
      normalizedName,
      draftData,
    )

    if (wasUpdated) {
      setEditingCharacterId(null)
      setDraftName('')
      setDraftData({})
      setValidationError(null)
      reload()
    }
  }

  let content

  if (isLoading) {
    content = (
      <p className="round-detail-state" role="status">
        Charakter wird geladen...
      </p>
    )
  } else if (error || !character) {
    content = (
      <div className="round-detail-state" role="alert">
        <p>{error ?? 'Charakter nicht verfügbar.'}</p>
        {characterId && (
          <button className="rounds-retry" type="button" onClick={reload}>
            Erneut versuchen
          </button>
        )}
      </div>
    )
  } else {
    const template = findCharacterTemplate(
      character.template_key,
      character.template_version,
    )
    const isCharacterOwner = character.owner_user_id === user?.id

    content = (
      <article className="character-detail">
        <header className="character-detail-header">
          <div className="character-detail-title-row">
            <h1>{character.name}</h1>
            {!isEditing && (template || isCharacterOwner) && (
              <div className="character-detail-actions">
                {template && (
                  <button
                    className="character-edit-button"
                    disabled={hasPendingCheckRequests || isCopying}
                    onClick={startEditing}
                    type="button"
                  >
                    Bearbeiten
                  </button>
                )}
                {isCharacterOwner && (
                  <button
                    aria-controls="character-copy-confirmation"
                    aria-expanded={isCopyConfirmationOpen}
                    className="character-copy-trigger"
                    disabled={isCopying}
                    onClick={openCopyConfirmation}
                    type="button"
                  >
                    Charakter kopieren
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="character-detail-template">
            {template?.name ?? 'Unbekannte Charaktervorlage'}
            <span>Version {character.template_version}</span>
          </p>
        </header>

        {isCharacterOwner && isCopyConfirmationOpen && !isEditing && (
          <section
            aria-labelledby="character-copy-title"
            className="character-copy-confirmation"
            id="character-copy-confirmation"
          >
            <h2 id="character-copy-title">Charakter kopieren</h2>
            <p>
              Eine unabhängige Kopie dieses Charakters wird erstellt. Die
              Kopie ist zunächst keiner Runde zugeordnet.
            </p>
            {copyError && (
              <p className="profile-form-error" role="alert">
                {copyError}
              </p>
            )}
            <div className="character-copy-actions">
              <button
                className="character-copy-confirm"
                data-submitting={isCopying}
                disabled={isCopying}
                onClick={() => void confirmCopy()}
                type="button"
              >
                {isCopying ? 'Wird kopiert...' : 'Kopieren'}
              </button>
              <button
                className="character-copy-cancel"
                disabled={isCopying}
                onClick={cancelCopyConfirmation}
                type="button"
              >
                Abbrechen
              </button>
            </div>
          </section>
        )}

        {user &&
          character.owner_user_id === user.id &&
          !isEditing && (
            <CharacterRoundAssignment
              character={character}
              onChanged={reload}
              ownerUserId={user.id}
            />
          )}

        {template ? (
          isEditing ? (
            <form className="character-edit-form" onSubmit={handleSubmit}>
              <CharacterSheetRenderer
                character={character}
                draftData={draftData}
                draftName={draftName}
                isDisabled={isSubmitting}
                mode="edit"
                onDataFieldChange={handleDataFieldChange}
                onNameChange={handleNameChange}
                template={template}
              />
              {(validationError || updateError) && (
                <p className="profile-form-error" role="alert">
                  {validationError ?? updateError}
                </p>
              )}
              <div className="character-edit-actions">
                <button
                  className="auth-submit"
                  data-submitting={isSubmitting}
                  disabled={isSubmitting || !draftName.trim()}
                  type="submit"
                >
                  {isSubmitting ? 'Speichern...' : 'Speichern'}
                </button>
                <button
                  className="character-edit-cancel"
                  disabled={isSubmitting}
                  onClick={cancelEditing}
                  type="button"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          ) : (
            <CharacterSheetRenderer
              character={character}
              isCheckSubmitting={isCheckSubmitting}
              mode="view"
              onCheckChange={(fieldKey, checked) =>
                void handleViewCheckChange(fieldKey, checked)
              }
              template={template}
            />
          )
        ) : (
          <p className="character-template-unavailable" role="status">
            Diese Charaktervorlage ist derzeit nicht verfügbar.
          </p>
        )}
        {checkError && !isEditing && (
          <p className="profile-form-error" role="alert">
            {checkError}
          </p>
        )}
      </article>
    )
  }

  return (
    <section className="character-detail-page">
      <Link className="round-detail-back" to={returnLink.to}>
        {returnLink.label}
      </Link>
      {content}
    </section>
  )
}

export default CharacterPage
