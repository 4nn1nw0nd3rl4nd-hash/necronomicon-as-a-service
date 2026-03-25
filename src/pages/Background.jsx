export default function Background({ character, handleChange }) {
  return (
    <div>
      <h3>Hintergrund</h3>
      <textarea name="background" value={character.background ?? ""} onChange={handleChange} style={{width:"100%", minHeight:"80px"}}/>
    </div>
  );
}