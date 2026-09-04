import { Fragment } from 'react'
import type {
  CharacterTemplateDefinition,
  CharacterTemplateField,
} from '../characterTemplates'
import type { CharacterDetails } from '../types/character'

type CharacterSheetRendererBaseProps = {
  character: CharacterDetails
  template: CharacterTemplateDefinition
}

type CharacterSheetRendererProps = CharacterSheetRendererBaseProps &
  (
    | {
        mode: 'view'
        isReadOnly: boolean
        isCheckSubmitting: (fieldKey: string) => boolean
        onCheckChange: (fieldKey: string, checked: boolean) => void
      }
    | {
        mode: 'edit'
        draftName: string
        draftData: Record<string, unknown>
        isDisabled: boolean
        onNameChange: (value: string) => void
        onDataFieldChange: (key: string, value: string | boolean) => void
      }
  )

function byOrder<T extends { order: number }>(items: readonly T[]) {
  return [...items].sort((first, second) => first.order - second.order)
}

function getCharacterFieldsClassName(
  fields: readonly CharacterTemplateField[],
) {
  const containsOnlyUnlabeledChecks =
    fields.length > 0 &&
    fields.every(
      (field) => field.type === 'check' && field.showLabel === false,
    )
  const containsMultipleShortFields =
    fields.filter((field) => field.type === 'short').length >= 2

  const classNames = ['character-sheet-fields']

  if (containsOnlyUnlabeledChecks) {
    classNames.push('character-sheet-fields-compact-checks')
  }

  if (containsMultipleShortFields) {
    classNames.push('character-sheet-fields-compact-shorts')
  }

  return classNames.join(' ')
}

function ViewCharacterField({
  character,
  field,
  isReadOnly,
  isCheckSubmitting,
  onCheckChange,
}: {
  character: CharacterDetails
  field: CharacterTemplateField
  isReadOnly: boolean
  isCheckSubmitting: (fieldKey: string) => boolean
  onCheckChange: (fieldKey: string, checked: boolean) => void
}) {
  const rawValue = character.data?.[field.key]
  const showLabel = field.showLabel !== false

  if (field.type === 'check') {
    const isChecked = rawValue === true
    const isSubmitting = isCheckSubmitting(field.key)

    return (
      <label
        aria-busy={isSubmitting}
        className="character-sheet-field character-sheet-field-check character-sheet-view-check"
        data-submitting={isSubmitting}
      >
        <input
          aria-label={showLabel ? undefined : field.label}
          checked={isChecked}
          className="character-sheet-checkbox-input"
          disabled={isReadOnly || isSubmitting}
          onChange={(event) =>
            onCheckChange(field.key, event.target.checked)
          }
          type="checkbox"
        />
        {showLabel && (
          <span className="character-sheet-field-label">{field.label}</span>
        )}
      </label>
    )
  }

  const value =
    field.type === 'character_name'
      ? character.name
      : typeof rawValue === 'string'
        ? rawValue
        : ''

  return (
    <div
      className={`character-sheet-field character-sheet-field-${field.type}`}
    >
      {showLabel && (
        <span className="character-sheet-field-label">{field.label}</span>
      )}
      <span className="character-sheet-field-value">
        {value.length > 0 ? value : '—'}
      </span>
    </div>
  )
}

function EditableCharacterField({
  draftName,
  draftData,
  field,
  isDisabled,
  onNameChange,
  onDataFieldChange,
}: {
  draftName: string
  draftData: Record<string, unknown>
  field: CharacterTemplateField
  isDisabled: boolean
  onNameChange: (value: string) => void
  onDataFieldChange: (key: string, value: string | boolean) => void
}) {
  const rawValue = draftData[field.key]
  const showLabel = field.showLabel !== false

  if (field.type === 'check') {
    return (
      <label className="character-sheet-field character-sheet-field-check">
        <input
          aria-label={showLabel ? undefined : field.label}
          checked={rawValue === true}
          className="character-sheet-checkbox-input"
          disabled={isDisabled}
          onChange={(event) =>
            onDataFieldChange(field.key, event.target.checked)
          }
          type="checkbox"
        />
        {showLabel && (
          <span className="character-sheet-field-label">{field.label}</span>
        )}
      </label>
    )
  }

  const value =
    field.type === 'character_name'
      ? draftName
      : typeof rawValue === 'string'
        ? rawValue
        : ''
  const commonProps = {
    'aria-label': showLabel ? undefined : field.label,
    disabled: isDisabled,
    value,
  }

  return (
    <label
      className={`character-sheet-field character-sheet-field-${field.type}`}
    >
      {showLabel && (
        <span className="character-sheet-field-label">{field.label}</span>
      )}
      {field.type === 'long' ? (
        <textarea
          {...commonProps}
          className="character-sheet-input character-sheet-textarea"
          onChange={(event) =>
            onDataFieldChange(field.key, event.target.value)
          }
          rows={4}
        />
      ) : (
        <input
          {...commonProps}
          className="character-sheet-input"
          maxLength={field.type === 'character_name' ? 100 : undefined}
          onChange={(event) => {
            if (field.type === 'character_name') {
              onNameChange(event.target.value)
              return
            }

            onDataFieldChange(field.key, event.target.value)
          }}
          type="text"
        />
      )}
    </label>
  )
}

function renderCharacterField(
  props: CharacterSheetRendererProps,
  field: CharacterTemplateField,
) {
  if (props.mode === 'edit') {
    return (
      <EditableCharacterField
        draftData={props.draftData}
        draftName={props.draftName}
        field={field}
        isDisabled={props.isDisabled}
        onDataFieldChange={props.onDataFieldChange}
        onNameChange={props.onNameChange}
      />
    )
  }

  return (
    <ViewCharacterField
      character={props.character}
      field={field}
      isReadOnly={props.isReadOnly}
      isCheckSubmitting={props.isCheckSubmitting}
      onCheckChange={props.onCheckChange}
    />
  )
}

export function CharacterSheetRenderer(props: CharacterSheetRendererProps) {
  const { character, template } = props

  return (
    <div className="character-sheet" aria-label={`Charakterbogen ${character.name}`}>
      <div className="character-sheet-grid">
        {byOrder(template.sections).map((section) => (
          <section
            className={`character-sheet-section character-sheet-section-${section.width}`}
            key={section.key}
          >
            <h2>{section.label}</h2>

            {section.fields && section.fields.length > 0 && (
              <div className={getCharacterFieldsClassName(section.fields)}>
                {byOrder(section.fields).map((field) => (
                  <Fragment key={field.key}>
                    {renderCharacterField(props, field)}
                  </Fragment>
                ))}
              </div>
            )}

            {section.groups && section.groups.length > 0 && (
              <div className="character-sheet-groups">
                {byOrder(section.groups).map((group) => (
                  <section className="character-sheet-group" key={group.key}>
                    <h3>{group.label}</h3>
                    <div
                      className={getCharacterFieldsClassName(group.fields)}
                    >
                      {byOrder(group.fields).map((field) => (
                        <Fragment key={field.key}>
                          {renderCharacterField(props, field)}
                        </Fragment>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
