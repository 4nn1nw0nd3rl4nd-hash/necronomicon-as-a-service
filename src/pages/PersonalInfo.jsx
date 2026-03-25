export default function PersonalInfo({ character, handleChange }) {
  return (
    <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"10px", marginBottom:"10px"}}>
      <div><label>Gespielt von</label><input name="played_by" value={character.played_by ?? ""} onChange={handleChange} /></div>
      <div><label>Beruf</label><input name="profession" value={character.profession ?? ""} onChange={handleChange} /></div>
      <div><label>Geburtstag</label><input name="birthdate" type="date" value={character.birthdate ?? ""} onChange={handleChange} /></div>
      <div><label>Alter</label><input name="age" type="number" value={character.age ?? ""} onChange={handleChange} /></div>
      <div><label>Geschlecht</label><input name="gender" value={character.gender ?? ""} onChange={handleChange} /></div>
      <div><label>Wohnort</label><input name="residence" value={character.residence ?? ""} onChange={handleChange} /></div>
      <div><label>Geburtsort</label><input name="birthplace" value={character.birthplace ?? ""} onChange={handleChange} /></div>
    </div>
  );
}