import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useCreateRound } from '../hooks/useCreateRound'
import type { CreateRoundInput } from '../types/round'

type CreateRoundFormProps = {
  onCreated: () => void
}

const initialFields: CreateRoundInput = {
  name: '',
  system: '',
  description: '',
  appointment: '',
}

function CreateRoundForm({ onCreated }: CreateRoundFormProps) {
  const {
    isSubmitting,
    error,
    isSuccess,
    createRound,
    resetState,
  } = useCreateRound()
  const [fields, setFields] = useState<CreateRoundInput>(initialFields)

  const handleChange =
    (field: keyof CreateRoundInput) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFields((currentFields) => ({
        ...currentFields,
        [field]: event.target.value,
      }))

      if (error || isSuccess) {
        resetState()
      }
    }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const roundId = await createRound({
      name: fields.name,
      system: fields.system,
      description: fields.description,
      appointment: fields.appointment,
    })

    if (roundId) {
      setFields(initialFields)
      onCreated()
    }
  }

  const isSubmitDisabled = isSubmitting || !fields.name.trim()

  return (
    <section
      className="create-round-card"
      aria-labelledby="create-round-title"
    >
      <h2 className="create-round-title" id="create-round-title">
        Neue Runde erstellen
      </h2>
      <form
        className="create-round-form"
        aria-labelledby="create-round-title"
        onSubmit={handleSubmit}
        noValidate
      >
        <label className="auth-field" htmlFor="round-name">
          <span>Name</span>
          <input
            id="round-name"
            type="text"
            value={fields.name}
            onChange={handleChange('name')}
            disabled={isSubmitting}
          />
        </label>
        <label className="auth-field" htmlFor="round-system">
          <span>System (optional)</span>
          <input
            id="round-system"
            type="text"
            value={fields.system}
            onChange={handleChange('system')}
            disabled={isSubmitting}
          />
        </label>
        <label className="auth-field" htmlFor="round-description">
          <span>Beschreibung (optional)</span>
          <textarea
            id="round-description"
            value={fields.description}
            onChange={handleChange('description')}
            disabled={isSubmitting}
            rows={4}
          />
        </label>
        <label className="auth-field" htmlFor="round-appointment">
          <span>Termin (optional)</span>
          <input
            id="round-appointment"
            type="text"
            value={fields.appointment}
            onChange={handleChange('appointment')}
            disabled={isSubmitting}
          />
        </label>
        <button
          className="auth-submit"
          type="submit"
          disabled={isSubmitDisabled}
          data-submitting={isSubmitting}
        >
          {isSubmitting ? 'Runde wird erstellt...' : 'Runde erstellen'}
        </button>
        {error && (
          <p className="profile-form-error" role="alert">
            {error}
          </p>
        )}
        {isSuccess && (
          <p className="profile-form-success" role="status">
            Die Runde wurde erstellt.
          </p>
        )}
      </form>
    </section>
  )
}

export default CreateRoundForm
