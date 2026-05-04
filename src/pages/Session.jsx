import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { createRollPayload } from "../lib/diceRules";
import { applyWhiteboardAction, initialWhiteboardState } from "../lib/whiteboardState";
import { applyNotebookAction, initialNotebookState } from "../lib/notebookState";

import Dice from "./Dice";
import Whiteboard from "./Whiteboard";
import Character from "./Character";
import Notebook from "./Notebook";

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
  const [notebookState, setNotebookState] = useState(initialNotebookState);
  const [sessionMeta, setSessionMeta] = useState(null);
  const [channelStatus, setChannelStatus] = useState("connecting");

  const channelRef = useRef(null);
  const userRef = useRef(null);
  const processedWhiteboardActionIdsRef = useRef(new Set());
  const processedNotebookActionIdsRef = useRef(new Set());

  const getDisplayName = (player) => {
    if (!player) return "Unbekannt";
    if (player.display_name?.trim()) return player.display_name.trim();
    if (player.user_id === currentUserId) {
      const currentUser = userRef.current;
      if (currentUser?.user_metadata?.username) return currentUser.user_metadata.username;
      if (currentUser?.email) return currentUser.email;
    }
    return player.user_id?.slice(0, 8) || "Unbekannt";
  };

  const appendUniqueDiceResult = (payload) => {
    setDiceResults((prev) => {
      if (prev.some((entry) => entry.id === payload.id)) {
        return prev;
      }

      return [...prev, payload];
    });
  };

  const appendUniqueMessage = (payload) => {
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

  const appendNotebookAction = (action) => {
    if (!action?.id || processedNotebookActionIdsRef.current.has(action.id)) {
      return;
    }

    processedNotebookActionIdsRef.current.add(action.id);
    setNotebookState((prev) => applyNotebookAction(prev, action));
  };

  useEffect(() => {
    const fetchPlayers = async (sessionPlayerId) => {
      return supabase
        .from("session_players")
        .select(`
            role,
            user_id,
            display_name,
            characters (
              id,
              name,
              system,
              data
            )
          `)
        .eq("session_id", sessionPlayerId);
    };

    const load = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;

      if (!user) return;

      userRef.current = user;
      setCurrentUserId(user.id);

      const [
        { data: sessionRow },
        { data: notebookRows, error: notebookError },
        { data: whiteboardImages, error: imagesError },
        { data: whiteboardNotes, error: notesError },
        { data: whiteboardTokens, error: tokensError },
      ] = await Promise.all([
        supabase
          .from("sessions")
          .select("id, slug, title, description, created_by, created_at, updated_at")
          .eq("slug", sessionId)
          .maybeSingle(),
        supabase
          .from("notebook_pages")
          .select("user_id, title, content, updated_at")
          .eq("session_slug", sessionId),
        supabase
          .from("whiteboard_images")
          .select("id, src, x, y, width, height, revealed, name")
          .eq("session_slug", sessionId)
          .order("created_at", { ascending: true }),
        supabase
          .from("whiteboard_notes")
          .select("id, text, x, y, author_id")
          .eq("session_slug", sessionId)
          .order("created_at", { ascending: true }),
        supabase
          .from("whiteboard_tokens")
          .select("user_id, x, y")
          .eq("session_slug", sessionId),
      ]);

      const sessionPlayerId = sessionRow?.slug || sessionId;
      const { data: initialPlayerRows, error: playerError } = await fetchPlayers(sessionPlayerId);

      if (sessionRow) {
        setSessionMeta(sessionRow);
      }

      if (!notebookError && notebookRows) {
        setNotebookState({
          pages: notebookRows.map((page) => ({
            userId: page.user_id,
            title: page.title || "",
            content: page.content || "",
            updatedAt: page.updated_at,
          })),
        });
      }

      if (!imagesError && !notesError && !tokensError) {
        setWhiteboardState({
          images:
            whiteboardImages?.map((image) => ({
              id: image.id,
              src: image.src,
              x: image.x,
              y: image.y,
              width: image.width,
              height: image.height,
              revealed: image.revealed,
              name: image.name,
            })) || [],
          notes:
            whiteboardNotes?.map((note) => ({
              id: note.id,
              text: note.text,
              x: note.x,
              y: note.y,
              authorId: note.author_id,
            })) || [],
          tokens:
            whiteboardTokens?.reduce((acc, token) => {
              acc[token.user_id] = { x: token.x, y: token.y };
              return acc;
            }, {}) || {},
        });
      }

      if (playerError) {
        console.error(playerError);
        return;
      }

      let playerRows = initialPlayerRows || [];
      let me = playerRows.find((player) => player.user_id === user.id);
      const displayName = user.user_metadata?.username?.trim() || user.email || user.id.slice(0, 8);

      if (me && me.display_name !== displayName) {
        const { error: syncDisplayNameError } = await supabase
          .from("session_players")
          .update({ display_name: displayName })
          .eq("session_id", sessionPlayerId)
          .eq("user_id", user.id);

        if (syncDisplayNameError) {
          console.error(syncDisplayNameError);
        } else {
          me = { ...me, display_name: displayName };
          playerRows = playerRows.map((player) =>
            player.user_id === user.id ? { ...player, display_name: displayName } : player
          );
        }
      }

      if (!me) {
        const defaultRole = sessionRow?.created_by === user.id ? "gm" : "player";
        const membershipPayload = {
          session_id: sessionPlayerId,
          user_id: user.id,
          role: defaultRole,
          display_name: displayName,
        };
        const { data: existingMembership, error: memberLookupError } = await supabase
          .from("session_players")
          .select("id")
          .eq("session_id", sessionPlayerId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (memberLookupError) {
          console.error(memberLookupError);
          return;
        }

        const { error: joinError } = existingMembership
          ? await supabase
              .from("session_players")
              .update({ role: defaultRole, display_name: displayName })
              .eq("id", existingMembership.id)
          : await supabase.from("session_players").insert(membershipPayload);

        if (joinError) {
          console.error(joinError);
        } else {
          const { data: refreshedPlayers, error: refreshPlayersError } = await fetchPlayers(sessionPlayerId);
          if (refreshPlayersError) {
            console.error(refreshPlayersError);
          } else {
            playerRows = refreshedPlayers || [];
            me = playerRows.find((player) => player.user_id === user.id);
          }
        }
      }

      setPlayers(playerRows);

      if (me) {
        setIsGM(me.role === "gm");
        setCharacter(me.characters);
      }
    };

    load();
  }, [sessionId]);

  useEffect(() => {
    const channel = supabase.channel(`session-${sessionId}`, {
      config: {
        broadcast: {
          self: true,
        },
      },
    });

    channelRef.current = channel;

    channel.on("broadcast", { event: "dice_roll" }, (msg) => {
      appendUniqueDiceResult(msg.payload);
    });

    channel.on("broadcast", { event: "chat_message" }, (msg) => {
      appendUniqueMessage(msg.payload);
    });

    channel.on("broadcast", { event: "private_message" }, (msg) => {
      const user = userRef.current;
      if (!user) return;

      if (msg.payload.to === user.id) {
        alert(`GM: ${msg.payload.text}`);
      }
    });

    channel.on("broadcast", { event: "draw" }, (msg) => {
      appendWhiteboardAction(msg.payload);
    });

    channel.on("broadcast", { event: "notebook_update" }, (msg) => {
      appendNotebookAction(msg.payload);
    });

    channel.subscribe((status) => {
      setChannelStatus(status);
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const rollDice = (request = { count: 1, sides: 20, modifier: 0, mode: "normal" }) => {
    const payload = createRollPayload(request, userRef.current?.id);

    appendUniqueDiceResult(payload);

    channelRef.current?.send({
      type: "broadcast",
      event: "dice_roll",
      payload,
    });
  };

  const sendMessage = (text) => {
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

  const persistWhiteboardAction = async (data) => {
    if (data.type === "add_image" && data.image) {
      return supabase.from("whiteboard_images").upsert({
        id: data.image.id,
        session_slug: sessionId,
        src: data.image.src,
        x: data.image.x,
        y: data.image.y,
        width: data.image.width,
        height: data.image.height,
        revealed: data.image.revealed ?? false,
        name: data.image.name || null,
      });
    }

    if (data.type === "move_image") {
      return supabase
        .from("whiteboard_images")
        .update({ x: data.x, y: data.y })
        .eq("session_slug", sessionId)
        .eq("id", data.targetId);
    }

    if (data.type === "toggle_image_visibility") {
      return supabase
        .from("whiteboard_images")
        .update({ revealed: data.revealed })
        .eq("session_slug", sessionId)
        .eq("id", data.targetId);
    }

    if (data.type === "add_note" && data.note) {
      return supabase.from("whiteboard_notes").upsert({
        id: data.note.id,
        session_slug: sessionId,
        text: data.note.text,
        x: data.note.x,
        y: data.note.y,
        author_id: data.note.authorId,
      });
    }

    if (data.type === "move_note") {
      return supabase
        .from("whiteboard_notes")
        .update({ x: data.x, y: data.y })
        .eq("session_slug", sessionId)
        .eq("id", data.targetId);
    }

    if (data.type === "move_token") {
      return supabase.from("whiteboard_tokens").upsert({
        session_slug: sessionId,
        user_id: data.userId,
        x: data.x,
        y: data.y,
      });
    }

    return null;
  };

  const sendDraw = async (data) => {
    appendWhiteboardAction(data);

    const result = await persistWhiteboardAction(data);
    if (result?.error) {
      console.error(result.error);
    }

    channelRef.current?.send({
      type: "broadcast",
      event: "draw",
      payload: data,
    });
  };

  const saveNotebookPage = async (page) => {
    const action = {
      id: `${userRef.current?.id ?? "anon"}-notebook-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      type: "upsert_page",
      page,
    };

    appendNotebookAction(action);

    const { error } = await supabase.from("notebook_pages").upsert({
      session_slug: sessionId,
      user_id: page.userId,
      title: page.title,
      content: page.content,
      updated_at: page.updatedAt,
    });

    if (error) {
      console.error(error);
    }

    channelRef.current?.send({
      type: "broadcast",
      event: "notebook_update",
      payload: action,
    });
  };

  const tabs = [
    { id: "character", label: "Charakter" },
    { id: "chat", label: "Chat" },
    { id: "whiteboard", label: "Whiteboard" },
    { id: "notebook", label: "Notizbuch" },
  ];

  const gmPlayers = players.filter((player) => player.role === "gm");
  const connectedPlayers = players.filter((player) => player.role !== "gm");

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
          <h1 style={{ margin: 0, fontSize: "40px", color: "#fff4d0" }}>
            {sessionMeta?.title || `Session ${sessionId}`}
          </h1>
          <p style={{ margin: "6px 0 0", color: "rgba(247, 241, 222, 0.72)" }}>
            DM:{" "}
            {gmPlayers.length > 0
              ? gmPlayers.map((player) => getDisplayName(player)).join(", ")
              : "Noch kein DM verbunden"}
          </p>
          <p style={{ margin: "4px 0 0", color: "rgba(247, 241, 222, 0.64)" }}>
            Spieler:{" "}
            {connectedPlayers.length > 0
              ? connectedPlayers.map((player) => getDisplayName(player)).join(", ")
              : "Noch keine Spieler verbunden"}
          </p>
          {sessionMeta?.description && (
            <p style={{ margin: "8px 0 0", color: "rgba(247, 241, 222, 0.58)" }}>
              {sessionMeta.description}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Link
            to="/"
            style={{
              padding: "12px 18px",
              borderRadius: "999px",
              border: "1px solid rgba(233, 204, 145, 0.2)",
              background: "rgba(245, 225, 185, 0.06)",
              color: "#fff3d2",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Startseite
          </Link>
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

        {activeTab === "notebook" && (
          <Notebook
            currentUserId={currentUserId}
            players={players}
            notebookState={notebookState}
            onSavePage={saveNotebookPage}
          />
        )}
      </div>
    </div>
  );
}
