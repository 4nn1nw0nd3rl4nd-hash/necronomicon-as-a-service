import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { createRollPayload } from "../lib/diceRules";
import { applyWhiteboardAction, initialWhiteboardState } from "../lib/whiteboardState";

import Dice from "./Dice";
import Whiteboard from "./Whiteboard";
import Character from "./Character";

export default function Session() {
  const { id: sessionId } = useParams();

  const [activeTab, setActiveTab] = useState("character");
  const [currentUserId, setCurrentUserId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [character, setCharacter] = useState(null);
  const [isGM, setIsGM] = useState(false);
  const [messages, setMessages] = useState([]);
  const [diceResults, setDiceResults] = useState([]);
  const [whiteboardState, setWhiteboardState] = useState(initialWhiteboardState);
  const [channelStatus, setChannelStatus] = useState("connecting");

  const channelRef = useRef(null);
  const userRef = useRef(null);
  const processedWhiteboardActionIdsRef = useRef(new Set());

  const appendUniqueDiceResult = (payload) => {
    // Eigene und empfangene Realtime-Wuerfe laufen beide hier durch.
    // Damit derselbe Wurf nicht doppelt erscheint, pruefen wir ueber die id,
    // ob er schon in der Liste enthalten ist.
    setDiceResults((prev) => {
      if (prev.some((entry) => entry.id === payload.id)) {
        return prev;
      }

      return [...prev, payload];
    });
  };

  const appendUniqueMessage = (payload) => {
    // Dasselbe Prinzip fuer Chatnachrichten.
    setMessages((prev) => {
      if (prev.some((entry) => entry.id === payload.id)) {
        return prev;
      }

      return [...prev, payload];
    });
  };

  const appendWhiteboardAction = (action) => {
    if (!action?.id || processedWhiteboardActionIdsRef.current.has(action.id)) {
      return;
    }

    processedWhiteboardActionIdsRef.current.add(action.id);
    setWhiteboardState((prev) => applyWhiteboardAction(prev, action));
  };

  // 🧠 Load session + user
  useEffect(() => {
    const load = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;

      if (!user) return;

      userRef.current = user;
      setCurrentUserId(user.id);

      const { data, error } = await supabase
        .from("session_players")
        .select(`
          role,
          user_id,
          characters (
            id,
            name,
            system,
            data
          )
        `)
        .eq("session_id", sessionId);

      if (error) {
        console.error(error);
        return;
      }

      setPlayers(data || []);

      const me = data?.find((p) => p.user_id === user.id);

      if (me) {
        setIsGM(me.role === "gm");
        setCharacter(me.characters);
      }
    };

    load();
  }, [sessionId]);

  // ⚡ Realtime setup
  useEffect(() => {
    // Pro Session wird genau ein Supabase-Realtime-Kanal geoeffnet.
    // "self: true" bedeutet:
    // Auch eigene Broadcasts kommen wieder beim Sender an.
    const channel = supabase.channel(`session-${sessionId}`, {
      config: {
        broadcast: {
          self: true,
        },
      },
    });

    channelRef.current = channel;

    channel.on("broadcast", { event: "dice_roll" }, (msg) => {
      // Eingehende Wuerfe landen direkt im Dice-Feed.
      appendUniqueDiceResult(msg.payload);
    });

    channel.on("broadcast", { event: "chat_message" }, (msg) => {
      // Eingehende Nachrichten landen direkt im Chat-Feed.
      appendUniqueMessage(msg.payload);
    });

    channel.on("broadcast", { event: "private_message" }, (msg) => {
      const user = userRef.current;
      if (!user) return;

      if (msg.payload.to === user.id) {
        alert("GM: " + msg.payload.text);
      }
    });

    channel.on("broadcast", { event: "draw" }, (msg) => {
      appendWhiteboardAction(msg.payload);
    });

    channel.subscribe((status) => {
      setChannelStatus(status);
      console.log("SUB STATUS:", status);
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const rollDice = (request = { count: 1, sides: 20, modifier: 0, mode: "normal" }) => {
    // Zentraler Einstieg fuer alle Wuerfe aus der UI.
    // Die eigentliche Logik steckt in createRollPayload(),
    // damit Session und lokale Dice-Ansicht dieselben Regeln benutzen.
    const payload = createRollPayload(request, userRef.current?.id);

    // Sofort lokal anzeigen, damit die UI direkt reagiert.
    appendUniqueDiceResult(payload);

    // Danach an alle Session-Teilnehmer broadcasten.
    channelRef.current?.send({
      type: "broadcast",
      event: "dice_roll",
      payload,
    });
  };

  // 💬 Chat
  const sendMessage = (text) => {
    // Nachrichten bekommen ebenfalls eine stabile id,
    // damit lokale Anzeige und Realtime-Antwort nicht doppelt rendern.
    const payload = {
      id: `${userRef.current?.id ?? "anon"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: userRef.current?.id,
      text,
    };

    appendUniqueMessage(payload);

    channelRef.current?.send({
      type: "broadcast",
      event: "chat_message",
      payload,
    });
  };

  // 🔒 Private GM message
  const sendPrivateMessage = (toUserId, text) => {
    if (!isGM) return;

    channelRef.current?.send({
      type: "broadcast",
      event: "private_message",
      payload: {
        to: toUserId,
        text,
      },
    });
  };

  // 🎨 Whiteboard
  const sendDraw = (data) => {
    appendWhiteboardAction(data);

    channelRef.current?.send({
      type: "broadcast",
      event: "draw",
      payload: data,
    });
  };

  const tabs = [
    { id: "character", label: "Charakter" },
    { id: "chat", label: "Chat" },
    { id: "whiteboard", label: "Whiteboard" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "24px",
        color: "#f7f1de",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap",
          padding: "20px 24px",
          borderRadius: "24px",
          background: "rgba(30, 21, 17, 0.9)",
          border: "1px solid rgba(233, 204, 145, 0.16)",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "40px", color: "#fff4d0" }}>Session {sessionId}</h1>
          <p style={{ margin: "6px 0 0", color: "rgba(247, 241, 222, 0.72)" }}>
            {players.length} Spieler verbunden · Kanalstatus: {channelStatus}
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "12px 18px",
                borderRadius: "999px",
                border: activeTab === tab.id ? "none" : "1px solid rgba(233, 204, 145, 0.2)",
                background:
                  activeTab === tab.id
                    ? "linear-gradient(135deg, #f4d28e, #d89f49)"
                    : "rgba(245, 225, 185, 0.06)",
                color: activeTab === tab.id ? "#1b130e" : "#fff3d2",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          borderRadius: "24px",
          background: "rgba(25, 18, 14, 0.88)",
          border: "1px solid rgba(233, 204, 145, 0.12)",
          overflow: "hidden",
        }}
      >
        {activeTab === "character" && <Character character={character} isGM={isGM} />}

        {activeTab === "chat" && (
          <Dice
            // Dice ist bewusst "dumm" genug, dass es nur Callbacks und Daten bekommt.
            // Dadurch bleibt die Session fuer Realtime zustaendig,
            // die Dice-Komponente aber fuer Darstellung und Eingabe.
            onRoll={rollDice}
            onSendMessage={sendMessage}
            results={diceResults}
            messages={messages}
            channelStatus={channelStatus}
          />
        )}

        {activeTab === "whiteboard" && (
          <Whiteboard
            isGM={isGM}
            onDraw={sendDraw}
            boardState={whiteboardState}
            currentUserId={currentUserId}
            players={players}
          />
        )}
      </div>
    </div>
  );
}
