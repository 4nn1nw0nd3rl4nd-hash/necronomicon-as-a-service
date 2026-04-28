import { useEffect, useMemo, useState } from "react";

function formatParticipantLabel(player, index) {
  if (!player) {
    return `Eintrag ${index + 1}`;
  }

  if (player.characters?.name) {
    return player.characters.name;
  }

  if (player.role === "gm") {
    return "DM";
  }

  return `Spieler ${index + 1}`;
}

function formatUpdatedAt(value) {
  if (!value) {
    return "Noch kein Eintrag";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unbekannter Zeitpunkt";
  }

  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Notebook({
  currentUserId,
  players = [],
  notebookState = { pages: [] },
  onSavePage,
}) {
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");

  const participantPages = useMemo(() => {
    const pageMap = new Map(notebookState.pages.map((page) => [page.userId, page]));

    return players.map((player, index) => {
      const page = pageMap.get(player.user_id);

      return {
        userId: player.user_id,
        label: formatParticipantLabel(player, index),
        role: player.role,
        title: page?.title || "",
        content: page?.content || "",
        updatedAt: page?.updatedAt || null,
      };
    });
  }, [notebookState.pages, players]);

  const myPage = participantPages.find((page) => page.userId === currentUserId);
  const otherPages = participantPages.filter((page) => page.userId !== currentUserId);

  useEffect(() => {
    setDraftTitle(myPage?.title || "");
    setDraftContent(myPage?.content || "");
  }, [myPage?.content, myPage?.title, myPage?.userId]);

  const saveCurrentPage = () => {
    if (!currentUserId) return;

    onSavePage({
      userId: currentUserId,
      title: draftTitle.trim() || "Notizen",
      content: draftContent,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "280px minmax(0, 1fr)",
        gap: "20px",
        padding: "24px",
        color: "#f7f1de",
      }}
    >
      <aside
        style={{
          display: "grid",
          gap: "16px",
          alignContent: "start",
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
            Session Notebook
          </p>
          <h2 style={{ margin: "8px 0 0", color: "#fff0c8" }}>Gruppen-Notizbuch</h2>
        </div>

        <div
          style={{
            padding: "14px",
            borderRadius: "18px",
            background: "rgba(255, 246, 228, 0.04)",
            border: "1px solid rgba(233, 204, 145, 0.12)",
            color: "rgba(247, 241, 222, 0.78)",
            display: "grid",
            gap: "8px",
          }}
        >
          <span>Jeder Teilnehmer hat eine eigene Seite.</span>
          <span>Du bearbeitest nur deine eigene Seite.</span>
          <span>Alle anderen Seiten sind fuer dich lesbar.</span>
        </div>

        <div
          style={{
            padding: "14px",
            borderRadius: "18px",
            background: "rgba(255, 246, 228, 0.04)",
            border: "1px solid rgba(233, 204, 145, 0.12)",
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ color: "#f3dfb7", fontWeight: 700 }}>Teilnehmer</div>
          {participantPages.length === 0 ? (
            <div style={{ color: "rgba(247, 241, 222, 0.62)" }}>Noch keine Spieler geladen.</div>
          ) : (
            participantPages.map((page) => (
              <div
                key={page.userId}
                style={{
                  padding: "10px 12px",
                  borderRadius: "14px",
                  border: "1px solid rgba(233, 204, 145, 0.1)",
                  background:
                    page.userId === currentUserId
                      ? "rgba(244, 210, 142, 0.12)"
                      : "rgba(255, 247, 231, 0.04)",
                }}
              >
                <div style={{ color: "#fff0c8", fontWeight: 700 }}>{page.label}</div>
                <div style={{ color: "rgba(247, 241, 222, 0.62)", fontSize: "13px" }}>
                  {page.updatedAt ? `Aktualisiert: ${formatUpdatedAt(page.updatedAt)}` : "Noch leer"}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <section style={{ display: "grid", gap: "18px" }}>
        <div
          style={{
            padding: "18px",
            borderRadius: "24px",
            border: "1px solid rgba(233, 204, 145, 0.14)",
            background: "rgba(27, 20, 15, 0.92)",
            display: "grid",
            gap: "14px",
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
              Deine Seite
            </p>
            <h2 style={{ margin: "8px 0 0", color: "#fff3d4" }}>
              {myPage?.label || "Eigene Notizen"}
            </h2>
          </div>

          <input
            type="text"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="Titel deiner Notizseite"
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: "16px",
              border: "1px solid rgba(233, 204, 145, 0.18)",
              background: "rgba(255, 247, 231, 0.05)",
              color: "#fff4dd",
            }}
          />

          <textarea
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            placeholder="Hier koennen Sitzungsnotizen, Namen, Hinweise oder To-dos hinein."
            style={{
              width: "100%",
              minHeight: "260px",
              padding: "16px",
              borderRadius: "18px",
              border: "1px solid rgba(233, 204, 145, 0.18)",
              background: "rgba(255, 247, 231, 0.06)",
              color: "#fff4dd",
              resize: "vertical",
              lineHeight: 1.6,
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "rgba(247, 241, 222, 0.62)", fontSize: "13px" }}>
              Sichtbar fuer die ganze Gruppe, bearbeitbar nur von dir.
            </span>
            <button
              type="button"
              onClick={saveCurrentPage}
              style={{
                padding: "12px 18px",
                borderRadius: "999px",
                border: "none",
                background: "linear-gradient(135deg, #f4d28e, #d89f49)",
                color: "#1b130e",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              Seite speichern
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "16px",
          }}
        >
          {otherPages.map((page) => (
            <article
              key={page.userId}
              style={{
                padding: "16px",
                borderRadius: "20px",
                border: "1px solid rgba(233, 204, 145, 0.12)",
                background: "rgba(255, 246, 228, 0.04)",
                display: "grid",
                gap: "10px",
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    color: "#d5b070",
                    fontSize: "12px",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  Gruppenblatt
                </p>
                <h3 style={{ margin: "8px 0 0", color: "#fff0c8" }}>{page.label}</h3>
              </div>

              <div
                style={{
                  color: "#f4e5c6",
                  fontWeight: 700,
                }}
              >
                {page.title || "Noch kein Titel"}
              </div>

              <div
                style={{
                  minHeight: "120px",
                  padding: "12px",
                  borderRadius: "14px",
                  background: "rgba(18, 13, 10, 0.5)",
                  color: "rgba(247, 241, 222, 0.8)",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.55,
                }}
              >
                {page.content || "Noch keine Notizen."}
              </div>

              <div style={{ color: "rgba(247, 241, 222, 0.6)", fontSize: "13px" }}>
                {formatUpdatedAt(page.updatedAt)}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Notebook;
