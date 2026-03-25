import jsPDF from "jspdf";

export function exportPDF(character) {
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
  ["str","dex","con","siz","intell","app","pow","edu"].forEach(a => { doc.text(`${a.toUpperCase()}: ${character[a]}`, 10, y); y+=6; });
  const calcHP = Math.floor((character.con + character.siz)/10);
  const calcSAN = character.pow;
  const calcLuck = character.pow;
  const calcMP = Math.floor(character.pow/5);
  const calcMOV = (()=>{if (character.dex>character.siz && character.str>character.siz)return 9;if(character.dex<character.siz && character.str<character.siz)return 7;return 8})();
  doc.text(`HP: ${calcHP} SAN: ${calcSAN} Luck: ${calcLuck} MP: ${calcMP} MOV: ${calcMOV}`, 10, y); y+=10;

  // Skills
  Object.keys(character).filter(k => !["id","played_by","profession","birthdate","age","gender","residence","birthplace","background"].includes(k) && isNaN(Number(k)) && k!=="custom_skill_name" && k!=="custom_skill_value").forEach(s => { doc.text(`${s}: ${character[s]}`, 10, y); y+=5; });
  if (character.custom_skill_name) { doc.text(`${character.custom_skill_name}: ${character.custom_skill_value}`, 10, y); y+=6; }

  // Kampf
  doc.text("Kampf-Fertigkeiten:", 10, y); y+=6;
  doc.text(`Ausweichen: ${character.dodge}`, 10, y); y+=5;
  doc.text(`Nahkampf: ${character.melee}`, 10, y); y+=5;
  doc.text(`Schuss Fehlfunktion: ${character.firearm_malfunction}`, 10, y); y+=5;
  doc.text(`Fernkampf (Faustfeuerwaffe): ${character.ranged_firearm}`, 10, y); y+=5;
  doc.text(`Fernkampf (Gewehr/Flinte): ${character.rifle_shotgun}`, 10, y); y+=10;

  // Hintergrund
  doc.text(`Hintergrund: ${character.background ?? ""}`, 10, y); y+=10;

  doc.save(`${character.name || "character"}.pdf`);
}