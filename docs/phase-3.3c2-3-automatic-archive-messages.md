# Phase 3.3c2-3 – automatische Archivierungsnachrichten

## Scope und bestehende Löschvorbereitung

Die Migration `20260918100000_emit_automatic_round_archive_messages.sql`
ersetzt ausschließlich
`public.prepare_user_deletion(p_user_id uuid) RETURNS void`.
Signatur, `SECURITY DEFINER`, `SET search_path = ''`, Owner und bestehende
EXECUTE-Grants bleiben erhalten. Grundlage ist die bisher letzte Definition in
`20260903140000_harden_admin_role_management.sql`.

Die Funktion bereitet die Accountlöschung vor; sie löscht weder `auth.users`
noch `profiles`. Die vorhandene Edge Function `delete-user` ruft sie mit dem
authentifizierten Nutzerclient auf, bevor sie die eigentliche Löschung ausführt.
Diese weitere Löschphase wird hier nicht verändert.

Unverändert gelten:

- Authentifizierter Admin darf reguläre Nutzer vorbereiten; der Bewahrer zusätzlich
  Admins. Ein normaler Nutzer ist nicht berechtigt. Selbstlöschung und Löschung
  des geschützten Bewahrers werden abgelehnt; fehlende Zielprofile ebenfalls.
- Caller-Profil wird zuerst mit **FOR SHARE**, Zielprofil danach mit **FOR UPDATE**
  gesperrt. Berechtigungen werden aus diesen gesperrten Zeilen gelesen.
- `deletion_pending_at = coalesce(deletion_pending_at, now())` erhält einen
  bestehenden Marker.
- Alle eigenen Charaktere des Zielnutzers werden aus ihren Runden ausgehängt,
  auch aus Runden, in denen er nur Spieler ist. Eigentümer bleiben bestehen.
  Die bestehenden Character-Trigger berechnen dabei die aktive Auswahl der
  jeweiligen Ziel-Mitgliedschaft unter deren UPDATE-Lock neu.
- Alle bestätigten GM-Runden werden archiviert und erhalten wie bisher
  `orphaned_at = now()`, auch bereits archivierte oder moderationsgesperrte
  Runden. Ein vorhandener Orphan-Zeitpunkt wird nach bestehender Semantik neu
  gesetzt, solange noch eine entsprechende GM-Mitgliedschaft vorhanden ist.
- Abschließend werden alle Mitgliedschaften des Zielnutzers entfernt.
  Runden mit bloßer Spieler-Mitgliedschaft werden nicht archiviert.
- Wiederholung nach erfolgreicher Vorbereitung findet keine GM-Mitgliedschaften
  mehr, erhält den Profilmarker und erzeugt keine weiteren Nachrichten.

## Multi-Round-Locks und Revalidierung

Alt:
Caller-Profil S → Zielprofil U / Löschmarker → GM-Runden und zugehörige
Mitgliedschaften U (nach Round-UUID) → eigene Charaktere / Lifecycle-Memberships
→ Archivierung/Verwaisung → Mitgliedschaften löschen.

Neu:
Caller-Profil S → Zielprofil U / unveränderter Löschmarker →
**alle** Sequence-Advisory-Locks der GM-Kandidaten nach Round-UUID →
GM-Runden und Mitgliedschaften U → eigene Charaktere / Lifecycle-Memberships →
pro bestätigter Runde Archivierung/Verwaisung und ggf. Nachricht →
Mitgliedschaften löschen.

Die erste Abfrage ermittelt nur Kandidaten, ohne Round-/Membership-Row-Locks.
`array_agg(round_id order by round_id)` bestimmt die Reihenfolge, einschließlich
bereits archivierter Runden. Eine vollständig abgeschlossene FOREACH-Schleife
nimmt alle Locks mit dem gemeinsamen Schlüssel:

```sql
pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'round-message-sequence:' || candidate_round_id::text, 0))
```

Erst danach liest ein Join aktuelle GM-Mitgliedschaft, existierende Runde,
Status und `orphaned_at` mit `FOR UPDATE OF round_to_lock, membership`.
Die Query ist auf bereits Sequence-gesperrte Kandidaten beschränkt und erneut
nach Round-UUID sortiert. Ein nicht mehr vorhandener oder nicht mehr als GM
berechtigter Kandidat wird nicht archiviert. Der gelesene Status entscheidet,
welche Runden eine neue Nachricht erhalten. `orphaned_at` bleibt bewusst kein
Ausschlusskriterium; die bestehende Verwaisungsregel gilt unverändert.

Das bereits vor der Kandidatensuche gehaltene Zielprofil-U-Lock serialisiert
Transfers zum/vom Zielnutzer gegen deren frühe Profil-KEY-SHARE-Locks. Neue
Memberships benötigen zudem den Profil-FK-Lock. Damit kann kein solcher
produktiver Pfad während dieser Operation unbemerkt eine weitere GM-Runde
hinzufügen. Die spätere Join-Abfrage verlässt sich dennoch nicht auf den früh
gelesenen Status oder die frühe Rolle. Es wird kein Sequence-Lock nachträglich
unter Round-, Membership- oder Character-Locks genommen.

## Nachricht und Atomarität

Nur ein unter Locks bestätigtes `status <> 'archived'` erzeugt eine neue
öffentliche Nachricht:

- `kind = 'system_message'`, `speaker_kind = 'system'`,
  `speaker_name_snapshot = 'System'`.
- Autor, Empfänger und Charakter sind NULL.
- Body exakt `Die Runde wurde archiviert.`; Request-ID serverseitige UUID.
- `coalesce(max(round_seq), 0) + 1` berücksichtigt unter dem gemeinsamen Lock
  sämtliche privaten und öffentlichen Nachrichten derselben Runde.

Bereits archivierte GM-Runden werden weiterhin verwaist, erhalten aber keine
zweite Archivierungsnachricht. Es gibt keine neue `locked_at`-Ablehnung.
Die Metadaten und Moderationssperren bleiben erhalten.

Profilmarker, Charakterbereinigung samt aktiver Auswahl, sämtliche Runden,
Nachrichten und Membership-Löschung liegen im selben RPC/Transaktionskontext.
Kein Exception-Handler schluckt Fehler. Ein Insertfehler in der zweiten oder
späteren Runde rollt auch die vorherigen Runden und Nachrichten zurück.

## Statischer Vergleich der konkurrierenden Pfade

| Pfad | Abgleich mit der neuen Löschvorbereitung |
| --- | --- |
| Chat-Send | Request-Lock → Profil KS → Sequence → ggf. Character S → Runde S → Membership S. Sends des Ziels warten schon am Profil; andere Sender derselben GM-Runde teilen den Sequence-Lock. Die Löschvorbereitung benötigt keinen Request-Lock. |
| Prepared Assignment | UUID-sortierte Profile KS → Sequence → Character U → Runde S → Memberships. Beteiligung des Zielnutzers serialisiert am Profil; ansonsten an der gemeinsamen Runde/Sequence. Keine späte Profil-Lock-Anforderung. |
| GM-Transfer | UUID-sortierte Profile KS → Sequence → Runde S → Memberships U. Transfer zum/vom Ziel blockiert vor Sequence an dessen Profil; eine vorher abgeschlossene Änderung wird bei der Kandidatensuche und Revalidierung berücksichtigt. |
| Pause/Fortsetzen / update_round | Caller-Profil S → Sequence → Runde U → Caller-Membership S. Gleiche Sequence-Reihenfolge; aktuelle GM-Rolle wird dort nach den Locks geprüft. |
| Manuelles Archivieren | Caller-Profil S → Sequence → Runde U → ggf. Caller-Membership S. Aktueller Status entscheidet nach Serialisierung: bereits manuell archiviert bedeutet keine zusätzliche automatische Nachricht. |
| Membership Removal | Runde S → Charaktere des zu entfernenden Spielers → dessen Membership. Kein Sequence- oder später Profil-Lock. Dieser RPC entfernt nur Spieler, nicht die bestätigte GM-Mitgliedschaft. In Spieler-Runden des Löschziels nimmt die Vorbereitung keinen Round-Lock; gemeinsame Character-/Ziel-Membership-Zeilen folgen derselben Bereinigungsrichtung. |
| Moderationssperre | Runde U, keine Sequence-/Membership-/späten Profil-Locks. Kann die Vorbereitung blockieren, fordert aber keinen von ihr später benötigten Sequence-Lock an. Automatisches Archivieren lehnt die Sperre nicht ab. |
| Zweite Accountlöschvorbereitung | Gleiches Ziel serialisiert am Zielprofil U. Unterschiedliche Ziele können wegen des eindeutigen GM pro Runde keine identischen aktuellen GM-Runden besitzen. Alle Kandidaten werden trotzdem konsistent UUID-sortiert gesperrt. Charakter- und Lifecycle-Bereinigung betreffen jeweils den eigenen Zielnutzer. Die Rollenmatrix verhindert gegenseitig berechtigte Admin-/Bewahrer-Löschung. |

Im statischen Vergleich dieser bestehenden einzelnen RPC-Pfade wurde kein
konkreter verbleibender Lock-Zyklus gefunden. Das ist **kein Nachweis durch echte
Paralleltests** und keine Aussage über beliebige vom Datenbankbetreiber
zusammengesetzte Mehr-RPC-Transaktionen oder die nachgelagerte physische
Accountlöschung. Die tatsächlich gehaltenen Locks, Wartezustände und Rollbacks
müssen später mit unabhängigen Sessions geprüft werden.

## Tests und Validierungsgrenzen

`supabase/tests/round_messages_security.sql` bleibt in BEGIN/ROLLBACK.
Alle neuen Zielaccounts und Runden sind isolierte Testfixtures; die vorhandenen
Security-Fälle bleiben erhalten. Keine physische Account-/Profillöschung.

Ergänzt sind:

- Einzelne active, paused und bereits archived GM-Runde; gesperrte active und
  paused GM-Runde; reine Spieler-Mitgliedschaft ohne Archivierung.
- Ein Ziel mit drei GM-Runden (active/paused/archived), je eigener Historie und
  unabhängigem Sequenzstand 10/20/30. Private Nachrichten bilden jeweils das
  Sequenzende. Exakte öffentliche Identität, Count, Status, Orphan-Markierung,
  Membership-/Character-Bereinigung und aktive Auswahl der verbleibenden Person.
- Admin → Nutzer, Bewahrer → Nutzer und Bewahrer → Admin; normaler Caller,
  Selbstlöschung, Admin → Admin, geschützter Bewahrer, NULL/fehlender Zielnutzer,
  nicht authentifizierter Caller. Abgelehnte Aufrufe bewahren vollständige
  Fixtures einschließlich Nachrichten.
- Wiederholung unverändert; verbleibendes Mitglied liest öffentliche Historie,
  Admin/Bewahrer bekommen kein Chatrecht, gesperrte Spieler behalten ihren
  Leseausschluss.
- Zwei UUID-sortierte GM-Runden: erste mit zulässiger Sequenz, zweite mit dem
  vorhandenen Sequenzmaximum. Der späte CHECK-Fehler wird in der bestehenden
  Exception-Untertransaktion aufgefangen. Vollständige JSONB-Zeilensnapshots
  vergleichen Profile, Runden, Mitgliedschaften inklusive aktiver IDs,
  Charaktere und Nachrichten. Nach Entfernen nur der Überlauf-Fixture gelingt
  derselbe Aufruf für beide Runden.

Die fünf neuen Node-Tests vergleichen vollständige normalisierte SQL-Blöcke,
insbesondere die gesamte unveränderte Berechtigungspräambel, Kandidatensuche
und vollständig abgeschlossene Sequence-Schleife, Revalidierung und
Änderungs-/Insert-Endblock. Sie prüfen außerdem die SQL-Testfixtures und deren
Rollback-Assertions. Der bestehende Test für 3.3c2-2 wird lediglich am folgenden
Phasenabschnitt begrenzt; seine Assertions bleiben erhalten.

Diese statischen Tests ersetzen weder PL/pgSQL-Ausführung noch SQL-/RLS- oder
Mehrsessiontests. In dieser Phase wird **kein SQL ausgeführt**: kein Staging,
Dry Run oder db push. Keine Frontend-, Realtime-, RLS-, Grant-, Recovery-,
update_round- oder set_round_archived-Änderung. Bestehende INSERT-Invalidierung
mit autorisiertem Refetch genügt für weiterhin leseberechtigte Clients.
Phase 3.3c3 und echte Parallelitäts-/Realtime-Tests sind nicht Bestandteil.

Lokale Ergebnisse: **174/174 relevante Node-Tests erfolgreich**, Build und ESLint
erfolgreich, `git diff --check` fehlerfrei. Vite meldet den bestehenden Hinweis
zum 621-kB-Chunk (500-kB-Grenze). Statisches Scope-Review: nur neue Migration,
SQL-Testergänzungen, zugehörige Node-Assertions und diese Dokumentation;
vorhandene Änderungen früherer Phasen bleiben unberührt.

## Nachtrag: EXECUTE-Grants absichern

Auf Staging wurde ein expliziter EXECUTE-Grant für `anon` festgestellt.
`REVOKE ... FROM PUBLIC` entfernt keinen separat an `anon` vergebenen Grant;
`CREATE OR REPLACE FUNCTION` erhält bestehende Grants ebenfalls.
Die neue Migration
`20260918101000_harden_prepare_user_deletion_execute_grants.sql`
entzieht deshalb ALL explizit sowohl PUBLIC als auch `anon` und sichert
EXECUTE für `authenticated` erneut zu. Explizite Grants für `service_role`
und postgres/Owner-Rechte werden nicht verändert.

Die bereits angewendete Migration, der Funktionsbody und die fachliche
Accountlöschlogik bleiben unverändert. Ebenso unverändert bleibt der SQL-Test
auf erlaubtes EXECUTE für `authenticated` und verbotenes EXECUTE für `anon`.
Ein zusätzlicher statischer Node-Test prüft die vollständige neue Migration
auf genau diese drei Grant-Anweisungen. Dieser Nachtrag wird nur lokal geprüft;
keine SQL-Ausführung gegen Staging und kein db push.
