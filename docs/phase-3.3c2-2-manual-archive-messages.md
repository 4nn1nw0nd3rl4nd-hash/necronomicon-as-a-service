# Phase 3.3c2-2 – manuelle Archivierungsnachrichten

## Bestehende Wege und unveränderte Signaturen

- `public.update_round(p_round_id uuid, p_name text, p_system text,
  p_description text, p_appointment text, p_status text) RETURNS public.rounds`:
  `EditRoundForm` in `RoundDetailsPage` über `useUpdateRound`. Speichert alle fünf
  Formularfelder gemeinsam; ausschließlich aktueller GM einer ungesperrten Runde.
  Das Formular erlaubt active, paused und archived, einschließlich Entarchivierung
  nach active/paused. Der Constraint für `orphaned_at` bleibt wirksam.
- `public.set_round_archived(p_round_id uuid, p_archived boolean) RETURNS void`:
  `AdminRoundDetailsPage` über `useSetRoundArchived`. Bereits vorher berechtigt:
  GM **oder** `profiles.role = 'admin'` **oder** `profiles.is_superadmin = true`.
  Keine Membership für Admin/Bewahrer nötig, aber weiterhin kein Chat-Leserecht
  allein durch diese Accountrolle. Entarchivierung führt unverändert nach paused.

Beide Wege lehnen moderationsgesperrte Runden ab. Erneutes Archivieren über
`set_round_archived` ist ein No-op, jedoch erst nach Berechtigungs-/Sperrprüfung.
Entarchivierung einer nicht archivierten Runde bleibt dort ein Fehler; bei
`orphaned_at IS NOT NULL` bleibt zuerst Recovery erforderlich. Recovery selbst
ändert weder den archivierten Status noch erzeugt sie eine Nachricht.

Die neue Migration `20260916130000_emit_manual_round_archive_messages.sql`
ersetzt ausschließlich diese beiden Funktionen mit `CREATE OR REPLACE`.
Signaturen, Owner und EXECUTE-Grants bleiben erhalten. Keine neue RLS, keine
Tabellen-/Spaltengrants, Trigger oder Subscription. Die Status-UPDATE-Absicherung
aus 3.3c2-1 bleibt unverändert. Keine Frontendänderung in dieser Teilphase.

## Nachrichtenmatrix

| RPC | Übergang | Nachricht |
| --- | --- | --- |
| update_round | active → paused | Die Runde wurde pausiert. |
| update_round | paused → active | Die Runde wurde fortgesetzt. |
| beide | active/paused → archived | Die Runde wurde archiviert. |
| beide | archived → archived | keine |
| update_round | archived → active/paused | keine |
| set_round_archived(false) | archived → paused | keine |
| update_round | gleicher Status / nur Metadaten | keine |

Genau ein Ereignis pro tatsächlicher Archivierung, auch bei anschließenden
Wiederholungen über den jeweils anderen Weg. Entscheidend ist der unter Lock
gelesene alte Status. Ein unveränderter archived-Status im Formular darf weiterhin
Metadaten ändern, ohne ein neues Ereignis zu erzeugen.

Die Nachricht ist öffentlich: `system_message` / `system` / `System`, NULL für
Autor, Empfänger und Charakter, serverseitige UUID und exakt der oben angegebene
Body. Kein Clienttext, kein Benutzername, kein Aufruf von `send_round_message`.

## Locks, Berechtigungen und Atomarität

`update_round` behält vollständig seine Reihenfolge:
Caller-Profil **FOR SHARE** → Sequence-Advisory-Lock → Runde **FOR UPDATE** →
Caller-Membership **FOR SHARE** samt aktueller GM-Prüfung → Edit → optional Insert.
Nur die Statusentscheidung wird um Archivierung erweitert.

`set_round_archived` verwendet jetzt:
Caller-Profil **FOR SHARE** samt Accountrollen-Prüfung → Sequence-Advisory-Lock →
Runde **FOR UPDATE** → für Nicht-Admins Caller-Membership **FOR SHARE** samt
aktueller GM-Prüfung → Sperr-/Statusprüfung → Statusupdate → optional Insert.

Das Profil wird vor Sequence/Round gesperrt. SHARE stabilisiert Accountrolle und
Superadmin-Flag gegen Änderung/Löschung und ist mit den frühen KEY SHARE-Locks
der vorhandenen Message-Produzenten kompatibel. Es wird nur ein Profil benötigt;
keine zusätzlichen oder späten Profil-Locks. Der Rollenvergleich entspricht exakt
dem bisherigen `is_admin()`-Prädikat. Admin/Bewahrer benötigen keine Membership;
normale Nutzer müssen ihre aktuelle GM-Rolle unter Membership-Lock nachweisen.
Keine spätere Lock-Verstärkung. Die Locks bleiben bis Transaktionsende bestehen.

Beide Wege verwenden vor dem Round-Lock genau
`pg_advisory_xact_lock(hashtextextended('round-message-sequence:' || p_round_id::text, 0))`.
Damit entsteht kein neuer Round→Sequence-Pfad. Unter diesem gemeinsamen Lock wird
`MAX(round_seq)+1` über **alle** Nachrichten der Runde berechnet, auch private.
Keine eigene Sequenz für Archivierung. Round-Lock und erneute Statusprüfung
verhindern doppelte Ereignisse durch nacheinander abgearbeitete Archivierungen.

Statusupdate und Insert liegen in einem RPC, ohne Fehler verschluckenden Handler.
Ein später Insertfehler rollt alles zurück, bei `update_round` auch sämtliche
gleichzeitig bearbeiteten Metadaten. Nach Erfolg bleibt die Archivierungsnachricht
über bestehende SELECT-RLS lesbar; reguläres neues Chat-Senden bleibt im Archiv
verboten. Bestehende rounds UPDATE- und round_messages INSERT-Invalidierung genügt.

## Prüfungen und Grenzen

Die SQL-Tests laufen weiterhin vollständig in BEGIN/ROLLBACK. Ergänzt wurden:

- Beide RPCs jeweils von active und paused; exakte öffentliche Identität,
  Status, Metadaten und Nachrichtenanzahl; Wiederholungen über beide Wege.
- Archivierter Chat: Mitglied liest Archivierungsnachrichten, neue GM- und
  Player-Nachrichten werden abgelehnt. Entarchivierung bleibt nachrichtenlos.
- Admin/Bewahrer ohne Membership bleiben berechtigt, ohne Chat-Inhaltszugriff;
  `update_round` bleibt auch für sie ohne GM-Membership verboten.
- Spieler/ehemaliger GM und Moderationssperre; beide Fehlerpfade unverändert.
- Später Insertfehler für beide RPCs durch vorhandene Sequenzobergrenze;
  Vergleich der vollständigen Round-Zeile und Nachrichtenanzahl vor/nach Fehler.
- Gemischte Historie aus Chat, privaten Zuweisungen, Transfer, Pause/Fortsetzen;
  insbesondere eine für den GM unsichtbare Nachricht mit höchster Sequenz.
- Verwaiste Runde: Archive-No-op, blockierte Entarchivierung, echte Recovery und
  anschließende stille Entarchivierung. Keine Accountlöschung im Test.

Die bisherigen Pause-/Fortsetzen- und Security-Prüfungen bleiben erhalten. Nur die
bisherige Erwartung „Archivierung ohne Nachricht“ wird für drei echte Übergänge
auf drei Archivierungsereignisse angepasst. Statische Node-Tests vergleichen den
neuen update_round vollständig mit 3.3c2-1 plus einzigem neuen Statuszweig und
prüfen set_round_archived mit geordneten Locks und zusammenhängenden Zweigen.
Sie ersetzen keine PostgreSQL-Ausführung, PostgREST- oder echten Paralleltests.

SQL wird in dieser Teilphase nicht ausgeführt; auch kein Staging, Dry Run oder
db push. Vorhandene Frontend-Tests bleiben relevant, da kein UI geändert wird.

Lokale Validierung: **169/169 Node-Tests bestanden** (`round-chat-security.test.mjs`
und `realtime-round.test.mjs`), `npm run build` und `npm run lint` erfolgreich,
`git diff --check` fehlerfrei. Vite meldet den bestehenden Chunk-Größenhinweis
(621 kB, Grenze 500 kB). Statisches Review: nur die beiden vorgesehenen
Funktionsdefinitionen in der neuen Migration; keine Änderungen an älteren
Migrationen. SQL-/Mehrsession-/Realtime-Integrationstests wurden nicht ausgeführt.

## Bewusst offen

`prepare_user_deletion`, automatische Archivierung und deren Mehr-Runden-Locks
bleiben unangetastet: **Phase 3.3c2-3**. Ebenso unverändert bleiben
`recover_orphaned_round`, `send_round_message`, Realtime und Chatdarstellung.
