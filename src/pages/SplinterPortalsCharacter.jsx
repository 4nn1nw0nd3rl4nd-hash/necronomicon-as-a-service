import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import jsPDF from "jspdf";

const emptyCharacter = {
  id: null,
  name: "",
  klasse: "",
  level: 1,
  health: 10,
  mana: 10,
  strength: 50,
  agility: 50,
  intelligence: 50,
  charisma: 50,
  skills: "[]",
  items: "[]"
};

function SplinterPortalsCharacter() {
  const [character, setCharacter] = useState(emptyCharacter);
  const [characters, setCharacters] = useState([]);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => { fetchCharacters(); }, []);

  const fetchCharacters = async () => {
    const { data } = await supabase.from("splinter_portals_characters").select("*").order("id");
    if (data) setCharacters(data);
  };

  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  const handleChange = (e) => {
    const { name, type, value } = e.target;
    let val = type === "number" ? Number(value) : value;
    if (type === "number") val = clamp(val, 0, 100);
    setCharacter(prev => ({ ...prev, [name]: val }));
  };

  const saveCharacter = async () => {
    const { id, ...data } = character;
    if (isEditing && id) {
      await supabase.from("splinter_portals_characters").update(data).eq("id", id);
      setCharacters(prev => prev.map(c => (c.id === id ? character : c)));
    } else {
      const { data: inserted } = await supabase.from("splinter_portals_characters").insert([data]).select();
      if (inserted && inserted[0]) setCharacters(prev => [...prev, inserted[0]]);
    }
    setCharacter(emptyCharacter);
    setIsEditing(false);
  };

  const loadCharacter = (char) => {
    setCharacter({ ...char });
    setIsEditing(true);
  };

  const deleteCharacter = async (id) => {
    await supabase.from("splinter_portals_characters").delete().eq("id", id);
    setCharacters(prev => prev.filter(c => c.id !== id));
  };

  const exportPDF = () => {
    if (!character) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Splinter Portals Charakterbogen", 10, 10);
    doc.setFontSize(12);
    doc.text(`Name: ${character.name}`, 10, 20);
    doc.text(`Klasse: ${character.klasse}`, 10, 30);
    doc.text(`Level: ${character.level}`, 10, 40);
    let y = 50;
    ["health","mana","strength","agility","intelligence","charisma"].forEach(a => {
      doc.text(`${a.toUpperCase()}: ${character[a]}`, 10, y);
      y += 8;
    });
    doc.save(`${character.name || "character"}.pdf`);
  };

  return (
    <div>
      <button onClick={() => { setCharacter(emptyCharacter); setIsEditing(false); }}>Neuer Charakter</button>
      <input name="name" placeholder="Name" value={character.name} onChange={handleChange} />
      <input name="klasse" placeholder="Klasse" value={character.klasse} onChange={handleChange} />
      <input name="level" type="number" placeholder="Level" value={character.level} onChange={handleChange} />

      <h3>Attribute</h3>
      {["health","mana","strength","agility","intelligence","charisma"].map(attr => (
        <input key={attr} name={attr} type="number" value={character[attr]} onChange={handleChange} placeholder={attr.toUpperCase()} />
      ))}

      <button onClick={saveCharacter}>{isEditing ? "Aktualisieren" : "Speichern"}</button>
      <button onClick={exportPDF}>PDF</button>

      <h3>Gespeicherte Charaktere</h3>
      <ul>
        {characters.map(c => (
          <li key={c.id}>
            {c.name} ({c.klasse})
            <button onClick={() => loadCharacter(c)}>Laden</button>
            <button onClick={() => deleteCharacter(c.id)}>Löschen</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SplinterPortalsCharacter;