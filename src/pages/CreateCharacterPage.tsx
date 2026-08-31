import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { availableCharacterTemplates } from '../characterTemplates'
import type { CharacterTemplateDefinition } from '../characterTemplates'
import { useCreateCharacter } from '../hooks/useCreateCharacter'

function getTemplateId(template: CharacterTemplateDefinition) {
  return `${template.key}@${template.version}`
}

function CreateCharacterPage() {
  const navigate = useNavigate()
  const { isSubmitting, error, createCharacter, resetState } =
    useCreateCharacter()
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
      navigate('/app/characters')
    }
  }

  const isSubmitDisabled =
    isSubmitting || !name.trim() || !selectedTemplate

  return (
    <section className="create-character-page">
      <Link className="round-detail-back" to="/app/characters">
        Zurück zu Meine Charaktere
      </Link>
      <h1 className="rounds-title">Charakter erstellen</h1>
      <form className="create-character-form" onSubmit={handleSubmit}>
        <label className="auth-field" htmlFor="character-name">
          <span>Name</span>
          <input
            id="character-name"
            type="text"
            value={name}
            onChange={handleNameChange}
            maxLength={100}
            required
            disabled={isSubmitting}
          />
        </label>
        <label className="auth-field" htmlFor="character-template">
          <span>Charaktervorlage</span>
          <select
            id="character-template"
            value={selectedTemplate ? getTemplateId(selectedTemplate) : ''}
            onChange={handleTemplateChange}
            required
            disabled={isSubmitting}
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
          type="submit"
          disabled={isSubmitDisabled}
          data-submitting={isSubmitting}
        >
          {isSubmitting ? 'Charakter wird erstellt...' : 'Charakter erstellen'}
        </button>
        {(validationError || error) && (
          <p className="profile-form-error" role="alert">
            {validationError || error}
          </p>
        )}
      </form>
    </section>
  )
}

export default CreateCharacterPage
