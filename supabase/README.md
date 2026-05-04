# Supabase / Datenbank-Dokumentation

Diese Mappe enthaelt das SQL-Schema und erklaert, wie das Frontend die Datenbank nutzt.

## Migrationen

Aktuelle Migration:

- `supabase/migrations/20260425_sync_app_schema.sql`

Anwenden:

1. SQL im Supabase SQL Editor ausfuehren
2. oder mit der Supabase CLI als Migration einspielen

## Datenmodell (aus Frontend-Sicht)

### Session-Verwaltung

- `sessions`
  - Metadaten einer Spielrunde (`slug`, `title`, `description`, `created_by`, Timestamps)
- `session_players`
  - Zuordnung User <-> Session plus Rolle (`gm` oder `player`) und optionaler `display_name`

### Spielinhalte pro Session

- `notebook_pages`
  - Persistente Notizen pro `session_id` + `user_id`
- `whiteboard_images`
  - Whiteboard-Bilder mit Position/Abmessung/Sichtbarkeit
- `whiteboard_notes`
  - Haftnotizen auf dem Whiteboard
- `whiteboard_tokens`
  - Token-Positionen pro User

### Charakterdaten

- `coc_characters`
  - Charakterboegen fuer Call of Cthulhu
- `splinter_portals_characters`
  - Charakterboegen fuer Splinter Portals

## Typischer Datenfluss

1. Startseite (`src/App.jsx`) laedt letzte Sessions (`sessions`) und legt beim Start per `slug` eine Session an/aktualisiert sie.
2. Danach wird eine Mitgliedschaft in `session_players` sichergestellt und fuer den Ersteller auf `gm` gesetzt.
3. Session-Seite (`src/pages/Session.jsx`) laedt Session-Metadaten sowie Whiteboard-/Notebook-Daten tabellarisch.
4. Dice/Chat laufen primaer ueber Realtime-Broadcasts; Whiteboard und Notebook werden zusaetzlich in Tabellen geschrieben.

## Refactoring-Hinweis

DB-Zugriffe der Startseite wurden in `src/lib/sessionRepository.js` gebuendelt. Dadurch sind Query-Details zentralisiert und leichter test-/wartbar.

## Sicherheit / RLS

Policies sind aktuell prototypisch (einfach). Fuer Produktion sollten Rollenrechte pro Tabelle strenger getrennt werden (insb. GM-only Operationen und Session-Zugriff nach Membership).
