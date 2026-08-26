import { Link } from 'react-router-dom'

function LandingPage() {
  return (
    <main className="landing-page">
      <div className="landing-content">
        <h1 className="landing-title">
          <span className="landing-title-primary">Necronomicon</span>
          <span className="landing-title-secondary">as a Service</span>
        </h1>
        <p className="landing-tagline">Tritt ein, wenn du dich traust.</p>
        <Link className="landing-entry" to="/login">
          Eintreten
        </Link>
      </div>
    </main>
  )
}

export default LandingPage
