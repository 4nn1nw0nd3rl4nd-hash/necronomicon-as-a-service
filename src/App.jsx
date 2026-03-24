import { Routes, Route, Link } from "react-router-dom";

// Beispiel-Komponenten
import Dice from "./pages/Dice";
import Character from "./pages/Character";
import Board from "./pages/Board";

function App() {
  return (
    <div style={{ padding: "40px" }}>
      <h1>PNP Portal</h1>

      <nav>
        <ul>
          <li><Link to="/dice">🎲 Würfel</Link></li>
          <li><Link to="/character">🧙 Charakter</Link></li>
          <li><Link to="/board">🗺 Whiteboard</Link></li>
        </ul>
      </nav>

      <Routes>
        <Route path="/" element={<h2>Willkommen im PNP Portal</h2>} />
        <Route path="/dice" element={<Dice />} />
        <Route path="/character" element={<Character />} />
        <Route path="/board" element={<Board />} />
      </Routes>
    </div>
  );
}

export default App;