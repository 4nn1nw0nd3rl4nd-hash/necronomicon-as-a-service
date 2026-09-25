# Phase 3.5d – Aufklappbare Würfeldetails

Dice-Nachrichten behalten ihre kompakte Darstellung im Chat. Ein nativer
`<details>/<summary>`-Bereich setzt lediglich einen kleinen Pfeil links vor die
bisherige Ergebniszeile, zum Beispiel `▸ 3d6 → 9`. Die Disclosure ist initial
geschlossen, per Tastatur bedienbar und wird nach einem Reload wieder
geschlossen angezeigt. Ihr Open-State wird nicht gespeichert oder
synchronisiert.

Geöffnet zeigt die Nachricht ausschließlich die bereits gespeicherten
`DiceRollDetails`:

- `results` als einzelne Würfelergebnisse in gespeicherter Reihenfolge,
- `raw_total` als Rohsumme,
- `modifier` immer und mit Pluszeichen bei positiven Werten,
- `total` als Gesamtwert.

Die kompakte Summary verwendet weiterhin `formatDiceExpression`. Rohsumme und
Gesamt werden nicht im Renderer neu berechnet. Auch für die Details gibt es
keinen neuen Fetch, RPC oder Realtime-Pfad; initiale, paginierte und live
geladene Nachrichten verwenden denselben bestehenden Datensatz.

Fehlen gültige Dice-Details, bleibt der defensive Text
„Würfelergebnis konnte nicht geladen werden.“ ohne funktionslose Disclosure
sichtbar. Text-, System-, Sprecher- und Zeitstempeldarstellung bleiben
unverändert.

Phase 3.5d enthält keinen Reroll. Diese Funktion folgt separat in Phase 3.5e.
