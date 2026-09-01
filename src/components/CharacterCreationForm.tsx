import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { availableCharacterTemplates } from '../characterTemplates'
import type { CharacterTemplateDefinition } from '../characterTemplates'
import { useCreateCharacter } from '../hooks/useCreateCharacter'

type CharacterCreationFormProps = {
  isPrepared?: boolean
  roundId?: string | null
  onCreated: (characterId: string) => void
}

function getTemplateId(template: CharacterTemplateDefinition) {
  return `${template.key}@${template.version}`
}

function CharacterCreationForm({
  isPrepared = false,
  roundId = null,
  onCreated,
}: CharacterCreationFormProps) {
  const { isSubmitting, error, createCharacter, resetState } =
    useCreateCharacter({ isPrepared, roundId })
  const [name, setName] = useState('')
  const [selectedTemplate, setSelectedTemplate] =
    useState<CharacterTemplateDefinition | null>(
      availableCharacterTemplates[0] ?? null,
    )
  const [validationError, setValidationError] = useState<string | null>(
    null,
  )

  const clearErrors = () => {
    setValidationError(null)

    if (error) {
      resetState()
    }
  }

  const handleNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value)
    clearErrors()
  }

  const handleTemplateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const template = availableCharacterTemplates.find(
      (candidate) => getTemplateId(candidate) === event.target.value,
    )

    setSelectedTemplate(template ?? null)
    clearErrors()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isSubmitting) {
      return
    }

    const normalizedName = name.trim()

    if (!normalizedName) {
      setValidationError('Bitte gib einen Namen für den Charakter ein.')
      return
    }

    if (normalizedName.length > 100) {
      setValidationError('Der Name darf höchstens 100 Zeichen lang sein.')
      return
    }

    if (!selectedTemplate) {
      setValidationError('Bitte wähle eine Charaktervorlage aus.')
      return
    }

    setValidationError(null)
    const characterId = await createCharacter(
      normalizedName,
      selectedTemplate,
    )

    if (characterId) {
      onCreated(characterId)
    }
  }

  const isSubmitDisabled =
    isSubmitting || !name.trim() || !selectedTemplate

  return (
    <form className="create-character-form" onSubmit={handleSubmit}>
      <label className="auth-field" htmlFor="character-name">
        <span>Name</span>
        <input
          disabled={isSubmitting}
          id="character-name"
          maxLength={100}
          onChange={handleNameChange}
          required
          type="text"
          value={name}
        />
      </label>
      <label className="auth-field" htmlFor="character-template">
        <span>Charaktervorlage</span>
        <select
          disabled={isSubmitting}
          id="character-template"
          onChange={handleTemplateChange}
          required
          value={selectedTemplate ? getTemplateId(selectedTemplate) : ''}
        >
          {availableCharacterTemplates.length === 0 && (
            <option value="">Keine Vorlage verfügbar</option>
          )}
          {availableCharacterTemplates.map((template) => (
            <option
              key={getTemplateId(template)}
              value={getTemplateId(template)}
            >
              {template.name} – Version {template.version}
            </option>
          ))}
        </select>
      </label>
      <button
        className="auth-submit"
        data-submitting={isSubmitting}
        disabled={isSubmitDisabled}
        type="submit"
      >
        {isSubmitting ? 'Charakter wird erstellt...' : 'Charakter erstellen'}
      </button>
      {(validationError || error) && (
        <p className="profile-form-error" role="alert">
          {validationError || error}
        </p>
      )}
    </form>
  )
}

export default CharacterCreationForm
