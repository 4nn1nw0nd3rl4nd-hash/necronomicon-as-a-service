import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useUpdateRound } from '../hooks/useUpdateRound'
import type {
  RoundDetails,
  RoundStatus,
  UpdateRoundInput,
} from '../types/round'

type EditRoundFormProps = {
  round: RoundDetails
  onUpdated: () => void
  onCancel: () => void
}

function EditRoundForm({
  round,
  onUpdated,
  onCancel,
}: EditRoundFormProps) {
  const {
    isSubmitting,
    error,
    isSuccess,
    updateRound,
    resetState,
  } = useUpdateRound()
  const [fields, setFields] = useState<UpdateRoundInput>(() => ({
    name: round.name,
    system: round.system ?? '',
    description: round.description ?? '',
    appointment: round.appointment ?? '',
    status: round.status,
  }))

  const resetMessages = () => {
    if (error || isSuccess) {
      resetState()
    }
  }

  const handleTextChange =
    (
      field: Exclude<keyof UpdateRoundInput, 'status'>,
    ) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFields((currentFields) => ({
        ...currentFields,
        [field]: event.target.value,
      }))
      resetMessages()
    }

  const handleStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setFields((currentFields) => ({
      ...currentFields,
      status: event.target.value as RoundStatus,
    }))
    resetMessages()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const updatedRound = await updateRound(round.id, {
      name: fields.name,
      system: fields.system,
      description: fields.description,
      appointment: fields.appointment,
      status: fields.status,
    })

    if (updatedRound) {
      onUpdated()
    }
  }

  return (
    <section
      className="round-detail-card"
      aria-labelledby="edit-round-title"
    >
      <h1 className="edit-round-title" id="edit-round-title">
        Runde bearbeiten
      </h1>
      <form
        className="edit-round-form"
        aria-labelledby="edit-round-title"
        onSubmit={handleSubmit}
        noValidate
      >
        <label className="auth-field" htmlFor="edit-round-name">
          <span>Name</span>
          <input
            id="edit-round-name"
            type="text"
            value={fields.name}
            onChange={handleTextChange('name')}
            disabled={isSubmitting}
          />
        </label>
        <label className="auth-field" htmlFor="edit-round-system">
          <span>System (optional)</span>
          <input
            id="edit-round-system"
            type="text"
            value={fields.system}
            onChange={handleTextChange('system')}
            disabled={isSubmitting}
          />
        </label>
        <label className="auth-field" htmlFor="edit-round-description">
          <span>Beschreibung (optional)</span>
          <textarea
            id="edit-round-description"
            value={fields.description}
            onChange={handleTextChange('description')}
            disabled={isSubmitting}
            rows={7}
          />
        </label>
        <label className="auth-field" htmlFor="edit-round-appointment">
          <span>Termin (optional)</span>
          <input
            id="edit-round-appointment"
            type="text"
            value={fields.appointment}
            onChange={handleTextChange('appointment')}
            disabled={isSubmitting}
          />
        </label>
        <label className="auth-field" htmlFor="edit-round-status">
          <span>Status</span>
          <select
            id="edit-round-status"
            value={fields.status}
            onChange={handleStatusChange}
            disabled={isSubmitting}
          >
            <option value="active">Aktiv</option>
            <option value="paused">Pausiert</option>
            <option value="archived">Archiviert</option>
          </select>
        </label>
        <div className="edit-round-actions">
          <button
            className="auth-submit"
            type="submit"
            disabled={isSubmitting || !fields.name.trim()}
            data-submitting={isSubmitting}
          >
            {isSubmitting ? 'Speichern...' : 'Speichern'}
          </button>
          <button
            className="edit-round-cancel"
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Abbrechen
          </button>
        </div>
        {error && (
          <p className="profile-form-error" role="alert">
            {error}
          </p>
        )}
        {isSuccess && (
          <p className="profile-form-success" role="status">
            Die Runde wurde gespeichert.
          </p>
        )}
      </form>
    </section>
  )
}

export default EditRoundForm
