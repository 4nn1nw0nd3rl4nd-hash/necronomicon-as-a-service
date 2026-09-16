# Phase 3.3b2 – atomarer GM-Transfer mit öffentlicher Systemnachricht

Die Migration `20260916110000_emit_game_master_transfer_messages.sql` ersetzt ausschließlich `public.transfer_game_master(p_round_id uuid, p_new_game_master_id uuid) RETURNS void`. Sie folgt auf die 3.3b1-Constraint-Migration. `SECURITY DEFINER`, leerer `search_path` und die durch `CREATE OR REPLACE` erhaltenen Execute-Grants bleiben bestehen. Es gibt keinen neuen Request-ID-Parameter.

## Transaktion und Locks

Nach Auth-/Parameterprüfung gilt diese Reihenfolge:

1. Caller- und Zielprofil: `FOR KEY SHARE`, nach UUID sortiert. `IN` dedupliziert Selbsttransfer; geprüft werden genau ein beziehungsweise zwei vorhandene Profile.
2. `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('round-message-sequence:' || p_round_id::text, 0))`.
3. Runde: `FOR SHARE`; Existenz und `locked_at` prüfen.
4. Caller-Membership: über Runde und `auth.uid()` ermitteln, `FOR UPDATE`; danach verbindlich `role = 'game_master'` prüfen.
5. Selbsttransfer ablehnen.
6. Ziel-Membership: über Runde und Ziel-ID ermitteln, `FOR UPDATE`; danach Existenz und `role = 'player'` prüfen.
7. Ziel-Username aus `profiles.username` lesen.
8. Caller demotieren, dann Ziel promoten; für jedes Update exakt eine betroffene Zeile prüfen.
9. `MAX(round_seq) + 1` über alle Nachrichten der Runde bestimmen, öffentliche Systemnachricht einfügen.

Die Demotion vor der Promotion erhält den Unique-Index für genau höchstens eine Spielleitung. Es gibt keine späteren Lock-Upgrades, neuen Trigger oder Änderungen an Charakter-/Active-Character-Regeln. Ohne Exception-Handler lässt jeder Fehler beide Rollenupdates und den Insert zusammen zurückrollen. Auch ein Fehler erst beim Message-Insert darf keinen Teiltransfer hinterlassen.

Statischer Vergleich der unveränderten anderen Pfade:

| Pfad | Relevante Lock-Reihenfolge |
| --- | --- |
| `send_round_message` | Request-Advisory → Autorenprofil KS → Sequence → optional Charakter S → Runde S → Membership S |
| `assign_prepared_character_internal` | Profile KS → Sequence → Charakter U → Runde S → GM-Membership (S, bei Selbstzuweisung U) → Ziel-Membership U |
| neuer Transfer | Profile KS → Sequence → Runde S → Caller-Membership U → Ziel-Membership U |

Namespace und Hash entsprechen den beiden anderen Nachrichtenproduzenten. Private Nachrichten gehen in die gemeinsame Sequenz ein. Die frühen Profil-Locks berücksichtigen den profilbasierten Löschpfad; eine neue `deletion_pending_at`-Produktregel wird nicht eingeführt. Dieser statische Vergleich ersetzt keine Parallelitätstests, insbesondere gegen `prepare_user_deletion`.

## Nachricht und bestehende Produktregeln

Jeder erfolgreiche Transfer erzeugt genau eine Nachricht mit `round_id = p_round_id`, der nächsten `round_seq`, `kind = 'system_message'`, `speaker_kind = 'system'`, `speaker_name_snapshot = 'System'` und serverseitiger zufälliger `client_request_id`. `author_user_id`, `recipient_user_id` und `character_id` sind alle NULL. ID und Zeitstempel stammen aus den bestehenden Defaults.

Der Body lautet `@<username> ist jetzt Spielleitung.` und wird ausschließlich serverseitig erzeugt. Der gespeicherte Text ist ein historischer Snapshot, kein aktueller Profilverweis. Spätere Username-Änderungen ändern ihn nicht. Die drei NULL-FKs verbinden ihn mit keinem Account oder Charakter; eine spätere Accountlöschung löscht deshalb diese öffentliche Nachricht nicht über deren FKs. Eine echte Accountlöschung wird in diesem Schritt nicht getestet.

Die unveränderte SELECT-RLS verlangt normalen Round-Lesezugriff; private Nachrichten bleiben zusätzlich empfängergebunden. Admin-/Superadmin-Rollen erhalten keinen Sonderzugriff. Frontend, Realtime, Pagination, Unread, Policies, Constraints und andere RPCs bleiben unverändert.

Transfers bleiben in `active`, `paused` und `archived` möglich, bei Moderationssperre nicht. Die Chat-Sendebeschränkung für archivierte Runden wird ausdrücklich nicht übernommen. Ein unmittelbarer Retry des alten GM scheitert an der aktuellen Rolle unter Membership-Lock und erzeugt keine zweite Nachricht. Das ist keine allgemeine Request-Idempotenzgarantie: Nach einer späteren Rückübertragung kann derselbe Nutzer wieder einen neuen gültigen Transfer ausführen.

## Username-Länge

`20260826090937_create_profiles.sql` definiert `username text NOT NULL` mit einem eindeutigen Index auf `lower(username)`, aber ohne explizite Maximallänge. Die weiteren Migrationen ergänzen keine solche Begrenzung. `RegisterPage.tsx` prüft den getrimmten Namen auf Leerheit; das Eingabefeld hat kein `maxLength`. Damit besteht keine fachliche Garantie, dass der erzeugte Body unter dem bestehenden 4000-Zeichen-Limit bleibt. Technische Indexgrenzen sind kein Ersatz dafür.

Es wird weder gekürzt noch eine neue Profilregel eingeführt. Ein theoretisch zu langer Body scheitert am vorhandenen Constraint und rollt den gesamten Transfer zurück.

## Tests und Grenzen

`supabase/tests/round_messages_security.sql` bleibt ein `BEGIN … ROLLBACK`-Test ohne Accountlöschung. Neue isolierte Fixtures prüfen den realen RPC: Rollenwechsel, genau eine öffentliche Nachricht samt Snapshot/Sequenz, ungültige Ziele einschließlich Selbsttransfer und fehlendem Profil, unberechtigte Caller einschließlich administrativer Accounts, unmittelbaren alten-GM-Retry, späteren Username-Wechsel, Statusregeln und Moderationssperre.

Der Rollbacktest setzt eine isolierte Nachricht auf die vorhandene Sequenzobergrenze `9007199254740991`. Der nächste Insert muss mit CHECK-Verletzung `23514` scheitern. Anschließend werden beide ursprünglichen Rollen, genau eine Spielleitung und die unveränderten Nachrichtenanzahlen geprüft. Der Fehler wird allein vom vorhandenen Testhelper in einer Exception-Subtransaktion abgefangen, nicht vom produktiven RPC.

Bei den bisherigen Assignment-Tests ist nach dem Transfer die Gesamtzahl jetzt vier (drei unveränderte private Nachrichten plus eine öffentliche). Die anschließende private Zuweisung hat Sequenz fünf statt vier. Eine zusätzliche Assertion prüft die öffentliche Sequenz vier direkt nach den drei privaten Nachrichten. Die früheren Transfer-Aufrufe in den Retry-Tests benötigen keine gelockerten Assertions: Dort wird anhand der jeweiligen Request-ID geprüft; die anfängliche exakte Sequenzprüfung liegt vor diesen Transfers.

Die neuen Node-Tests prüfen statisch Signatur, Security, exakt geordnete Locks, Rollenprüfungen unmittelbar nach den Locks, beide Update-Zeilenanzahlen, das vollständige Insert-Feldmapping, den serverseitigen Body und gemeinsame Sequenzberechnung. Die Source-Prüfungen der SQL-Testfälle beweisen deren Ausführung nicht. Auch die statischen RPC-Prüfungen ersetzen weder einen PostgreSQL-Parser noch Laufzeit-/Race-Tests.

SQL-Integrationstests, Staging-Anwendung, echte Parallelitäts- und Realtime-Tests werden in diesem Schritt nicht ausgeführt. Phase 3.3b3 bleibt erforderlich: unabhängige Sessions für Transfer gegen Transfer, Send, Assignment, Membership-Entfernung, Moderationsänderung und Accountlöschung sowie sichtbare öffentliche Nachrichten und private Isolation über Realtime. Keine manuelle Private-Message-Funktion oder Rundenstatus-Systemnachrichten sind Bestandteil dieses Schritts.

Lokal ausgeführt am 16.09.2026:

- `node --test tests/round-chat-security.test.mjs tests/realtime-round.test.mjs`: beide Testdateien erfolgreich, keine Fehler.
- `npm run build`: erfolgreich; Vite meldet die Bundle-Größenwarnung für den JavaScript-Chunk über 500 kB.
- `npm run lint`: erfolgreich, keine ESLint-Meldungen.
- `git diff --check`: erfolgreich.
- Statisches Review der neuen RPC-Definition, der SQL-Testzustände und des Diffs: Änderungen auf diese Phase beschränkt; bereits vorhandene 3.3b1-Arbeit bleibt erhalten. Kein SQL, Dry Run, `db push`, Commit oder Push ausgeführt.
