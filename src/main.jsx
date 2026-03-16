import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "./App.jsx";
import Dice from "./pages/Dice.jsx";
import Character from "./pages/Character.jsx";
import Whiteboard from "./pages/Whiteboard.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/dice" element={<Dice />} />
      <Route path="/character" element={<Character />} />
      <Route path="/board" element={<Whiteboard />} />
    </Routes>
  </BrowserRouter>
);