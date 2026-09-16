# Phase 3.3a2-1: atomare Zuweisungsnachricht

Voraussetzung: Phase 3.3a1. Die neue Migration ist
`20260915120000_emit_private_prepared_assignment_messages.sql`.

Die öffentlichen Signaturen bleiben unverändert:

- `assign_prepared_character(uuid, uuid) returns void`
- `assign_prepared_character_keep_copy(uuid, uuid) returns uuid`

Beide SECURITY-DEFINER-RPCs verwenden
`assign_prepared_character_internal(uuid, uuid, boolean) returns uuid`.
Der Helper hat einen leeren search_path und keine EXECUTE-Rechte für PUBLIC,
anon oder authenticated. Die bestehenden öffentlichen RPC-Grants bleiben erhalten.

## Reihenfolge innerhalb derselben Transaktion

1. Anmeldung/Parameter prüfen und Runde ohne Zeilensperre ermitteln.
2. Aufrufer- und Empfängerprofile in UUID-Reihenfolge FOR KEY SHARE sperren.
   Bei Selbstzuweisung wird nur ein Profil gesperrt. Keine neue Prüfung auf
   deletion_pending_at.
3. Den identischen transaktionalen Sequenz-Advisory-Lock wie send_round_message
   nehmen: hashtextextended('round-message-sequence:' || round_id, 0).
4. Original FOR UPDATE sperren. Existenz, Löschstatus, unveränderte Rundenzuordnung
   und NULL-Eigentümer erneut prüfen. Bei abweichender Runde abbrechen, keinen
   zweiten Sequenz-Lock nehmen.
5. Runde FOR SHARE sperren; Existenz, Lock und Archiv prüfen. Paused bleibt erlaubt.
6. GM-Membership FOR SHARE sperren und aktuelle Rolle prüfen. Bei Selbstzuweisung
   unmittelbar FOR UPDATE nehmen, ohne späteres S-zu-U-Upgrade.
7. Andere Ziel-Membership FOR UPDATE sperren und Existenz prüfen.
8. Optional copy_character aufrufen; Original-U und alle Eingangssperren sind
   bereits vorhanden. Rückgabewert bleibt die ID der vorbereiteten Kopie.
9. Original-Eigentümer setzen; bestehende Aktivcharakter-Trigger normal ausführen.
10. MAX(round_seq)+1 über alle Rundennachrichten bestimmen und private
    Systemnachricht für den aktualisierten Original-Eigentümer einfügen.

Der Name kommt aus UPDATE RETURNING. Autor ist NULL; Sprecher ist system/System;
Text und Request-UUID kommen vom Server. created_at verwendet den bestehenden
Default. Der Sequenz-Lock bleibt bis zum Transaktionsende gehalten.

Fehler werden nicht abgefangen. Ein fehlgeschlagener Nachrichten-Insert rollt
Originaländerung, Aktivcharakter-Neuberechnung und optionale Kopie mit zurück.
Die Sequenzgrenze dient im SQL-Test als gezielter Fehler nach diesen Schritten.

Der U-gesperrte Übergang von NULL-Eigentümer zu Eigentümer verhindert zwei
erfolgreiche Zuweisungen desselben Originals. Die zufällige Nachrichten-Request-ID
ist keine Idempotenzgrundlage. Ein Netzwerk-Retry nach erfolgreichem Commit kann
weiterhin „Character already has an owner“ melden.

## Prüfgrenzen und nächster Schritt

Die SQL-Tests sind transaktional (BEGIN/ROLLBACK) und sequenziell. Die Node-Tests
prüfen SQL-Quelltext; sie beweisen weder die Ausführung noch Deadlockfreiheit.
Keine Änderungen an send_round_message, Copy-Logik, Triggern, RLS, Publication,
GM-Transfer oder Löschvorbereitung. Die getrennten Transaktionen von
Löschvorbereitung und Auth-Accountlöschung werden hier nicht vereinheitlicht.

Nach statischem Review und Staging-Anwendung folgt separat **3.3a2-2** mit echten
getrennten Verbindungen für:

- gleichzeitiges Senden durch Empfänger und anderen Spieler;
- doppelte Zuweisung und zwei keep_copy-Aufrufe;
- Aktivcharakterwechsel und Membership Removal;
- GM-Transfer und Round Lock/Archivierung;
- prepare_user_deletion.

Bestehende unabhängige Copy-/Lösch-/Neuberechnungszyklen werden durch diesen
begrenzten Zuweisungsablauf nicht pauschal behoben.
