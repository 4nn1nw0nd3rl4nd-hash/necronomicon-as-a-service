# Phase 3.4a: Würfel-Datenbankfundament

Migration: `20260918110000_add_dice_roll_message_foundation.sql`.
Nur Schema, Constraints, RLS und Grants. Keine Änderungen an alten Migrationen,
RPCs, Frontend, Fetch, Realtime, Pagination oder Unread.

## Modell und Constraints

`round_message_dice_rolls` enthält ausschließlich:

| Feld | Typ / Regel |
| --- | --- |
| `message_id` | UUID, Primary Key, FK auf `round_messages(id) ON DELETE CASCADE` |
| `dice_count` | integer NOT NULL, 1–50 |
| `dice_sides` | integer NOT NULL, 2–1000 |
| `modifier` | integer NOT NULL DEFAULT 0, −9999 bis +9999 |
| `results` | integer[] NOT NULL, unveränderte Reihenfolge |
| `raw_total` | integer NOT NULL, zwischen Count und Count × Sides |
| `total` | integer NOT NULL, exakt Raw Total + Modifier |

Das Array muss nichtleer, eindimensional und ab Index 1 adressiert sein.
`cardinality` und `array_length(..., 1)` müssen Count entsprechen. Alle Werte
liegen zwischen 1 und Sides. Die Werteprüfung verwendet `ALL` mit `IS TRUE`,
sodass UNKNOWN durch NULL-Elemente abgelehnt wird. Auch die Formprüfung muss
explizit TRUE sein. Kein Sortieren, Summenhelper oder Trigger.
Die maximalen Summen passen in integer (Raw Total bis 50.000, Total bis 59.999).
Der Primary Key ist der einzige erforderliche Detailindex.

## Message-Hülle

`round_messages_kind_check` erlaubt zusätzlich `dice_roll`.
Das allgemeine `body NOT NULL` entfällt; `round_messages_body_kind` verlangt
für Würfe NULL, für Charakter- und Systemnachrichten weiterhin NOT NULL.
Die bisherigen Längen- und Nonblank-Checks bleiben unverändert: NULL passiert
diese Checks, wird für Textnachrichten jedoch von der neuen Body-Regel verboten.

Die beiden bestehenden Zweige von `round_messages_message_identity` bleiben
unverändert. Der neue Dice-Zweig erlaubt nur character/game_master und verlangt
`recipient_user_id IS NULL`. Keine Secret Rolls. Speaker-Kinds, GM-Identity,
Snapshots, Sequence-/Request-Eindeutigkeit und alle historischen FKs bleiben
unverändert. Autor und Charakter dürfen historisch weiterhin NULL werden.
Die richtige Identität bei Erzeugung muss später der RPC garantieren.

## Zugriff und Historie

Detail-RLS ist aktiviert. Die SELECT-Policy verwendet ein EXISTS auf die Parent-
Message unter Aufruferrechten und verlangt `kind = 'dice_roll'`. Somit gelten
sämtliche Parent-Policies inklusive Empfänger-, Membership- und Lock-Prüfung.
Kein SECURITY-DEFINER-Lesehelper und kein Admin-/Bewahrer-Sonderrecht.

Ein explizites REVOKE ALL entzieht auch mögliche zuvor durch Default-Privileges
erteilte Tabellenrechte für PUBLIC, anon und authenticated. Danach erhält nur
authenticated SELECT. Keine Clientrechte für INSERT, UPDATE, DELETE, TRUNCATE,
TRIGGER oder REFERENCES; keine Schreibpolicies. SQL-Tests kontrollieren die
effektiven Tabellen-/Spaltenrechte und PUBLIC-ACLs in der späteren Testdatenbank.
Die tatsächlichen Remote-Default-ACLs wurden hier nicht abgefragt.
Parent-RLS, Parent-Grants und bestehende RPCs werden nicht verändert.

Es gibt keinen normalen Message-Delete-RPC und kein Message-Soft-Delete.
Private Systemnachrichten können über den bestehenden Empfänger-FK bei
Accountlöschung verschwinden; öffentliche Würfe haben keinen Empfänger.
Autoren-/Charakter-FKs erhalten Historie mit SET NULL. Wird eine Parent-Message
privilegiert gelöscht, löscht der neue FK ihre Details mit. Keine neue
Löschfunktion oder Client-DELETE-Freigabe. Privilegierte SQL-Rollen behalten
ihre Verwaltungsrechte; diese Migration macht sie nicht unveränderlich.

Bewusst mögliche Inkonsistenzen bei privilegierten SQL-Schreibzugriffen:

- Dice-Message ohne Detail.
- Detail an einer anderen Message-Art (für normale Leser durch die Detail-Policy verborgen).
- Raw Total innerhalb der Grenzen, aber ungleich der exakten Array-Summe.

Keine Cross-Table-Trigger für diese Fälle. PK/FK verhindern mehrere Details pro
Message und verwaiste Details. Vollständige atomare Erzeugung folgt in 3.4b.

## Abgrenzung zu 3.4b

Noch offen: Dice-RPC, Zufallserzeugung, Idempotenz, atomare Message-/Detail-
Erzeugung und exakte Array-Summe. Insbesondere bleibt das Chat-Retry-Hardening
offen: Vor Einführung eines produktiven Dice-Erzeugers muss der Chat-Retry
Message-Kinds unterscheiden und den Body NULL-sicher vergleichen.
3.4a erzeugt selbst keine Würfe; privilegierte Dice-Fixtures nur in Tests mit
ROLLBACK verwenden, nicht als produktive Inhalte für den bisherigen Client.

Keine Detail-Publication oder eigene Subscription. `round_messages INSERT`
bleibt das vorgesehene Invalidierungssignal für den späteren gemeinsamen Fetch.

## Tests

- `supabase/tests/round_message_dice_rolls_security.sql`: eigenständiger
  BEGIN/ROLLBACK-Test nach Anwendung der Foundation. Deckt bisherige Identitäten,
  Body-/Array-/Zahlengrenzen, Default/Arrayreihenfolge, RLS inklusive zusätzlicher
  temporärer Parent-Policy, Rollen/Status/Membership, effektive Grants, FK/PK und
  Cascade ab. Die zusätzliche Parent-Policy wird per SAVEPOINT zurückgerollt.
- `supabase/tests/round_messages_security.sql`: unverändert als vollständige
  Phase-3.1–3.3-Regression ausführen, insbesondere echte Assignment-, Transfer-,
  Pause-/Fortsetzen- und Archivierungs-RPCs.
- `tests/dice-roll-foundation.test.mjs`: statische Struktur-/Scope-Prüfungen;
  zusätzlich die bestehende Node-Suite ausführen. Kein Ersatz für PostgreSQL.

Kein SQL-Test wurde in diesem Schritt ausgeführt; keine Staging-Ausführung,
kein Dry Run und kein db push. Keine Accountlöschung oder Storage-Operationen.
Bei ON_ERROR_STOP-Abbruch in einer offenen SQL-Session explizit `ROLLBACK;`.

Lokale Validierung: gezielte Security-Tests 51/51 erfolgreich; vollständige Suite
mit `node --test --test-isolation=none --test-reporter=spec tests/*.test.mjs`
184/184 erfolgreich. Neue MJS-Datei ausdrücklich mit ESLint `recommended`
geprüft (die Projektkonfiguration richtet ihre Regeln nur an TS/TSX): keine
Fehler/Warnungen. `git diff --check` und zusätzliche Whitespace-Prüfung der
ungetrackten Dateien unauffällig. Kein Build nötig bei reinem SQL/Test/Doku-Scope.
