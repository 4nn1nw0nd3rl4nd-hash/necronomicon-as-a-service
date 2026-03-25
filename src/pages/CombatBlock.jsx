export default function CombatBlock({ character, handleChange }) {
  return (
    <div>
      <h3>Kampf</h3>
      <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px"}}>
        <div><label>Ausweichen (1/2 GE)</label><input name="dodge" type="number" value={character.dodge ?? 0} onChange={handleChange}/></div>
        <div><label>Nahkampf (Handgemenge) (25%)</label><input name="melee" type="number" value={character.melee ?? 25} onChange={handleChange}/></div>
        <div><label>Schuss Fehlfunktion</label><input name="firearm_malfunction" type="number" value={character.firearm_malfunction ?? 0} onChange={handleChange}/></div>
        <div><label>Fernkampf (Faustfeuerwaffe) (20%)</label><input name="ranged_firearm" type="number" value={character.ranged_firearm ?? 20} onChange={handleChange}/></div>
        <div><label>Fernkampf (Gewehr/Flinte) (25%)</label><input name="rifle_shotgun" type="number" value={character.rifle_shotgun ?? 25} onChange={handleChange}/></div>
      </div>
    </div>
  );
}