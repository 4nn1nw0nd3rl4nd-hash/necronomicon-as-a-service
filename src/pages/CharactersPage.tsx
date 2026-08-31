import { availableCharacterTemplates } from '../characterTemplates'
import { useMyCharacters } from '../hooks/useMyCharacters'

function getTemplateLabel(templateKey: string, templateVersion: number) {
  const template = availableCharacterTemplates.find(
    (candidate) =>
      candidate.key === templateKey && candidate.version === templateVersion,
  )

  return template?.name ?? 'Unbekannte Charaktervorlage'
}

function CharactersPage() {
  const { characters, isLoading, error, reload } = useMyCharacters()

  let content

  if (isLoading) {
    content = (
      <p className="rounds-state" role="status">
        Charaktere werden geladen...
      </p>
    )
  } else if (error) {
    content = (
      <div className="rounds-state" role="alert">
        <p>{error}</p>
        <button className="rounds-retry" type="button" onClick={reload}>
          Erneut versuchen
        </button>
      </div>
    )
  } else if (characters.length === 0) {
    content = <p className="rounds-state">Du hast noch keine Charaktere.</p>
  } else {
    content = (
      <ul className="rounds-list">
        {characters.map((character) => (
          <li key={character.id}>
            <article className="round-card">
              <header className="round-card-header">
                <h2>{character.name}</h2>
              </header>
              <dl className="round-details">
                <div>
                  <dt>System</dt>
                  <dd>
                    {getTemplateLabel(
                      character.template_key,
                      character.template_version,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Rundenzuordnung</dt>
                  <dd>
                    {character.round_id
                      ? 'Einer Runde zugeordnet'
                      : 'Keine Runde'}
                  </dd>
                </div>
              </dl>
            </article>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="rounds-page" aria-labelledby="characters-title">
      <h1 className="rounds-title" id="characters-title">
        Meine Charaktere
      </h1>
      <p>
        Hier findest du deine Charaktere – unabhängig davon, ob sie bereits
        einer Runde zugeordnet sind.
      </p>
      {content}
    </section>
  )
}

export default CharactersPage
