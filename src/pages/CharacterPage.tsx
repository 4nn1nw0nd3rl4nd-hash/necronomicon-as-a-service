import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CharacterSheetRenderer } from '../components/CharacterSheetRenderer'
import { findCharacterTemplate } from '../characterTemplates'
import { useCharacter } from '../hooks/useCharacter'
import { useSetCharacterCheck } from '../hooks/useSetCharacterCheck'
import { useUpdateCharacter } from '../hooks/useUpdateCharacter'

function CharacterPage() {
  const { characterId } = useParams()
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
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(
    null,
  )
  const [draftName, setDraftName] = useState('')
  const [draftData, setDraftData] = useState<Record<string, unknown>>({})
  const [validationError, setValidationError] = useState<string | null>(null)

  const isEditing = editingCharacterId === character?.id

  const resetEditMessages = () => {
    setValidationError(null)
    resetUpdateState()
  }

  const startEditing = () => {
    if (!character || hasPendingCheckRequests) {
      return
    }

    setDraftName(character.name)
    setDraftData({ ...character.data })
    resetEditMessages()
    resetCheckState()
    setEditingCharacterId(character.id)
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

    content = (
      <article className="character-detail">
        <header className="character-detail-header">
          <div className="character-detail-title-row">
            <h1>{character.name}</h1>
            {template && !isEditing && (
              <button
                className="character-edit-button"
                disabled={hasPendingCheckRequests}
                onClick={startEditing}
                type="button"
              >
                Bearbeiten
              </button>
            )}
          </div>
          <p className="character-detail-template">
            {template?.name ?? 'Unbekannte Charaktervorlage'}
            <span>Version {character.template_version}</span>
          </p>
        </header>

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
      <Link className="round-detail-back" to="/app/characters">
        Zurück zu Meine Charaktere
      </Link>
      {content}
    </section>
  )
}

export default CharacterPage
