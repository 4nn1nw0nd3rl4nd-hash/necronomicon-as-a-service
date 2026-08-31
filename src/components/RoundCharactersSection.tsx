import { Link } from 'react-router-dom'
import { findCharacterTemplate } from '../characterTemplates'
import { useRoundCharacters } from '../hooks/useRoundCharacters'
import type { RoundMember, RoundMembershipRole } from '../types/round'

type RoundCharactersSectionProps = {
  roundId: string
  membershipRole: RoundMembershipRole | null
  members: RoundMember[]
}

function getTemplateName(templateKey: string, templateVersion: number) {
  return (
    findCharacterTemplate(templateKey, templateVersion)?.name ??
    'Unbekannte Charaktervorlage'
  )
}

function RoundCharactersSection({
  roundId,
  membershipRole,
  members,
}: RoundCharactersSectionProps) {
  const { characters, isLoading, error, reload } =
    useRoundCharacters(roundId)
  const isGameMaster = membershipRole === 'game_master'

  let content

  if (isLoading) {
    content = (
      <p className="round-members-state" role="status">
        Charaktere werden geladen...
      </p>
    )
  } else if (error) {
    content = (
      <div className="round-members-state" role="alert">
        <p>{error}</p>
        <button className="rounds-retry" onClick={reload} type="button">
          Erneut versuchen
        </button>
      </div>
    )
  } else if (characters.length === 0) {
    content = (
      <p className="round-members-state">
        {isGameMaster
          ? 'Dieser Runde sind noch keine Charaktere zugeordnet.'
          : 'Du hast dieser Runde noch keinen Charakter zugeordnet.'}
      </p>
    )
  } else {
    content = (
      <ul className="round-characters-list">
        {characters.map((character) => {
          const owner = character.owner_user_id
            ? members.find(
                ({ user_id }) => user_id === character.owner_user_id,
              )
            : null

          return (
            <li key={character.id}>
              <Link
                aria-label={`Charakter ${character.name} öffnen`}
                className="round-character-link"
                state={{
                  characterReturnContext: { source: 'round', roundId },
                }}
                to={`/app/characters/${character.id}`}
              >
                <article className="round-character-card">
                  <h3>{character.name}</h3>
                  <p>
                    {getTemplateName(
                      character.template_key,
                      character.template_version,
                    )}
                  </p>
                  {isGameMaster && (
                    <span className="round-character-owner">
                      {character.owner_user_id
                        ? owner?.profile.display_name ?? 'Spieler'
                        : 'Vorbereitet'}
                    </span>
                  )}
                </article>
              </Link>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <section
      aria-labelledby="round-characters-title"
      className="round-members-card round-characters-card"
    >
      <h2 className="round-members-title" id="round-characters-title">
        Charaktere
      </h2>
      {content}
    </section>
  )
}

export default RoundCharactersSection
