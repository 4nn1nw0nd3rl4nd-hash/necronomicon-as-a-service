import { useState, useEffect } from "react";
import jsPDF from "jspdf";

function Character() {
  const emptyCharacter = {
    id: null,
    name: "",
    beruf: "",
    str: 50,
    dex: 50,
    int: 50,
    con: 50,
    app: 50,
    pow: 50,
    siz: 50,
    edu: 50,
    hp: 10,
    san: 50
  };

  const [character, setCharacter] = useState(emptyCharacter);
  const [characters, setCharacters] = useState([]);

  // 🔄 Laden beim Start
  useEffect(() => {
    const data = JSON.parse(localStorage.getItem("coc_characters")) || [];
    setCharacters(data);
  }, []);

  // ✏️ Input ändern
  const handleChange = (e) => {
    setCharacter({
      ...character,
      [e.target.name]: e.target.value
    });
  };

  // 💾 Speichern / Aktualisieren
  const saveCharacter = () => {
    let updatedCharacters;

    if (character.id) {
      // ✏️ bearbeiten
      updatedCharacters = characters.map((c) =>
        c.id === character.id ? character : c
      );
    } else {
      // ➕ neu
      const newCharacter = {
        ...character,
        id: Date.now()
      };
      updatedCharacters = [...characters, newCharacter];
    }

    localStorage.setItem("coc_characters", JSON.stringify(updatedCharacters));
    setCharacters(updatedCharacters);
    setCharacter(emptyCharacter);
  };

  // 📂 Laden eines Charakters
  const loadCharacter = (char) => {
    setCharacter(char);
  };

  // ❌ Löschen
  const deleteCharacter = (id) => {
    const updated = characters.filter((c) => c.id !== id);
    localStorage.setItem("coc_characters", JSON.stringify(updated));
    setCharacters(updated);
  };

  // 🧾 PDF Export
  const exportPDF = () => {
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Call of Cthulhu Charakterbogen", 10, 10);

    doc.setFontSize(12);
    doc.text(`Name: ${character.name}`, 10, 20);
    doc.text(`Beruf: ${character.beruf}`, 10, 30);

    doc.text("Attribute:", 10, 45);
    doc.text(`STR: ${character.str}`, 10, 55);
    doc.text(`DEX: ${character.dex}`, 10, 65);
    doc.text(`INT: ${character.int}`, 10, 75);
    doc.text(`CON: ${character.con}`, 10, 85);
    doc.text(`APP: ${character.app}`, 10, 95);
    doc.text(`POW: ${character.pow}`, 10, 105);
    doc.text(`SIZ: ${character.siz}`, 10, 115);
    doc.text(`EDU: ${character.edu}`, 10, 125);

    doc.text("Status:", 10, 140);
    doc.text(`HP: ${character.hp}`, 10, 150);
    doc.text(`SAN: ${character.san}`, 10, 160);

    doc.save(`${character.name || "character"}.pdf`);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>🧙 CoC Charakterbogen</h2>

      {/* FORMULAR */}
      <input name="name" placeholder="Name" value={character.name} onChange={handleChange} />
      <input name="beruf" placeholder="Beruf" value={character.beruf} onChange={handleChange} />

      <h3>Attribute</h3>
      {["str","dex","int","con","app","pow","siz","edu"].map((attr) => (
        <input
          key={attr}
          name={attr}
          type="number"
          value={character[attr]}
          onChange={handleChange}
          placeholder={attr.toUpperCase()}
        />
      ))}

      <h3>Status</h3>
      <input name="hp" type="number" value={character.hp} onChange={handleChange} placeholder="HP" />
      <input name="san" type="number" value={character.san} onChange={handleChange} placeholder="SAN" />

      <br /><br />
      <button onClick={saveCharacter}>💾 Speichern</button>
      <button onClick={exportPDF}>🧾 PDF</button>

      <hr />

      {/* LISTE */}
      <h3>📚 Gespeicherte Charaktere</h3>
      <ul>
        {characters.map((c) => (
          <li key={c.id}>
            {c.name} ({c.beruf})
            <button onClick={() => loadCharacter(c)}>Laden</button>
            <button onClick={() => deleteCharacter(c.id)}>Löschen</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Character;