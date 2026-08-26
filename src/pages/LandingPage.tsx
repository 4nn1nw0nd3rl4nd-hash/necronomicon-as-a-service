import { Link } from 'react-router-dom'

function LandingPage() {
  return (
    <main>
      <h1>Necronomicon as a Service</h1>
      <p>Tritt ein, wenn du dich traust.</p>
      <Link to="/login">Eintreten</Link>
    </main>
  )
}

export default LandingPage
