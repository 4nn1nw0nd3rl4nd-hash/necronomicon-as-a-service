# Phase 3.1 – Basis-IC-Chat

## Umfang und Dateien

Implementiert ist ausschließlich öffentlicher Textchat pro Runde in `/app/rounds/:roundId/play`. Die bestehende Rundenverwaltung und die drei Hauptreiter bleiben erhalten. Nachrichten sind für Clients unveränderlich.

Neu:

- `src/types/roundMessage.ts`: Nachrichtenmodell, 4.000-Zeichen-Grenze, Seitengröße 50.
- `src/hooks/useRoundMessages.ts`: autorisierte Initial-/Cursor-/Delta-Reads und ein Chat-Channel.
- `src/hooks/useSendRoundMessage.ts`: Entwurf, Sendesperre, Request-ID, Fehler und Cleanup.
- `supabase/migrations/20260914100000_create_round_messages.sql`: Tabelle, Constraints und Indizes, zunächst ohne Client-Zugriff.
- `supabase/migrations/20260914101000_secure_round_messages.sql`: spezifischer Lesehelper, SELECT-RLS und Send-RPC.
- `supabase/migrations/20260914102000_enable_round_messages_realtime.sql`: ausschließlich `round_messages` zur vorhandenen Publication hinzufügen.
- `supabase/tests/round_messages_security.sql`: transaktionales SQL-Integrationstestskript mit Rollback, noch nicht ausgeführt.
- `tests/round-chat-security.test.mjs`: ausführbare statische Security-/Migrationsprüfungen.
- Dieses Dokument.

Geändert:

- `src/pages/RoundPlayPage.tsx`: Nachrichtenstate oberhalb des Panels, aktuelle Mitgliedschaft und aktiver Sprecher, Zugriffsabgleich und Unread.
- `src/components/PlayModeHeader.tsx`: Unread-Anzeige; allgemeiner Vorschauhinweis entfällt, die Hauptinhalte bleiben als Platzhalter gekennzeichnet.
- `src/components/PlayChatPanel.tsx`: Verlauf, Pagination, Composer, Scrollverhalten und bestehendes Desktop-/Mobile-Panel.
- `src/hooks/useRealtimeInvalidation.ts`: optionale INSERT-only-Subscription und Replication-ready-Reconciliation; bestehende UPDATE-/INSERT+UPDATE-Aufrufer bleiben kompatibel.
- `src/style.css`: begrenzte Verlaufshöhe, Textnachrichten, Composer, Fokus und Unread.
- `tests/realtime-round.test.mjs`: bestehende Harness erweitert und Chat-/Lifecycle-Regressionstests ergänzt; Publication-Erwartung um die einzige neue Tabelle erweitert.

Keine Dependency, kein Commit/Push, keine Migration ausgeführt und kein db push. Die drei Migrationen müssen vor einem echten Chat-Test auf Staging separat geprüft und freigegeben werden.

## Vollständiges Nachrichtenschema

| Feld | SQL-Typ | NULL / Default / Bedeutung |
|---|---|---|
| `id` | uuid | PK, NOT NULL, `gen_random_uuid()` |
| `round_id` | uuid | NOT NULL; FK `rounds(id) ON DELETE RESTRICT` |
| `round_seq` | bigint | NOT NULL; 1 bis 9.007.199.254.740.991, damit JSON/JavaScript die Werte exakt abbilden |
| `author_user_id` | uuid | nullable; FK `profiles(id) ON DELETE SET NULL` |
| `character_id` | uuid | nullable; FK `characters(id) ON DELETE SET NULL` |
| `speaker_kind` | text | NOT NULL; nur `character` oder `game_master` |
| `speaker_name_snapshot` | text | NOT NULL; 1–100 Zeichen; bleibt historische Identität |
| `kind` | text | NOT NULL; Default und einziger Wert `character_message` |
| `body` | text | NOT NULL; 1–4.000 Unicode-Zeichen, nicht ausschließlich Whitespace |
| `client_request_id` | uuid | NOT NULL; clientseitige Request-ID |
| `created_at` | timestamptz | NOT NULL; `now()` |

Zusätzlich: `UNIQUE(round_id, round_seq)`, `UNIQUE(author_user_id, client_request_id)`, GM-Constraint (`character_id IS NULL` und Snapshot `Spielleitung`), partieller FK-Index auf nichtleeren `character_id`. Der erste Unique-Btree deckt beide Cursor-Richtungen ab; der Author-Unique-Index auch den Author-FK. Keine Visibility-, Roll-, System-, Edit- oder Delete-Felder.

Die nullable Referenzen passen zur vorhandenen Accountlöschung über `auth.users → profiles` und zur physischen Charakterbereinigung. Kein Snapshot wird aus aktuellen Profil-/Charakterdaten für die Anzeige nachgeladen. Ein physisch gelöschter Charakter darf deshalb eine `character`-Nachricht mit `character_id = NULL` hinterlassen.

4.000 Unicode-Codepoints sind ausreichend für mehrzeilige IC-Beiträge, begrenzen aber einzelne Payloads auf höchstens etwa 16 KB UTF-8. Frontend und SQL prüfen dieselbe Whitespace-Menge; Zeilenumbrüche und der eigentliche Text werden unverändert gespeichert. React rendert den Body ausschließlich als Text. Es gibt kein HTML-/Markdown-Rendering.

## Schreiben, Identität und Reihenfolge

```sql
public.send_round_message(
  p_round_id uuid,
  p_body text,
  p_client_request_id uuid,
  p_expected_active_character_id uuid
) returns public.round_messages
```

Der Client schickt bei Spielern die angezeigte aktive Charakter-ID und beim GM `NULL`. Das ist nur eine Erwartungsprüfung: Autor, tatsächliche Rolle, aktive Charakter-ID, Besitzer, Runde, Löschzustand, Snapshot, Sequenz, UUID und Zeitpunkt bestimmt bzw. prüft der Server. Ein aktiver Charakterwechsel zwischen Anzeige und Sendung führt zu Ablehnung. Auch ein Rollenwechsel zwischen Spieler und GM erzeugt keine unbemerkte neue Sprecheridentität.

Zwei transaction-scoped Advisory Locks verwenden getrennte Namensräume:

1. `round-message-request:<auth.uid>:<client_request_id>` serialisiert gleiche Requests auch bei Wiederverwendung über verschiedene Runden.
2. `round-message-sequence:<round_id>` serialisiert neue Nachrichten pro Runde bis zum COMMIT. Nach Erwerb wird unter dem normalen API-Isolationsniveau READ COMMITTED `max(round_seq) + 1` ermittelt. Der nächste Sender kann erst nach Commit/Rollback weiterarbeiten. Es gibt keine globale Sequence und keinen vom Client vergebenen Cursor. Die Unique-Constraint bleibt eine zusätzliche Sicherung. Hash-Kollisionen verursachen lediglich zusätzliche Serialisierung.

Charakter, Runde und Mitgliedschaft werden vor dem INSERT erneut unter `FOR SHARE` geprüft. Die Reihenfolge Charakter → Runde → Mitgliedschaft entspricht vorhandenen Charakteraktionen. Damit stehen unter anderem Snapshot, aktive Auswahl, Eigentümer, Zuordnung, Rolle, Archiv und Lock während des Inserts fest. Konkurrenzkonflikte/Deadlocks führen zu einem Transaktionsfehler und einem sicheren Retry, nicht zu einem unautorisierten Insert. Bei manuell erhöhtem Isolationsniveau können zusätzlich Serialization-/Unique-Konflikte auftreten; die normale API verwendet READ COMMITTED.

Identische wiederholte Requests liefern die bereits gespeicherte Nachricht zurück. Eine andere Runde oder ein anderer Body mit derselben Author/Request-Kombination wird abgelehnt. Ein Replay prüft aktuelle **Leserechte**, führt jedoch keinen neuen Schreibvorgang aus: Es funktioniert auch nach Umbenennung, Charakterlöschung, Rollenwechsel oder Archivierung. Nach Verlust der Leserechte, insbesondere bei einem gesperrten Spieler, gibt es keine Replay-Ausgabe. Geänderte erwartete Charakter-ID überschreibt niemals eine bereits bestätigte historische Nachricht.

Lock-/Snapshot-Grundlagen wurden mit der [PostgreSQL-Dokumentation zu expliziten Sperren](https://www.postgresql.org/docs/18/explicit-locking.html) abgeglichen.

## Rechte und Rundenzustände

`can_read_round_messages(uuid)` prüft ausschließlich die aktuelle `round_membership` von `auth.uid()` und den Runden-Lock. `can_view_round()` und allgemeine Admin-/Bewahrerrechte werden ausdrücklich nicht verwendet.

| Zustand | Aktuelles Mitglied: Lesen | Spieler: Schreiben | Aktueller GM: Schreiben |
|---|---|---|---|
| active | ja | mit gültigem aktivem eigenen Charakter | als „Spielleitung“ |
| paused | ja | mit gültigem aktivem eigenen Charakter | als „Spielleitung“ |
| archived | ja | nein | nein |
| locked | ausschließlich aktueller GM | nein | nein |

Admin/Bewahrer ohne Mitgliedschaft: kein Chatinhalt und kein Senden. Ein administrativer Account mit Spieler-Mitgliedschaft erhält beim Lock ebenfalls keine Chat-Leserechte. Entfernte Mitglieder: keine weiteren autorisierten Reads. Es gibt keinen Account-/Username-Fallback.

Authenticated erhält nur SELECT auf der Tabelle. Keine direkten INSERT-/UPDATE-/DELETE-Grants oder Policies. Der Send-RPC autorisiert vollständig selbst. Beide SECURITY-DEFINER-Funktionen besitzen einen leeren `search_path`, qualifizierte Tabellen und ausschließlich gezielte EXECUTE-Freigaben für authenticated; PUBLIC/anon werden entzogen. Allgemeine Runden-/Adminrechte bleiben unverändert. Die RLS-/Grant-Trennung folgt den [Supabase-RLS-Grundlagen](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Laden und Realtime

- Initial: neueste 50 autorisierte Nachrichten per `round_seq DESC LIMIT 50`, im UI aufsteigend.
- Älter: `round_seq < ältester geladener Wert`, DESC/LIMIT 50, nach ID zusammenführen. Kein OFFSET.
- Neuer: `round_seq > sicherer Cursor`, ASC/LIMIT 50. Volle Delta-Seiten werden weiter abgearbeitet, bis der Rückstand aufgeschlossen ist. Ältere Seiten und Send-Receipts bewegen den Delta-Cursor nicht.
- Ein Chat-Channel je geöffnetem Spielmodus/Runde, ausschließlich INSERT auf `public.round_messages`, exakt nach `round_id` gefiltert.
- Events liefern keine direkt angezeigten Nachrichten. Sie bündeln sich über 100 ms und lösen neue autorisierte Reads aus.
- Nach SUBSCRIBED und zusätzlich nach der tatsächlichen Postgres-Replication-ready-Meldung wird nochmals abgeglichen. Der installierte SDK unterstützt dafür `broadcast.replication_ready`; dies ist eine Transportstatus-Option und erzeugt keine Chat-Systemnachrichten. Die zusätzliche Readiness-Meldung schließt auch die SDK-seitige Lücke zwischen WebSocket-Subscribe und einsatzbereitem Datenbanklistener. Siehe [Supabase zur Subscribe-/Listener-Lücke](https://supabase.com/docs/guides/troubleshooting/realtime-postgres-changes-troubleshooting#step-6-writing-right-after-subscribed). Ein bereits laufender Initial-/Delta-Read merkt weitere Invalidierungen und führt einen Folgeabruf aus. Das schließt die Initial-/Subscribe-Lücke.
- Focus, visible, online und erneutes SUBSCRIBED benutzen dieselbe vorhandene Reconciliation. Kein Polling, kein Komplettreload der Historie.
- Zusätzlich wird vor jeder Seite/Delta-Abfrage der Chat-Lesehelper aufgerufen. So ist eine entzogene Berechtigung von einer unveränderten, leeren Delta-Antwort unterscheidbar. Bestätigte Ablehnung entfernt den Cache. Temporäre Fehler erhalten den letzten bestätigten Verlauf.
- Round-/Accountwechsel, Unmount und StrictMode stoppen alte Listener, Timer und Reads. Eine lokale Zugriffsgeneration verhindert, dass eine ältere Pagination-Antwort nach bestätigtem Zugriffsverlust Daten zurückbringt. Verspätete Send-Antworten verändern weder neue Entwürfe noch Navigation oder Nachrichtenstate.

## UI, Scrollen und Unread

Desktop bleibt beim einklappbaren 380-px-Panel, mobil bis 48 rem beim nativen Modal mit Escape/Fokusführung. Nachrichten und Entwurf liegen oberhalb des Panels. Tabwechsel, Ein-/Ausklappen und Desktop-/Mobile-Wechsel starten deshalb keinen neuen Initialload und verlieren keinen Entwurf. Die Subscription bleibt im eingeklappten Spielmodus aktiv.

Jede Nachricht zeigt Snapshot, formatierten Zeitpunkt und reinen mehrzeiligen Body; die Spielleitung erhält einen dezenten Akzent. Der Composer zeigt die Sprecheridentität. Ohne gültigen aktiven Charakter, während der Berechtigungsprüfung, im Archiv oder bei Lock wird er mit Erklärung deaktiviert. Während eines Sends verhindert zusätzlich ein synchroner In-flight-Guard Doppelklicks. Enter sendet, Shift+Enter erzeugt einen Zeilenumbruch; IME-Komposition sendet nicht versehentlich. Text wird erst nach bestätigtem RPC-Erfolg geleert. Ein unbestätigter Retry behält die Request-ID, eine bewusst geänderte Nachricht erhält eine neue.

Beim Öffnen springt der Verlauf zum Ende. Wer höchstens 80 px vom Ende entfernt ist, folgt neuen Nachrichten automatisch. Weiter oben bleibt die Leseposition erhalten; „Neue Nachrichten“ führt zum Ende. Beim Voranstellen älterer Seiten wird die Höhenänderung ausgeglichen. Native Browser-Scrollanker sind dafür deaktiviert. Eingeklappte Chats zeigen die Anzahl neuer ungesehener Nachrichten. Der initial geladene Verlauf zählt nicht als neu.

## Vollständige manuelle Staging-Testmatrix

**Noch nicht ausgeführt.** Mindestens zwei getrennte echte Browser-Sessions verwenden: A Spieler mit aktivem Charakter, B GM derselben Runde; zusätzlich C zweiter Spieler und D Admin/Bewahrer ohne Mitgliedschaft. Erst nach separat freigegebenem Staging-Dry-Run und Migrationstest. Ergebnisse jeweils mit Browser, Rolle, Runde und Zeitpunkt protokollieren.

| Fall | Schritte | Erwartung |
|---|---|---|
| A – Spieler + GM | A/B öffnen denselben Spieltisch. A schreibt; B antwortet. | Beide sehen beide Nachrichten live, einmalig und in derselben Sequenz. A mit Charaktersnapshot, B als Spielleitung. |
| B – Zweiter Spieler | C tritt mit eigener Mitgliedschaft bei, alle drei senden. | Dieselbe öffentliche Chronik bei allen; keine kontoübergreifende Sprecherverwechslung. |
| C – Aktiver Charakter | A sendet, wechselt in der Verwaltung den aktiven Charakter, sendet erneut. Während eines verzögerten Requests nochmals wechseln. | Alter Snapshot bleibt, neue Nachricht nutzt neuen Charakter. Veraltete Erwartung wird abgelehnt. |
| D – Kein aktiver Charakter | Aktive Auswahl entfernen bzw. Runde mit mehreren Charakteren ohne Auswahl verwenden. UI und direkten RPC prüfen. | Composer mit Hinweis deaktiviert; RPC lehnt ab. Kein Username-Fallback. GM bleibt unabhängig von Charakterwahl. |
| E – Rename/Löschung | Charakter nach einer Nachricht umbenennen, erneut senden; anschließend aus Runde entfernen bzw. später physisch löschen. | Alte Namen unverändert; neue Nachricht neuer Name. Historie bleibt auch bei NULL-Referenz erhalten. |
| F – Archiv/Paused | Runde zunächst pausieren und senden; danach archivieren. Als Spieler und GM lesen/senden. | Pausiert: Senden möglich. Archiv: Verlauf lesbar, beide Sends serverseitig blockiert. Bereits bestätigter identischer Retry erzeugt keine neue Nachricht. |
| G – Lock | Bewahrer sperrt Runde, während A/B geöffnet sind. UI und direkte Reads/RPCs prüfen. | GM liest, niemand schreibt; Spieler erhält keine weiteren autorisierten Chatreads. Nach Entsperren/Fokusabgleich kommt erlaubter Zustand zurück. |
| H – Fremde Runde/Admin | D öffnet Play-URL, liest Tabelle und ruft RPC direkt auf. Dasselbe als Bewahrer. Optional Admin als Spieler einer gesperrten Runde. | Kein Chatinhalt ohne Mitgliedschaft. Kein Admin-/Bewahrer-Bypass beim Senden oder beim Lock. |
| I – Eingeklappt | A klappt Chat ein; B sendet mehrfach; A wechselt Hauptreiter und öffnet Chat. | Subscription bleibt aktiv; Unread-Zahl wächst; alle Nachrichten sofort vorhanden, kein neuer Initialload. |
| J – Pagination | Mehr als 50 Nachrichten erstellen. Ältere Seiten laden, während B neu sendet. | Stabile aufsteigende Sequenz, keine Duplikate, ältere Leseposition bleibt. Neue Nachrichten verschieben den älteren Cursor nicht. |
| K – Offline/Reconnect | A offline, B sendet mehr als 50 Nachrichten. A online; zusätzlich Focus/Visibility und WebSocket-Reconnect auslösen. | Delta wird seitenweise vollständig nachgeholt; bestehender Verlauf bleibt bei Fehlern. Kein Polling/Komplettreload. |
| L – Mobile | Bei 320/390/768 px Drawer öffnen, schreiben, schließen; B sendet; wieder öffnen und zwischen Reitern/Desktop wechseln. | Gemeinsamer Verlauf/Entwurf, Unread korrekt, keine horizontale Überbreite, Escape/Schließen funktioniert. |
| M – Inhalt und Retry | Leerraum, 4.000/4.001 Zeichen, Emoji, mehrzeiligen Text und HTML-/Markdown-Zeichen testen. Send-Antwort nach DB-Erfolg unterbrechen und unverändert wiederholen; doppelt klicken. | Grenzen konsistent; HTML bleibt Text; nur eine Nachricht pro Request. Bei Fehler bleibt Text. |
| N – Lifecycle/Zugriff | Bei laufendem Initialload, älterer Seite und Send ausloggen, Runde/Account wechseln oder navigieren. Mitgliedschaft entfernen; Focus/Read auslösen. Unter StrictMode wiederholen. | Alte Antworten verändern keinen neuen State. Bestätigter Zugriffsentzug entfernt Cache. Keine nachträgliche Navigation. |
| O – Scrollen | Am Ende neue Nachricht empfangen; dann oben lesen und weitere Nachricht empfangen; ältere Seite nachladen. | Nur am Ende automatisches Folgen. Oben kein Sprung, neuer Hinweis. Ältere Seite erhält sichtbaren Textausschnitt. |

Zusätzlicher SQL-Security-Test: `supabase/tests/round_messages_security.sql` nach Prüfung mit `psql --set ON_ERROR_STOP=1` ausschließlich in der Testumgebung ausführen. Er erzeugt temporäre IDs und Fixture-Accounts, simuliert authenticated-Sessions, prüft RPC/RLS/Grants/FKs und endet mit ROLLBACK. Einen vorhandenen Bewahrer verwendet er nur als Testidentität, ohne dessen Daten zu ändern. Keine Migration wird durch dieses Skript installiert.

### Echte Parallelität mit zwei DB-Sessions

Auf einer freigegebenen Staging-Test-Runde mit gültigen Mitgliedern:

1. A: `BEGIN`, `SET LOCAL ROLE authenticated`, eigenes JWT-Subject über `set_config('request.jwt.claim.sub', '<user-A>', true)`, Send-RPC mit UUID RA und aktivem Charakter; Transaktion danach noch **nicht committen**.
2. B: eigene Transaktion/Rolle/Subject, Send-RPC für dieselbe Runde mit anderer UUID RB. Der RPC wartet an der Runden-Sequenzsperre.
3. A committen; B darf danach fortsetzen und committen. Beide IDs müssen verschieden, beide Sequenzen eindeutig und B größer als A sein. Ein Delta ab dem vorherigen Cursor muss beide liefern.
4. Mit ROLLBACK von A wiederholen: B schreibt korrekt, keine uncommittete Nachricht wird zum Cursor.
5. Dieselbe Author/Request-UUID in zwei Sessions desselben Spielers senden: zweite Antwort enthält dieselbe Nachrichten-ID, die Zeilenzahl steigt nur um eins.
6. A bis zum Send-Commit offen lassen und parallel Runde archivieren/sperren bzw. Charakter wechseln/umbenennen: die Operationen müssen ordentlich warten oder mit einem wiederholbaren Transaktionskonflikt abbrechen. Kein Insert darf unter einem bereits verbindlich geänderten unzulässigen Zustand durchrutschen.

## Einschränkungen und spätere Phasen

- Migrationen, echte RLS-/RPC-Ausführung und Mehr-Session-/Parallelitätstests sind noch nicht durchgeführt. Statische Tests beweisen keine laufende Datenbankkonfiguration.
- Realtime kann Ereignisse für inzwischen ausgeschlossene Mitglieder wegen RLS unterdrücken. Die nächste autorisierte Reconciliation (z. B. Fokus, Online, Reconnect oder Retry) entfernt bestätigten unzulässigen Cache. Bereits zuvor rechtmäßig gelesene Daten lassen sich nicht rückwirkend vom Client zurückholen.
- Request-ID, Entwurf und Unread sind nur lokal für den geöffneten Spielmodus. Nach Navigation/Reload gibt es keine persistente Offline-Outbox. Eine nach Abbruch trotzdem serverseitig bestätigte Nachricht bleibt regulär in der Chronik.
- Nachrichtenrate, Anti-Spam, Suche und frei ziehbare Chatbreite sind nicht Teil dieser Phase. Umfangreiche nachgeladene Seiten bleiben bis zum Verlassen im Speicher.
- Kleine Fensterhöhen können Seitenscrollen erfordern. Der Nachrichtenverlauf selbst ist begrenzt und scrollbar.
- Phase 3.2+: NPC-/GM-Charakterauswahl; spätere getrennte Phasen für Würfel, Secret Rolls, Systemnachrichten, Edit/Delete, Anhänge, OOC, Reactions, Presence/Typing, Journal und Spieltisch. Nichts davon wurde vorimplementiert.

## Prüfstatus

- `npm run build`: erfolgreich. Vite meldet den bekannten Hinweis auf einen JavaScript-Chunk über 500 kB; aktueller Chunk 618,61 kB, gzip 167,72 kB.
- `npm run lint`: erfolgreich, keine Fehler oder Warnungen.
- `node --test --test-isolation=none --test-reporter=spec tests/*.test.mjs`: **117/117 erfolgreich** (110 bestehende/neue Hook-, UI- und Regressionstests, 7 statische Security-/Migrationsprüfungen).
- Browserprüfung mit temporärer React-Vorschau und simulierten Nachrichten: erfolgreich bei 320, 390, 768, 769, 1024, 1440 und 1920 px. Geprüft: Anfangsposition, Auto-Scroll, kein Sprung beim Lesen, ältere Seiten mit erhaltener Position, Unread/Toggle, reiner Text statt HTML, Senden/Fehlerentwurf und mobiler Dialog/Escape. Dies war kein Test gegen ein installiertes Chat-Backend. Die temporären Vorschau-Dateien sind entfernt.
- `git diff --check`: erfolgreich. Statisches Diff-Review abgeschlossen; Änderungen auf Phase 3.1 begrenzt. Insbesondere Zugriffsgeneration direkt am Merge, Reihenfolge-/Request-Locks, FK-Historie, fehlende Client-Schreibrechte und zusätzliche Replication-ready-Reconciliation geprüft.
- SQL-Integrationstest, echte Mehr-Session- und Datenbank-Parallelitätstests: **nicht ausgeführt**, wie vorgegeben. Die Migrationen bleiben ausschließlich Dateien.

**Einschätzung:** Nach statischem Review erscheinen die drei Migrationen bereit für einen separat freizugebenden Staging-Dry-Run. Das ist keine Bestätigung bereits geprüfter Laufzeit-RLS oder eine Produktionsfreigabe. Vor einem echten Chat-Rollout die SQL-Security-Tests und die manuelle Matrix einschließlich Parallelität und Replication-ready-Verhalten durchführen.
