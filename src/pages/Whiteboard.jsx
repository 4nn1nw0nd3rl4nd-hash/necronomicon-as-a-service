import { useEffect, useMemo, useRef, useState } from "react";

const BOARD_WIDTH = 1200;
const BOARD_HEIGHT = 700;

function createActionId(prefix, currentUserId) {
  return `${prefix}-${currentUserId ?? "anon"}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function clampToBoard(value, max) {
  return Math.max(0, Math.min(max, value));
}

function Whiteboard({
  isGM,
  onDraw,
  boardState = { images: [], notes: [], tokens: {} },
  currentUserId,
  players = [],
}) {
  const boardRef = useRef(null);
  const fileInputRef = useRef(null);

  const [noteText, setNoteText] = useState("");
  const [placementMode, setPlacementMode] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [localPositions, setLocalPositions] = useState({});

  const playerTokens = useMemo(() => {
    return players
      .filter((player) => player.role !== "gm")
      .map((player, index) => {
        const savedPosition = boardState.tokens[player.user_id];

        return {
          userId: player.user_id,
          label: player.characters?.name || `Token ${index + 1}`,
          color: player.user_id === currentUserId ? "#f6c56a" : "#7bc3ff",
          x: savedPosition?.x ?? 120 + (index % 5) * 100,
          y: savedPosition?.y ?? 560 + Math.floor(index / 5) * 80,
        };
      });
  }, [boardState.tokens, currentUserId, players]);

  const visibleImages = useMemo(() => {
    return isGM ? boardState.images : boardState.images.filter((image) => image.revealed);
  }, [boardState.images, isGM]);

  const myToken = playerTokens.find((token) => token.userId === currentUserId);

  const canDragNote = (note) => isGM || note.authorId === currentUserId;
  const canDragToken = (tokenUserId) => tokenUserId === currentUserId;

  const getBoardPoint = (event) => {
    const board = boardRef.current;
    if (!board) return null;

    const rect = board.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * BOARD_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT;

    return {
      x: clampToBoard(x, BOARD_WIDTH),
      y: clampToBoard(y, BOARD_HEIGHT),
    };
  };

  const resolvePosition = (key, fallbackX, fallbackY) => {
    return localPositions[key] || { x: fallbackX, y: fallbackY };
  };

  const beginDrag = (event, entity) => {
    event.stopPropagation();

    const point = getBoardPoint(event);
    if (!point) return;

    setDragState({
      ...entity,
      offsetX: point.x - entity.x,
      offsetY: point.y - entity.y,
    });
  };

  useEffect(() => {
    if (!dragState) return undefined;

    // Waehrend des Draggens bewegen wir nur die lokale Vorschau.
    // Erst beim Loslassen senden wir eine Realtime-Aktion, damit das
    // Whiteboard nicht bei jedem Pixel eine neue Broadcast-Nachricht erzeugt.
    const handlePointerMove = (event) => {
      const point = getBoardPoint(event);
      if (!point) return;

      const nextX = clampToBoard(point.x - dragState.offsetX, BOARD_WIDTH);
      const nextY = clampToBoard(point.y - dragState.offsetY, BOARD_HEIGHT);

      setLocalPositions((prev) => ({
        ...prev,
        [dragState.key]: { x: nextX, y: nextY },
      }));
    };

    const handlePointerUp = () => {
      const nextPosition = localPositions[dragState.key] || {
        x: dragState.x,
        y: dragState.y,
      };

      if (dragState.kind === "image") {
        onDraw({
          id: createActionId("wb", currentUserId),
          type: "move_image",
          targetId: dragState.targetId,
          x: nextPosition.x,
          y: nextPosition.y,
        });
      }

      if (dragState.kind === "note") {
        onDraw({
          id: createActionId("wb", currentUserId),
          type: "move_note",
          targetId: dragState.targetId,
          x: nextPosition.x,
          y: nextPosition.y,
        });
      }

      if (dragState.kind === "token") {
        onDraw({
          id: createActionId("wb", currentUserId),
          type: "move_token",
          userId: dragState.userId,
          x: nextPosition.x,
          y: nextPosition.y,
        });
      }

      setLocalPositions((prev) => {
        const copy = { ...prev };
        delete copy[dragState.key];
        return copy;
      });

      setDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [currentUserId, dragState, localPositions, onDraw]);

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    onDraw({
      id: createActionId("wb", currentUserId),
      type: "add_image",
      image: {
        id: createActionId("img", currentUserId),
        src: fileDataUrl,
        x: 240,
        y: 180,
        width: 360,
        height: 240,
        revealed: false,
        name: file.name,
      },
    });

    event.target.value = "";
  };

  const handleBoardClick = (event) => {
    if (!placementMode || !noteText.trim()) return;

    const point = getBoardPoint(event);
    if (!point) return;

    onDraw({
      id: createActionId("wb", currentUserId),
      type: "add_note",
      note: {
        id: createActionId("note", currentUserId),
        text: noteText.trim(),
        x: point.x,
        y: point.y,
        authorId: currentUserId,
      },
    });

    setPlacementMode(false);
    setNoteText("");
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "300px minmax(0, 1fr)",
        gap: "20px",
        padding: "24px",
        color: "#f7f1de",
      }}
    >
      <aside
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          padding: "18px",
          borderRadius: "22px",
          border: "1px solid rgba(233, 204, 145, 0.14)",
          background: "rgba(36, 25, 19, 0.96)",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              color: "#d5b070",
              fontSize: "13px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Whiteboard Tools
          </p>
          <h2 style={{ margin: "8px 0 0", color: "#fff0c8" }}>Taktische Flaeche</h2>
        </div>

        {isGM && (
          <div
            style={{
              padding: "14px",
              borderRadius: "18px",
              background: "rgba(255, 246, 228, 0.04)",
              border: "1px solid rgba(233, 204, 145, 0.12)",
            }}
          >
            <div style={{ marginBottom: "10px", color: "#f3dfb7", fontWeight: 700 }}>
              DM Bilder
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: "14px",
                border: "none",
                background: "linear-gradient(135deg, #f4d28e, #d89f49)",
                color: "#1b130e",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Bild hochladen
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: "none" }}
            />

            <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
              {boardState.images.length === 0 ? (
                <div style={{ color: "rgba(247, 241, 222, 0.62)" }}>
                  Noch keine Bilder auf dem Board.
                </div>
              ) : (
                boardState.images.map((image) => (
                  <div
                    key={image.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "14px",
                      background: "rgba(255, 247, 231, 0.04)",
                      border: "1px solid rgba(233, 204, 145, 0.08)",
                    }}
                  >
                    <div style={{ marginBottom: "8px", color: "#fff0c8", fontWeight: 700 }}>
                      {image.name || "Karte"}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onDraw({
                          id: createActionId("wb", currentUserId),
                          type: "toggle_image_visibility",
                          targetId: image.id,
                          revealed: !image.revealed,
                        })
                      }
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "12px",
                        border: "1px solid rgba(233, 204, 145, 0.18)",
                        background: image.revealed
                          ? "rgba(130, 209, 143, 0.2)"
                          : "rgba(245, 225, 185, 0.06)",
                        color: "#fff0c8",
                        cursor: "pointer",
                      }}
                    >
                      {image.revealed ? "Fuer Spieler sichtbar" : "Vor Spielern verborgen"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div
          style={{
            padding: "14px",
            borderRadius: "18px",
            background: "rgba(255, 246, 228, 0.04)",
            border: "1px solid rgba(233, 204, 145, 0.12)",
          }}
        >
          <div style={{ marginBottom: "10px", color: "#f3dfb7", fontWeight: 700 }}>
            Beschriftungen
          </div>
          <textarea
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="z. B. Geheimtuer, Blutspur, Falle"
            style={{
              width: "100%",
              minHeight: "90px",
              padding: "12px",
              borderRadius: "14px",
              border: "1px solid rgba(233, 204, 145, 0.18)",
              background: "rgba(255, 247, 231, 0.06)",
              color: "#fff4dd",
              resize: "vertical",
            }}
          />
          <button
            type="button"
            disabled={!noteText.trim()}
            onClick={() => setPlacementMode((prev) => !prev)}
            style={{
              width: "100%",
              marginTop: "10px",
              padding: "10px 12px",
              borderRadius: "14px",
              border: "1px solid rgba(233, 204, 145, 0.18)",
              background: placementMode
                ? "rgba(123, 195, 255, 0.22)"
                : "rgba(245, 225, 185, 0.06)",
              color: "#fff0c8",
              cursor: noteText.trim() ? "pointer" : "not-allowed",
            }}
          >
            {placementMode ? "Platzierung abbrechen" : "Notiz auf Board platzieren"}
          </button>
        </div>

        <div
          style={{
            padding: "14px",
            borderRadius: "18px",
            background: "rgba(255, 246, 228, 0.04)",
            border: "1px solid rgba(233, 204, 145, 0.12)",
          }}
        >
          <div style={{ marginBottom: "10px", color: "#f3dfb7", fontWeight: 700 }}>
            Rollen auf dem Board
          </div>
          <div style={{ display: "grid", gap: "8px", color: "rgba(247, 241, 222, 0.72)" }}>
            <span>DM kann Bilder hochladen, verschieben und sichtbar schalten.</span>
            <span>Alle koennen Notizen setzen; Autor oder DM darf sie verschieben.</span>
            <span>Jeder Spieler hat genau ein eigenes Token.</span>
          </div>
        </div>

        <div
          style={{
            padding: "14px",
            borderRadius: "18px",
            background: "rgba(255, 246, 228, 0.04)",
            border: "1px solid rgba(233, 204, 145, 0.12)",
          }}
        >
          <div style={{ marginBottom: "10px", color: "#f3dfb7", fontWeight: 700 }}>
            Dein Status
          </div>
          <div style={{ display: "grid", gap: "8px", color: "rgba(247, 241, 222, 0.72)" }}>
            <span>{isGM ? "Du bist als DM im Board." : "Du bist als Spieler im Board."}</span>
            <span>
              {myToken
                ? `Dein Token heisst ${myToken.label} und kann von dir bewegt werden.`
                : "Als DM bekommst du kein eigenes Token."}
            </span>
          </div>
        </div>
      </aside>

      <section style={{ display: "grid", gap: "14px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                color: "#d5b070",
                fontSize: "13px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Encounter Board
            </p>
            <h2 style={{ margin: "8px 0 0", color: "#fff3d4" }}>Karte, Marker und Tokens</h2>
          </div>

          <div
            style={{
              padding: "10px 14px",
              borderRadius: "999px",
              background: placementMode
                ? "rgba(123, 195, 255, 0.22)"
                : "rgba(255, 246, 228, 0.04)",
              border: "1px solid rgba(233, 204, 145, 0.14)",
              color: "#fff0c8",
            }}
          >
            {placementMode ? "Klicke auf das Board fuer die Notiz" : "Board bereit"}
          </div>
        </div>

        <div
          ref={boardRef}
          onClick={handleBoardClick}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: `${BOARD_WIDTH} / ${BOARD_HEIGHT}`,
            minHeight: "560px",
            overflow: "hidden",
            borderRadius: "24px",
            border: "1px solid rgba(233, 204, 145, 0.14)",
            background:
              "radial-gradient(circle at top left, rgba(214, 185, 121, 0.07), transparent 24%), linear-gradient(180deg, #2d221a 0%, #1a140f 100%)",
            boxShadow: "inset 0 0 0 1px rgba(255, 240, 201, 0.04)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
              pointerEvents: "none",
            }}
          />

          {visibleImages.map((image) => {
            const position = resolvePosition(`image-${image.id}`, image.x, image.y);

            return (
              <img
                key={image.id}
                src={image.src}
                alt={image.name || "Map asset"}
                onPointerDown={(event) =>
                  isGM &&
                  beginDrag(event, {
                    kind: "image",
                    key: `image-${image.id}`,
                    targetId: image.id,
                    x: position.x,
                    y: position.y,
                  })
                }
                style={{
                  position: "absolute",
                  left: `${(position.x / BOARD_WIDTH) * 100}%`,
                  top: `${(position.y / BOARD_HEIGHT) * 100}%`,
                  width: `${(image.width / BOARD_WIDTH) * 100}%`,
                  height: `${(image.height / BOARD_HEIGHT) * 100}%`,
                  objectFit: "cover",
                  borderRadius: "18px",
                  border: "2px solid rgba(255, 240, 201, 0.25)",
                  cursor: isGM ? "grab" : "default",
                  transform: "translate(-50%, -50%)",
                  userSelect: "none",
                }}
              />
            );
          })}

          {boardState.notes.map((note) => {
            const position = resolvePosition(`note-${note.id}`, note.x, note.y);

            return (
              <div
                key={note.id}
                onPointerDown={(event) =>
                  canDragNote(note) &&
                  beginDrag(event, {
                    kind: "note",
                    key: `note-${note.id}`,
                    targetId: note.id,
                    x: position.x,
                    y: position.y,
                  })
                }
                style={{
                  position: "absolute",
                  left: `${(position.x / BOARD_WIDTH) * 100}%`,
                  top: `${(position.y / BOARD_HEIGHT) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  maxWidth: "180px",
                  padding: "10px 12px",
                  borderRadius: "14px",
                  background:
                    note.authorId === currentUserId
                      ? "rgba(255, 227, 145, 0.96)"
                      : "rgba(255, 240, 184, 0.92)",
                  color: "#2f2416",
                  fontWeight: 700,
                  boxShadow: "0 10px 24px rgba(0, 0, 0, 0.18)",
                  cursor: canDragNote(note) ? "grab" : "default",
                }}
              >
                {note.text}
              </div>
            );
          })}

          {playerTokens.map((token) => {
            const position = resolvePosition(`token-${token.userId}`, token.x, token.y);

            return (
              <div
                key={token.userId}
                onPointerDown={(event) =>
                  canDragToken(token.userId) &&
                  beginDrag(event, {
                    kind: "token",
                    key: `token-${token.userId}`,
                    userId: token.userId,
                    x: position.x,
                    y: position.y,
                  })
                }
                style={{
                  position: "absolute",
                  left: `${(position.x / BOARD_WIDTH) * 100}%`,
                  top: `${(position.y / BOARD_HEIGHT) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  display: "grid",
                  gap: "6px",
                  placeItems: "center",
                  cursor: canDragToken(token.userId) ? "grab" : "default",
                }}
              >
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "999px",
                    background: token.color,
                    border: "3px solid rgba(255,255,255,0.7)",
                    boxShadow: "0 10px 20px rgba(0, 0, 0, 0.22)",
                  }}
                />
                <div
                  style={{
                    padding: "4px 8px",
                    borderRadius: "999px",
                    background: "rgba(19, 15, 12, 0.78)",
                    color: "#fff2d1",
                    fontSize: "12px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {token.label}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default Whiteboard;
