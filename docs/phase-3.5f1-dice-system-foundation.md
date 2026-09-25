# Phase 3.5f1: Datenbankfundament für Würfelsysteme

## Datenvertrag

Charaktervorlage und Würfelsystem sind unabhängig. Die vorhandene
Charaktervorlagenversion bestimmt Aufbau und Inhalt des Bogens.
`rounds.dice_system` bezeichnet das aktuelle Würfelsystem einer Runde;
`round_message_dice_rolls.dice_system` ist der historische Snapshot jedes Wurfs.

Die additive Migration
`20260925100000_add_dice_system_foundation.sql` folgt auf
`20260919100000_preserve_game_master_narration_selection.sql`.
Beide neuen Spalten sind `text NOT NULL DEFAULT 'generic'` mit einem
benannten `CHECK (dice_system IN ('generic'))`. Der konstante Default setzt
auch für bestehende Zeilen den Wert generic, ohne frühere Felder zu ändern.
Die separate Backfill-Fixture prüft genau diesen Übergang mit der echten Migration.

Nur tatsächlich implementierte Systeme werden zugelassen. In dieser Phase ist
das ausschließlich generic. NULL, leerer String, andere Groß-/Kleinschreibung,
Whitespace, vaesen, splinter_portals und unbekannte Schlüssel sind ungültig.
Es gibt keine Normalisierung unbekannter Keys und kein PostgreSQL-ENUM.

## Setter, Autorisierung und bestehende Rundensemantik

`public.set_round_dice_system(p_round_id uuid, p_dice_system text) RETURNS void`
ist ein fokussierter SECURITY-DEFINER-RPC mit leerem `search_path`,
qualifizierten öffentlichen Objekten und expliziter Prüfung von `auth.uid()`.

Nur die unter den finalen Locks gelesene aktuelle GM-Mitgliedschaft erlaubt
die Änderung. Admin oder Superadmin allein reichen nicht. Spieler,
Nichtmitglieder, ehemalige GMs und Profile mit `deletion_pending_at` werden
abgewiesen. Der Setter emittiert keine Chatnachricht.

Der vorhandene `update_round`-Vertrag aus
`20260916130000_emit_manual_round_archive_messages.sql` erlaubt Einstellungen
in active, paused und archived; locked wird abgewiesen. Der neue Setter
übernimmt das unverändert. Archivierung allein verhindert daher keinen
Systemwechsel; eine Moderationssperre verhindert ihn.

Fehler: fehlende Authentifizierung, Profil oder GM-Recht sowie gesperrte/fehlende
Runde liefern SQLSTATE 42501; fehlende Round-ID oder ungültiges Würfelsystem
SQLSTATE 22023. Die Fehlertexte sind im SQL-Test ausdrücklich geprüft.

## Lockordnung und atomarer Snapshot

Geprüfte bestehende Reihenfolgen:

| Operation | Reihenfolge für relevante Locks |
| --- | --- |
| Dice-Send (neuer Wurf) | Request-Advisory → Profil KEY SHARE → Round-Sequence-Advisory → optional Character SHARE → Round SHARE → Membership SHARE |
| GM-Transfer | beteiligte Profile KEY SHARE in UUID-Reihenfolge → Sequence → Round SHARE → Memberships UPDATE |
| update_round / set_round_archived | Profil SHARE → Sequence → Round UPDATE → gegebenenfalls Membership SHARE |
| set_round_locked | Round UPDATE; keine nachfolgenden Profile-/Sequence-Locks |
| set_active_character | beteiligte Profile SHARE mit Pending-Prüfung → Sequence → optional Character UPDATE → Round SHARE → Memberships UPDATE |
| prepare_user_deletion | Caller-Profil SHARE → Zielprofil UPDATE → alle GM-Sequence-Locks in Round-UUID-Reihenfolge → Round/Membership UPDATE → Cleanup |
| neuer Systemsetter | Caller-Profil SHARE mit Pending-Prüfung → Sequence → Round UPDATE → aktuelle Membership SHARE |

Der Setter verwendet ausschließlich die vorhandene Advisory-Domäne
`round-message-sequence:<round_id>`. Er benötigt weder Request-Lock noch
Character-Lock und erzeugt keine neue Lock-Domäne. Der frühe Profil-SHARE-Lock
verhindert eine Konkurrenz zur Account-Löschung, während später bereits
Sequence-/Round-Locks gehalten werden. Eine zuerst abgeschlossene
Löschvorbereitung scheitert danach an der Pending-Prüfung.

Transfer und Setter serialisieren an Sequence. Die GM-Rolle wird erst danach
unter Round-/Membership-Locks geprüft: Transfer zuerst bedeutet Ablehnung des
ehemaligen GM. Setter zuerst darf noch als aktueller GM abschließen; Transfer
folgt nach Freigabe. Die Moderationssperre serialisiert über Round UPDATE.

Der Dice-RPC hält Sequence und Round SHARE bereits vor der Erzeugung des
Parents. Aus genau diesem gesperrten `current_round.dice_system` wird der
Detail-Snapshot beim INSERT geschrieben. Zwischen Parent und Detail kann der
Setter die Runde deshalb nicht ändern. Es gibt keinen zweiten Snapshot-SELECT
und keinen zusätzlichen Trigger.

## Historie, Idempotenz und Antwortvertrag

Die Signatur des Dice-RPC mit sechs Argumenten bleibt unverändert.
Nach Rücknahme ausschließlich des neuen INSERT-Felds/-Werts und des neuen
Receipt-Felds ist sein ausführbarer Body identisch zur vorigen Version;
ein statischer Test überprüft das vollständig.

Retries prüfen weiterhin den bestehenden Autor-/Request-/Runden-/Parameter-
Vertrag und Leserechte. Sie lesen die gespeicherte Detailzeile vor dem
Neuwurf-Pfad. Ein Retry würfelt nicht erneut und liest kein aktuelles
Rundensystem für seinen Snapshot. Spätere Systemwechsel verändern keinen
historischen Wurf. Die normalen Clientrollen können Detailzeilen nicht ändern.

Die explizite JSON-Allowlist enthält nun zusätzlich
`dice_roll.dice_system` aus der gespeicherten Detailzeile, für Erstwurf und
Retry identisch. Der bestehende `decodeRoundMessage` liest bekannte Felder
und ignoriert zusätzliche; ein Test führt den unveränderten Decoder mit
beiden Antwortformen aus. Frontendtypen und Fetch-Projektion bleiben in 3.5f1
unverändert. Die vollständige Systemauswahl, Registry, UI, Typen und
Projektionen folgen in 3.5f2.

## RLS und Grants

Der neue Setter besitzt explizit EXECUTE für authenticated; PUBLIC und anon
werden explizit ausgeschlossen. Die existierenden Dice-RPC-Grants bleiben
erhalten.

Seit der kontrollierten Round-Edit-Migration haben Clientrollen keinen
tabellenweiten UPDATE-Grant auf rounds. Authenticated besitzt lediglich
UPDATE für name, system, description und appointment. Der neue Key gehört
nicht dazu. Zusätzlich entzieht die Migration explizit UPDATE auf beiden
neuen Spalten für PUBLIC, anon und authenticated. Andere Metadatenrechte
werden nicht verändert.

Die bestehende Round-UPDATE-RLS verlangt außerdem aktuelle GM-Mitgliedschaft
und eine ungesperrte Runde. Dice-Details bleiben SELECT-only über Parent-RLS.
Es gibt keine neue RLS-Policy, keine neuen Tabellen-Grants, keine
Realtime-Änderung und keine persistente Reroll-Verknüpfung.

## SQL-Tests und lokaler Dry Run

`supabase/tests/dice_system_foundation_security.sql` ist für eine isolierte
lokale PostgreSQL-17-/Supabase-Datenbank nach allen Migrationen vorgesehen.
Als postgres mit `psql -X -v ON_ERROR_STOP=1 -f <Datei>` ausführen.
Die Fixture wechselt für RPC-Aufrufe tatsächlich auf authenticated/anon und
setzt lokale Auth-Claims. Sie prüft Defaults, NULL-/Key-Constraints, ACLs,
direkte Update-Verweigerung, alle geforderten Rollen, Profil-Pending,
Status/Sperre, einen echten GM-Transfer, tatsächliche gespeicherte Snapshots,
identische Retry-Receipts und genau einen Parent/Detail. Alle Änderungen
enden mit ROLLBACK. Nach einem interaktiv abgebrochenen Fehler ebenfalls
ROLLBACK ausführen.

`supabase/tests/dice_system_foundation_backfill.sql` ist ein separater
Migrations-Dry-Run auf einer lokalen Wegwerf-Datenbank mit Schema bis
20260919100000, bevor 3.5f1 angewendet ist. Er legt historische Zeilen an,
führt die echte neue Migration per relativem psql-include aus und vergleicht
sämtliche vorherigen Row-Felder sowie die neuen generic-Snapshots.
Auch die DDL wird abschließend zurückgerollt. Auf bereits migriertem Schema
bricht er absichtlich ab; keine Spalten für diesen Test löschen.

Die bestehende 3.4b-SQL-Suite vergleicht Receipts mit den gespeicherten Rows;
das neue Snapshot-Feld ist nun in beiden enthalten. Alte Migrationen und
bestehende SQL-/Node-Tests werden nicht geändert.

Lokal wurde der Supabase-Status geprüft. Docker und Podman sind nicht
verfügbar; auch psql liegt nicht im PATH. Deshalb wurden die SQL-Fixtures und
der tatsächliche Migrations-Dry-Run hier nicht ausgeführt. Keine
Remote-Migration und keine Staging-Races. Statische SQL-Prüfungen sind kein
Ersatz für diese ausstehenden Datenbankprüfungen.

Ausgeführte lokale Validierung:

- Neue statische/Decoder-Tests: 10/10 bestanden.
- Neue und bestehende Dice-/Security-Suiten gemeinsam: 77/77 bestanden.
- Vollständige Node-Suite: 257/257 bestanden, keine übersprungenen Tests.
- ESLint für die neue MJS-Datei mit explizitem MJS-Dateimuster und
  `@eslint/js` recommended: 0 Fehler, 0 Warnungen. Die Projektkonfiguration
  richtet ihre Regeln regulär nur an TS/TSX-Dateien.
- `git diff --check` sowie zusätzliche Whitespace-/Konfliktmarker-Prüfung
  aller fünf neuen Dateien bestanden.
- Kein Build nötig: kein Frontendcode geändert. Kein Staging, Commit oder Push.

## Concurrency-Abnahmeplan (später, nicht ausgeführt)

Zwei unabhängige Sessions, READ COMMITTED, passende Auth-Claims und isolierte
Testdaten verwenden. A führt den jeweiligen RPC aus und lässt die Transaktion
offen, B startet die Gegenoperation. Warten über pg_locks/pg_stat_activity
prüfen, danach A committen oder zurückrollen. Beide Startreihenfolgen sowie
COMMIT und ROLLBACK testen. Abschließend gespeicherte Rows privilegiert lesen.

| Paar | A zuerst / B zuerst und erwartetes Resultat |
| --- | --- |
| Dice ↔ Setter | Beide warten am selben Sequence-Lock. Setter zuerst: neuer Wurf übernimmt das danach aktuelle System. Dice zuerst: sein gespeicherter Snapshot bleibt unverändert, Setter folgt. Keine halben Parent-/Detailzeilen; Retry liefert denselben historischen Snapshot. |
| Setter ↔ GM-Transfer | Setter zuerst darf als bisheriger GM abschließen. Transfer zuerst: ehemaliger GM wird nach Warten abgewiesen; neuer GM darf setzen. |
| Setter ↔ Archivierung | Gemeinsamer Sequence-Lock; beide Reihenfolgen erlaubt, weil archived weiterhin Settings erlaubt. Keine verlorene Statusänderung, kein zusätzliches Archivevent durch Setter. |
| Setter ↔ Moderationssperre | Round-Row-Lock: Sperre zuerst führt zur Setter-Ablehnung. Setter zuerst beendet Änderung vor Sperre. Nach Lock-Rollback ist Setter zulässig. |
| Setter ↔ prepare_user_deletion | Profil-Lock: Setter zuerst beendet vor Cleanup. Deletion zuerst führt nach COMMIT zur Ablehnung wegen Pending/entfernter Mitgliedschaft. Nach ROLLBACK bleibt GM berechtigt. Kein Zyklus durch gehaltene Sequence-Locks. |
| Setter ↔ set_active_character | Gemeinsamer Sequence-Lock; beide Richtungen erhalten System und aktive Identität unabhängig. |

Da aktuell nur generic zulässig ist, beweist der reale Test zunächst
Warteverhalten und unveränderte Snapshots. Ein beobachtbarer A→B-Systemwechsel
samt historischem Retry wird erst mit einer späteren Migration für ein zweites
implementiertes System geprüft. Für diesen Test jetzt keine Zukunfts-Keys
freischalten oder Constraints auf Staging lockern.

## Abgrenzung

Keine UI, Hooks für Systemwahl, Registry, Quick-Dice-Resets, Secret Rolls,
Vaesen-/Splinter-Portals-Logik, Änderungen am Reroll oder an
Charaktervorlagen. Vaesen und weitere Systeme werden erst nach eigener
Implementierung durch spätere Migrationen freigeschaltet.
