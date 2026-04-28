const sectionStyle = {
  padding: "18px",
  borderRadius: "22px",
  border: "1px solid rgba(129, 91, 52, 0.22)",
  background:
    "linear-gradient(180deg, rgba(255, 250, 240, 0.96) 0%, rgba(244, 233, 214, 0.98) 100%)",
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.45)",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(122, 90, 60, 0.28)",
  background: "rgba(255, 252, 246, 0.92)",
  color: "#25180f",
  fontSize: "14px",
};

const labelStyle = {
  display: "grid",
  gap: "6px",
  color: "#4a3423",
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "0.03em",
};

const primaryActionStyle = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, #9d7347, #7e5734)",
  color: "#fff8eb",
  cursor: "pointer",
  fontWeight: 700,
};

const secondaryActionStyle = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid rgba(122, 90, 60, 0.28)",
  background: "rgba(255, 252, 246, 0.9)",
  color: "#2c1d12",
  cursor: "pointer",
  fontWeight: 700,
};

function CharacterFrame({ eyebrow, title, actions, children }) {
  return (
    <div
      style={{
        padding: "20px",
        maxWidth: "1280px",
        margin: "0 auto",
        color: "#24170f",
        fontFamily: '"Georgia", "Times New Roman", serif',
      }}
    >
      <div
        style={{
          ...sectionStyle,
          marginBottom: "20px",
          background:
            "radial-gradient(circle at top left, rgba(145, 109, 61, 0.12), transparent 24%), linear-gradient(180deg, rgba(253, 247, 237, 0.98) 0%, rgba(244, 233, 214, 0.98) 100%)",
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: "18px", flexWrap: "wrap" }}
        >
          <div>
            <p
              style={{
                margin: 0,
                color: "#7a5636",
                fontSize: "13px",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              {eyebrow}
            </p>
            <h2 style={{ margin: "8px 0 0", fontSize: "34px", color: "#2f1f13" }}>{title}</h2>
          </div>

          {actions ? (
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              {actions}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gap: "18px" }}>{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function StatBox({ label, value, name, handleChange, readOnly = false }) {
  return (
    <div
      style={{
        display: "grid",
        gap: "6px",
        padding: "12px",
        borderRadius: "16px",
        border: "1px solid rgba(129, 91, 52, 0.22)",
        background: "rgba(255, 253, 248, 0.86)",
        textAlign: "center",
      }}
    >
      <span style={{ color: "#694b35", fontWeight: 700, letterSpacing: "0.06em" }}>{label}</span>
      <input
        name={name}
        type="number"
        value={value ?? ""}
        readOnly={readOnly}
        onChange={handleChange}
        style={{
          ...inputStyle,
          textAlign: "center",
          fontSize: "24px",
          fontWeight: 700,
          padding: "8px 10px",
          background: readOnly ? "rgba(237, 227, 209, 0.9)" : "rgba(255, 252, 246, 0.92)",
        }}
      />
    </div>
  );
}

export {
  CharacterFrame,
  Field,
  StatBox,
  inputStyle,
  primaryActionStyle,
  secondaryActionStyle,
  sectionStyle,
};
