# Dice Lib

Dieses Verzeichnis enthaelt die fachliche Logik fuer das Wuerfelsystem.

## Dateien

### `diceParser.js`

Diese Datei versteht Texteingaben aus der UI und wandelt sie in ein standardisiertes Objekt um.

Beispiele:

```js
parseDiceCommand("2d6+3")
// => { count: 2, sides: 6, modifier: 3, mode: "normal" }

parseDiceCommand("1d20 adv")
// => { count: 1, sides: 20, modifier: 0, mode: "adv" }

parseDiceCommand("1d100 bonus2")
// => { count: 1, sides: 100, modifier: 0, mode: "bonus2" }

parseDiceCommand("glueck")
// => { count: 3, sides: 6, modifier: 0, mode: "luck" }
```

Wichtig:

- Der Parser rechnet noch nichts aus.
- Er beschreibt nur den gewuenschten Wurf.

### `diceRules.js`

Diese Datei berechnet aus einem standardisierten Request das eigentliche Ergebnis.

Wichtige Funktionen:

- `getModeTone(mode)`
  Farben fuer die UI
- `getModeLabel(mode)`
  Lesbare Namen fuer Buttons und Badges
- `buildDiceRoll(request, userId)`
  Berechnet Inhalt eines Wurfs
- `createRollPayload(request, userId)`
  Ergaenzt eine eindeutige `id` fuer Feed und Realtime

## Datenfluss

Der typische Ablauf ist:

1. UI nimmt Texteingabe entgegen
2. `parseDiceCommand(...)` erzeugt ein Request-Objekt
3. `buildDiceRoll(...)` oder `createRollPayload(...)` berechnet das Ergebnis
4. Die Session zeigt das Ergebnis lokal an und sendet es ueber Realtime

## Warum diese Trennung sinnvoll ist

Ohne diese Trennung wuerden Parsing, Fachlogik und UI komplett ineinanderlaufen.

Mit dieser Struktur kann man:

- neue Modi einfacher einbauen
- Regeln testen, ohne die UI mitzudenken
- die Session und die lokale Dice-Ansicht dieselbe Logik nutzen lassen

## Neue Modi einbauen

Wenn du eine neue Regel ergaenzen willst, gehst du normalerweise so vor:

1. In `diceParser.js`
   neuen Text / Alias erkennen
2. In `diceRules.js`
   neue Berechnung einbauen
3. In `diceRules.js`
   Label und ggf. Farbton ergaenzen
4. In `Dice.jsx`
   Button oder UI fuer den neuen Modus anzeigen
