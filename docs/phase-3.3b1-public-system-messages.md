# Phase 3.3b1: öffentliche Systemnachrichten – Datenmodell

Die Migration `20260916100000_allow_public_system_messages.sql` ersetzt nur
`round_messages_message_identity`. Im Systemmessage-Zweig entfällt ausschließlich
`recipient_user_id IS NOT NULL`.

- `recipient_user_id IS NULL`: öffentliche Systemnachricht für normale Leser der Runde.
- `recipient_user_id IS NOT NULL`: private Systemnachricht für den Empfänger mit Rundenzugriff.
- Beide verlangen weiterhin `speaker_kind = 'system'`, `author_user_id IS NULL`
  und `speaker_name_snapshot = 'System'`.
- `character_id` darf weiterhin gesetzt oder NULL sein; Character-/GM-Regeln
  und alle übrigen Constraints bleiben unverändert.

SELECT-RLS und Lesehelper bleiben unverändert. Accountrollen allein gewähren
keinen Inhaltszugriff. Frontend, Realtime, RPCs und Grants werden nicht geändert.
`transfer_game_master` wurde in diesem Schritt nicht verändert. Es wird noch
keine öffentliche Systemnachricht produktiv erzeugt; die neuen Zeilen im
SQL-Security-Test sind ausschließlich Fixtures innerhalb von BEGIN/ROLLBACK.
Phase 3.3b2 übernimmt den atomaren Transfer mit Nachricht und die Lock-Reihenfolge.

Der SQL-Test ergänzt öffentliche Systemnachrichten mit/ohne Charakterreferenz
und ungültige öffentliche Systemidentitäten. Die bestehende Lesermatrix prüft
Spieler, anderen Spieler, GM und Admin/Superadmin ohne Mitgliedschaft; private
Sichtbarkeitsprüfungen bleiben bestehen. Die öffentlichen Fixtures werden nach
dieser Matrix entfernt, damit die bisherigen Lifecycle-Erwartungen gleich bleiben.
Die Tests echter Prepared-Zuweisungen mit Character-ID laufen unverändert weiter.

Der statische Node-Test prüft den vollständigen Migrationsinhalt und den exakten
Unterschied zum bisherigen CHECK. Er ersetzt keine PostgreSQL-Ausführung.
Migration und SQL-Integrationstest wurden in diesem Schritt nicht angewendet
beziehungsweise ausgeführt; kein Staging-Test oder db push (auch kein Dry Run).
