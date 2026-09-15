# Phase 3.2b: GM als eigener aktiver Charakter

Die Migration `20260915100000_allow_game_master_active_character_chat.sql`
ersetzt ausschließlich `public.send_round_message(uuid, text, uuid, uuid)`.
Die Phase-3.1-Migrationen bleiben unverändert. `CREATE OR REPLACE` erhält die
bestehenden EXECUTE-Rechte. Keine Schema-, RLS-, Publication- oder Frontendänderung.

## Absendervertrag

- `player`: erwartete Charakter-ID muss gesetzt sein und der aktiven ID der
  aktuellen Mitgliedschaft entsprechen.
- `game_master` mit erwarteter ID `NULL`: Spielleitung, ohne Charakter-ID.
- `game_master` mit erwarteter ID: dieselben Charakterprüfungen wie für Spieler.
- Jede Charakteridentität muss existieren, dem Aufrufer gehören, derselben Runde
  zugeordnet und nicht gelöscht sein. Eigene inaktive, fremde, besitzerlose,
  rundenfremde und gelöschte Charaktere sind ausgeschlossen.
- Der Snapshot kommt aus dem gesperrten Charakterdatensatz; Autor bleibt
  `auth.uid()`. Es gibt keine automatische Ersatzidentität.
- Active/paused erlauben neue Nachrichten; archived/locked verbieten sie in
  beiden GM-Modi. Ein GM ohne aktiven Charakter kann weiterhin erzählen.

## Rollenwechsel, Sperren und Retries

Die aktuell gesperrte Mitgliedschaft entscheidet. Nach GM-Transfer gelten für
den bisherigen GM die Spielerregeln: eine alte Erzählerabsicht mit `NULL` wird
abgelehnt; ebenso eine erwartete ID A, wenn inzwischen B aktiv ist. Ist derselbe
eigene erwartete Charakter weiterhin aktiv, darf er als Spieler senden.

Die Reihenfolge bleibt unverändert: Request-Advisory-Lock, Retry-Prüfung,
Profile `FOR KEY SHARE`, Runden-Sequenz-Advisory-Lock, optional Character
`FOR SHARE`, Round `FOR SHARE`, Membership `FOR SHARE`, Rollen-/Aktivprüfung,
INSERT. Insbesondere bleibt der Profile-Lock vor den weiteren Schreibpfad-Locks
erhalten, passend zur Accountlöschung. Es werden keine zusätzlichen Locks
eingeführt.

Ein bestätigter Request wird weiterhin vor neuen Schreibprüfungen anhand von
Autor und Request-ID wiedergefunden. Runde und Text müssen übereinstimmen und
aktueller Lesezugriff muss bestehen. Die ursprüngliche Nachricht mit ursprünglichem
Snapshot wird zurückgegeben, auch nach Umbenennung, Charakter- oder Rollenwechsel.
Kein zweiter INSERT; kein nachträglicher Snapshot-Abgleich mit dem heutigen Namen.

## Hinweis für Phase 3.2c

Wenn der GM zwischen Spielleitung und aktivem Charakter umschaltet, muss eine
**neue Sendeabsicht eine neue `client_request_id` verwenden**. Ein Retry eines
unbestätigten Versuchs muss dessen ursprüngliche Request-ID, Text und erwartete
Charakter-ID behalten. Umschalten darf einen solchen Retry nicht stillschweigend
umdeuten. Der Server behandelt dieselbe Request-ID weiterhin als ursprünglichen
Request; er bindet sie nicht nachträglich an eine neue Absenderwahl.

## Prüfungen

- `tests/round-chat-security.test.mjs` prüft nun die aktuelle Migration, den
  gemeinsamen Aktivcharakter-Zweig und die Lock-Reihenfolge. Ein Vergleich mit
  Phase 3.1 stellt sicher, dass ausschließlich die Rollenverzweigung geändert ist.
- `supabase/tests/round_messages_security.sql` ergänzt GM-Erfolg, genaue
  Absenderfelder, verbotene IDs, fehlenden aktiven Charakter, Umbenennung,
  Charakterwechsel, echten GM-Transfer, Retry und archived/locked/paused.
  Bestehende Spielertests bleiben erhalten.
- Das SQL-Skript endet mit ROLLBACK. Es setzt die neue Migration voraus und wurde
  hier nicht ausgeführt: keine lokale PostgreSQL-/Docker-Laufzeit verfügbar.
  Gleichzeitige Transaktionen und Accountlöschung müssen weiterhin separat in
  einer isolierten Testumgebung geprüft werden; die Zustandswechsel im Skript
  laufen sequenziell.
- Lokal ausgeführt: `npm run build` erfolgreich (Vite meldet ein Bundle über
  500 kB), `npm run lint` erfolgreich und
  `node --test --test-isolation=none --test-reporter=spec tests/*.test.mjs` mit
  128/128 erfolgreichen Tests, davon 10 statische Chat-Security-Prüfungen.
  `git diff --check` und statischer Diff-Review sind unauffällig. Keine Migration
  wurde angewendet; kein Remote-SQL und kein `db push`.
