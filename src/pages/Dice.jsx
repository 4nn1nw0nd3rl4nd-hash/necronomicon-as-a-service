import { useState } from "react";

function Dice() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("normal");

  function rollDie(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }
  
  function roll(sides) {
  const roll1 = rollDie(sides);

  let resultText = `🎲 d${sides}: ${roll1}`;

  // ADV / DIS
  if (mode === "adv" || mode === "dis") {
    const roll2 = rollDie(sides);

    const final =
      mode === "adv"
        ? Math.max(roll1, roll2)
        : Math.min(roll1, roll2);

    resultText = `🎲 ${mode.toUpperCase()}: ${roll1} & ${roll2} → ${final}`;
  }

  setMessages([
    ...messages,
    { type: "bot", text: resultText }
  ]);
}

  function parseCommand(command) {
    let text = command.toLowerCase().trim();

    let match = text.match(/(\d*)d(4|6|8|10|12|20|100)/);
    if (!match) return null;

    let count = parseInt(match[1] || "1");
    let sides = parseInt(match[2]);

    let modifierMatch = text.match(/([+-]\d+)/);
    let modifier = modifierMatch ? parseInt(modifierMatch[1]) : 0;

    let advantage = text.includes("adv");
    let disadvantage = text.includes("dis");

    return { count, sides, modifier, advantage, disadvantage };
  }

function sendMessage() {
  if (!input.trim()) return;

  const newMessages = [...messages, { type: "user", text: input }];
  const text = input.toLowerCase();

  const isDiceCommand = /(\d*d(4|6|8|10|12|20|100))/.test(text);

if (!isDiceCommand) {
  setMessages(newMessages);
  setInput("");
  return;
}

  // 🎲 WÜRFEL LOGIK (dein bestehender Parser)
  const parsed = parseCommand(text);

  if (!parsed) {
    newMessages.push({
      type: "bot",
      text: "❓ Ungültiger Würfel"
    });
    setMessages(newMessages);
    setInput("");
    return;
  }

  let results = [];

  if (parsed.advantage || parsed.disadvantage) {
    const r1 = rollDie(parsed.sides);
    const r2 = rollDie(parsed.sides);

    const final = parsed.advantage
      ? Math.max(r1, r2)
      : Math.min(r1, r2);

    results.push({
      text: `🎲 ADV/DIS: ${r1} & ${r2} → ${final + parsed.modifier}`
    });
  } else {
    let sum = 0;
    let rolls = [];

    for (let i = 0; i < parsed.count; i++) {
      const r = rollDie(parsed.sides);
      rolls.push(r);
      sum += r;
    }

    results.push({
      text: `🎲 Rolls: [${rolls.join(", ")}]`
    });

    results.push({
      text: `🔥 TOTAL: ${sum + parsed.modifier}`
    });
  }

  results.forEach(r =>
    newMessages.push({ type: "bot", text: r.text })
  );

  setMessages(newMessages);
  setInput("");
}

  function handleKey(e) {
    if (e.key === "Enter") sendMessage();
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "20px",
        padding: "40px",
        maxWidth: "1000px",
        margin: "0 auto"
      }}
    >
      {/* LEFT SIDE - COMMANDS */}
      <div
        style={{
          width: "250px",
          border: "1px solid #ddd",
          borderRadius: "10px",
          padding: "15px",
          height: "500px"
        }}
      >
        <h3>📜 Befehle</h3>

        <ul>
          <li>1d20</li>
          <li>2d6+3</li>
          <li>3d8-1</li>
          <li>1d20 adv</li>
          <li>1d20 dis</li>
        </ul>

        <hr />

        <p><b>Würfel:</b></p>
        <ul>
          <li>d4</li>
          <li>d6</li>
          <li>d8</li>
          <li>d10</li>
          <li>d12</li>
          <li>d20</li>
          <li>d100</li>
        </ul>
      </div>

      {/* RIGHT SIDE - CHAT */}
      <div style={{ flex: 1 }}>
        <h1>🎲 Dice Chat</h1>
<div style={{ marginBottom: "10px" }}>
  <h3>
    🎯 Mode:{" "}
    <span
      style={{
        color:
          mode === "adv"
            ? "green"
            : mode === "dis"
            ? "red"
            : "black",
        fontWeight: "bold"
      }}
    >
      {mode.toUpperCase()}
    </span>
  </h3>
</div>
        <div
          style={{
            border: "1px solid #ccc",
            borderRadius: "10px",
            padding: "10px",
            height: "350px",
            overflowY: "auto",
            marginBottom: "10px",
            background: "#fafafa"
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                textAlign: msg.type === "user" ? "right" : "left",
                margin: "6px 0"
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "6px 10px",
                  borderRadius: "8px",
                  background:
                    msg.type === "user" ? "#d1e7ff" : "#eee"
                }}
              >
                {msg.text}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="z.B. 2d6+3, 1d20 adv"
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid #ccc"
            }}
          />

          <button
            onClick={sendMessage}
            style={{
              padding: "10px 15px",
              borderRadius: "6px",
              border: "none",
              background: "#333",
              color: "white"
            }}
          >
            Würfeln
          </button>
        </div>
		{/* WÜRFEL BUTTONS */}
<div style={{ marginTop: "15px" }}>
  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
    {[4, 6, 8, 10, 12, 20, 100].map((s) => (
      <button key={s} onClick={() => roll(s)}>
        d{s}
      </button>
    ))}
  </div>

  {/* MODE BUTTONS */}
  <div style={{ marginTop: "10px", display: "flex", gap: "10px" }}>
    <button onClick={() => setMode("normal")}>
      NORMAL
    </button>

    <button onClick={() => setMode("adv")}>
      ADV
    </button>

    <button onClick={() => setMode("dis")}>
      DIS
    </button>
  </div>
</div>
      </div>
    </div>
  );
}

export default Dice;