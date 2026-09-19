# Persistente GM-Sprecherwahl

## Produktvertrag

- Player wählen ausschließlich eigene gültige Charaktere dieser Runde. Der
  Auswahl-RPC erlaubt ihnen kein explizites NULL.
- GMs wählen eigene Charaktere **und verwalten weiterhin die aktiven Charaktere
  anderer Rundenmitglieder**. Die Änderung betrifft jeweils die Owner-Membership.
- NULL betrifft ausschließlich die eigene aktuelle GM-Membership und bedeutet
  „Spielleitung“. Admin-/Bewahrerrechte ohne Membership erzeugen keine Ausnahme.
- `recalculate_active_character` bewahrt GM-NULL und gültige GM-IDs. Eine ungültige
  GM-ID wird geleert, ohne automatisch einen Ersatz zu wählen. Player behalten
  ihre bisherige Autoauswahl bei genau einem gültigen Charakter.
- Auswahl bleibt auch in pausierten/archivierten Runden erlaubt; `locked_at`
  verhindert sie weiterhin. Auswahl erzeugt keine Chat-/Systemnachricht.

Die Ursache des alten Verhaltens ist zweigeteilt: Die Chat-Auswahl schrieb zuvor
nur React-State, während der Lifecycle-Helper NULL auch bei GMs automatisch
ersetzen konnte. Ein reiner SELECT/Reload löst diesen Trigger nicht aus. Ein
behaupteter Datenbankwechsel von bereits gespeichertem NULL zu einer ID allein
durch Reload ist damit nicht nachgewiesen.

## RPC und Locks

Die noch nicht angewendete Migration
`20260919100000_preserve_game_master_narration_selection.sql` wird korrigiert;
es gibt keine zusätzliche Korrekturmigration.

`set_active_character(p_round_id uuid, p_character_id uuid)` verwendet:

1. Owner-Ermittlung ohne Row-Lock, ausschließlich als Kandidat.
2. Caller- und Owner-Profile in UUID-Reihenfolge `FOR SHARE`; beide müssen
   existieren und dürfen nicht bereits `deletion_pending_at` haben.
3. Gemeinsamer Advisory-Lock
   `hashtextextended('round-message-sequence:' || p_round_id::text, 0)`.
4. Bei Nicht-NULL Character `FOR UPDATE`, mit erneuter Prüfung von Owner,
   Runde und `deleted_at`. Geänderter Owner führt zur Ablehnung statt zu einer
   späten Akquisition eines weiteren Profil-Locks.
5. Round `FOR SHARE`, Existenz und Moderationssperre prüfen.
6. Caller-/Owner-Memberships in User-UUID-Reihenfolge `FOR UPDATE`.
7. Aktuelle Caller-Rolle, Ziel-Membership und erforderliches GM-Recht prüfen;
   anschließend ausschließlich die Ziel-Membership aktualisieren.

NULL überspringt Character-Locks und verwendet den Caller als Ziel. Die
Characterprüfung bleibt durch den gehaltenen Lock bis zum Update gültig.
Keine Autorisierung verwendet einen vor den Locks gelesenen GM-Status.

Die Reihenfolge **Character vor Round** bleibt absichtlich kompatibel mit den
vorhandenen Character-Lifecycle-Pfaden. Ein einfaches Umdrehen würde deren
Inversion nur verlagern. Die konkrete Konkurrenz mit Round-vor-Character in der
Löschvorbereitung wird stattdessen **vor allen diesen Row-Locks** ausgeschlossen:

| Konkurrierender Pfad | Gemeinsame Synchronisation |
| --- | --- |
| Chat, Dice, Prepared Assignment | Profile vor Sequence; derselbe Sequence-Key vor Character/Round/Membership |
| GM-Transfer | Profile vor demselben Sequence-Key; Rollenwechsel ist vor finaler Auswahlprüfung abgeschlossen oder wartet |
| Manuelle Archivierung / Round-Edit | Derselbe Sequence-Key vor Round-UPDATE-Lock |
| Löschvorbereitung von Caller oder Owner | Target-Profil UPDATE kollidiert bereits mit Auswahl-Profil SHARE; danach zusätzlich gemeinsame Sequence für GM-Runden |
| Character-Lifecycle | Character vor Round/Membership bleibt erhalten; keine neue Round-vor-Character-Akquisition |

Die Auswahl benötigt keine Sequenznummer, nutzt den bestehenden Key aber als
Transaktionssperre. Sie hält niemals einen Character-Lock, während sie auf
Profile oder diesen Advisory-Lock wartet. Dies ist eine statische Begründung für
die genannten Pfade, kein ausgeführter allgemeiner Deadlock-Nachweis.

Der alte `set_active_character(p_character_id uuid)` delegiert nach lesender
Rundenermittlung an den neuen RPC. Signatur, NULL-Ablehnung und GM-Verwaltung
bleiben erhalten. Das ist nötig, damit der alte Einstieg nicht weiterhin den
gleichen ungeschützten Character-vor-Round-Pfad anbietet. Beide Overloads haben
leeren `search_path`, explizites REVOKE für PUBLIC/anon und GRANT für authenticated.
Owner-/service_role-Grants werden nicht explizit verändert.

## Frontend und kanonischer Zustand

Die bestehende Character-Query lädt für GMs die eigenen gültigen Figuren dieser
Runde auch bei NULL. Aktiver Charakter und auswählbare Figuren sind getrennt.
Player behalten die ID-begrenzte Query. Keine zusätzliche Datenquelle oder
N+1-Abfragen. Die bestehende Character-Subscription wird für GMs auf den Owner
statt die aktive ID gefiltert und berücksichtigt INSERTs; die Zahl der
Subscriptions sowie Message-/Dice-Realtime bleiben unverändert.

Der Selector zeigt alle eigenen Figuren plus „Spielleitung“. Er persistiert
jeweils die konkrete ID oder NULL. Mount/Reload führen keinen Auswahl-Write aus.

Die lokale Auswahl gehört zu einer Request-Generation und einem
Round-/User-/Role-Scope. Während Write und anschließendem Membership-Refetch ist
sie sichtbar und weitere Auswahl gesperrt. Der Membership-Hook liefert dazu ein
Promise für einen Fetch, der **nach** der Invalidierung beginnt: Eine ältere
laufende Anfrage genügt nicht, ihr folgt ein zusammengefasster neuer Fetch.

Nach dessen Abschluss wird Pending bedingungslos entfernt, auch bei abweichendem
Serverwert oder fehlgeschlagenem Refetch. Danach gilt der letzte erfolgreich
gelesene Membershipzustand; weitere Reconciliation kann ihn aktualisieren.
RPC-Fehler entfernen Pending ebenfalls, ohne einen beim Klick gespeicherten
Servermodus zurückzuschreiben. Fehler erscheinen an der Auswahl und sperren den
kanonischen Chatsprecher nicht dauerhaft. Rollenwechsel/Unmount invalidieren
alte Completions. Bereits gestartete Chat-Sends behalten ihre ursprünglichen
Parameter; neue Sends verwenden NULL beziehungsweise die neue Character-ID.

## Lokale Prüfungen und Grenzen

- Verhaltenstests verwenden den echten Auswahl-Hook mit Backend-Mock, nicht
  einen pauschal erfolgreichen Persistenz-Stub. Hin-/Rückwechsel, mehrere eigene
  Optionen, Reload, beide Ladefolgen, konkurrierende Serverwerte in beiden
  Richtungen, Fehler, Rollenverlust und Refetch-Coalescing werden geprüft.
- Security-Node-Tests ergänzen statische Lock-/Revalidierungs-/Wrapperprüfungen.
- `round_messages_security.sql` enthält echte RPC-Tests für die Rollenmatrix,
  beide Overloads, Grants, ungültige/fremde Figuren, Lifecycle und Sperren.
  Die beiden `player_only`-Fixture-Erwartungen behandeln den überlebenden GM nun
  korrekt als NULL. Dice-RPC-Fixtures setzen GM-IDs bereits ausdrücklich und
  benötigen keine Anpassung.
- SQL und echte parallele DB-Aufrufe wurden hier **nicht ausgeführt**. Lokal
  stehen PostgreSQL-14-Binaries, aber keine eingerichtete Supabase-Testumgebung
  zur Verfügung. Node-Tests ersetzen diese Prüfung nicht.

## Reproduzierbarer Mehrsession-Testplan (noch nicht ausgeführt)

Erst in separat freigegebener isolierter Staging-/Testumgebung nach Anwendung der
Migration. Keine bestehenden G/U/V-Accounts benutzen. Benötigt werden drei
disposable Accounts G (GM), U und V (Player) sowie ein berechtigter Caller A für
Löschvorbereitung. G/U/V dürfen keine Runden oder Figuren außerhalb der Fixture
haben, da `prepare_user_deletion` kontoweit wirkt. Keine echte Accountlöschung
während der Messung.

Als postgres in einer Setup-Transaktion eine neue active/unlocked Runde R mit
Memberships G/U/V und zwei gültigen V-Figuren C1/C2 erstellen; V explizit auf C1
setzen. Zusätzlich eine eigene G-Figur CG und G-NULL vorsehen. Setup committen,
die erzeugten UUIDs dokumentieren. Für jede Richtung eine frische Fixture oder
vollständig wiederhergestellte Ausgangsfixture verwenden; nie einfach nach
committeter Löschvorbereitung weiterarbeiten.

In **beiden** Testverbindungen vor jedem Versuch (psql-Variablen R/G/U/V/C2/A
mit den dokumentierten UUIDs belegen):

```sql
begin;
set local lock_timeout = '10s';
set local statement_timeout = '20s';
set local role authenticated;
select pg_backend_pid();
select set_config('request.jwt.claim.sub', :'G', true);
```

**Auswahl gewinnt gegen Transfer:** Session 1 führt
`select public.set_active_character(:'R'::uuid, :'C2'::uuid);` aus und hält die
Transaktion offen. Session 2 führt als G
`select public.transfer_game_master(:'R'::uuid, :'U'::uuid);` aus. Den echten
Wait beobachten, dann Session 1 committen und anschließend Session 2 committen.
Erwartung: V hat C2, U ist GM, G Player; Auswahl erzeugt keine Message.

**Transfer gewinnt:** Session 1 führt den Transfer als G aus, hält offen;
Session 2 startet als G die Auswahl von V-C2. Nach beobachtetem Wait Session 1
committen. Session 2 muss mit `P0001` ablehnen und wird zurückgerollt. V bleibt
auf C1. Entscheidend ist die fremde Ziel-Membership: Eine eigene gültige Figur
dürfte G als inzwischen normaler Player weiterhin auswählen.

Beide Richtungen auch mit dem einparametrigen Auswahl-RPC wiederholen. Zusätzlich
NULL-Auswahl des alten G nach gewonnenem Transfer muss abgelehnt werden.

**Auswahl gewinnt gegen Löschvorbereitung:** Session 1 wählt C2 als G und hält
offen. Session 2 verwendet den JWT-Claim A und führt
`select public.prepare_user_deletion(:'G'::uuid);` aus. Es muss bereits am
G-Profil warten. Session 1 committen, anschließend Session 2 committen. Erwartung:
V behält C2, G-Membership ist entfernt, G-Figuren sind von R gelöst, R archiviert
und verwaist, genau eine Archivierungsmessage bei echter Neuarchivierung.

**Löschvorbereitung gewinnt:** Session 1 führt als A dieselbe Vorbereitung aus
und hält offen. Session 2 startet Auswahl als G. Es wartet vor dem Sequence- und
Character-Lock am Profil. Nach Commit von Session 1 muss Auswahl ablehnen;
Session 2 rollbacken. V bleibt auf C1, keine Teiländerung durch Auswahl.

Diese beiden Richtungen zusätzlich mit V als Löschziel wiederholen: Das prüft
den zweiten frühen Profil-Lock. Bei Deletion von V bleibt R aktiv (G ist GM),
V-Figuren verlassen R und V-Membership entfällt. Auswahl darf nach gewonnenem
Deletion-Commit niemals V wieder auswählen. Einmal den Blocker statt mit COMMIT
mit ROLLBACK freigeben: Der wartende Auswahl-Request darf dann vollständig
erfolgreich sein. Beide RPC-Signaturen abdecken.

Dritte Verbindung, ausschließlich lesend; `pid1`/`pid2` aus den Sessions:

```sql
begin read only;
select pid, wait_event_type, wait_event, pg_blocking_pids(pid)
from pg_stat_activity where pid in (:pid1, :pid2);
select pid, locktype, relation::regclass, mode, granted, classid, objid
from pg_locks where pid in (:pid1, :pid2)
order by pid, locktype, granted;
commit;
```

PID, Blocker, Wait-Event und gehaltene/ungewährte Locks vor der Freigabe
dokumentieren. Keine künstliche Pause bis über das Timeout hinaus. Nach jedem
Versuch Status/orphaned_at/locked_at, Membershiprollen/aktive IDs,
Character-Owner/Round-Zuordnung, deletion_pending_at und alle Messages prüfen.
Bei Deadlock, veralteter GM-Autorisierung oder Teilzustand stoppen und rollbacken.
Keine doppelte round_seq; Auswahl selbst erzeugt keine Message. Ein absichtlich
ausgelöstes Timeout ist kein bestandener Konkurrenztest.

Ergebnisse vor Cleanup protokollieren. Dann alle Testverbindungen committen oder
rollbacken. Als postgres nur die dokumentierten Fixture-IDs bereinigen:
Messages, Characters/Kopien, Memberships, Runden; ausschließlich disposable
Accounts anschließend entfernen. Null verbleibende Fixture-Rows und keine
offenen Testtransaktionen verifizieren. Keine dieser Staging-Aktionen wurde im
Rahmen dieses Fixes ausgeführt.
