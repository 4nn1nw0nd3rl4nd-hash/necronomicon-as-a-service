export const SUPPORTED_SIDES = [4, 6, 8, 10, 12, 20, 100];

export function parseDiceCommand(command) {
  // Wir arbeiten intern komplett mit Kleinbuchstaben und ohne
  // Fuehrungs-/End-Leerzeichen, damit die Erkennung robuster ist.
  const text = command.toLowerCase().trim();

  // Glueckswurf ist ein Sonderfall:
  // Der Nutzer tippt keinen klassischen "XdY"-Befehl,
  // sondern einfach nur "glueck".
  // Wir uebersetzen das hier direkt in unsere interne Struktur.
  if (text === "glueck" || text === "gluck" || text === "luck") {
    return { count: 3, sides: 6, modifier: 0, mode: "luck" };
  }

  // Basisformat fuer normale Wuerfelbefehle:
  // "1d20", "2d6", "3d8" usw.
  // Die erste Gruppe ist optional, damit auch "d20" moeglich waere.
  const match = text.match(/(\d*)d(4|6|8|10|12|20|100)/);

  if (!match) return null;

  // count = Anzahl der Wuerfel, sides = Seitenzahl des Wuerfels.
  const count = parseInt(match[1] || "1", 10);
  const sides = parseInt(match[2], 10);

  // Optionaler Modifikator wie +3 oder -1.
  const modifierMatch = text.match(/([+-]\d+)/);
  const modifier = modifierMatch ? parseInt(modifierMatch[1], 10) : 0;

  // Der Modus steuert spaeter, welche Wurfregel angewendet wird.
  // Default ist immer "normal".
  let mode = "normal";

  // Reihenfolge ist hier wichtig:
  // Erst die spezielleren CoC-Modi, dann die allgemeineren DnD-Modi.
  // So verhindern wir, dass ein Text versehentlich am falschen Zweig landet.
  if (text.includes("strafe2") || text.includes("straf2") || text.includes("penalty2") || text.includes("pw2")) {
    mode = "penalty2";
  } else if (text.includes("strafe1") || text.includes("straf1") || text.includes("penalty1") || text.includes("pw1")) {
    mode = "penalty1";
  } else if (text.includes("bonus2") || text.includes("bw2")) {
    mode = "bonus2";
  } else if (text.includes("bonus1") || text.includes("bw1")) {
    mode = "bonus1";
  } else if (text.includes("adv")) {
    mode = "adv";
  } else if (text.includes("dis")) {
    mode = "dis";
  }

  // Rueckgabe ist bewusst generisch:
  // Die eigentliche Wurfberechnung passiert spaeter zentral in diceRules.js.
  return { count, sides, modifier, mode };
}
