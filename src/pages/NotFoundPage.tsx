import { Link } from 'react-router-dom'

function NotFoundPage() {
  return (
    <main>
      <h1>404</h1>
      <p>Diese Seite wurde im Necronomicon nicht gefunden.</p>
      <Link to="/">Zur Startseite</Link>
    </main>
  )
}

export default NotFoundPage
