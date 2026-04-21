function rollDie(sides) {
  // Ein einfacher Hilfswurf:
  // Math.random() liefert 0 <= x < 1
  // multipliziert mit Seitenzahl und abgerundet ergibt 0..(sides-1)
  // +1 verschiebt das auf 1..sides
  return Math.floor(Math.random() * sides) + 1;
}

export function getModeTone(mode) {
  // Diese Funktion hat nur eine UI-Aufgabe:
  // Je nach Modus liefern wir die Farben fuer Buttons / Badges.
  if (mode === "adv") return { background: "#85d58e", color: "#102312" };
  if (mode === "dis") return { background: "#ff9384", color: "#34130d" };
  if (mode === "bonus1") return { background: "#88baf7", color: "#0f1a30" };
  if (mode === "bonus2") return { background: "#6fa0f1", color: "#091629" };
  if (mode === "penalty1") return { background: "#c58eff", color: "#26103c" };
  if (mode === "penalty2") return { background: "#ad70ed", color: "#1d0d31" };
  if (mode === "luck") return { background: "#f6c56a", color: "#2f1d08" };
  return { background: "#f3d18c", color: "#1e1611" };
}

export function getModeLabel(mode) {
  // Lesbare Labels fuer die Oberflaeche.
  // So bleibt die App flexibel:
  // Intern koennen wir kurze, technische Modusnamen benutzen,
  // extern aber freundliche Begriffe anzeigen.
  if (mode === "adv") return "ADV";
  if (mode === "dis") return "DIS";
  if (mode === "bonus1") return "Bonus 1";
  if (mode === "bonus2") return "Bonus 2";
  if (mode === "penalty1") return "Strafe 1";
  if (mode === "penalty2") return "Strafe 2";
  if (mode === "luck") return "Glueck";
  return "Normal";
}

export function buildDiceRoll(request, userId = "Ich") {
  // request ist das standardisierte Wurf-Objekt aus Parser oder UI:
  // { count, sides, modifier, mode }
  const { count = 1, sides = 20, modifier = 0, mode = "normal" } = request;

  if (mode === "luck") {
    // Call of Cthulhu Glueckswurf:
    // Drei W6 werden addiert und anschliessend mit 5 multipliziert.
    const rolls = Array.from({ length: 3 }, () => rollDie(6));
    const sum = rolls.reduce((total, current) => total + current, 0);

    return {
      label: "Glueckswurf",
      detail: `[${rolls.join(", ")}] x 5`,
      result: sum * 5,
      userId,
    };
  }

  if (mode === "bonus1" || mode === "bonus2" || mode === "penalty1" || mode === "penalty2") {
    // CoC Bonus-/Strafwuerfel:
    // Ein "d100"-Wurf wird als Einerwuerfel + Zehnerwuerfel modelliert.
    //
    // Beispiel:
    // Einer = 7
    // Zehneroptionen = [4, 1, 6]
    //
    // Bonus: kleinster Zehner zaehlt
    // Strafe: groesster Zehner zaehlt
    const ones = rollDie(10) - 1;
    const baseTens = rollDie(10) - 1;
    const extraCount = mode === "bonus2" || mode === "penalty2" ? 2 : 1;
    const extraTens = Array.from({ length: extraCount }, () => rollDie(10) - 1);
    const tensPool = [baseTens, ...extraTens];
    const selectedTens =
      mode === "bonus1" || mode === "bonus2"
        ? Math.min(...tensPool)
        : Math.max(...tensPool);
    const result = selectedTens * 10 + ones;

    // Label nur fuer die spaetere Anzeige im Feed.
    const label =
      mode === "bonus2"
        ? "Bonuswuerfel 2"
        : mode === "bonus1"
          ? "Bonuswuerfel 1"
          : mode === "penalty2"
            ? "Strafwuerfel 2"
            : "Strafwuerfel 1";

    return {
      label,
      detail: `Einer ${ones}, Zehner [${tensPool.join(", ")}] -> ${selectedTens}${modifier ? ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}` : ""}`,
      result: result + modifier,
      userId,
    };
  }

  if (mode === "adv" || mode === "dis") {
    // DnD Advantage / Disadvantage:
    // Zwei Wuerfe, der bessere oder schlechtere zaehlt.
    const first = rollDie(sides);
    const second = rollDie(sides);
    const selected = mode === "adv" ? Math.max(first, second) : Math.min(first, second);
    const total = selected + modifier;
    const modifierText = modifier ? ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}` : "";

    return {
      label: `${mode.toUpperCase()} d${sides}`,
      detail: `${first}, ${second}${modifierText}`,
      result: total,
      userId,
    };
  }

  const rolls = [];
  let sum = 0;

  // Standardfall fuer "normale" Mehrfachwuerfe wie 2d6+3.
  for (let i = 0; i < count; i += 1) {
    const roll = rollDie(sides);
    rolls.push(roll);
    sum += roll;
  }

  const total = sum + modifier;
  const modifierText = modifier ? ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}` : "";

  return {
    label: `${count}d${sides}`,
    detail: `[${rolls.join(", ")}]${modifierText}`,
    result: total,
    userId,
  };
}

export function createRollPayload(request, userId = "Ich") {
  // Diese Funktion baut das finale Objekt, das wir im UI anzeigen
  // und ueber Supabase Realtime verschicken koennen.
  //
  // Wichtig:
  // buildDiceRoll() berechnet nur Inhalt
  // createRollPayload() ergaenzt zusaetzlich eine eindeutige id
  // fuer Deduplizierung und Listen-Rendering.
  return {
    id: `${userId ?? "anon"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...buildDiceRoll(request, userId),
  };
}
