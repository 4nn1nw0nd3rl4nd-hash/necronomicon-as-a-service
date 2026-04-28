import jsPDF from "jspdf";
import {
  calculateCoCDerived,
  cocSkillsList,
  getCoCSkillLabel,
} from "../lib/cocSheet";

function drawSection(doc, title, x, y, width, height) {
  doc.setDrawColor(83, 61, 41);
  doc.setFillColor(248, 240, 223);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");
  doc.setFillColor(96, 70, 45);
  doc.rect(x, y, width, 7, "F");
  doc.setTextColor(252, 245, 230);
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.text(title, x + 3, y + 4.8);
  doc.setTextColor(35, 27, 20);
}

function drawField(doc, label, value, x, y, width) {
  doc.setFont("times", "bold");
  doc.setFontSize(8);
  doc.text(label, x, y);
  doc.setDrawColor(128, 108, 88);
  doc.line(x, y + 1.4, x + width, y + 1.4);
  doc.setFont("times", "normal");
  doc.text(String(value ?? ""), x + 0.5, y - 0.2, {
    maxWidth: Math.max(width - 1, 12),
  });
}

function drawStatBox(doc, label, value, x, y, width) {
  doc.setDrawColor(110, 90, 72);
  doc.rect(x, y, width, 14);
  doc.setFont("times", "bold");
  doc.setFontSize(8);
  doc.text(label, x + 2, y + 4);
  doc.setFontSize(14);
  doc.text(String(value ?? ""), x + width / 2, y + 10, { align: "center" });
}

function drawParagraph(doc, text, x, y, width, height) {
  const lines = doc.splitTextToSize(text || "", width - 4);
  const clipped = lines.slice(0, Math.max(1, Math.floor((height - 6) / 4)));
  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.text(clipped, x + 2, y + 5);
}

export function exportPDF(character) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const derived = calculateCoCDerived(character);
  const skills = [...cocSkillsList];

  if (character.custom_skill_name) {
    skills.push("custom_skill");
  }

  doc.setFillColor(239, 228, 205);
  doc.rect(0, 0, 210, 297, "F");

  doc.setTextColor(34, 26, 18);
  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.text("Call of Cthulhu Ermittlerbogen", 105, 13, { align: "center" });

  drawSection(doc, "Persoenliche Daten", 10, 18, 190, 32);
  drawField(doc, "Name", character.name, 14, 30, 55);
  drawField(doc, "Gespielt von", character.played_by, 75, 30, 50);
  drawField(doc, "Beruf", character.profession, 131, 30, 55);
  drawField(doc, "Geburtstag", character.birthdate || "", 14, 42, 40);
  drawField(doc, "Alter", character.age ?? "", 60, 42, 18);
  drawField(doc, "Geschlecht", character.gender, 84, 42, 26);
  drawField(doc, "Wohnort", character.residence, 116, 42, 34);
  drawField(doc, "Geburtsort", character.birthplace, 156, 42, 30);

  drawSection(doc, "Attribute", 10, 55, 92, 42);
  const attributes = [
    ["STR", character.str],
    ["DEX", character.dex],
    ["CON", character.con],
    ["SIZ", character.siz],
    ["INT", character.intell],
    ["APP", character.app],
    ["POW", character.pow],
    ["EDU", character.edu],
  ];

  attributes.forEach(([label, value], index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    drawStatBox(doc, label, value, 14 + col * 21, 66 + row * 16, 18);
  });

  drawSection(doc, "Abgeleitete Werte", 108, 55, 92, 42);
  const derivedStats = [
    ["TP", derived.hitpoints],
    ["SAN", derived.sanity],
    ["Glueck", derived.luck],
    ["MP", derived.magic_points],
    ["MOV", derived.mov],
  ];

  derivedStats.forEach(([label, value], index) => {
    drawStatBox(doc, label, value, 112 + index * 17, 70, 14);
  });

  drawField(doc, "Ausweichen", character.dodge ?? 0, 112, 92, 18);
  drawField(doc, "Nahkampf", character.melee ?? 25, 136, 92, 18);
  drawField(doc, "Faustfeuerwaffe", character.ranged_firearm ?? 20, 160, 92, 24);
  drawField(doc, "Gewehr/Flinte", character.rifle_shotgun ?? 25, 112, 103, 24);
  drawField(doc, "Fehlfunktion", character.firearm_malfunction ?? 0, 142, 103, 18);

  drawSection(doc, "Fertigkeiten", 10, 102, 190, 115);
  doc.setFont("times", "bold");
  doc.setFontSize(8);
  doc.text("Fertigkeit", 14, 114);
  doc.text("%", 86, 114, { align: "right" });
  doc.text("Fertigkeit", 110, 114);
  doc.text("%", 186, 114, { align: "right" });

  const half = Math.ceil(skills.length / 2);
  const leftSkills = skills.slice(0, half);
  const rightSkills = skills.slice(half);

  leftSkills.forEach((skill, index) => {
    const y = 120 + index * 5.1;
    const label =
      skill === "custom_skill" ? character.custom_skill_name : getCoCSkillLabel(skill);
    const value =
      skill === "custom_skill" ? character.custom_skill_value ?? "" : character[skill] ?? 0;
    doc.setFont("times", "normal");
    doc.setFontSize(7.5);
    doc.text(label || "Sonderfertigkeit", 14, y);
    doc.text(String(value), 86, y, { align: "right" });
    doc.setDrawColor(190, 176, 152);
    doc.line(13, y + 1.2, 88, y + 1.2);
  });

  rightSkills.forEach((skill, index) => {
    const y = 120 + index * 5.1;
    const label = getCoCSkillLabel(skill);
    const value = character[skill] ?? 0;
    doc.setFont("times", "normal");
    doc.setFontSize(7.5);
    doc.text(label, 110, y);
    doc.text(String(value), 186, y, { align: "right" });
    doc.setDrawColor(190, 176, 152);
    doc.line(109, y + 1.2, 188, y + 1.2);
  });

  drawSection(doc, "Hintergrund", 10, 223, 92, 58);
  drawParagraph(doc, character.background, 10, 230, 92, 50);

  drawSection(doc, "Wichtige Personen", 108, 223, 92, 28);
  drawParagraph(doc, character.important_people, 108, 230, 92, 20);

  drawSection(doc, "Wichtige Orte", 108, 253, 92, 28);
  drawParagraph(doc, character.important_places, 108, 260, 92, 20);

  doc.save(`${character.name || "ermittlerbogen"}.pdf`);
}
