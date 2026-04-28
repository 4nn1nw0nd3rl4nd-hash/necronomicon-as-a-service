import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { exportPDF } from "./PDFExport";
import {
  calculateCoCDerived,
  cocSkillsList,
  createEmptyCoCCharacter,
  getCoCSkillLabel,
} from "../lib/cocSheet";
import {
  CharacterFrame,
  Field,
  StatBox,
  inputStyle,
  primaryActionStyle,
  secondaryActionStyle,
  sectionStyle,
} from "../components/character/CharacterFrame";
import SavedCharacterList from "../components/character/SavedCharacterList";

const emptyCharacter = createEmptyCoCCharacter();

const skillCardStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 78px",
  gap: "8px",
  alignItems: "center",
};

export default function CoCCharacter() {
  const [character, setCharacter] = useState(emptyCharacter);
  const [characters, setCharacters] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState(null);

  const derived = calculateCoCDerived(character);

  useEffect(() => {
    fetchCharacters();
  }, []);

  const fetchCharacters = async () => {
    const { data, error: fetchError } = await supabase.from("coc_characters").select("*").order("id");
    if (fetchError) {
      setError(`Charaktere konnten nicht geladen werden: ${fetchError.message}`);
      return;
    }

    setError(null);
    setCharacters(data || []);
  };

  const handleChange = (event) => {
    const { name, type, value } = event.target;
    let nextValue;

    if (type === "number") nextValue = value === "" ? null : Number(value);
    else if (type === "date") nextValue = value === "" ? null : value;
    else nextValue = value;

    setError(null);
    setCharacter((prev) => ({ ...prev, [name]: nextValue }));
  };

  const saveCharacter = async () => {
    try {
      const { id, ...data } = character;
      Object.keys(data).forEach((key) => {
        if (data[key] === "") data[key] = null;
      });

      const payload = {
        ...data,
        ...derived,
      };

      if (isEditing && id) {
        const { error: updateError } = await supabase.from("coc_characters").update(payload).eq("id", id);
        if (updateError) {
          throw updateError;
        }

        setCharacters((prev) =>
          prev.map((entry) => (entry.id === id ? { ...entry, ...payload, id } : entry))
        );
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("coc_characters")
          .insert([payload])
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
      setCharacter(createEmptyCoCCharacter());
      setIsEditing(false);
    } catch (err) {
      setError(`Speichern fehlgeschlagen: ${err.message}`);
    }
  };

  const loadCharacter = (entry) => {
    setCharacter({ ...createEmptyCoCCharacter(), ...entry });
    setIsEditing(true);
  };

  const deleteCharacter = async (id) => {
    const { error: deleteError } = await supabase.from("coc_characters").delete().eq("id", id);
    if (deleteError) {
      setError(`Loeschen fehlgeschlagen: ${deleteError.message}`);
      return;
    }

    setCharacters((prev) => prev.filter((entry) => entry.id !== id));
  };

  return (
    <CharacterFrame
      eyebrow="Call of Cthulhu"
      title="Ermittlerbogen"
      actions={
        <>
          <button type="button" onClick={saveCharacter} style={primaryActionStyle}>
            {isEditing ? "Bogen aktualisieren" : "Bogen speichern"}
          </button>
          <button
            type="button"
            onClick={() => exportPDF({ ...character, ...derived })}
            style={secondaryActionStyle}
          >
            PDF auf einer Seite
          </button>
        </>
      }
    >
      {error && <p style={{ color: "red" }}>{error}</p>}

      <section style={sectionStyle}>
        <h3 style={{ marginTop: 0, color: "#3a281a" }}>Persoenliche Daten</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "14px",
          }}
        >
          <Field label="Name">
            <input name="name" value={character.name ?? ""} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Gespielt von">
            <input
              name="played_by"
              value={character.played_by ?? ""}
              onChange={handleChange}
              style={inputStyle}
            />
          </Field>
          <Field label="Beruf">
            <input
              name="profession"
              value={character.profession ?? ""}
              onChange={handleChange}
              style={inputStyle}
            />
          </Field>
          <Field label="Geburtstag">
            <input
              name="birthdate"
              type="date"
              value={character.birthdate ?? ""}
              onChange={handleChange}
              style={inputStyle}
            />
          </Field>
          <Field label="Alter">
            <input name="age" type="number" value={character.age ?? ""} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Geschlecht">
            <input name="gender" value={character.gender ?? ""} onChange={handleChange} style={inputStyle} />
          </Field>
          <Field label="Wohnort">
            <input
              name="residence"
              value={character.residence ?? ""}
              onChange={handleChange}
              style={inputStyle}
            />
          </Field>
          <Field label="Geburtsort">
            <input
              name="birthplace"
              value={character.birthplace ?? ""}
              onChange={handleChange}
              style={inputStyle}
            />
          </Field>
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 0.9fr)",
          gap: "18px",
        }}
      >
        <section style={sectionStyle}>
          <h3 style={{ marginTop: 0, color: "#3a281a" }}>Attribute</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: "12px",
            }}
          >
            <StatBox label="STR" name="str" value={character.str} handleChange={handleChange} />
            <StatBox label="DEX" name="dex" value={character.dex} handleChange={handleChange} />
            <StatBox label="CON" name="con" value={character.con} handleChange={handleChange} />
            <StatBox label="SIZ" name="siz" value={character.siz} handleChange={handleChange} />
            <StatBox label="INT" name="intell" value={character.intell} handleChange={handleChange} />
            <StatBox label="APP" name="app" value={character.app} handleChange={handleChange} />
            <StatBox label="POW" name="pow" value={character.pow} handleChange={handleChange} />
            <StatBox label="EDU" name="edu" value={character.edu} handleChange={handleChange} />
          </div>
        </section>

        <section style={sectionStyle}>
          <h3 style={{ marginTop: 0, color: "#3a281a" }}>Abgeleitete Werte und Kampf</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
              gap: "10px",
              marginBottom: "16px",
            }}
          >
            <StatBox label="TP" name="hitpoints" value={derived.hitpoints} handleChange={handleChange} readOnly />
            <StatBox label="SAN" name="sanity" value={derived.sanity} handleChange={handleChange} readOnly />
            <StatBox label="GL" name="luck" value={derived.luck} handleChange={handleChange} readOnly />
            <StatBox
              label="MP"
              name="magic_points"
              value={derived.magic_points}
              handleChange={handleChange}
              readOnly
            />
            <StatBox label="MOV" name="mov" value={derived.mov} handleChange={handleChange} readOnly />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "12px",
            }}
          >
            <Field label="Ausweichen">
              <input name="dodge" type="number" value={character.dodge ?? 0} onChange={handleChange} style={inputStyle} />
            </Field>
            <Field label="Handgemenge">
              <input name="melee" type="number" value={character.melee ?? 25} onChange={handleChange} style={inputStyle} />
            </Field>
            <Field label="Faustfeuerwaffe">
              <input
                name="ranged_firearm"
                type="number"
                value={character.ranged_firearm ?? 20}
                onChange={handleChange}
                style={inputStyle}
              />
            </Field>
            <Field label="Gewehr/Flinte">
              <input
                name="rifle_shotgun"
                type="number"
                value={character.rifle_shotgun ?? 25}
                onChange={handleChange}
                style={inputStyle}
              />
            </Field>
            <Field label="Fehlfunktion">
              <input
                name="firearm_malfunction"
                type="number"
                value={character.firearm_malfunction ?? 0}
                onChange={handleChange}
                style={inputStyle}
              />
            </Field>
          </div>
        </section>
      </div>

      <section style={sectionStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: "14px",
          }}
        >
          <h3 style={{ margin: 0, color: "#3a281a" }}>Fertigkeiten</h3>
          <span style={{ color: "#6e4d35", fontSize: "13px" }}>
            Kompakt wie ein klassischer Ermittlerbogen in zwei Spalten.
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 20px" }}>
          {cocSkillsList.map((skill) => (
            <div key={skill} style={skillCardStyle}>
              <span style={{ color: "#3d2918", fontWeight: 700 }}>{getCoCSkillLabel(skill)}</span>
              <input
                name={skill}
                type="number"
                value={character[skill] ?? ""}
                onChange={handleChange}
                style={inputStyle}
              />
            </div>
          ))}
          <div style={skillCardStyle}>
            <input
              name="custom_skill_name"
              placeholder="Besondere Fertigkeit"
              value={character.custom_skill_name ?? ""}
              onChange={handleChange}
              style={inputStyle}
            />
            <input
              name="custom_skill_value"
              type="number"
              placeholder="%"
              value={character.custom_skill_value ?? ""}
              onChange={handleChange}
              style={inputStyle}
            />
          </div>
        </div>
      </section>

      <section style={sectionStyle}>
        <h3 style={{ marginTop: 0, color: "#3a281a" }}>Hintergrund</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "14px" }}>
          <Field label="Persoenlicher Hintergrund">
            <textarea
              name="background"
              value={character.background ?? ""}
              onChange={handleChange}
              style={{ ...inputStyle, minHeight: "150px", resize: "vertical", lineHeight: 1.5 }}
            />
          </Field>
          <Field label="Wichtige Personen">
            <textarea
              name="important_people"
              value={character.important_people ?? ""}
              onChange={handleChange}
              style={{ ...inputStyle, minHeight: "150px", resize: "vertical", lineHeight: 1.5 }}
            />
          </Field>
          <Field label="Wichtige Orte">
            <textarea
              name="important_places"
              value={character.important_places ?? ""}
              onChange={handleChange}
              style={{ ...inputStyle, minHeight: "150px", resize: "vertical", lineHeight: 1.5 }}
            />
          </Field>
        </div>
      </section>

      <SavedCharacterList
        title="Gespeicherte Charaktere"
        emptyText="Noch keine CoC-Charaktere gespeichert."
        entries={characters}
        getTitle={(entry) => entry.name || "Unbenannter Ermittler"}
        getSubtitle={(entry) =>
          `${entry.profession || "Kein Beruf"}${entry.played_by ? ` · gespielt von ${entry.played_by}` : ""}`
        }
        onLoad={loadCharacter}
        onDelete={deleteCharacter}
      />
    </CharacterFrame>
  );
}
