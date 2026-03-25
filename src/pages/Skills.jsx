export default function Skills({ character, handleChange, skillsList }) {
  return (
    <div>
      <h3>Fertigkeiten</h3>
      <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"10px"}}>
        {skillsList.map(skill => (
          <div key={skill}>
            <label>{skill.replaceAll("_"," ")}</label>
            <input name={skill} type="number" value={character[skill] ?? ""} onChange={handleChange}/>
          </div>
        ))}
      </div>

      <h3>Besondere Fertigkeit</h3>
      <div style={{display:"flex", gap:"10px", alignItems:"center", marginBottom:"10px"}}>
        <input name="custom_skill_name" placeholder="Name" value={character.custom_skill_name ?? ""} onChange={handleChange} style={{flex:1}}/>
        <input name="custom_skill_value" type="number" placeholder="Wert" value={character.custom_skill_value ?? ""} onChange={handleChange} style={{width:"80px"}}/>
      </div>
    </div>
  );
}