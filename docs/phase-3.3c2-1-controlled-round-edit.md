# Phase 3.3c2-1 – kontrollierte GM-Bearbeitung

## Bestehender Flow und Scope

`EditRoundForm.tsx` ist der einzige produktive Caller von `useUpdateRound`.
Das Formular speichert `name`, `system`, `description`, `appointment` und `status`
gemeinsam und bietet `active`, `paused`, `archived` an. Der Hook normalisiert die
Texte, erwartet eine aktualisierte `RoundDetails`-Zeile oder `null` bei Fehlern
und hält Loading-/Fehler-/Erfolgszustand lokal. Nach Erfolg lädt die aufrufende
Rundenansicht ihre Daten erneut. Diese Semantik und die UI bleiben erhalten.

Die Migration `20260916120000_add_controlled_round_edit.sql` ergänzt ausschließlich
den Bearbeitungs-RPC und die direkte UPDATE-Absicherung. Der Hook verwendet nun
den RPC samt SELECT-Projektion und `maybeSingle()`, ohne zweiten Schreibaufruf
oder künstlichen Chat-State. Die Rückgabe enthält auch `orphaned_at`, entsprechend
dem bestehenden `RoundDetails`-Typ.

## RPC und Rechte

```text
public.update_round(
  p_round_id uuid,
  p_name text,
  p_system text,
  p_description text,
  p_appointment text,
  p_status text
) RETURNS public.rounds
```

`SECURITY DEFINER`, leerer `search_path`, EXECUTE ausschließlich für
`authenticated` unter den Clientrollen. `auth.uid()` stammt vom Server.
Die Funktion prüft nach den Locks eine existierende, ungesperrte Runde und die
aktuelle GM-Membership des Callers. Admin/Bewahrer ohne GM-Membership werden
abgelehnt. Kein neues `deletion_pending_at`-Kriterium. Der bestehende Constraint
für verwaiste Runden gilt weiterhin. Nur die fünf Formularfelder werden geändert.

## Locks und Atomarität

Reihenfolge: Caller-Profil **FOR SHARE** → gemeinsamer Sequence-Advisory-Lock →
Runde **FOR UPDATE** → Caller-Membership **FOR SHARE** → Update → optional Insert.

Profil-S stabilisiert das vorhandene Profil gegen Änderung/Löschung und bleibt
mit den frühen Profil-KS-Locks von Send, Assignment und Transfer kompatibel.
Membership-S genügt für die Rollenprüfung, da dieser RPC keine Membership ändert;
es verhindert deren parallele Änderung bis Transaktionsende. Kein späteres
Lock-Upgrade. Der Round-U-Lock schützt alten Status und Moderationszustand.

Sequence-Key: `hashtextextended('round-message-sequence:' || p_round_id::text, 0)`.
Er wird vor Round-/Membership-Locks erworben, auch bei nachrichtenlosen Edits.
`MAX(round_seq) + 1` umfasst sämtliche sichtbaren und privaten Nachrichten der
Runde unter Definer-Rechten. Kein separater Zähler und keine neue Request-ID-API.

Das Update gibt die aktualisierte Zeile per `RETURNING` zurück; eine fehlende
Zeile löst einen Fehler aus. Der RPC gibt erst nach dem optionalen Message-Insert
zurück. Kein Exception-Handler: auch ein später Insertfehler rollt Metadaten,
Status und Nachricht gemeinsam zurück. Der bestehende updated_at-Trigger bleibt
unverändert.

## Übergänge

| Alter Status | Neuer Status | Nachricht |
| --- | --- | --- |
| active | paused | Die Runde wurde pausiert. |
| paused | active | Die Runde wurde fortgesetzt. |
| beliebig | identisch | keine |
| active/paused | archived | in diesem Schritt keine |
| archived | active/paused | keine |

Reine Metadatenänderungen erzeugen keine Nachricht. Maßgeblich sind alter und
neuer Status, nicht die Zahl betroffener UPDATE-Zeilen. Die optionalen Nachrichten
sind `system_message` / `system` / `System`, mit NULL für Autor, Empfänger und
Charakter sowie serverseitiger UUID. Es gibt keinen frei wählbaren Body und keinen
Username im Text. Die Nachrichtenproduktion verändert weder RLS noch Realtime.

## Direkte UPDATE-Absicherung

Im bisherigen Repository gibt es eine GM-only UPDATE-RLS für ungesperrte Runden,
aber keine spaltenbezogene Begrenzung für `rounds.status`. Die ursprünglichen
Supabase-Standardgrants sind nicht vollständig als Migrationen abgebildet.
Es wurde keine Remote-Katalogabfrage ausgeführt.

Die Migration entzieht daher explizit table-level UPDATE für `PUBLIC`, `anon` und
`authenticated` sowie einen eventuell vorhandenen separaten UPDATE(status)-Grant
für dieselben Rollen. Ein bloßer Spalten-Revoke würde einen Table-Grant nicht
überstimmen. Anschließend wird UPDATE auf genau `name`, `system`, `description`,
`appointment` für `authenticated` gewährt. Die unveränderte UPDATE-RLS beschränkt
diese Metadatenrechte weiterhin auf den aktuellen GM einer ungesperrten Runde.
Aus dem Repository sind keine weiteren UPDATE-Spaltengrants für rounds bekannt.

Der produktive Formularpfad läuft vollständig über den RPC. Direkte legitime
Metadatenupdates bleiben möglich; direkter Status-UPDATE ist kein Ausweichweg.
SELECT-Rechte und Policies bleiben unverändert. Die bestehenden Definer-RPCs
behalten die Rechte ihres Owners. Accountrollen erhalten keine neuen Sonderrechte.
Die SQL-Tests prüfen die effektiven Spaltenrechte einschließlich vererbter Grants
und einen echten abgelehnten Status-UPDATE als aktueller GM. Unerwartete zusätzliche
Grants aus nicht versionierten Rollen wären bei späterer SQL-Ausführung sichtbar.

## Tests und bewusst verschobene Punkte

Ergänzte SQL-Tests innerhalb des vorhandenen BEGIN/ROLLBACK testen Pause,
Fortsetzen, beide No-ops, reine Metadatenänderung, Spieler/ehemaligen GM sowie
Admin/Bewahrer ohne Membership, Moderationssperre und direkten UPDATE-Bypass.
Die Sequenz-Fixture benutzt reale Chat-, Assignment- und Transfer-RPCs und enthält
eine für den Caller unsichtbare private Nachricht. Der späte Fehler wird über die
bestehende Sequenzobergrenze erzwungen; verglichen wird die vollständige Round-Zeile
vor/nach dem Fehler, einschließlich Metadaten und Status. Zusätzliche Counts unter
privilegierter Testbeobachtung sichern die private Historie ab.

Archivierung/Entarchivierung über das Formular sowie der unveränderte
`set_round_archived` werden weiterhin ohne neue Archivierungsnachricht geprüft.
Keine bestehenden Security-Assertions wurden entfernt oder abgeschwächt.

Statische Node-Tests sichern vollständige Signatur, geordnete Lock-Schritte,
Prüfungen unmittelbar nach Locks, exakt zwei Übergangstexte, bedingten Insert,
Grants und die Frontend-RPC-Parameter ab. Diese Tests ersetzen keine PostgreSQL-
Ausführung, keinen echten PostgREST-/Browser-Test und keine Paralleltests.

Lokal ausgeführt: 164/164 Node-Tests aus `round-chat-security.test.mjs` und
`realtime-round.test.mjs` erfolgreich. Der Hook-Verhaltenstest prüft normalisierte
RPC-Parameter, Rückgabe, Schutz vor parallelem Absenden und Fehlerzustand; die
bestehenden Erfolgstimer-Tests bleiben erhalten. Der RPC-Mock unterstützt dafür
nun auch `select` und `maybeSingle`. Build und ESLint erfolgreich; Vite meldet
den bestehenden Hinweis auf einen Bundle-Chunk über 500 kB. `git diff --check`
ist fehlerfrei. Die ergänzten SQL-Tests wurden nicht ausgeführt.

- Manuelle Archivierungsnachrichten einschließlich Formularpfad: **3.3c2-2**.
- `prepare_user_deletion` / automatische Archivierung: **3.3c2-3**.
- Keine Änderungen an diesen RPCs, Chatdarstellung oder Realtime in diesem Schritt.
- Vor späterer Frontend-Inbetriebnahme muss die neue Migration angewendet sein.
- Keine SQL-/Staging-Ausführung, kein Dry Run, db push, Commit oder Push.
