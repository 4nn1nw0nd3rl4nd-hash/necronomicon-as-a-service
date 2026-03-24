import { Routes, Route, Link } from "react-router-dom";

// Beispiel-Komponenten
import Dice from "./pages/Dice";
import Character from "./pages/Character";
import Whiteboard from "./pages/Whiteboard";

function App() {
  return (
    <div style={{ padding: "40px" }}>
      <h1>PNP Portal</h1>

      <nav>
        <ul>
          <li><Link to="/Dice">🎲 Würfel</Link></li>
          <li><Link to="/Character">🧙 Charakter</Link></li>
          <li><Link to="/Whiteboard">🗺 Whiteboard</Link></li>
        </ul>
      </nav>

      <Routes>
        <Route path="/" element={<h2>Willkommen im PNP Portal</h2>} />
        <Route path="/Dice" element={<Dice />} />
        <Route path="/Character" element={<Character />} />
        <Route path="/Whiteboard" element={<Whiteboard />} />
      </Routes>
    </div>
  );
}

export default App;