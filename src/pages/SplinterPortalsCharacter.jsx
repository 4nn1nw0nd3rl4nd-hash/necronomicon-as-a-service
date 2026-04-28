import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import jsPDF from "jspdf";
import {
  CharacterFrame,
  Field,
  inputStyle,
  primaryActionStyle,
  secondaryActionStyle,
  sectionStyle,
} from "../components/character/CharacterFrame";
import SavedCharacterList from "../components/character/SavedCharacterList";

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
  items: "[]",
};

function SplinterPortalsCharacter() {
  const [character, setCharacter] = useState(emptyCharacter);
  const [characters, setCharacters] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCharacters();
  }, []);

  const fetchCharacters = async () => {
    const { data, error: fetchError } = await supabase
      .from("splinter_portals_characters")
      .select("*")
      .order("id");

    if (fetchError) {
      setError(`Charaktere konnten nicht geladen werden: ${fetchError.message}`);
      return;
    }

    setError(null);
    setCharacters(data || []);
  };

  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  const handleChange = (event) => {
    const { name, type, value } = event.target;
    let nextValue = type === "number" ? Number(value) : value;
    if (type === "number") nextValue = clamp(nextValue, 0, 100);
    setError(null);
    setCharacter((prev) => ({ ...prev, [name]: nextValue }));
  };

  const saveCharacter = async () => {
    try {
      const { id, ...data } = character;

      if (isEditing && id) {
        const { error: updateError } = await supabase
          .from("splinter_portals_characters")
          .update(data)
          .eq("id", id);

        if (updateError) {
          throw updateError;
        }

        setCharacters((prev) => prev.map((entry) => (entry.id === id ? { ...character, id } : entry)));
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("splinter_portals_characters")
          .insert([data])
          .select();

        if (insertError) {
          throw insertError;
        }

        if (!inserted || !inserted[0]) {
          throw new Error("Supabase hat keinen gespeicherten Charakter zurueckgegeben.");
        }

        setCharacters((prev) => [...prev, inserted[0]]);
      }

      setError(null);
      setCharacter(emptyCharacter);
      setIsEditing(false);
    } catch (err) {
      setError(`Speichern fehlgeschlagen: ${err.message}`);
    }
  };

  const loadCharacter = (entry) => {
    setCharacter({ ...entry });
    setIsEditing(true);
  };

  const deleteCharacter = async (id) => {
    const { error: deleteError } = await supabase
      .from("splinter_portals_characters")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(`Loeschen fehlgeschlagen: ${deleteError.message}`);
      return;
    }

    setCharacters((prev) => prev.filter((entry) => entry.id !== id));
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
    ["health", "mana", "strength", "agility", "intelligence", "charisma"].forEach((attr) => {
      doc.text(`${attr.toUpperCase()}: ${character[attr]}`, 10, y);
      y += 8;
    });
    doc.save(`${character.name || "character"}.pdf`);
  };

  return (
    <CharacterFrame
      eyebrow="Splinter Portals"
      title="Abenteurerbogen"
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              setCharacter(emptyCharacter);
              setIsEditing(false);
            }}
            style={secondaryActionStyle}
          >
            Neuer Charakter
          </button>
          <button type="button" onClick={saveCharacter} style={primaryActionStyle}>
            {isEditing ? "Aktualisieren" : "Speichern"}
          </button>
          <button type="button" onClick={exportPDF} style={secondaryActionStyle}>
            PDF
          </button>
        </>
      }
    >
      {error && <p style={{ color: "red" }}>{error}</p>}

      <section style={sectionStyle}>
        <h3 style={{ marginTop: 0, color: "#3a281a" }}>Grunddaten</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "14px",
          }}
        >
          <Field label="Name">
            <input name="name" value={character.name} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Klasse">
            <input name="klasse" value={character.klasse} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Level">
            <input name="level" type="number" value={character.level} onChange={handleChange} style={inputStyle} />
          </Field>
        </div>
      </section>

      <section style={sectionStyle}>
        <h3 style={{ marginTop: 0, color: "#3a281a" }}>Attribute</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "12px",
          }}
        >
          {["health", "mana", "strength", "agility", "intelligence", "charisma"].map((attr) => (
            <Field key={attr} label={attr.toUpperCase()}>
              <input
                name={attr}
                type="number"
                value={character[attr]}
                onChange={handleChange}
                style={inputStyle}
              />
            </Field>
          ))}
        </div>
      </section>

      <SavedCharacterList
        emptyText="Noch keine Splinter-Portals-Charaktere gespeichert."
        entries={characters}
        getTitle={(entry) => entry.name || "Unbenannter Held"}
        getSubtitle={(entry) => `${entry.klasse || "Keine Klasse"} · Level ${entry.level ?? 1}`}
        onLoad={loadCharacter}
        onDelete={deleteCharacter}
      />
    </CharacterFrame>
  );
}

export default SplinterPortalsCharacter;
