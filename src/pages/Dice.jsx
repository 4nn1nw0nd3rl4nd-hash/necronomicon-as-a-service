import { useMemo, useState } from "react";
import { SUPPORTED_SIDES, parseDiceCommand } from "../lib/diceParser";
import { buildDiceRoll, getModeLabel, getModeTone } from "../lib/diceRules";

function toTimelineEntry(entry, index) {
  // Diese Funktion normalisiert zwei unterschiedliche Datenarten
  // auf dieselbe Darstellungsform:
  // 1. Chat-Nachricht
  // 2. Wurf-Ergebnis
  //
  // Das ist praktisch, weil das Feed-Rendering unten dann nur noch
  // eine gemeinsame "displayEntries"-Liste braucht.
  if (entry.type === "chat") {
    return {
      id: entry.id || `chat-${index}`,
      kind: "chat",
      author: entry.userId || "User",
      body: entry.text,
    };
  }

  return {
    id: entry.id || `roll-${index}`,
    kind: "roll",
    author: entry.userId || `Wurf ${index + 1}`,
    body: entry.label || "d20",
    detail: entry.detail || "",
    result: entry.result ?? "?",
  };
}

function Dice({ onRoll, onSendMessage, results = [], messages = [] }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("normal");
  const [localEntries, setLocalEntries] = useState([]);

  const timeline = useMemo(() => {
    // Wenn Session-Daten vorhanden sind, zeigen wir den gemeinsamen Realtime-Feed.
    // Falls Dice jemals ausserhalb einer Session verwendet wird,
    // faellt die Komponente auf localEntries zurueck.
    const sessionEntries = [
      ...results.map((entry) => ({ ...entry, type: "roll" })),
      ...messages.map((entry) => ({ ...entry, type: "chat" })),
    ];

    if (sessionEntries.length > 0) {
      return sessionEntries;
    }

    return localEntries;
  }, [localEntries, messages, results]);

  const displayEntries = useMemo(
    // Hier wird der rohe Feed in darstellbare Karten uebersetzt.
    () => timeline.map(toTimelineEntry).sort((a, b) => (a.id > b.id ? 1 : -1)),
    [timeline]
  );

  const triggerRoll = (parsed) => {
    // Wenn die Session eine onRoll-Funktion uebergibt,
    // soll Dice nicht selbst rechnen, sondern den Wurf nach oben geben.
    // So bleibt die Session der "Single Source of Truth" fuer Realtime.
    if (onRoll) {
      onRoll(parsed);
      return;
    }

    // Fallback fuer lokale Nutzung ohne Session.
    setLocalEntries((prev) => [
      ...prev,
      {
        id: `local-roll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "roll",
        ...buildDiceRoll(parsed, "Ich"),
      },
    ]);
  };

  const triggerChat = (text) => {
    // Dasselbe Prinzip wie bei Wuerfen:
    // Bevorzugt ueber die Session schicken, sonst lokal puffern.
    if (onSendMessage) {
      onSendMessage(text);
      return;
    }

    setLocalEntries((prev) => [
      ...prev,
      {
        id: `local-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "chat",
        userId: "Ich",
        text,
      },
    ]);
  };

  const handleQuickRoll = (sides) => {
    // Glueck und CoC Bonus/Strafe sind Sonderfaelle:
    // Der Schnellwuerfel-Button selbst bestimmt hier nicht immer den exakten Wurf,
    // sondern loest je nach Modus den passenden Regeltyp aus.
    if (mode === "luck") {
      triggerRoll({ count: 3, sides: 6, modifier: 0, mode: "luck" });
      return;
    }

    if (mode === "bonus1" || mode === "bonus2" || mode === "penalty1" || mode === "penalty2") {
      triggerRoll({ count: 1, sides: 100, modifier: 0, mode });
      return;
    }

    triggerRoll({ count: 1, sides, modifier: 0, mode });
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;

    // Erst versuchen wir, den Text als Wuerfelbefehl zu verstehen.
    // Wenn das fehlschlaegt, behandeln wir den Text einfach als Chatnachricht.
    const parsed = parseDiceCommand(text);

    if (parsed) {
      triggerRoll(parsed);
    } else {
      triggerChat(text);
    }

    setInput("");
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      handleSubmit();
    }
  };

  const modeTone = getModeTone(mode);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "290px minmax(0, 1fr)",
        gap: "22px",
        padding: "28px",
        color: "#f7f1de",
      }}
    >
      <aside
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          padding: "20px",
          borderRadius: "24px",
          border: "1px solid rgba(233, 204, 145, 0.16)",
          background:
            "linear-gradient(180deg, rgba(41, 30, 23, 0.98), rgba(24, 17, 14, 0.96))",
          boxShadow: "inset 0 1px 0 rgba(255, 240, 201, 0.06)",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              color: "#d5b070",
              fontSize: "13px",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            Ritual Tools
          </p>
          <h2 style={{ margin: "8px 0 0", color: "#fff0c8", fontSize: "28px" }}>Dice Desk</h2>
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: "18px",
            background: "rgba(255, 246, 228, 0.04)",
            border: "1px solid rgba(233, 204, 145, 0.12)",
          }}
        >
          <div style={{ marginBottom: "12px", color: "#f3dfb7", fontWeight: 700 }}>Aktueller Modus</div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 14px",
              borderRadius: "999px",
              background: modeTone.background,
              color: modeTone.color,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {getModeLabel(mode)}
          </span>
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: "18px",
            background: "rgba(255, 246, 228, 0.04)",
            border: "1px solid rgba(233, 204, 145, 0.12)",
          }}
        >
          <div style={{ marginBottom: "12px", color: "#f3dfb7", fontWeight: 700 }}>Schnellwuerfel</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
            {SUPPORTED_SIDES.map((sides) => (
              <button
                key={sides}
                onClick={() => handleQuickRoll(sides)}
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(233, 204, 145, 0.16)",
                  background:
                    "linear-gradient(180deg, rgba(247, 229, 191, 0.12), rgba(233, 204, 145, 0.04))",
                  color: "#fff1cd",
                  padding: "14px 10px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {`d${sides}`}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: "18px",
            background: "rgba(255, 246, 228, 0.04)",
            border: "1px solid rgba(233, 204, 145, 0.12)",
          }}
        >
          <div style={{ marginBottom: "12px", color: "#f3dfb7", fontWeight: 700 }}>Modi</div>
          <div style={{ display: "grid", gap: "14px" }}>
            <div>
              <div style={{ marginBottom: "10px", color: "rgba(247, 241, 222, 0.62)", fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                DnD
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {["normal", "adv", "dis"].map((currentMode) => {
                  const currentTone = getModeTone(currentMode);
                  const isActive = currentMode === mode;

                  return (
                    <button
                      key={currentMode}
                      onClick={() => setMode(currentMode)}
                      style={{
                        borderRadius: "999px",
                        border: isActive
                          ? "none"
                          : "1px solid rgba(233, 204, 145, 0.18)",
                        background: isActive ? currentTone.background : "rgba(245, 225, 185, 0.06)",
                        color: isActive ? currentTone.color : "#fff0c8",
                        padding: "10px 14px",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      {getModeLabel(currentMode)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ marginBottom: "10px", color: "rgba(247, 241, 222, 0.62)", fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                Call of Cthulhu
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {["bonus1", "bonus2", "penalty1", "penalty2", "luck"].map((currentMode) => {
                  const currentTone = getModeTone(currentMode);
                  const isActive = currentMode === mode;
                  const handleModeClick = () => {
                    if (currentMode === "luck") {
                      setMode("luck");
                      triggerRoll({ count: 3, sides: 6, modifier: 0, mode: "luck" });
                      return;
                    }

                    setMode(currentMode);
                  };

                  return (
                    <button
                      key={currentMode}
                      onClick={handleModeClick}
                      style={{
                        borderRadius: "999px",
                        border: isActive
                          ? "none"
                          : "1px solid rgba(233, 204, 145, 0.18)",
                        background: isActive ? currentTone.background : "rgba(245, 225, 185, 0.06)",
                        color: isActive ? currentTone.color : "#fff0c8",
                        padding: "10px 14px",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {getModeLabel(currentMode)}
                    </button>
                  );
                })}
              </div>

            </div>
          </div>
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: "18px",
            background: "rgba(255, 246, 228, 0.04)",
            border: "1px solid rgba(233, 204, 145, 0.12)",
          }}
        >
          <div style={{ marginBottom: "8px", color: "#f3dfb7", fontWeight: 700 }}>Beispiele</div>
          <div style={{ display: "grid", gap: "8px", color: "rgba(247, 241, 222, 0.72)" }}>
            <span>`1d20`</span>
            <span>`2d6+3`</span>
            <span>`1d20 adv`</span>
            <span>`1d100 bonus1`</span>
            <span>`1d100 bonus2`</span>
            <span>`1d100 strafe1`</span>
            <span>`1d100 strafe2`</span>
            <span>`glueck`</span>
          </div>
        </div>
      </aside>

      <section
        style={{
          display: "grid",
          gridTemplateRows: "auto minmax(420px, 1fr) auto",
          gap: "16px",
          padding: "20px",
          borderRadius: "24px",
          border: "1px solid rgba(233, 204, 145, 0.16)",
          background:
            "radial-gradient(circle at top right, rgba(211, 151, 72, 0.1), transparent 26%), linear-gradient(180deg, rgba(35, 25, 20, 0.98), rgba(20, 14, 11, 0.98))",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                color: "#d5b070",
                fontSize: "13px",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              Dice Feed
            </p>
            <h2 style={{ margin: "8px 0 0", color: "#fff3d4", fontSize: "32px" }}>
              Wuerfel und Chat im selben Verlauf
            </h2>
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              borderRadius: "999px",
              border: "1px solid rgba(233, 204, 145, 0.14)",
              background: "rgba(255, 246, 228, 0.04)",
            }}
          >
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "999px",
                background: modeTone.background,
                boxShadow: `0 0 18px ${modeTone.background}`,
              }}
            />
            <span style={{ color: "rgba(247, 241, 222, 0.82)" }}>
              Fokus: <b style={{ color: "#fff1ca" }}>{getModeLabel(mode)}</b>
            </span>
          </div>
        </div>

        <div
          style={{
            padding: "12px",
            borderRadius: "22px",
            border: "1px solid rgba(233, 204, 145, 0.12)",
            background:
              "linear-gradient(180deg, rgba(255, 248, 236, 0.05), rgba(255, 248, 236, 0.02))",
            overflowY: "auto",
            display: "grid",
            gap: "12px",
          }}
        >
          {displayEntries.length === 0 ? (
            <div
              style={{
                display: "grid",
                placeItems: "center",
                minHeight: "320px",
                borderRadius: "18px",
                border: "1px dashed rgba(233, 204, 145, 0.16)",
                color: "rgba(247, 241, 222, 0.66)",
                background: "rgba(255, 247, 231, 0.03)",
                textAlign: "center",
                padding: "24px",
              }}
            >
              <div>
                <div style={{ fontSize: "18px", color: "#fff0c8", marginBottom: "8px" }}>
                  Noch ist es still im Ritualraum.
                </div>
                <div>Schreibe eine Nachricht oder starte den ersten Wurf.</div>
              </div>
            </div>
          ) : (
            displayEntries.map((entry) => {
              const isChat = entry.kind === "chat";

              return (
                <article
                  key={entry.id}
                  style={{
                    alignSelf: isChat ? "stretch" : "stretch",
                    padding: isChat ? "14px 16px" : "16px 18px",
                    borderRadius: "18px",
                    border: isChat
                      ? "1px solid rgba(124, 171, 208, 0.14)"
                      : "1px solid rgba(233, 204, 145, 0.16)",
                    background: isChat
                      ? "linear-gradient(180deg, rgba(73, 94, 119, 0.26), rgba(41, 54, 68, 0.2))"
                      : "linear-gradient(180deg, rgba(241, 220, 178, 0.16), rgba(121, 85, 40, 0.16))",
                    boxShadow: isChat
                      ? "none"
                      : "inset 0 1px 0 rgba(255, 241, 205, 0.08), 0 12px 30px rgba(0, 0, 0, 0.14)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: isChat ? "center" : "flex-start",
                      gap: "14px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color: isChat ? "#cde7ff" : "#ffe7b3",
                          fontWeight: 800,
                          marginBottom: isChat ? "6px" : "4px",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {entry.author}
                      </div>

                      {isChat ? (
                        <div style={{ color: "#f4f7ff", lineHeight: 1.6 }}>{entry.body}</div>
                      ) : (
                        <>
                          <div style={{ color: "#f9eed4", fontSize: "18px", fontWeight: 700 }}>
                            {entry.body}
                          </div>
                          <div style={{ color: "rgba(249, 238, 212, 0.72)", marginTop: "6px" }}>
                            {entry.detail || "Direkter Wurf"}
                          </div>
                        </>
                      )}
                    </div>

                    {!isChat && (
                      <div
                        style={{
                          minWidth: "84px",
                          padding: "12px 14px",
                          borderRadius: "16px",
                          background: "rgba(255, 241, 205, 0.88)",
                          color: "#2a1a12",
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                          Result
                        </div>
                        <div style={{ fontSize: "30px", fontWeight: 900, lineHeight: 1.1 }}>{entry.result}</div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div
          style={{
            display: "grid",
            gap: "12px",
            padding: "14px",
            borderRadius: "20px",
            border: "1px solid rgba(233, 204, 145, 0.14)",
            background: "rgba(255, 246, 228, 0.04)",
          }}
        >
          <div style={{ display: "flex", gap: "12px", alignItems: "stretch" }}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nachricht schreiben oder z. B. 2d6+3, 1d20 adv, 1d100 bonus1, glueck"
              style={{
                flex: 1,
                padding: "16px 18px",
                borderRadius: "16px",
                border: "1px solid rgba(233, 204, 145, 0.22)",
                background: "rgba(255, 247, 231, 0.08)",
                color: "#fff4dd",
              }}
            />

            <button
              onClick={handleSubmit}
              style={{
                minWidth: "132px",
                padding: "16px 18px",
                borderRadius: "16px",
                border: "none",
                background: "linear-gradient(135deg, #f4d28e, #d89f49)",
                color: "#1a130e",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Senden
            </button>
          </div>

          <div style={{ color: "rgba(247, 241, 222, 0.66)", fontSize: "14px" }}>
            Glueckswurf: Modus `Glueck` waehlen und einen Schnellwuerfel druecken oder einfach `glueck` eingeben. Wuerfelbefehle werden automatisch erkannt. Alles andere landet als Chatnachricht im Feed.
          </div>
        </div>
      </section>
    </div>
  );
}

export default Dice;
