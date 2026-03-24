import { useState, useEffect } from "react";
import jsPDF from "jspdf";
import { supabase } from "../supabaseClient";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCharacters();
  }, []);

  // 🔄 Alle Charaktere laden
  const fetchCharacters = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("characters")
      .select("*")
      .order("id", { ascending: true });
    if (error) setError(error.message);
    else setCharacters(data);
    setLoading(false);
  };

  // ✏️ Input ändern
  const handleChange = (e) => {
    const value = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setCharacter({ ...character, [e.target.name]: value });
  };

  // 💾 Speichern / Aktualisieren
  const saveCharacter = async () => {
    setError(null);
    try {
      if (character.id) {
        // Update
        const { error } = await supabase
          .from("characters")
          .update({
            name: character.name,
            beruf: character.beruf,
            str: character.str,
            dex: character.dex,
            int: character.int,
            con: character.con,
            app: character.app,
            pow: character.pow,
            siz: character.siz,
            edu: character.edu,
            hp: character.hp,
            san: character.san
          })
          .eq("id", character.id);
        if (error) throw error;
      } else {
        // Insert (ohne id!)
        const { data, error } = await supabase
          .from("characters")
          .insert([{
            name: character.name,
            beruf: character.beruf,
            str: character.str,
            dex: character.dex,
            int: character.int,
            con: character.con,
            app: character.app,
            pow: character.pow,
            siz: character.siz,
            edu: character.edu,
            hp: character.hp,
            san: character.san
          }])
          .select();
        if (error) throw error;
        if (data && data[0]) setCharacter({ ...character, id: data[0].id });
      }

      fetchCharacters();
      if (!character.id) setCharacter(emptyCharacter); // Form nur leeren bei neuem Charakter
    } catch (err) {
      setError(err.message);
    }
  };

  // ❌ Löschen
  const deleteCharacter = async (id) => {
    setError(null);
    const { error } = await supabase
      .from("characters")
      .delete()
      .eq("id", id);
    if (error) setError(error.message);
    else fetchCharacters();
  };

  // 📂 Laden eines Charakters in das Formular
  const loadCharacter = (char) => {
    setCharacter(char);
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
    let y = 55;
    ["str","dex","int","con","app","pow","siz","edu"].forEach(attr => {
      doc.text(`${attr.toUpperCase()}: ${character[attr]}`, 10, y);
      y += 10;
    });

    doc.text("Status:", 10, y + 10);
    doc.text(`HP: ${character.hp}`, 10, y + 20);
    doc.text(`SAN: ${character.san}`, 10, y + 30);

    doc.save(`${character.name || "character"}.pdf`);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>🧙 CoC Charakterbogen</h2>

      {loading && <p>Lade Charaktere...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {/* FORMULAR */}
      <input name="name" placeholder="Name" value={character.name} onChange={handleChange} />
      <input name="beruf" placeholder="Beruf" value={character.beruf} onChange={handleChange} />

      <h3>Attribute</h3>
      {["str","dex","int","con","app","pow","siz","edu"].map(attr => (
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
        {characters.map(c => (
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