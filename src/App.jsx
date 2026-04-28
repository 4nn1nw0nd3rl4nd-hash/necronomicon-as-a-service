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
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUser, setAuthUser] = useState(null);

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
    Promise.resolve().then(loadSessions);
  }, []);

  useEffect(() => {
    let ignore = false;

    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!ignore) {
        setAuthUser(user || null);
      }
    };

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user || null);
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, []);

  const ensureSessionExists = async (slug) => {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;

    if (!user) {
      setStatus("Bitte zuerst einloggen, bevor du eine Session anlegst.");
      return false;
    }

    const payload = {
      slug,
      title: createTitle.trim() || `Session ${slug}`,
      description: createDescription.trim() || null,
      created_by: user.id,
    };

    const { error } = await supabase.from("sessions").upsert(payload, { onConflict: "slug" });

    if (error) {
      console.error(error);
      setStatus(`Session-Metadaten konnten nicht gespeichert werden: ${error.message}`);
      return false;
    }

    const { data: existingMembership, error: memberLookupError } = await supabase
      .from("session_players")
      .select("id")
      .eq("session_id", slug)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberLookupError) {
      console.error(memberLookupError);
      setStatus(`Session wurde erstellt, aber GM-Rolle konnte nicht geprueft werden: ${memberLookupError.message}`);
      return false;
    }

    const membershipPayload = {
      session_id: slug,
      user_id: user.id,
      role: "gm",
    };

    const { error: gmError } = existingMembership
      ? await supabase.from("session_players").update({ role: "gm" }).eq("id", existingMembership.id)
      : await supabase.from("session_players").insert(membershipPayload);

    if (gmError) {
      console.error(gmError);
      setStatus(`Session wurde erstellt, aber GM-Rolle konnte nicht gesetzt werden: ${gmError.message}`);
      return false;
    }

    setStatus("");
    await loadSessions();
    return true;
  };

  const handleStart = async () => {
    if (!normalizedSessionId) return;

    const success = await ensureSessionExists(normalizedSessionId);
    if (!success) return;

    navigate(`/session/${encodeURIComponent(normalizedSessionId)}`);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      handleStart();
    }
  };

  const handleSignIn = async () => {
    const email = authEmail.trim();
    if (!email || !authPassword) {
      setStatus("Bitte E-Mail und Passwort eingeben.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: authPassword,
    });

    if (error) {
      setStatus(`Login fehlgeschlagen: ${error.message}`);
      return;
    }

    setStatus("Erfolgreich eingeloggt.");
    setAuthPassword("");
  };

  const handleSignUp = async () => {
    const email = authEmail.trim();
    if (!email || !authPassword) {
      setStatus("Bitte E-Mail und Passwort eingeben.");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password: authPassword,
    });

    if (error) {
      setStatus(`Registrierung fehlgeschlagen: ${error.message}`);
      return;
    }

    setStatus("Konto erstellt. Falls aktiviert, pruefe deine E-Mails zur Bestaetigung.");
    setAuthPassword("");
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setStatus(`Logout fehlgeschlagen: ${error.message}`);
      return;
    }

    setStatus("Erfolgreich ausgeloggt.");
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
            <div className="auth-card">
              <span className="session-card-label">Login</span>
              {authUser ? (
                <>
                  <p className="auth-user">Eingeloggt als {authUser.email || authUser.id}</p>
                  <button type="button" className="secondary-button" onClick={handleSignOut}>
                    Ausloggen
                  </button>
                </>
              ) : (
                <>
                  <input
                    className="session-input"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    placeholder="E-Mail"
                    type="email"
                  />
                  <input
                    className="session-input"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    placeholder="Passwort"
                    type="password"
                  />
                  <div className="landing-buttons">
                    <button type="button" className="secondary-button" onClick={handleSignIn}>
                      Einloggen
                    </button>
                    <button type="button" className="secondary-button" onClick={handleSignUp}>
                      Registrieren
                    </button>
                  </div>
                </>
              )}
            </div>

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
                disabled={!normalizedSessionId || !authUser}
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
