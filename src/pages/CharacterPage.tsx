import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
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
import { useCharacterPortrait } from '../hooks/useCharacterPortrait'
import { useCopyCharacter } from '../hooks/useCopyCharacter'
import { useRemoveCharacterPortrait } from '../hooks/useRemoveCharacterPortrait'
import { useSetCharacterCheck } from '../hooks/useSetCharacterCheck'
import { useSoftDeleteCharacter } from '../hooks/useSoftDeleteCharacter'
import { useUpdateCharacter } from '../hooks/useUpdateCharacter'
import { useUploadCharacterPortrait } from '../hooks/useUploadCharacterPortrait'

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
    portraitUrl,
    isLoading: isPortraitLoading,
    error: portraitError,
    reload: reloadPortrait,
    clearPortrait,
  } = useCharacterPortrait(character?.id)
  const {
    isSubmitting: isUploadingPortrait,
    error: portraitUploadError,
    uploadCharacterPortrait,
    resetState: resetPortraitUploadState,
  } = useUploadCharacterPortrait()
  const {
    isSubmitting: isRemovingPortrait,
    error: portraitRemoveError,
    removeCharacterPortrait,
    resetState: resetPortraitRemoveState,
  } = useRemoveCharacterPortrait()
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
  const {
    isSubmitting: isDeleting,
    error: deleteError,
    softDeleteCharacter,
    resetState: resetDeleteState,
  } = useSoftDeleteCharacter()
  const portraitFileInputRef = useRef<HTMLInputElement>(null)
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(
    null,
  )
  const [draftName, setDraftName] = useState('')
  const [draftData, setDraftData] = useState<Record<string, unknown>>({})
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isCopyConfirmationOpen, setIsCopyConfirmationOpen] =
    useState(false)
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] =
    useState(false)
  const [isPortraitRemoveConfirmationOpen, setIsPortraitRemoveConfirmationOpen] =
    useState(false)

  const isEditing = editingCharacterId === character?.id
  const isCharacterOwner = Boolean(
    character && user && character.owner_user_id === user.id,
  )
  const canManagePortrait = Boolean(
    character &&
      user &&
      character.deleted_at === null &&
      (isCharacterOwner || character.round_id !== null),
  )
  const isPortraitMutating = isUploadingPortrait || isRemovingPortrait
  const isPortraitManagementVisible =
    canManagePortrait && !isPortraitLoading && !portraitError

  const resetEditMessages = () => {
    setValidationError(null)
    resetUpdateState()
  }

  const startEditing = () => {
    if (
      !character ||
      hasPendingCheckRequests ||
      isCopying ||
      isDeleting
    ) {
      return
    }

    setIsCopyConfirmationOpen(false)
    setIsDeleteConfirmationOpen(false)
    resetCopyState()
    resetDeleteState()
    setDraftName(character.name)
    setDraftData({ ...character.data })
    resetEditMessages()
    resetCheckState()
    setEditingCharacterId(character.id)
  }

  const openCopyConfirmation = () => {
    if (isCopying || isDeleting) {
      return
    }

    resetDeleteState()
    setIsDeleteConfirmationOpen(false)
    resetCopyState()
    setIsCopyConfirmationOpen(true)
  }

  const openDeleteConfirmation = () => {
    if (isCopying || isDeleting) {
      return
    }

    resetCopyState()
    setIsCopyConfirmationOpen(false)
    resetDeleteState()
    setIsDeleteConfirmationOpen(true)
  }

  const cancelDeleteConfirmation = () => {
    if (isDeleting) {
      return
    }

    resetDeleteState()
    setIsDeleteConfirmationOpen(false)
  }

  const confirmDelete = async () => {
    if (!character) {
      return
    }

    const wasDeleted = await softDeleteCharacter(character.id)

    if (wasDeleted) {
      setIsDeleteConfirmationOpen(false)
      navigate('/app/characters')
    }
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

  const openPortraitFilePicker = () => {
    if (!canManagePortrait || isPortraitMutating) {
      return
    }

    resetPortraitUploadState()
    resetPortraitRemoveState()
    setIsPortraitRemoveConfirmationOpen(false)
    portraitFileInputRef.current?.click()
  }

  const handlePortraitFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !character || !canManagePortrait) {
      return
    }

    resetPortraitRemoveState()
    const wasUploaded = await uploadCharacterPortrait(character.id, file)

    if (wasUploaded) {
      reloadPortrait()
    }
  }

  const openPortraitRemoveConfirmation = () => {
    if (!canManagePortrait || !portraitUrl || isPortraitMutating) {
      return
    }

    resetPortraitUploadState()
    resetPortraitRemoveState()
    setIsPortraitRemoveConfirmationOpen(true)
  }

  const cancelPortraitRemoveConfirmation = () => {
    if (isRemovingPortrait) {
      return
    }

    resetPortraitRemoveState()
    setIsPortraitRemoveConfirmationOpen(false)
  }

  const confirmPortraitRemove = async () => {
    if (!character || !canManagePortrait) {
      return
    }

    const wasRemoved = await removeCharacterPortrait(character.id)

    if (wasRemoved) {
      setIsPortraitRemoveConfirmationOpen(false)
      clearPortrait()
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
            {!isEditing && (template || isCharacterOwner) && (
              <div className="character-detail-actions">
                {template && (
                  <button
                    className="character-edit-button"
                    disabled={
                      hasPendingCheckRequests || isCopying || isDeleting
                    }
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
                    disabled={isCopying || isDeleting}
                    onClick={openCopyConfirmation}
                    type="button"
                  >
                    Charakter kopieren
                  </button>
                )}
                {isCharacterOwner && (
                  <button
                    aria-controls="character-delete-confirmation"
                    aria-expanded={isDeleteConfirmationOpen}
                    className="character-delete-trigger"
                    disabled={isCopying || isDeleting}
                    onClick={openDeleteConfirmation}
                    type="button"
                  >
                    In den Papierkorb
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

        <section
          aria-labelledby="character-portrait-title"
          className={`character-portrait-section${
            isPortraitManagementVisible
              ? ' character-portrait-section-with-management'
              : ''
          }`}
        >
          <h2 id="character-portrait-title">Portrait</h2>
          <div className="character-portrait-frame">
            {isPortraitLoading ? (
              <p className="character-portrait-state" role="status">
                Portrait wird geladen...
              </p>
            ) : portraitError ? (
              <div className="character-portrait-state">
                <p role="alert">{portraitError}</p>
                <button
                  className="character-portrait-retry"
                  onClick={reloadPortrait}
                  type="button"
                >
                  Erneut versuchen
                </button>
              </div>
            ) : portraitUrl ? (
              <img
                alt={`Portrait von ${character.name}`}
                className="character-portrait-image"
                src={portraitUrl}
              />
            ) : (
              <div className="character-portrait-placeholder">
                <span aria-hidden="true">◇</span>
                <span>Kein Portrait</span>
              </div>
            )}
          </div>

          {isPortraitManagementVisible && (
            <div className="character-portrait-management">
              <input
                accept="image/jpeg,image/png,image/webp"
                className="character-portrait-file-input"
                disabled={isPortraitMutating}
                onChange={(event) => void handlePortraitFileChange(event)}
                ref={portraitFileInputRef}
                type="file"
              />
              <p className="character-portrait-hint">
                JPEG, PNG oder WebP · max. 5 MB
              </p>
              <div className="character-portrait-actions">
                <button
                  className="character-portrait-upload"
                  data-submitting={isUploadingPortrait}
                  disabled={isPortraitMutating}
                  onClick={openPortraitFilePicker}
                  type="button"
                >
                  {isUploadingPortrait
                    ? 'Wird hochgeladen...'
                    : portraitUrl
                      ? 'Portrait ändern'
                      : 'Portrait hochladen'}
                </button>
                {portraitUrl && (
                  <button
                    aria-controls="character-portrait-remove-confirmation"
                    aria-expanded={isPortraitRemoveConfirmationOpen}
                    className="character-portrait-remove-trigger"
                    data-submitting={isRemovingPortrait}
                    disabled={isPortraitMutating}
                    onClick={openPortraitRemoveConfirmation}
                    type="button"
                  >
                    {isRemovingPortrait
                      ? 'Wird entfernt...'
                      : 'Portrait entfernen'}
                  </button>
                )}
              </div>

              {(portraitUploadError || portraitRemoveError) && (
                <p className="profile-form-error" role="alert">
                  {portraitUploadError ?? portraitRemoveError}
                </p>
              )}

              {portraitUrl && isPortraitRemoveConfirmationOpen && (
                <div
                  className="character-portrait-remove-confirmation"
                  id="character-portrait-remove-confirmation"
                >
                  <p>Möchtest du das Portrait wirklich entfernen?</p>
                  <div className="character-portrait-remove-actions">
                    <button
                      className="character-portrait-remove-confirm"
                      data-submitting={isRemovingPortrait}
                      disabled={isPortraitMutating}
                      onClick={() => void confirmPortraitRemove()}
                      type="button"
                    >
                      {isRemovingPortrait
                        ? 'Wird entfernt...'
                        : 'Portrait entfernen'}
                    </button>
                    <button
                      className="character-portrait-remove-cancel"
                      disabled={isPortraitMutating}
                      onClick={cancelPortraitRemoveConfirmation}
                      type="button"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

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

        {isCharacterOwner && isDeleteConfirmationOpen && !isEditing && (
          <section
            aria-labelledby="character-delete-title"
            className="character-delete-confirmation"
            id="character-delete-confirmation"
          >
            <h2 id="character-delete-title">In den Papierkorb</h2>
            <p>
              Möchtest du diesen Charakter in den Papierkorb verschieben?
            </p>
            <p>
              Er bleibt 14 Tage wiederherstellbar und wird nicht sofort
              endgültig gelöscht.
            </p>
            {deleteError && (
              <p className="profile-form-error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="character-delete-actions">
              <button
                className="character-delete-confirm"
                data-submitting={isDeleting}
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
                type="button"
              >
                {isDeleting ? 'Wird verschoben...' : 'In den Papierkorb'}
              </button>
              <button
                className="character-delete-cancel"
                disabled={isDeleting}
                onClick={cancelDeleteConfirmation}
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
