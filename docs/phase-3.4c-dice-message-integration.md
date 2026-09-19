# Phase 3.4c – Frontend-Datenintegration für generische Würfelwürfe

## Datenmodell und Normalisierung

`RoundMessage` ist eine discriminated union aus `CharacterMessage`,
`SystemMessage` und `DiceRollMessage`. Character- und Systemnachrichten behalten
einen verpflichtenden Text-Body. Ein Würfelwurf hat dagegen `kind = 'dice_roll'`,
`body = null`, einen Character- oder GM-Sprecher und eingebettete
`DiceRollDetails` mit Message-ID, Würfelanzahl, Seitenzahl, Modifikator,
Einzelergebnissen, Rohsumme und Gesamtsumme.

`decodeRoundMessage` ist die gemeinsame Laufzeitgrenze für Daten aus
PostgREST-Fetches und RPC-Rückgaben. Er prüft die Message-Hülle, bekannte
Nachrichtenarten, Text- beziehungsweise NULL-Body, zulässige Sprecherarten und
alle Dice-Felder. Unbekannte Message-Arten oder ungültige Hüllen werden
abgelehnt. Die Ergebnisreihenfolge wird unverändert kopiert und nicht sortiert.

Die 1:1-Relation kann durch PostgREST abhängig von der erkannten Kardinalität
als Objekt oder als Array mit genau einem Objekt eintreffen. Beide Eingangsformen
werden einmalig am Decoder akzeptiert und auf den Produktvertrag
`DiceRollDetails | null` normalisiert. Das Frontend führt keine zweite dauerhafte
Relationform ein.

Fehlt bei einem ansonsten gültigen Dice-Parent die Detailzeile oder ist das
Detailobjekt unvollständig, bleibt die Parent-Nachricht erhalten und erhält
`dice_roll = null`. Dieser definierte Fehlerzustand wird vorläufig als
„Würfelergebnis konnte nicht geladen werden.“ dargestellt. Das Frontend
rekonstruiert keinen Body und würfelt nicht erneut.

## Gemeinsame Projektion und Fetchpfade

Die zentrale `roundMessageFields`-Projektion bettet
`round_message_dice_rolls` ohne `!inner` ein. Dadurch bleiben Character-,
System- und beschädigte Dice-Parent-Nachrichten im Ergebnis. Initial Load,
ältere Seiten und autorisierte Delta-Refetches verwenden unverändert denselben
Select-String und denselben Decoder. Es gibt keine N+1- oder separate
Dice-Detailabfrage.

Pagination bleibt an den Parent-Zeilen und `round_seq` ausgerichtet. Page Size
und Cursor werden aus den gelieferten Parent-Zeilen bestimmt; die eingebettete
1:1-Relation beeinflusst die Anzahl nicht. Die sichtbaren Nachrichten werden
weiter nach `round_seq` sortiert und nach Message-ID zusammengeführt. Damit
behandelt die bestehende Deduplizierung Würfelwürfe wie alle anderen Messages.

RPC-JSON mit einem Dice-Objekt und die eingebettete PostgREST-Relation laufen
durch denselben Decoder und ergeben dieselbe Frontend-Struktur. Auch die bereits
vorhandene Text-Sendequittung verwendet nun diesen Decoder. Ein Dice-Sendehook
oder künstlicher UI-Aufruf wird in dieser Phase nicht eingeführt.

## Realtime, Unread und vorläufige Darstellung

Realtime bleibt bei genau einer `round_messages`-INSERT-Invalidierung. Der danach
ausgeführte autorisierte Delta-Refetch lädt mit der gemeinsamen Projektion auch
die vollständigen Dice-Details. Es gibt keinen Channel für
`round_message_dice_rolls` und keine Übernahme des Realtime-Payloads in den
Nachrichten-State.

Unread zählt weiterhin tatsächlich geladene sichtbare Parent-Nachrichten ohne
Kind-Filter. Ein sichtbarer Würfelwurf wird deshalb wie jede andere Message
gezählt; private Sequenzlücken erzeugen weiterhin keinen Zähler.

`PlayChatPanel` behält die bisherige Character-/GM-/Systemdarstellung. Für einen
gültigen Würfelwurf zeigt es nur den strukturiert formatierten Ausdruck und die
Gesamtsumme, zum Beispiel `2d6+3 → 10`. Bei Modifikator null entfällt `+0`, ein
negativer Modifikator wird direkt als `-N` ausgegeben. Dies ist keine fertige
Würfelkarte.

## Tests und verbleibender Scope

Die Tests decken Character-, öffentliche und private Systemnachrichten, gültige
Würfelwürfe, NULL-Body, fehlende und beschädigte Details, unbekannte Arten,
Objekt-/Array-Normalisierung, Ergebnisreihenfolge und Ausdrucksformatierung ab.
Initial Load, Pagination und Delta-Refetch verwenden dieselbe eingebettete
Projektion; Dice-Parents werden dedupliziert und ohne Detailquery geladen. Die
temporäre Erfolgs- und Fehlerdarstellung sowie die bestehende Unread-Basis sind
ebenfalls abgedeckt.

Phase 3.4d übernimmt die echte Multi-Session-/Realtime-Abnahme. Würfelsteuerung,
Parser, Wiederholungsfunktion, Secret Rolls, systemspezifische Regeln,
Character-Sheet-Rolls und die eigentliche Würfel-UI bleiben Phase 3.5 oder
späteren Teilphasen vorbehalten. Diese Phase ändert keine Datenbankmigration,
Subscription oder Pagination-Architektur.
