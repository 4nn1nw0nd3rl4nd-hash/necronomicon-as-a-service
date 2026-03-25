import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import PersonalInfo from "./PersonalInfo";
import Attributes from "./Attributes";
import Skills from "./Skills";
import CombatBlock from "./CombatBlock";
import Background from "./Background";
import { exportPDF } from "./PDFExport";

const skillsList = [
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

// Initialisiere Skills
skillsList.forEach(s => emptyCharacter[s] = 0);

export default function CoCCharacter() {
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

  const saveCharacter = async () => {
    try {
      const { id, ...data } = character;
      Object.keys(data).forEach(k => { if (data[k] === "") data[k] = null; });

      const payload = {
        ...data,
        hitpoints: Math.floor((character.con + character.siz)/10),
        sanity: character.pow,
        luck: character.pow,
        magic_points: Math.floor(character.pow / 5),
        mov: (() => {if (character.dex > character.siz && character.str > character.siz) return 9; if(character.dex < character.siz && character.str < character.siz) return 7; return 8})()
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

  const loadCharacter = (char) => { setCharacter({ ...char }); setIsEditing(true); };
  const deleteCharacter = async (id) => { await supabase.from("coc_characters").delete().eq("id", id); setCharacters(prev => prev.filter(c => c.id !== id)); };

  return (
    <div style={{padding:"20px", maxWidth:"900px", margin:"0 auto", fontFamily:"serif"}}>
      {error && <p style={{color:'red'}}>{error}</p>}

      <PersonalInfo character={character} handleChange={handleChange}/>
      <Attributes character={character} handleChange={handleChange}/>
      <Skills character={character} handleChange={handleChange} skillsList={skillsList}/>
      <CombatBlock character={character} handleChange={handleChange}/>
      <Background character={character} handleChange={handleChange}/>

      <br/>
      <button onClick={saveCharacter}>{isEditing ? "Aktualisieren" : "Speichern"}</button>
      <button onClick={() => exportPDF(character)}>PDF</button>

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