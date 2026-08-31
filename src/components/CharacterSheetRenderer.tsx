import type {
  CharacterTemplateDefinition,
  CharacterTemplateField,
} from '../characterTemplates'
import type { CharacterDetails } from '../types/character'

type CharacterSheetRendererProps = {
  character: CharacterDetails
  template: CharacterTemplateDefinition
}

function byOrder<T extends { order: number }>(items: readonly T[]) {
  return [...items].sort((first, second) => first.order - second.order)
}

function CharacterField({
  character,
  field,
}: {
  character: CharacterDetails
  field: CharacterTemplateField
}) {
  const rawValue = character.data?.[field.key]
  const showLabel = field.showLabel !== false

  if (field.type === 'check') {
    const isChecked = rawValue === true

    return (
      <div
        aria-label={`${field.label}: ${isChecked ? 'angekreuzt' : 'nicht angekreuzt'}`}
        className="character-sheet-field character-sheet-field-check"
        role="img"
      >
        <span
          aria-hidden="true"
          className={`character-sheet-check${isChecked ? ' character-sheet-check-checked' : ''}`}
        >
          {isChecked ? '✓' : ''}
        </span>
        {showLabel && (
          <span aria-hidden="true" className="character-sheet-field-label">
            {field.label}
          </span>
        )}
      </div>
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

export function CharacterSheetRenderer({
  character,
  template,
}: CharacterSheetRendererProps) {
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
              <div className="character-sheet-fields">
                {byOrder(section.fields).map((field) => (
                  <CharacterField
                    character={character}
                    field={field}
                    key={field.key}
                  />
                ))}
              </div>
            )}

            {section.groups && section.groups.length > 0 && (
              <div className="character-sheet-groups">
                {byOrder(section.groups).map((group) => (
                  <section className="character-sheet-group" key={group.key}>
                    <h3>{group.label}</h3>
                    <div className="character-sheet-fields">
                      {byOrder(group.fields).map((field) => (
                        <CharacterField
                          character={character}
                          field={field}
                          key={field.key}
                        />
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
