import { useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";

import "./App.css";
import { supabase } from "./supabaseClient";
import Session from "./pages/Session.jsx";

function HomePage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState("");

  const normalizedSessionId = sessionId.trim();

  const loadSessions = async () => {
    const { data, error } = await supabase
      .from("sessions")
      .select("slug, title, description, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(12);

    if (error) {
      console.error(error);
      setStatus(`Sessions konnten nicht geladen werden: ${error.message}`);
      return;
    }

    setSessions(data || []);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const ensureSessionExists = async (slug) => {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;

    const payload = {
      slug,
      title: createTitle.trim() || `Session ${slug}`,
      description: createDescription.trim() || null,
      created_by: user?.id || null,
    };

    const { error } = await supabase.from("sessions").upsert(payload, { onConflict: "slug" });

    if (error) {
      console.error(error);
      // Wichtiger Fallback:
      // Auch wenn die Sessions-Tabelle auf Supabase noch nicht migriert wurde
      // oder die Policies den Insert blockieren, soll der Nutzer die Session
      // trotzdem direkt oeffnen koennen.
      setStatus(`Session-Metadaten konnten nicht gespeichert werden: ${error.message}`);
      return false;
    }

    setStatus("");
    await loadSessions();
    return true;
  };

  const handleStart = async () => {
    if (!normalizedSessionId) return;

    await ensureSessionExists(normalizedSessionId);

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
            Whiteboard, Notizbuch und gemeinsamem Session-Raum.
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

            <label className="session-card">
              <span className="session-card-label">Session-Titel</span>
              <input
                className="session-input"
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                placeholder="z. B. Fluestern in Innsmouth"
              />
            </label>

            <label className="session-card">
              <span className="session-card-label">Kurzbeschreibung</span>
              <input
                className="session-input"
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="Optional: ein kurzer Hook fuer diese Runde"
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
                onClick={() => {
                  setSessionId("test");
                  setCreateTitle("Demo Runde");
                }}
              >
                Demo laden
              </button>
            </div>

            {status && <p className="landing-status">{status}</p>}
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
              <span className="ritual-title">Whiteboard und Notizen</span>
              <p>Taktische Flaeche und gemeinsames Notizbuch pro Session.</p>
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
          <p>Wuerfel, Chat, Whiteboard und Notizen leben in derselben Session.</p>
        </article>
        <article>
          <h2>Fokus auf Atmosphaere</h2>
          <p>Kein graues Tooling, sondern ein Einstieg mit Spielgefuehl.</p>
        </article>
      </section>

      <section className="session-list">
        <div className="session-list-header">
          <div>
            <p className="landing-eyebrow">Offene Runden</p>
            <h2>Alle Sessions auf einen Blick</h2>
          </div>
          <p>
            Bestehende Runden kannst du hier direkt ansehen. Wenn du oben eine neue Session-ID
            eintraegst, wird sie automatisch in Supabase angelegt.
          </p>
        </div>

        <div className="session-grid">
          {sessions.length === 0 ? (
            <article className="session-preview empty">
              <h3>Noch keine Sessions vorhanden</h3>
              <p>Lege oben eine Session an, dann erscheint sie direkt in dieser Liste.</p>
            </article>
          ) : (
            sessions.map((session) => (
              <article key={session.slug} className="session-preview">
                <p className="session-preview-slug">{session.slug}</p>
                <h3>{session.title || session.slug}</h3>
                <p>{session.description || "Noch keine Beschreibung fuer diese Runde."}</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => navigate(`/session/${encodeURIComponent(session.slug)}`)}
                >
                  Session ansehen
                </button>
              </article>
            ))
          )}
        </div>
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
