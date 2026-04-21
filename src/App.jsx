import { useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";

import "./App.css";
import Session from "./pages/Session.jsx";

function HomePage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState("");

  const normalizedSessionId = sessionId.trim();

  const handleStart = () => {
    if (!normalizedSessionId) return;
    navigate(`/session/${encodeURIComponent(normalizedSessionId)}`);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      handleStart();
    }
  };

  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-eyebrow">Necronomicon as a Service</p>
          <h1>Starte deine Session wie ein beschwoerenes Ritual.</h1>
          <p className="landing-intro">
            Ein Portal fuer Pen-and-Paper-Runden mit Charakterboegen, Dice Chat,
            Whiteboard und gemeinsamem Session-Raum.
          </p>

          <div className="landing-actions">
            <label className="session-card">
              <span className="session-card-label">Session-ID</span>
              <input
                className="session-input"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="z. B. test, friday-night oder cthulhu-01"
              />
            </label>

            <div className="landing-buttons">
              <button
                type="button"
                className="primary-button"
                onClick={handleStart}
                disabled={!normalizedSessionId}
              >
                Session betreten
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => setSessionId("test")}
              >
                Demo laden
              </button>
            </div>
          </div>
        </div>

        <aside className="landing-panel">
          <div className="panel-glow" />
          <div className="ritual-grid">
            <div className="ritual-card">
              <span className="ritual-title">Charaktere</span>
              <p>Call of Cthulhu und Splinter Portals in einem Raum.</p>
            </div>
            <div className="ritual-card">
              <span className="ritual-title">Dice Chat</span>
              <p>Wuerfeln und schreiben im selben Verlauf.</p>
            </div>
            <div className="ritual-card">
              <span className="ritual-title">Session Sync</span>
              <p>Supabase Realtime haelt die Runde zusammen.</p>
            </div>
          </div>
        </aside>
      </section>

      <section className="feature-strip">
        <article>
          <h2>Schneller Einstieg</h2>
          <p>Session-ID eingeben, Route oeffnen, Runde starten.</p>
        </article>
        <article>
          <h2>Gemeinsamer Spielraum</h2>
          <p>Wuerfel, Chat und Whiteboard leben direkt in derselben Session.</p>
        </article>
        <article>
          <h2>Fokus auf Atmosphaere</h2>
          <p>Kein graues Tooling, sondern ein Einstieg mit Spielgefuehl.</p>
        </article>
      </section>
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/session/:id" element={<Session />} />
      <Route
        path="*"
        element={
          <div className="not-found">
            <h1>Nicht gefunden</h1>
            <p>Diese Route existiert nicht im Portal.</p>
            <Link to="/" className="primary-button">
              Zur Startseite
            </Link>
          </div>
        }
      />
    </Routes>
  );
}

export default App;
