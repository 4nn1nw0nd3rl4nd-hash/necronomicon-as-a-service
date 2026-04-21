import { useMemo, useState } from "react";

const SUPPORTED_SIDES = [4, 6, 8, 10, 12, 20, 100];

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function parseCommand(command) {
  const text = command.toLowerCase().trim();
  const match = text.match(/(\d*)d(4|6|8|10|12|20|100)/);

  if (!match) return null;

  const count = parseInt(match[1] || "1", 10);
  const sides = parseInt(match[2], 10);
  const modifierMatch = text.match(/([+-]\d+)/);
  const modifier = modifierMatch ? parseInt(modifierMatch[1], 10) : 0;
  const mode = text.includes("adv") ? "adv" : text.includes("dis") ? "dis" : "normal";

  return { count, sides, modifier, mode };
}

function buildLocalRoll(parsed) {
  if (parsed.mode === "adv" || parsed.mode === "dis") {
    const first = rollDie(parsed.sides);
    const second = rollDie(parsed.sides);
    const selected = parsed.mode === "adv" ? Math.max(first, second) : Math.min(first, second);
    const total = selected + parsed.modifier;
    const modifierText = parsed.modifier ? ` ${parsed.modifier > 0 ? "+" : "-"} ${Math.abs(parsed.modifier)}` : "";

    return {
      id: `local-roll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "roll",
      label: `${parsed.mode.toUpperCase()} d${parsed.sides}`,
      detail: `${first}, ${second}${modifierText}`,
      result: total,
    };
  }

  const rolls = [];
  let sum = 0;

  for (let i = 0; i < parsed.count; i += 1) {
    const roll = rollDie(parsed.sides);
    rolls.push(roll);
    sum += roll;
  }

  const total = sum + parsed.modifier;
  const modifierText = parsed.modifier ? ` ${parsed.modifier > 0 ? "+" : "-"} ${Math.abs(parsed.modifier)}` : "";

  return {
    id: `local-roll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "roll",
    label: `${parsed.count}d${parsed.sides}`,
    detail: `[${rolls.join(", ")}]${modifierText}`,
    result: total,
  };
}

function formatTimelineEntry(entry, index) {
  if (entry.type === "chat") {
    return {
      id: entry.id || `chat-${index}`,
      kind: "chat",
      text: `${entry.userId || "User"}: ${entry.text}`,
    };
  }

  const userLabel = entry.userId || `Wurf ${index + 1}`;
  const detail = entry.detail ? ` (${entry.detail})` : "";

  return {
    id: entry.id || `roll-${index}`,
    kind: "roll",
    text: `${userLabel}: ${entry.label || "d20"} = ${entry.result ?? "?"}${detail}`,
  };
}

function Dice({ onRoll, onSendMessage, results = [], messages = [] }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("normal");
  const [localEntries, setLocalEntries] = useState([]);

  const timeline = useMemo(() => {
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
    () =>
      timeline
        .map(formatTimelineEntry)
        .sort((a, b) => (a.id > b.id ? 1 : -1)),
    [timeline]
  );

  const triggerRoll = (parsed) => {
    if (onRoll) {
      onRoll(parsed);
      return;
    }

    setLocalEntries((prev) => [...prev, buildLocalRoll(parsed)]);
  };

  const triggerChat = (text) => {
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
    triggerRoll({ count: 1, sides, modifier: 0, mode });
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;

    const parsed = parseCommand(text);

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

  return (
    <div
      style={{
        display: "flex",
        gap: "20px",
        padding: "40px",
        maxWidth: "1000px",
        margin: "0 auto",
        color: "#f7f1de",
      }}
    >
      <div
        style={{
          width: "250px",
          border: "1px solid rgba(233, 204, 145, 0.18)",
          borderRadius: "18px",
          padding: "15px",
          height: "500px",
          background: "rgba(255, 247, 231, 0.05)",
        }}
      >
        <h3 style={{ color: "#fff0c8" }}>Befehle</h3>

        <ul>
          <li>1d20</li>
          <li>2d6+3</li>
          <li>3d8-1</li>
          <li>1d20 adv</li>
          <li>1d20 dis</li>
        </ul>

        <hr />

        <p>
          <b style={{ color: "#f5deb2" }}>Wuerfel</b>
        </p>
        <ul>
          {SUPPORTED_SIDES.map((sides) => (
            <li key={sides}>{`d${sides}`}</li>
          ))}
        </ul>
      </div>

      <div style={{ flex: 1 }}>
        <h1 style={{ color: "#fff0c8" }}>Dice Chat</h1>

        <div style={{ marginBottom: "10px" }}>
          <h3>
            Modus:{" "}
            <span
              style={{
                color: mode === "adv" ? "#84d98a" : mode === "dis" ? "#ff8b7a" : "#f5deb2",
                fontWeight: "bold",
              }}
            >
              {mode.toUpperCase()}
            </span>
          </h3>
        </div>

        <div
          style={{
            border: "1px solid rgba(233, 204, 145, 0.18)",
            borderRadius: "18px",
            padding: "10px",
            height: "350px",
            overflowY: "auto",
            marginBottom: "10px",
            background: "rgba(255, 248, 236, 0.08)",
          }}
        >
          {displayEntries.length === 0 ? (
            <p style={{ color: "rgba(247, 241, 222, 0.72)" }}>Noch keine Nachrichten oder Wuerfelwuerfe.</p>
          ) : (
            displayEntries.map((entry) => (
              <div key={entry.id} style={{ margin: "6px 0" }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    borderRadius: "8px",
                    background: entry.kind === "chat" ? "#f1d8aa" : "#efe6d1",
                    color: "#1f1712",
                    border: "1px solid rgba(64, 44, 29, 0.08)",
                  }}
                >
                  {entry.text}
                </span>
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nachricht oder z. B. 2d6+3, 1d20 adv"
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid rgba(233, 204, 145, 0.22)",
              background: "rgba(255, 247, 231, 0.08)",
              color: "#fff4dd",
            }}
          />

          <button
            onClick={handleSubmit}
            style={{
              padding: "10px 15px",
              borderRadius: "6px",
              border: "none",
              background: "linear-gradient(135deg, #f4d28e, #d89f49)",
              color: "#1a130e",
              fontWeight: 700,
            }}
          >
            Senden
          </button>
        </div>

        <div style={{ marginTop: "15px" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {SUPPORTED_SIDES.map((sides) => (
              <button
                key={sides}
                onClick={() => handleQuickRoll(sides)}
                style={{
                  borderRadius: "999px",
                  border: "1px solid rgba(233, 204, 145, 0.2)",
                  background: "rgba(245, 225, 185, 0.06)",
                  color: "#fff0c8",
                  padding: "10px 14px",
                }}
              >
                {`d${sides}`}
              </button>
            ))}
          </div>

          <div style={{ marginTop: "10px", display: "flex", gap: "10px" }}>
            <button
              onClick={() => setMode("normal")}
              style={{
                borderRadius: "999px",
                border: "1px solid rgba(233, 204, 145, 0.2)",
                background: mode === "normal" ? "#f4d28e" : "rgba(245, 225, 185, 0.06)",
                color: mode === "normal" ? "#1a130e" : "#fff0c8",
                padding: "10px 14px",
                fontWeight: 700,
              }}
            >
              NORMAL
            </button>
            <button
              onClick={() => setMode("adv")}
              style={{
                borderRadius: "999px",
                border: "1px solid rgba(233, 204, 145, 0.2)",
                background: mode === "adv" ? "#84d98a" : "rgba(245, 225, 185, 0.06)",
                color: mode === "adv" ? "#102212" : "#fff0c8",
                padding: "10px 14px",
                fontWeight: 700,
              }}
            >
              ADV
            </button>
            <button
              onClick={() => setMode("dis")}
              style={{
                borderRadius: "999px",
                border: "1px solid rgba(233, 204, 145, 0.2)",
                background: mode === "dis" ? "#ff8b7a" : "rgba(245, 225, 185, 0.06)",
                color: mode === "dis" ? "#2d120d" : "#fff0c8",
                padding: "10px 14px",
                fontWeight: 700,
              }}
            >
              DIS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dice;
