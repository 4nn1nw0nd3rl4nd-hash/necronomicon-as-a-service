import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import jsPDF from "jspdf";

const skills = [
  "accounting","anthropology","appraise","archaeology",
  "charm","climb","credit_rating","cthulhu_mythos",
  "disguise","drive","electrical_repair",
  "fast_talk","fighting","firearms","first_aid",
  "history","intimidate","jump","language_own",
  "language_other","law","library_use","listen",
  "locksmith","mechanical_repair","medicine","natural_world",
  "navigate","occult","operate_heavy_machinery",
  "persuade","pilot","psychology","psychoanalysis",
  "ride","science","sleight_of_hand","spot_hidden",
  "stealth","survival","swim","throw","track"
];

const emptyCharacter = {
  id: null,
  played_by: "",
  profession: "",
  birthdate: null,
  age: null,
  gender: "",
  residence: "",
  birthplace: "",

  str:50, dex:50, con:50, siz:50, intell:50, app:50, pow:50, edu:50, mov:8,
  hitpoints:null, sanity:null, luck:null, magic_points:null,

  custom_skill_name: "",
  custom_skill_value: null,

  background:"", important_people:"", important_places:"",

  // Kampf
  dodge: 0,
  melee: 25,
  firearm_malfunction: 0,
  ranged_firearm: 20,
  rifle_shotgun: 25
};

// Initialize Skills
skills.forEach(s => emptyCharacter[s] = 0);

function CoCCharacter() {
  const [character, setCharacter] = useState(emptyCharacter);
  const [characters, setCharacters] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { fetchCharacters(); }, []);

  const fetchCharacters = async () => {
    const { data, error } = await supabase.from("coc_characters").select("*").order("id");
    if (error) setError(error.message);
    else setCharacters(data);
  };

  const handleChange = (e) => {
    const { name, type, value } = e.target;
    let val;
    if (type === "number") val = value === "" ? null : Number(value);
    else if (type === "date") val = value === "" ? null : value;
    else val = value;
    setCharacter(prev => ({ ...prev, [name]: val }));
  };

  const calcHP = Math.floor((character.con + character.siz) / 10);
  const calcSAN = character.pow;
  const calcLuck = character.pow;
  const calcMP = Math.floor(character.pow / 5);

  const calcMOV = () => {
    if (character.dex > character.siz && character.str > character.siz) return 9;
    if (character.dex < character.siz && character.str < character.siz) return 7;
    return 8;
  };

  const saveCharacter = async () => {
    try {
      const { id, ...data } = character;

      // "" → null fix
      Object.keys(data).forEach(k => { if (data[k] === "") data[k] = null; });

      const payload = {
        ...data,
        hitpoints: calcHP,
        sanity: calcSAN,
        luck: calcLuck,
        magic_points: calcMP,
        mov: calcMOV()
      };

      if (isEditing && id) {
        await supabase.from("coc_characters").update(payload).eq("id", id);
        setCharacters(prev => prev.map(c => (c.id === id ? { ...c, ...payload } : c)));
      } else {
        const { data: inserted } = await supabase.from("coc_characters").insert([payload]).select();
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

  const exportPDF = () => {
    const doc = new jsPDF();
    let y = 10;

    // Persönliche Infos
    doc.text(`Gespielt von: ${character.played_by}`, 10, y); y+=6;
    doc.text(`Beruf: ${character.profession}`, 10, y); y+=6;
    doc.text(`Geburtstag: ${character.birthdate ?? ""}`, 10, y); y+=6;
    doc.text(`Alter: ${character.age ?? ""}`, 10, y); y+=6;
    doc.text(`Geschlecht: ${character.gender ?? ""}`, 10, y); y+=6;
    doc.text(`Wohnort: ${character.residence ?? ""}`, 10, y); y+=6;
    doc.text(`Geburtsort: ${character.birthplace ?? ""}`, 10, y); y+=10;

    // Attribute
    ["str","dex","con","siz","intell","app","pow","edu"].forEach(a => {
      doc.text(`${a.toUpperCase()}: ${character[a]}`, 10, y); y+=6;
    });
    doc.text(`HP: ${calcHP} SAN: ${calcSAN} Luck: ${calcLuck} MP: ${calcMP} MOV: ${calcMOV()}`, 10, y); y+=10;

    // Skills
    skills.forEach(s => { doc.text(`${s}: ${character[s]}`, 10, y); y+=5; });
    if (character.custom_skill_name) { doc.text(`${character.custom_skill_name}: ${character.custom_skill_value}`, 10, y); y+=6; }

    // Kampf
    doc.text("Kampf-Fertigkeiten:", 10, y); y+=6;
    doc.text(`Ausweichen: ${character.dodge}`, 10, y); y+=5;
    doc.text(`Nahkampf: ${character.melee}`, 10, y); y+=5;
    doc.text(`Schuss Fehlfunktion: ${character.firearm_malfunction}`, 10, y); y+=5;
    doc.text(`Fernkampf (Faustfeuerwaffe): ${character.ranged_firearm}`, 10, y); y+=5;
    doc.text(`Fernkampf (Gewehr/Flinte): ${character.rifle_shotgun}`, 10, y); y+=10;

    doc.save("character.pdf");
  };

  return (
    <div style={{padding:"20px", maxWidth:"900px", margin:"0 auto", fontFamily:"serif"}}>
      {error && <p style={{color:'red'}}>{error}</p>}

      <h2>Charakter</h2>
      <div style={{display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:"10px", marginBottom:"10px"}}>
        <div><label>Gespielt von</label><input name="played_by" value={character.played_by ?? ""} onChange={handleChange} /></div>
        <div><label>Beruf</label><input name="profession" value={character.profession ?? ""} onChange={handleChange} /></div>
        <div><label>Geburtstag</label><input name="birthdate" type="date" value={character.birthdate ?? ""} onChange={handleChange} /></div>
        <div><label>Alter</label><input name="age" type="number" value={character.age ?? ""} onChange={handleChange} /></div>
        <div><label>Geschlecht</label><input name="gender" value={character.gender ?? ""} onChange={handleChange} /></div>
        <div><label>Wohnort</label><input name="residence" value={character.residence ?? ""} onChange={handleChange} /></div>
        <div><label>Geburtsort</label><input name="birthplace" value={character.birthplace ?? ""} onChange={handleChange} /></div>
      </div>

      <h3>Attribute</h3>
      <div style={{display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"10px"}}>
        {["str","dex","con","siz","intell","app","pow","edu","mov"].map(attr => (
          <div key={attr}>
            <label>{attr.toUpperCase()}</label>
            <input name={attr} type="number" value={character[attr] ?? ""} onChange={handleChange} />
          </div>
        ))}
      </div>

      <h3>Abgeleitete Werte</h3>
      <p>HP: {calcHP} | SAN: {calcSAN} | Luck: {calcLuck} | MP: {calcMP} | MOV: {calcMOV()}</p>

      <h3>Fertigkeiten</h3>
      <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"10px"}}>
        {skills.map(skill => (
          <div key={skill}>
            <label>{skill.replaceAll("_"," ")}</label>
            <input name={skill} type="number" value={character[skill] ?? ""} onChange={handleChange} />
          </div>
        ))}
      </div>

      <h3>Besondere Fertigkeit</h3>
      <div style={{display:"flex", gap:"10px", alignItems:"center", marginBottom:"10px"}}>
        <input name="custom_skill_name" placeholder="Name" value={character.custom_skill_name ?? ""} onChange={handleChange} style={{flex:1}}/>
        <input name="custom_skill_value" type="number" placeholder="Wert" value={character.custom_skill_value ?? ""} onChange={handleChange} style={{width:"80px"}}/>
      </div>

      <h3>Kampf</h3>
      <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px"}}>
        <div><label>Ausweichen (1/2 GE)</label><input name="dodge" type="number" value={character.dodge ?? 0} onChange={handleChange} /></div>
        <div><label>Nahkampf (Handgemenge) (25%)</label><input name="melee" type="number" value={character.melee ?? 25} onChange={handleChange} /></div>
        <div><label>Schuss Fehlfunktion</label><input name="firearm_malfunction" type="number" value={character.firearm_malfunction ?? 0} onChange={handleChange} /></div>
        <div><label>Fernkampf (Faustfeuerwaffe) (20%)</label><input name="ranged_firearm" type="number" value={character.ranged_firearm ?? 20} onChange={handleChange} /></div>
        <div><label>Fernkampf (Gewehr/Flinte) (25%)</label><input name="rifle_shotgun" type="number" value={character.rifle_shotgun ?? 25} onChange={handleChange} /></div>
      </div>

      <h3>Hintergrund</h3>
      <textarea name="background" value={character.background ?? ""} onChange={handleChange} />

      <br/><br/>
      <button onClick={saveCharacter}>{isEditing ? "Aktualisieren" : "Speichern"}</button>
      <button onClick={exportPDF}>PDF</button>

      <h3>Gespeicherte Charaktere</h3>
      <ul>
        {characters.map(c => (
          <li key={c.id}>
            {c.name}
            <button onClick={() => loadCharacter(c)}>Laden</button>
            <button onClick={() => deleteCharacter(c.id)}>Löschen</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CoCCharacter;