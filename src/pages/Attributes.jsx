export default function Attributes({ character, handleChange }) {
  const calcMOV = () => {
    if (character.dex > character.siz && character.str > character.siz) return 9;
    if (character.dex < character.siz && character.str < character.siz) return 7;
    return 8;
  };

  const calcHP = Math.floor((character.con + character.siz)/10);
  const calcSAN = character.pow;
  const calcLuck = character.pow;
  const calcMP = Math.floor(character.pow/5);

  return (
    <div>
      <h3>Attribute</h3>
      <div style={{display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"10px"}}>
        {["str","dex","con","siz","intell","app","pow","edu","mov"].map(attr => (
          <div key={attr}>
            <label>{attr.toUpperCase()}</label>
            <input name={attr} type="number" value={attr === "mov" ? calcMOV() : character[attr] ?? ""} onChange={handleChange}/>
          </div>
        ))}
      </div>

      <h3>Abgeleitete Werte</h3>
      <p>HP: {calcHP} | SAN: {calcSAN} | Luck: {calcLuck} | MP: {calcMP} | MOV: {calcMOV()}</p>
    </div>
  );
}