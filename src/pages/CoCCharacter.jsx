import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import jsPDF from "jspdf";

const emptyCharacter = {
  name: "", played_by: "", profession: "",
  birthdate: "", age: "", gender: "", residence: "", birthplace: "",
  str:50, dex:50, con:50, siz:50, intell:50, app:50, pow:50, edu:50,
  hitpoints:0, sanity:0, luck:0, magic_points:0,
  anthropology:0, archaeology:0, drive:0, library_use:0,
  accounting:0, charm:0, cthulhu_mythos:0, first_aid:0,
  swimming:0, stealth:0, psychology:0, persuasion:0,
  background:"", important_people:"", important_places:""
};

function CoCCharacter() {
  const [character, setCharacter] = useState(emptyCharacter);
  const [characters, setCharacters] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState(null);

  // Laden der Charaktere
  useEffect(() => { fetchCharacters(); }, []);

  const fetchCharacters = async () => {
    const { data, error } = await supabase.from("coc_characters").select("*").order("id");
    if (error) setError(error.message);
    else setCharacters(data);
  };

  const handleChange = (e) => {
    const { name, type, value } = e.target;
    setCharacter(prev => ({ ...prev, [name]: type === "number" ? Number(value) : value }));
  };

  // Abgeleitete Werte berechnen
  const calculatedHP = Math.floor((character.con + character.siz) / 10);
  const calculatedSAN = character.pow;
  const calculatedLuck = character.pow;
  const calculatedMP = Math.floor(character.pow / 5);

  // Speichern / Update
  const saveCharacter = async () => {
    try {
      const { id, ...data } = character;
      const payload = {
        ...data,
        hitpoints: calculatedHP,
        sanity: calculatedSAN,
        luck: calculatedLuck,
        magic_points: calculatedMP
      };
      if (isEditing && id) {
        const { error } = await supabase.from("coc_characters").update(payload).eq("id", id);
        if (error) throw error;
        setCharacters(prev => prev.map(c => (c.id === id ? { ...c, ...payload } : c)));
      } else {
        const { data: inserted, error } = await supabase.from("coc_characters").insert([payload]).select();
        if (error) throw error;
        if (inserted && inserted[0]) setCharacters(prev => [...prev, inserted[0]]);
      }
      setCharacter(emptyCharacter);
      setIsEditing(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadCharacter = (char) => {
    setCharacter({ ...char });
    setIsEditing(true);
  };

  const deleteCharacter = async (id) => {
    await supabase.from("coc_characters").delete().eq("id", id);
    setCharacters(prev => prev.filter(c => c.id !== id));
  };

  // PDF Export
  const exportPDF = () => {
    const doc = new jsPDF("p", "mm", "a4");
    doc.setFontSize(16);
    doc.text("Call of Cthulhu Charakterbogen", 105, 10, null, null, "center");

    let y = 20;

    // Persönliche Daten
    doc.setFontSize(12);
    doc.text(`Name: ${character.name}`, 10, y); y+=6;
    doc.text(`Gespielt von: ${character.played_by}`, 10, y); y+=6;
    doc.text(`Beruf: ${character.profession}`, 10, y); y+=6;
    doc.text(`Geburtstag/Alter: ${character.birthdate} / ${character.age}`, 10, y); y+=6;
    doc.text(`Geschlecht: ${character.gender}`, 10, y); y+=6;
    doc.text(`Wohnort: ${character.residence}`, 10, y); y+=6;
    doc.text(`Geburtsort: ${character.birthplace}`, 10, y); y+=10;

    // Attribute Tabelle
    const attributes = ["str","dex","con","siz","intell","app","pow","edu"];
    doc.setFontSize(12);
    doc.text("Attribute:", 10, y); y+=6;
    attributes.forEach(att => {
      doc.text(`${att.toUpperCase()}: ${character[att]}`, 10, y);
      y += 6;
    });

    y += 4;
    doc.text(`HP: ${calculatedHP}  SAN: ${calculatedSAN}  Luck: ${calculatedLuck}  MP: ${calculatedMP}`, 10, y);
    y += 10;

    // Skills
    const skills = [
      "anthropology","archaeology","drive","library_use",
      "accounting","charm","cthulhu_mythos","first_aid",
      "swimming","stealth","psychology","persuasion"
    ];
    doc.text("Fertigkeiten:", 10, y); y+=6;
    skills.forEach(skill => {
      doc.text(`${skill.replace("_"," ")}: ${character[skill]}`, 10, y);
      y += 6;
    });

    y += 4;
    doc.text("Hintergrund / wichtige Personen / Orte:", 10, y); y+=6;
    doc.text(`Hintergrund: ${character.background}`, 10, y); y+=6;
    doc.text(`Wichtige Personen: ${character.important_people}`, 10, y); y+=6;
    doc.text(`Wichtige Orte: ${character.important_places}`, 10, y+=6);

    doc.save(`${character.name || "character"}.pdf`);
  };

  return (
    <div style={{padding:"20px", maxWidth:"800px", margin:"0 auto"}}>
      {error && <p style={{color:'red'}}>{error}</p>}
      <h2>Charakter erstellen / bearbeiten</h2>
      <button onClick={() => { setCharacter(emptyCharacter); setIsEditing(false); }}>Neuer Charakter</button>

      <h3>Persönliche Daten</h3>
      {["name","played_by","profession","birthdate","age","gender","residence","birthplace"].map(field => (
        <input
          key={field}
          name={field}
          type={field==="birthdate"?"date":field==="age"?"number":"text"}
          placeholder={field.replace("_"," ")}
          value={character[field]}
          onChange={handleChange}
          style={{display:"block", marginBottom:"6px"}}
        />
      ))}

      <h3>Attribute</h3>
      {["str","dex","con","siz","intell","app","pow","edu"].map(attr => (
        <input
          key={attr}
          name={attr}
          type="number"
          value={character[attr]}
          onChange={handleChange}
          placeholder={attr.toUpperCase()}
          min={0} max={100}
          style={{marginRight:"6px"}}
        />
      ))}

      <h3>Abgeleitete Werte</h3>
      <input readOnly value={`HP: ${calculatedHP}`} style={{marginRight:"6px"}} />
      <input readOnly value={`SAN: ${calculatedSAN}`} style={{marginRight:"6px"}} />
      <input readOnly value={`Luck: ${calculatedLuck}`} style={{marginRight:"6px"}} />
      <input readOnly value={`MP: ${calculatedMP}`} />

      <h3>Fertigkeiten</h3>
      {[
        "anthropology","archaeology","drive","library_use",
        "accounting","charm","cthulhu_mythos","first_aid",
        "swimming","stealth","psychology","persuasion"
      ].map(skill => (
        <input
          key={skill}
          name={skill}
          type="number"
          value={character[skill]}
          onChange={handleChange}
          placeholder={skill.replace("_"," ")}
          min={0} max={100}
          style={{marginRight:"6px", marginBottom:"6px"}}
        />
      ))}

      <h3>Hintergrund / Wichtige Infos</h3>
      <textarea
        name="background"
        placeholder="Hintergrund"
        value={character.background}
        onChange={handleChange}
        style={{width:"100%", marginBottom:"6px"}}
      />
      <textarea
        name="important_people"
        placeholder="Wichtige Personen"
        value={character.important_people}
        onChange={handleChange}
        style={{width:"100%", marginBottom:"6px"}}
      />
      <textarea
        name="important_places"
        placeholder="Wichtige Orte"
        value={character.important_places}
        onChange={handleChange}
        style={{width:"100%", marginBottom:"6px"}}
      />

      <button onClick={saveCharacter}>{isEditing?"Aktualisieren":"Speichern"}</button>
      <button onClick={exportPDF} style={{marginLeft:"6px"}}>PDF Export</button>

      <h3>Gespeicherte Charaktere</h3>
      <ul>
        {characters.map(c => (
          <li key={c.id} style={{marginBottom:"4px"}}>
            {c.name} ({c.profession})
            <button onClick={() => loadCharacter(c)} style={{marginLeft:"4px"}}>Laden</button>
            <button onClick={() => deleteCharacter(c.id)} style={{marginLeft:"2px"}}>Löschen</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CoCCharacter;