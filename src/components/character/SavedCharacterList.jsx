import { secondaryActionStyle, sectionStyle } from "./CharacterFrame";

function SavedCharacterList({
  title = "Gespeicherte Charaktere",
  emptyText,
  entries,
  getTitle,
  getSubtitle,
  onLoad,
  onDelete,
}) {
  return (
    <section style={sectionStyle}>
      <h3 style={{ marginTop: 0, color: "#3a281a" }}>{title}</h3>
      <div style={{ display: "grid", gap: "10px" }}>
        {entries.length === 0 ? (
          <div style={{ color: "#6d4c35" }}>{emptyText}</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
                alignItems: "center",
                padding: "12px 14px",
                borderRadius: "16px",
                border: "1px solid rgba(129, 91, 52, 0.18)",
                background: "rgba(255, 252, 246, 0.86)",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: "#302014" }}>{getTitle(entry)}</div>
                <div style={{ color: "#6d4c35", fontSize: "13px" }}>{getSubtitle(entry)}</div>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" onClick={() => onLoad(entry)} style={secondaryActionStyle}>
                  Laden
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(entry.id)}
                  style={{
                    ...secondaryActionStyle,
                    border: "1px solid rgba(148, 72, 54, 0.22)",
                    background: "rgba(123, 33, 22, 0.08)",
                    color: "#652c22",
                  }}
                >
                  Loeschen
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default SavedCharacterList;
