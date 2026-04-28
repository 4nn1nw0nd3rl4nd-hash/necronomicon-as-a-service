Diese Projektmappe enthaelt lokale SQL-Migrationen fuer Supabase.

Wichtig:
- Die App speichert CoC- und Splinter-Portals-Charaktere bereits in Tabellen.
- `session_players` und `characters` werden fuer die Session-Ansicht benoetigt.
- Whiteboard und Notizbuch laufen im aktuellen Frontend noch ueber Realtime-Broadcasts und werden noch nicht dauerhaft in Tabellen gespeichert.

Aktuelle Migration:
- [20260425_sync_app_schema.sql](/D:/pnp-website/git/necronomicon-as-a-service-test/supabase/migrations/20260425_sync_app_schema.sql)

Anwenden:
1. SQL im Supabase SQL Editor ausfuehren
2. oder mit der Supabase CLI als Migration einspielen

Hinweis:
Die Policies sind absichtlich einfach gehalten, damit der aktuelle Prototyp funktioniert. Wenn du spaeter feinere Rechte willst, sollten wir die RLS-Regeln fuer GM/Spieler gezielt haerter machen.
