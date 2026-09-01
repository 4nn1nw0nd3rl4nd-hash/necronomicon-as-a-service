import { Link, useNavigate } from 'react-router-dom'
import CharacterCreationForm from '../components/CharacterCreationForm'

function CreateCharacterPage() {
  const navigate = useNavigate()

  return (
    <section className="create-character-page">
      <Link className="round-detail-back" to="/app/characters">
        Zurück zu Meine Charaktere
      </Link>
      <h1 className="rounds-title">Charakter erstellen</h1>
      <CharacterCreationForm
        onCreated={() => navigate('/app/characters')}
      />
    </section>
  )
}

export default CreateCharacterPage
