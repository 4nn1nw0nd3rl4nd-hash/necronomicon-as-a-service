import { Link, useParams } from 'react-router-dom'
import { CharacterSheetRenderer } from '../components/CharacterSheetRenderer'
import { findCharacterTemplate } from '../characterTemplates'
import { useCharacter } from '../hooks/useCharacter'

function CharacterPage() {
  const { characterId } = useParams()
  const { character, isLoading, error, reload } = useCharacter(characterId)

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
          <h1>{character.name}</h1>
          <p className="character-detail-template">
            {template?.name ?? 'Unbekannte Charaktervorlage'}
            <span>Version {character.template_version}</span>
          </p>
        </header>

        {template ? (
          <CharacterSheetRenderer character={character} template={template} />
        ) : (
          <p className="character-template-unavailable" role="status">
            Diese Charaktervorlage ist derzeit nicht verfügbar.
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
