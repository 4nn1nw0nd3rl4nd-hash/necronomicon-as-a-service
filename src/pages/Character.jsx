import { useState } from "react";
import CoCCharacter from "./CoCCharacter";
import SplinterPortalsCharacter from "./SplinterPortalsCharacter";

function Character() {
  const [system, setSystem] = useState("CoC");

  return (
    <div style={{ padding: "20px" }}>
      <h2>🧾 Charakterbogen</h2>

      <label>System wählen: </label>
      <select value={system} onChange={e => setSystem(e.target.value)}>
        <option value="CoC">Call of Cthulhu</option>
        <option value="SplinterPortals">Splinter Portals</option>
      </select>

      <hr />

      {system === "CoC" && <CoCCharacter />}
      {system === "SplinterPortals" && <SplinterPortalsCharacter />}
    </div>
  );
}

export default Character;