# Phase 3.4b – generischer Dice-RPC

Stand: 2026-09-18. Lokale Implementierung, noch keine SQL-Ausführung oder
Staging-Abnahme. Voraussetzung ist die unveränderte Foundation aus Phase 3.4a.

Neue Dateien:

- `supabase/migrations/20260918120000_add_generic_dice_roll_rpc.sql`
- `supabase/tests/generic_dice_roll_rpc_security.sql`
- `tests/generic-dice-rpc.test.mjs`
- diese Dokumentation

## Vertrag und Security

```sql
public.send_round_dice_roll(
  p_round_id uuid,
  p_dice_count integer,
  p_dice_sides integer,
  p_modifier integer,
  p_client_request_id uuid,
  p_expected_active_character_id uuid
) returns jsonb
```

`SECURITY DEFINER`, leerer `search_path`, schemaqualifizierte Tabellen,
Hilfsfunktionen und aufgerufene PostgreSQL-Funktionen. `authenticated` bekommt
`EXECUTE`; `PUBLIC` und `anon` werden explizit ausgeschlossen. Es gibt keine neuen
Tabellenrechte, Policies, Trigger, Publikationen oder Client-Schreibwege.

`auth.uid()` bestimmt den Autor. Runde und Request-ID dürfen nicht NULL sein.
Würfelzahl 1–50, Seiten 2–1000, Modifier −9999–9999 sind zwingende Integer-Eingaben;
NULL wird abgelehnt, nicht ergänzt oder begrenzt. Nur die erwartete Character-ID
darf gemäß der Senderlogik NULL sein. Ergebnisse, Summen, Snapshot, Absenderart,
Character, Body und Empfänger sind keine Client-Parameter.

Neue Würfe sind für aktuelle Mitglieder in `active` und `paused` erlaubt.
`archived` und `locked_at IS NOT NULL` verhindern neue Würfe auch für den GM.
Admin/Bewahrer erhalten ohne Mitgliedschaft kein Spielrecht.

| Aufrufer / Erwartung | Neuer Wurf |
| --- | --- |
| Spieler, eigener aktiver Character | Character-ID und Name des gesperrten Characters |
| Spieler, NULL | `CHAT_IDENTITY_CHANGED`, ohne aktiven Character `CHAT_NO_ACTIVE_CHARACTER` |
| GM, eigener aktiver Character | Derselbe Characterpfad wie beim Spieler |
| GM, NULL | `game_master`, Character NULL, Snapshot `Spielleitung` |
| Fremder, vorbereiteter, gelöschter oder rundenfremder Character | `CHAT_CHARACTER_UNAVAILABLE` |
| Eigener verfügbarer, aber nicht mehr aktiver Character | `CHAT_IDENTITY_CHANGED` |

`p_expected_active_character_id` beschreibt die Absicht beim Senden. Der RPC
vergleicht sie nach den Locks mit der aktuellen Mitgliedschaft. Ein zwischenzeitlicher
Wechsel von A auf B erzeugt keinen stillschweigenden Wurf als B. `FOR SHARE` hält
auch den verwendeten Characternamen bis zum Transaktionsende stabil.

## Idempotenz und Chat-Retry

Chat und Dice teilen weiterhin `UNIQUE(author_user_id, client_request_id)` sowie
den Advisory-Key `round-message-request:<author>:<client_request_id>` mit
`pg_catalog.hashtextextended(..., 0)`. Unterschiedliche Autoren dürfen dieselbe
UUID unabhängig verwenden. Ein neuer Wurf benötigt eine neue UUID.

Nach Parameterprüfung und Request-Lock folgt `can_read_round_messages(round_id)`
wie im Chat. Anschließend wird nach Autor und Request-ID gesucht. Ein vorhandener
Request muss dieselbe Runde und `kind = 'dice_roll'` haben; Detailzeile und alle
drei mathematischen Parameter müssen übereinstimmen. Ein Konflikt liefert
`22023 / CHAT_REQUEST_CONFLICT`. Ein Dice-Parent ohne Detail liefert
`22000 / DICE_STORED_ROLL_INCOMPLETE`; der RPC repariert ihn nicht durch Neuwürfeln.

Ein erfolgreicher Retry liest nur gespeicherte Daten: kein Random-Aufruf, keine
Sequenzvergabe, keine Inserts und keine erneute Bewertung des aktiven Characters.
Name, Absender und Ergebnisse werden nicht aktualisiert. Bestehende FK-Anonymisierung
bleibt wirksam, etwa `character_id = NULL` nach physischer Characterlöschung;
der historische Snapshot bleibt erhalten.

Ein Retry überlebt Umbenennung, Characterwechsel, Rollenwechsel und Archivierung,
solange der aktuelle Aufrufer weiter lesen darf. Entfernte Mitglieder dürfen nicht
wiederholen. In moderierten Runden verliert der Spieler bereits am Lesegate den
Zugriff; der GM darf seinen alten Wurf lesen, aber keinen neuen erzeugen. Es gibt
keine Admin-/Bewahrer-Ausnahme. Wie im bestehenden Chat entscheidet beim Retry der
aktuelle autoritative Lesecheck; neue Schreibvorgänge prüfen zusätzlich unter Locks.

Der ersetzte `send_round_message(uuid,text,uuid,uuid)` behält Signatur, Grants,
Validierung, Fehler, Locks und Schreibpfad bei. Nur die Retry-Bedingung ändert sich:

```sql
message.round_id is distinct from p_round_id
or message.kind is distinct from 'character_message'
or message.body is distinct from p_body
```

Damit können Dice-Requests mit NULL-Body nicht mehr versehentlich als Chat-Retry
erfolgreich sein. Beide Richtungen Chat → Dice und Dice → Chat werden getestet.

| SQLSTATE | Meldungen |
| --- | --- |
| `22023` | `CHAT_INVALID_REQUEST`, `DICE_INVALID_PARAMETERS`, `CHAT_REQUEST_CONFLICT`, `CHAT_CHARACTER_UNAVAILABLE`, `CHAT_NO_ACTIVE_CHARACTER`, `CHAT_IDENTITY_CHANGED` |
| `42501` | `CHAT_NOT_AUTHORIZED`, `CHAT_ROUND_LOCKED`, `CHAT_ROUND_ARCHIVED` |
| `22000` | `DICE_STORED_ROLL_INCOMPLETE` |

## Lock-Reihenfolge und gemeinsame Sequenz

Analysierte Vorlagen sind der aktuelle Chat aus
`20260915100000_allow_game_master_active_character_chat.sql`, der private
Assignment-Produzent aus `20260915120000`, GM-Transfer aus `20260916110000`,
manuelle Archivierung aus `20260916130000` und Löschvorbereitung aus
`20260918100000`. Characterwechsel und Moderation stammen aus `20260904130000`.

Die finale Reihenfolge für einen neuen Wurf lautet:

1. Authentifizierung und Parameterprüfung.
2. Request-Advisory-Lock.
3. Aktuelles Leserecht und vollständige Retry-Prüfung; erfolgreiche Retries umgehen den Schreibpfad.
4. Eigenes Profil `FOR KEY SHARE` vor Sequenz- und Zeilensperren.
5. Gemeinsamer `round-message-sequence:<round_id>` Advisory-Lock, Hash-Seed 0.
6. Erwarteter eigener, nicht gelöschter Character der Runde `FOR SHARE`, falls angegeben.
7. Runde `FOR SHARE`.
8. Eigene Mitgliedschaft `FOR SHARE`.
9. Erneute Prüfung von Membership, Status, Moderation und erwarteter Identität.
10. Würfelarray erzeugen und daraus die Summe berechnen.
11. `MAX(round_seq) + 1` über **alle** Nachrichten der Runde.
12. Parent und anschließend Detail einfügen, explizite JSON-Rückgabe bilden.

Der Profil-Lock schützt den Autor-FK früh und folgt der bestehenden Reihenfolge
von `prepare_user_deletion`. Assignment und Transfer nehmen benötigte Profile
vor dem gleichen Sequenz-Lock; Archivproduzenten nehmen ebenfalls Profil vor
Sequenz und Runde. Es wird kein später Profil-Lock hinzugefügt.

Chat, private und öffentliche Systemnachrichten und Würfe teilen eine Sequenz.
Der Definer sieht auch private Nachrichten anderer Empfänger. Sichtbare Lücken
sind deshalb korrekt. `UNIQUE(round_id, round_seq)` bleibt zusätzliche Absicherung.
Die Sequenz-Semantik setzt wie die bisherigen Produzenten API-Transaktionen mit
`READ COMMITTED` voraus. Advisory- und Zeilensperren gelten bis COMMIT/ROLLBACK.

## Randomness und atomare Speicherung

`supabase/config.toml` nennt PostgreSQL 17; die lokale Datei
`supabase/.temp/postgres-version` nennt `17.6.1.166`. Diese Projektmetadaten wurden
nur gelesen, nicht live gegen Staging verifiziert. PostgreSQL 17 dokumentiert
`random(integer, integer)` mit inklusiven Grenzen und gleichmäßiger Verteilung:
[PostgreSQL 17: Random Functions](https://www.postgresql.org/docs/17/functions-math.html#FUNCTIONS-MATH-RANDOM-TABLE).

Der RPC verwendet je Schleifendurchlauf `pg_catalog.random(1, p_dice_sides)` und
hängt den Wert an ein anfangs leeres `integer[]` an. Er erzeugt genau
`p_dice_count` Werte in ihrer Entstehungsreihenfolge, ohne Sortierung, eigene
Modulo-Abbildung, Seed-Parameter oder zusätzliche Zufallsabfrage für die Summe.
`raw_total` entsteht aus `SUM(unnest(rolled_results))`; `total` ist genau diese
Summe plus Modifier. Der Höchstwert 59999 passt problemlos in `integer`.

Die Quelle ist PostgreSQL-Pseudozufall, keine kryptographische Zusage. Ein
probabilistischer Fairness-Test ist kein Bestandteil der Sicherheitsvalidierung.
Der vorbereitete SQL-Test prüft vor den Fällen zusätzlich
`to_regprocedure('pg_catalog.random(integer,integer)')`; seine Ausführung auf dem
Zielsystem steht noch aus. Es gibt keinen stillen Fallback auf eine andere Quelle.

Parent und Detail entstehen in derselben RPC-Transaktion. Der Parent verwendet
`kind = 'dice_roll'`, `body = NULL`, `recipient_user_id = NULL`, den aktuellen
Autor, die gesperrte Identität und die gemeinsame Sequenz. Die sieben Detailfelder
kommen ausschließlich aus dem erzeugten Array und den geprüften Parametern.
Es gibt keinen Exception-Handler, der einen Insertfehler verschlucken könnte.
Ein fehlgeschlagener Parent erzeugt kein Detail; ein fehlgeschlagenes Detail rollt
auch den Parent zurück. Eine fehlgeschlagene Transaktion reserviert keine
persistierte Nachrichtensequenz. Ihr interner Zufallszustand ist kein Replay-Beleg;
maßgeblich sind ausschließlich erfolgreich gespeicherte Details.

## Rückgabe

Neue Würfe und Retries erreichen dieselbe abschließende `jsonb_build_object`-
Anweisung. Beispielwerte dienen nur zur Darstellung:

```json
{
  "id": "<message-uuid>",
  "round_id": "<round-uuid>",
  "round_seq": 42,
  "author_user_id": "<user-uuid>",
  "character_id": "<character-uuid>",
  "speaker_kind": "character",
  "speaker_name_snapshot": "Ada",
  "kind": "dice_roll",
  "body": null,
  "recipient_user_id": null,
  "client_request_id": "<request-uuid>",
  "created_at": "2026-09-18T12:00:00+00:00",
  "dice_roll": {
    "message_id": "<message-uuid>",
    "dice_count": 2,
    "dice_sides": 6,
    "modifier": 3,
    "results": [2, 6],
    "raw_total": 8,
    "total": 11
  }
}
```

Alle Felder sind explizit freigegeben. Interne `%rowtype`-Variablen und
`RETURNING * INTO` werden nicht automatisch zu JSON serialisiert. Erweiterungen
der Tabellen exponieren somit keine zusätzlichen Felder. Eine weitere
Client-Abfrage ist für den Sendebeleg nicht erforderlich.

## Vorbereitete SQL-Tests

`supabase/tests/generic_dice_roll_rpc_security.sql` ist ein isoliertes
`BEGIN`/`ROLLBACK`-Skript für eine später freigegebene Testdatenbank mit allen
Migrationen bis 3.4b. Setup und kontrollierte Fehlerbedingungen benötigen eine
privilegierte Rolle; RPC-Fälle laufen als `authenticated` mit gesetzter User-ID,
der anonyme Negativfall als `anon`. Bei Abbruch einer interaktiven Sitzung muss
die Transaktion explizit zurückgerollt werden.

Abgedeckt sind 1d6, 5d6, 2d6±3, maximale/minimale Parameter, NULL- und
Bereichsfehler, vollständige Gleichheit mit gespeicherter Hülle und geordnetem
Array, **exakte** Array-Summe, Idempotenz und neue UUID, alle Parameter-/Runden-
und Typkonflikte sowie fehlende Details. Fehlerhelfer prüfen SQLSTATE und bei
RPC-Fehlern die Meldung sowie unveränderte Parent-/Detailzahlen.

Weitere Fälle prüfen Spieler-/GM-Identitäten, fremde/vorbereitete/gelöschte/
rundenfremde Characters, aktive Auswahl und Umbenennung, GM-Rollenverlust,
Status, Moderation, Nichtmitglieder, Admin/Bewahrer, entfernte Mitgliedschaft und
anonyme Aufrufe. Normale Chat-Retries, Bodykonflikte und beide GM-Chatmodi bleiben
als Regression enthalten.

Eine eigene Runde durchläuft reale Produzenten: Chat → Dice → private
Characterzuweisung → Dice → öffentliche Archivmeldung, mit Sequenzen 1–5.
Für Atomarität erzwingt ein temporärer `NOT VALID`-CHECK im Savepoint einen
**bestimmten** Detail-Constraintfehler nach dem Parent-Insert. Danach müssen
Parent-/Detailzahlen und MAX-Sequenz unverändert sein. Nach Rücknahme des CHECKs
funktioniert derselbe Request mit der unmittelbar nächsten Sequenz.

## Spätere Concurrency-Abnahme – nicht ausgeführt

Je Fall zwei unabhängige Sessions mit `BEGIN`, `READ COMMITTED` und passenden
User-Claims verwenden. Session A führt den genannten RPC aus und lässt ihre
Transaktion offen; B startet die Gegenoperation. Beide Startreihenfolgen sowie
COMMIT und ROLLBACK von A prüfen. Lock-Wartezustand und finale Daten kontrollieren;
keinen Timing-Sleep als Nachweis verwenden. Fehler in B mit ROLLBACK bereinigen.
Alle Zählungen/Sequenzen abschließend mit privilegierter Lesesession prüfen,
damit private Nachrichten nicht fehlen. Keine Produktionsfixtures verwenden.

| Fall | Konkrete Gegenoperation und erwartetes Verhalten |
| --- | --- |
| 1. Dice ↔ Dice, verschiedene UUIDs | Gleiche Runde, auch verschiedene Autoren: B wartet am gemeinsamen Sequenz-Lock. Nach A-COMMIT zwei vollständige Würfe mit aufeinanderfolgenden Sequenzen; nach A-ROLLBACK nur B mit nächster freier Sequenz. |
| 2. Dice ↔ Dice, gleiche UUID | Gleicher Autor und gleiche Parameter: B wartet am Request-Lock. A-COMMIT führt zu exakt gleichem Beleg und nur einem Parent/Detail; A-ROLLBACK lässt B einmal neu erzeugen. Als Variante geänderte Parameter: Konflikt nach A-COMMIT. |
| 3. Dice ↔ Chat | Verschiedene UUIDs derselben Runde: beide teilen den Sequenz-Lock, erzeugen je genau einen Event; nur Dice besitzt Detail. Beide Reihenfolgen und Rollback ohne persistierte Lücke prüfen. |
| 4. Chat ↔ Dice, gleiche UUID | Gleicher Autor: gemeinsamer Request-Lock. A-COMMIT lässt B in beiden Richtungen mit `CHAT_REQUEST_CONFLICT` scheitern, ohne zweite Nachricht. A-ROLLBACK erlaubt den anderen Typ. |
| 5. Dice ↔ active_character switch | A → B per `set_active_character(B)`, Dice erwartet A. Switch zuerst committed: Dice meldet `CHAT_IDENTITY_CHANGED`. Dice zuerst: Membership-SHARE hält Switch bis zum Abschluss auf; Wurf bleibt A. Switch-Rollback erhält A. |
| 6. Dice ↔ GM transfer | `transfer_game_master(round,newGM)` teilt Sequenz-Lock und sperrt Memberships. Transfer zuerst: ehemaliger GM darf NULL nicht mehr als Narration verwenden; eigener aktiver Character bleibt bei passender Erwartung zulässig. Dice zuerst: alter Rollenbeleg bleibt historisch korrekt. Transfer-Rollback lässt alte Rechte bestehen. |
| 7. Dice ↔ Archive | `set_round_archived(round,true)` bzw. `update_round(...,'archived')` teilt Sequenz-Lock. Archiv zuerst committed: kein neuer Wurf. Dice zuerst: Wurf vor öffentlicher Archivmeldung. Archiv-Rollback erlaubt den Wurf ohne persistiertes Archivevent. |
| 8. Dice ↔ Moderation Lock | Bewahrer ruft `set_round_locked(round,true,reason)` auf. Round-UPDATE kollidiert mit Dice-SHARE; kein zusätzlicher Sequenz-Lock im Moderations-RPC. Lock zuerst committed: kein neuer Wurf; bei bereits passiertem Lesegate greift die gesperrte Statusprüfung. Dice zuerst: Wurf beendet sich vor Sperre. Rollback lässt Schreiben zu. |
| 9. Dice ↔ prepare_user_deletion | Admin/Bewahrer bereitet Löschung des würfelnden Spielers bzw. GM vor. Profile-UPDATE kollidiert mit frühem Dice-KEY-SHARE, bevor Dice Sequenz/Character/Runde/Membership hält. Dice zuerst: Beleg bleibt, Cleanup folgt. Deletion zuerst committed: kein neuer Wurf wegen entfernter Mitgliedschaft/Characterzuordnung; beim GM zusätzlich automatisches Archivevent. Deletion-Rollback erlaubt den Wurf. Keine neue zyklische Lock-Reihenfolge. |

Für neue Würfe erwarten wir keine Deadlocks oder halben Events. Die Matrix ist
ein vorbereiteter Abnahmeplan, kein bereits erbrachter Parallelitätsnachweis.

## Lokale Validierung und verbleibender Scope

Die statischen Node-Tests prüfen Funktionsvertrag, ACLs, Schlüssel und Lock-Reihenfolge,
Retry-Pfad, minimale Chat-Änderung, unveränderte Sender-/Statussemantik,
Randomness-Pfad, exakte Summenquelle, Parent-/Detail-Zuordnung und JSON-Allowlist.
Die SQL-Coverage-Assertions ersetzen keine tatsächliche SQL-Ausführung.

Ausgeführte lokale Prüfungen:

- Gezielte Suite (`generic-dice-rpc`, `dice-roll-foundation`, `round-chat-security`):
  **65/65 bestanden**, darin 14 neue 3.4b-Tests.
- Gesamte relevante Node-Suite: **198/198 bestanden**, keine übersprungenen Tests.
- ESLint für `tests/generic-dice-rpc.test.mjs`: **0 Fehler, 0 Warnungen**.
  Verwendet wurde `@eslint/js` recommended mit explizitem MJS-Dateimuster, weil
  die Projektkonfiguration auf TS/TSX-Dateien beschränkt ist.
- `git diff --check` und zusätzliche Whitespace-Prüfung der vier neuen,
  noch ungetrackten Dateien: ohne Befund.
- SHA-256-Abgleich mit dem Ausgangsstand: bestehende Migrationen, vorhandene
  Chat-/Foundation-Tests und 3.4a-Dokumentation unverändert.

Node-Aufrufe:

```sh
node --test --test-isolation=none --test-reporter=spec tests/generic-dice-rpc.test.mjs tests/dice-roll-foundation.test.mjs tests/round-chat-security.test.mjs
node --test --test-isolation=none --test-reporter=spec tests/*.test.mjs
```

Ein Frontend-Build ist für ausschließlich SQL, MJS-Tests und Dokumentation nicht
notwendig; TypeScript und UI bleiben unverändert.

Keine Staging-Verbindung, SQL-Ausführung, Dry Run, `db push`, Migration Repair,
Commit oder Push. Die bestehenden Migrationen einschließlich 3.4a bleiben unverändert.

Phase 3.4c bleibt vollständig offen: TypeScript-Datentypen, Fetch-Embedding,
Chat-Rendering, Eingabe/Parser, Realtime, Pagination, Unread und erneutes Würfeln.
Secret Rolls, systemspezifische Würfel und Phase 3.5 sind ebenfalls nicht enthalten.
