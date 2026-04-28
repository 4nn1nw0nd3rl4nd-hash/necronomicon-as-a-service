import { useState } from "react";
import CoCCharacter from "./CoCCharacter";
import SplinterPortalsCharacter from "./SplinterPortalsCharacter";

const systems = [
  { id: "CoC", label: "Call of Cthulhu", component: CoCCharacter },
  { id: "SplinterPortals", label: "Splinter Portals", component: SplinterPortalsCharacter },
];

function Character({ character: sessionCharacter }) {
  const initialSystem = sessionCharacter?.system === "SplinterPortals" ? "SplinterPortals" : "CoC";
  const [system, setSystem] = useState(initialSystem);
  const activeSystem = systems.find((entry) => entry.id === system) || systems[0];
  const ActiveComponent = activeSystem.component;

  return (
    <div style={{ padding: "20px" }}>
      <h2>Charakterbogen</h2>

      <label>System waehlen: </label>
      <select value={system} onChange={(event) => setSystem(event.target.value)}>
        {systems.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>

      <hr />

      <ActiveComponent />
    </div>
  );
}

export default Character;
