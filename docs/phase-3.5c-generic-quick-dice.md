# Phase 3.5c – Generische Schnellwürfel

Der bestehende Spieltisch-Chat bietet zusätzlich zum `/r`-Befehl eine kompakte
Schnellwürfel-Maske. Sie unterstützt die Würfeltypen d4, d6, d8, d10, d12, d20
und d100. Ein erster Klick wählt einen Würfel, weitere Klicks auf denselben Typ
erhöhen die Anzahl bis maximal 50. Ein anderer Würfeltyp ersetzt den bisherigen
Pool durch einen einzelnen Würfel; gemischte Würfelarten sind nicht vorgesehen.

Minus und Plus korrigieren die Anzahl. Minus entfernt bei einem einzelnen
Würfel die Auswahl vollständig. Der Modifier ist eine ganze Zahl von −9999 bis
+9999; ein leerer Wert entspricht 0. Ungültige Werte deaktivieren den Wurf. Die
Vorschau verwendet dieselbe Schreibweise wie die bestehenden Dice-Nachrichten.
„Schnellwürfel zurücksetzen“ entfernt die Auswahl und setzt den Modifier auf 0.

Die Auswahl ist ausschließlich lokaler UI-State und wird weder auf dem Server
noch im Browser gespeichert. Nach einem erfolgreichen Wurf bleibt sie erhalten,
damit derselbe Pool erneut gewürfelt werden kann. Reload oder ein neuer
Spieltisch-Scope beginnen wieder ohne Auswahl.

## Gemeinsamer Sendekern

Schnellwürfel übergeben strukturierte Werte an denselben Composer-Sendekern wie
`/r`. Request-ID-Erzeugung, Doppelsubmit-Schutz, RPC, Sprecheridentität,
Antwort-Decoding, Contract-Prüfung, Fehlerabbildung und Delta-Refetch sind nicht
dupliziert. Ein neuer oder geänderter Wurf erhält eine neue Request-ID. Nach
einem ambigen Fehler verwendet ein unveränderter erneuter Versuch dieselbe ID;
deterministische Ablehnung und Erfolg geben den Intent frei.

Die Sprecheridentität stammt weiterhin ausschließlich aus dem kanonischen
Spieltischzustand: aktive Character-ID für Spieler und GM im Charaktermodus,
NULL für GM-Spielleitung. Die Schnellmaske besitzt keinen eigenen Identity-State.

Der Chatdraft und die Schnellwürfelauswahl sind voneinander unabhängig. Ein
Schnellwurf schreibt keinen `/r`-Text, leert den Draft weder bei Erfolg noch bei
Fehler und erzeugt keine optimistische Dice-Nachricht. Umgekehrt verändert ein
`/r`-Wurf die Schnellwürfelauswahl nicht.

## Abgrenzung

Phase 3.5c enthält keine Datenbank-, SQL-, RLS- oder Realtime-Änderung und keine
Systemmasken oder Persistenz. Phase 3.5d ergänzt später die Dice-Card, Phase 3.5e
Reroll und Phase 3.5f das Maskensystem.
