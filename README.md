# Necronomicon as a Service

Ein kleines Pen-and-Paper-Portal mit:

- Startseite fuer den Session-Einstieg
- Session-Ansicht mit Tabs fuer Charakter, Chat und Whiteboard
- Dice-/Chat-Feed mit DnD- und Call-of-Cthulhu-Wuerfeln
- Supabase Realtime fuer gemeinsame Session-Events

## Schnellueberblick

Die App ist in vier grobe Bereiche aufgeteilt:

1. `src/App.jsx`
   Startseite und Routing
2. `src/pages/Session.jsx`
   Zentrale Session-Logik, Realtime und Tab-Steuerung
3. `src/pages/Dice.jsx`
   UI fuer Wuerfeln und Chat
4. `src/lib/diceParser.js` und `src/lib/diceRules.js`
   Parsing und Regel-Logik fuer Wuerfelbefehle

## Wie der Wuerfel-Flow funktioniert

### 1. Eingabe in der Dice-Seite

In `src/pages/Dice.jsx` schreibt der Nutzer entweder:

- einen Wuerfelbefehl wie `2d6+3`, `1d20 adv`, `1d100 bonus1`
- oder normalen Chat-Text

`handleSubmit()` prueft die Eingabe.

- Wenn der Parser einen gueltigen Wuerfelbefehl erkennt, wird `triggerRoll(parsed)` aufgerufen.
- Wenn nicht, wird die Eingabe als Chatnachricht behandelt.

### 2. Parsing

`src/lib/diceParser.js` ist nur dafuer da, Text in ein standardisiertes Objekt umzuwandeln.

Beispiele:

```js
{ count: 2, sides: 6, modifier: 3, mode: "normal" }
{ count: 1, sides: 20, modifier: 0, mode: "adv" }
{ count: 1, sides: 100, modifier: 0, mode: "bonus1" }
{ count: 3, sides: 6, modifier: 0, mode: "luck" }
```

Wichtig:

- Der Parser rechnet noch nichts aus.
- Er beschreibt nur, was gewuerfelt werden soll.

### 3. Wurf-Regeln

`src/lib/diceRules.js` enthaelt die eigentliche Fachlogik.

Die zentrale Funktion ist:

- `buildDiceRoll(request, userId)`

Sie berechnet aus dem Request:

- `label`
- `detail`
- `result`
- `userId`

Beispiele fuer Spezialregeln:

- `adv` / `dis`
  Zwei Wuerfe, besserer oder schlechterer zaehlt
- `bonus1` / `bonus2`
  CoC Bonuswuerfel, kleinster Zehner zaehlt
- `penalty1` / `penalty2`
  CoC Strafwuerfel, groesster Zehner zaehlt
- `luck`
  Glueckswurf = `3d6 * 5`

Danach baut:

- `createRollPayload(request, userId)`

das finale Objekt fuer UI und Realtime. Dort wird auch eine eindeutige `id` vergeben.

## Warum Parser und Regeln getrennt sind

Frueher war alles direkt in `Dice.jsx`.

Jetzt sind die Aufgaben getrennt:

- `diceParser.js`
  Versteht Eingaben
- `diceRules.js`
  Berechnet Ergebnisse
- `Dice.jsx`
  Stellt die Oberflaeche dar
- `Session.jsx`
  Kuemmert sich um Realtime und gemeinsame Session-Daten

Das macht den Code leichter testbar und einfacher zu aendern.

## Wie die Session Realtime nutzt

`src/pages/Session.jsx` ist die Bruecke zwischen UI und Supabase.

Wichtige Aufgaben:

- Session-ID aus der URL lesen
- Benutzer und Session-Spieler aus Supabase laden
- Realtime-Kanal oeffnen
- Chat- und Wuerfel-Events empfangen
- Ergebnisse lokal deduplizieren

Wenn `Dice.jsx` einen Wurf ausloest, passiert Folgendes:

1. `Dice.jsx` ruft `onRoll(request)` auf
2. `Session.jsx` erzeugt mit `createRollPayload(...)` ein Ergebnisobjekt
3. Das Ergebnis wird sofort lokal angezeigt
4. Danach wird es ueber Supabase Broadcast an andere Session-Teilnehmer gesendet

Dasselbe Prinzip gilt fuer Chatnachrichten.

## Warum es `appendUnique...`-Funktionen gibt

In `Session.jsx` gibt es:

- `appendUniqueDiceResult`
- `appendUniqueMessage`

Die verhindern doppelte Eintraege im Feed.

Das ist wichtig, weil ein Event:

- lokal sofort hinzugefuegt werden kann
- und zusaetzlich ueber Realtime wieder zurueckkommen kann

Die eindeutige `id` sorgt dafuer, dass derselbe Eintrag nicht zweimal erscheint.

## Wie der Dice-Feed aufgebaut ist

In `Dice.jsx` laufen zwei Datenarten zusammen:

- Chatnachrichten
- Wuerfelergebnisse

Beide werden mit `toTimelineEntry(...)` in eine gemeinsame Darstellungsform gebracht.

Dadurch muss das Rendering unten nur noch eine Liste anzeigen statt zwei komplett unterschiedliche UI-Wege zu haben.

## Lesereihenfolge fuer den Code

Wenn du den Code verstehen willst, lies ihn am besten in dieser Reihenfolge:

1. `src/App.jsx`
   So kommst du in die App und in die Session hinein.
2. `src/pages/Session.jsx`
   Das ist der zentrale Datenfluss fuer Realtime.
3. `src/pages/Dice.jsx`
   Hier siehst du, wie die UI mit Session und Parser zusammenarbeitet.
4. `src/lib/diceParser.js`
   Hier verstehst du, wie Eingaben erkannt werden.
5. `src/lib/diceRules.js`
   Hier steckt die eigentliche Wurf-Logik.

## Wie man neue Modi einbaut

Wenn du spaeter eine neue Regel hinzufuegen willst, ist das typische Vorgehen:

1. In `src/lib/diceParser.js`
   neuen Modus aus Eingabetext erkennen
2. In `src/lib/diceRules.js`
   neue Berechnung einbauen
3. Ebenfalls in `src/lib/diceRules.js`
   `getModeLabel()` und ggf. `getModeTone()` erweitern
4. In `src/pages/Dice.jsx`
   den Button oder die UI fuer den Modus anzeigen

## Starten

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Hinweis

Aktuell ist die Dice-Oberflaeche schon deutlich modularer als vorher.
Der naechste sinnvolle Refactoring-Schritt waere, `src/pages/Dice.jsx` selbst noch weiter in kleinere UI-Komponenten aufzuteilen, z. B.:

- `DiceSidebar`
- `DiceFeed`
- `DiceComposer`
