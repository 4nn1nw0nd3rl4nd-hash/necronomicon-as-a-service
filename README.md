# Necronomicon-as-a-Service

Necronomicon-as-a-Service ist eine Online-Plattform für Pen-&-Paper-Runden.

Die Plattform soll Spielleitungen und Spielern Werkzeuge für die Organisation und Durchführung von Runden bereitstellen. Dazu gehören unter anderem Rundenverwaltung, Charaktere, Würfeln, In-Character-Chat, Journal und später ein einfacher virtueller Spieltisch.

---

## Tech-Stack

- React
- TypeScript
- Vite
- Supabase
  - PostgreSQL
  - Authentication
  - Row Level Security
  - Edge Functions
  - später Storage und Realtime
- Git / GitHub
- Vercel
- Supabase Edge Functions mit Deno

---

# Voraussetzungen

Für die lokale Entwicklung werden benötigt:

- Node.js 24
- npm
- Git
- Supabase CLI

Die verwendete Node-Version ist in `.nvmrc` festgelegt.

Prüfen:

```bash
node --version
npm --version
git --version
```

Die Node-Version sollte Version 24 sein.

---

# Projekt installieren

Repository klonen:

```bash
git clone <REPOSITORY-URL>
```

Danach in den Projektordner wechseln:

```bash
cd necronomicon-as-a-service-test
```

Abhängigkeiten installieren:

```bash
npm install
```

---

# Umgebungsvariablen

Bei einer neuen lokalen Installation muss im Hauptordner des Projekts eine Datei namens

```text
.env.local
```

angelegt werden.

Sie enthält:

```env
VITE_SUPABASE_URL=https://DEIN-PROJEKT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=DEIN-PUBLISHABLE-KEY
```

Die konkreten Werte stammen aus dem gemeinsamen Supabase-Projekt.

## Wichtig

`.env.local` wird nicht in Git gespeichert.

Niemals folgende Schlüssel in die React-Anwendung eintragen:

- Service Role Key
- Secret Key
- andere privilegierte Supabase-Schlüssel

Browser-Code verwendet ausschließlich den Supabase Publishable Key.

Variablen, die mit

```text
VITE_
```

beginnen, sind für den Browser sichtbar und dürfen deshalb keine geheimen Zugangsdaten enthalten.

---

# Entwicklungsserver starten

```bash
npm run dev
```

Standardmäßig ist die Anwendung anschließend erreichbar unter:

```text
http://localhost:5173
```

---

# Supabase CLI

Die Supabase CLI wird im Projekt über `npx` verwendet.

Version prüfen:

```bash
npx supabase --version
```

## Bei Supabase anmelden

Jeder Entwickler muss sich lokal einmal anmelden:

```bash
npx supabase login
```

## Lokales Repository mit dem Supabase-Projekt verbinden

```bash
npx supabase link --project-ref <PROJECT-REF>
```

Der Project Ref stammt aus dem gemeinsamen Supabase-Projekt.

Das Linking ist eine lokale Einstellung und wird nicht zwischen den Entwicklern über Git synchronisiert.

---

# Datenbankmigrationen

Alle Änderungen am Datenbankschema werden als Migrationen unter

```text
supabase/migrations/
```

gespeichert.

Dadurch befindet sich die Datenbankstruktur gemeinsam mit dem Anwendungscode unter Versionskontrolle.

## Neue Migration erstellen

```bash
npx supabase migration new name_der_migration
```

Danach die erzeugte SQL-Datei unter

```text
supabase/migrations/
```

bearbeiten.

## Migration zuerst prüfen

Vor dem Anwenden:

```bash
npx supabase db push --dry-run
```

## Migration anwenden

Wenn der Dry-Run korrekt aussieht:

```bash
npx supabase db push
```

Danach kann geprüft werden, welche Migrationen lokal und remote vorhanden sind:

```bash
npx supabase migration list
```

---

# Sehr wichtige Teamregel für Migrationen

Das Projekt verwendet ein gemeinsames Supabase-Projekt.

Deshalb führt immer nur **eine Person gleichzeitig Datenbankmigrationen aus**.

Beispiel:

```text
P2 erstellt Migration
↓
P2 führt db push aus
↓
P2 committed und pusht die Migration zu Git
↓
P1 führt git pull aus
```

P1 führt anschließend **nicht noch einmal `db push` für dieselbe bereits angewendete Migration aus**.

Vor Arbeiten am Datenbankschema deshalb immer kurz abstimmen, wer gerade für Migrationen zuständig ist.

---

# Git-Workflow

Vor Beginn der Arbeit:

```bash
git pull
```

Aktuellen Zustand prüfen:

```bash
git status
```

Änderungen zum Commit hinzufügen:

```bash
git add .
```

Commit erstellen:

```bash
git commit -m "Beschreibung der Änderung"
```

Änderungen zu GitHub übertragen:

```bash
git push
```

Der andere Entwickler holt die Änderungen anschließend mit:

```bash
git pull
```

---

# Projektstruktur

Wichtige Verzeichnisse:

```text
src/
├─ lib/
│  └─ supabase.ts
└─ ...

supabase/
├─ migrations/
└─ functions/
   └─ delete-user/
      └─ index.ts
```

`src/` enthält die React-Anwendung.

`supabase/migrations/` enthält die versionierte Datenbankstruktur.

`supabase/functions/` enthält serverseitige Supabase Edge Functions.

---

# Supabase Client

Der zentrale Supabase Client befindet sich unter:

```text
src/lib/supabase.ts
```

Die Anwendung verwendet die Variablen:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Es soll möglichst nur dieser zentrale Client verwendet werden.

---

# Datenmodell

## Profile

Tabelle:

```text
profiles
```

Ein Profil gehört genau zu einem Supabase-Auth-Nutzer.

Die ID des Profils entspricht der ID aus:

```text
auth.users
```

Wichtige Felder:

```text
id
username
display_name
role
is_superadmin
created_at
updated_at
```

### Rollen

Globale Rollen:

```text
user
admin
```

Der Superadmin wird zusätzlich über

```text
is_superadmin = true
```

gekennzeichnet.

---

# Benutzername und Anzeigename

`username`

- eindeutig
- wird für die interne Nutzerzuordnung verwendet
- Groß-/Kleinschreibung wird bei der Eindeutigkeit nicht unterschieden
- soll später nicht beliebig verändert werden

`display_name`

- frei änderbarer Anzeigename
- darf vom Nutzer selbst verändert werden

Ein Nutzer kann seine globale Rolle oder seinen Superadmin-Status nicht selbst verändern.

---

# Automatische Profilerstellung

Wird ein neuer Nutzer über Supabase Authentication registriert, wird automatisch ein Eintrag in

```text
profiles
```

erstellt.

Die IDs von

```text
auth.users.id
```

und

```text
profiles.id
```

sind identisch.

Wird ein normaler Auth-Nutzer gelöscht, wird auch sein Profil automatisch entfernt.

---

# Runden

Tabelle:

```text
rounds
```

Wichtige Felder:

```text
id
name
system
description
appointment
status
created_at
updated_at
```

Mögliche Statuswerte:

```text
active
paused
archived
```

---

# Rundenmitgliedschaften

Tabelle:

```text
round_memberships
```

Sie verbindet Nutzer mit Runden.

Mögliche Rollen innerhalb einer Runde:

```text
player
game_master
```

Die Rundenrolle ist unabhängig von der globalen Nutzerrolle.

Ein globaler Admin kann also beispielsweise gleichzeitig normaler Spieler einer Runde sein.

Pro Runde gibt es höchstens einen:

```text
game_master
```

Ein Nutzer kann pro Runde nur einmal als Mitglied eingetragen sein.

---

# Berechtigungsfunktionen

Folgende Hilfsfunktionen werden von der Datenbank verwendet:

```text
is_admin()
is_round_member()
is_round_game_master()
```

Sie dienen unter anderem den Row-Level-Security-Regeln und den kontrollierten Datenbankfunktionen.

---

# Runde erstellen

Die Anwendung erstellt eine Runde nicht durch einen direkten Tabellen-Insert.

Stattdessen wird verwendet:

```text
create_round()
```

Die Funktion:

1. erstellt die Runde
2. setzt automatisch den aktuellen Nutzer als `game_master`

Beide Vorgänge laufen innerhalb einer gemeinsamen Datenbanktransaktion.

Wenn einer der Schritte fehlschlägt, wird die gesamte Erstellung zurückgerollt.

---

# Spieler zu einer Runde hinzufügen

Funktion:

```text
add_player_to_round()
```

Nur folgende Nutzer dürfen Spieler hinzufügen:

- Spielleitung der jeweiligen Runde
- Admin

Der hinzugefügte Nutzer wird immer als

```text
player
```

eingetragen.

Ein Spieler kann nicht doppelt derselben Runde hinzugefügt werden.

---

# Spieler aus einer Runde entfernen

Funktion:

```text
remove_player_from_round()
```

Nur folgende Nutzer dürfen Spieler entfernen:

- Spielleitung der jeweiligen Runde
- Admin

Die Funktion entfernt ausschließlich Memberships mit der Rolle:

```text
player
```

Ein `game_master` kann deshalb nicht versehentlich über diese Funktion entfernt werden.

---

# Spielleitung übertragen

Funktion:

```text
transfer_game_master()
```

Die Spielleitung kann an einen bestehenden Spieler der Runde übertragen werden.

Dabei wird:

```text
alter game_master → player
neuer Spieler → game_master
```

Die Übertragung erfolgt innerhalb einer Transaktion.

Falls die Übertragung fehlschlägt, bleibt der bisherige Spielleiter erhalten.

Die Spielleitung kann nicht an einen Nutzer übertragen werden, der nicht Mitglied der Runde ist.

---

# Adminsystem

Normale Nutzer besitzen:

```text
role = user
```

Admins besitzen:

```text
role = admin
```

Admins können unter anderem:

- alle Runden sehen
- alle Runden verwalten
- Nutzer administrieren
- normale Nutzer zu Admins machen
- anderen normalen Admins die Adminrechte entziehen
- Nutzer löschen

Normale Nutzer können keine Adminfunktionen verwenden.

---

# Nutzer zum Admin machen

Funktion:

```text
promote_user_to_admin()
```

Nur ein bestehender Admin darf einen anderen Nutzer zum Admin machen.

Nicht erlaubt sind unter anderem:

- Selbstbeförderung
- Veränderung des Superadmins
- erneute Beförderung eines bereits bestehenden Admins

Die Funktion verändert ausschließlich:

```text
role
```

und kann niemals

```text
is_superadmin
```

setzen.

---

# Adminrechte entfernen

Funktion:

```text
demote_admin_to_user()
```

Ein Admin kann einem anderen normalen Admin die Adminrechte entziehen.

Nicht erlaubt sind:

- eigene Adminrechte entfernen
- Superadmin zurückstufen
- normaler Nutzer führt die Funktion aus

---

# Superadmin

Das System besitzt genau einen permanenten Superadmin.

Der Superadmin besitzt:

```text
role = admin
is_superadmin = true
```

Der Superadmin:

- ist immer Admin
- kann nicht auf `user` zurückgestuft werden
- kann seinen Superadmin-Status nicht verlieren
- kann nicht gelöscht werden
- kann nicht durch einen zweiten Superadmin ersetzt werden

Die Schutzmechanismen befinden sich direkt auf Datenbankebene.

Dadurch kann der Schutz nicht einfach über die normale Anwendung umgangen werden.

---

# Nutzer löschen

Das Löschen eines Nutzers besteht aus zwei Teilen.

## 1. Datenbank vorbereiten

Funktion:

```text
prepare_user_deletion()
```

Vor dem eigentlichen Löschen:

- werden normale Spieler-Memberships des Nutzers entfernt
- werden Runden, in denen der Nutzer Spielleiter ist, an den Superadmin übertragen

Beispiel:

```text
Nutzer A
├─ SL von Runde 1
├─ SL von Runde 2
└─ Spieler in Runde 3
```

Nach Vorbereitung:

```text
Superadmin
├─ SL von Runde 1
└─ SL von Runde 2

Nutzer A
└─ keine Memberships mehr
```

Runde 3 bleibt bestehen.

---

# Tatsächliche Auth-Löschung

Das eigentliche Löschen aus Supabase Authentication erfolgt über die Edge Function:

```text
delete-user
```

Der Ablauf:

```text
Admin
↓
Edge Function
↓
Authentifizierung prüfen
↓
prepare_user_deletion()
↓
Spielleitungen ggf. an Superadmin übertragen
↓
Memberships bereinigen
↓
Auth-Nutzer löschen
↓
Profil wird automatisch gelöscht
```

Die Edge Function verwendet serverseitig privilegierte Supabase-Zugangsdaten.

Diese dürfen niemals in der React-App verwendet werden.

---

# Edge Functions

Edge Functions befinden sich unter:

```text
supabase/functions/
```

Sie laufen mit Deno.

Die aktuelle Funktion:

```text
delete-user
```

kann deployt werden mit:

```bash
npx supabase functions deploy delete-user
```

Die Supabase-Umgebung stellt der gehosteten Function die benötigten serverseitigen Variablen bereit.

Service-Role- oder Secret-Keys werden niemals in Git gespeichert.

---

# Row Level Security

Für die relevanten Tabellen ist Row Level Security aktiviert.

Die Anwendung verlässt sich nicht ausschließlich auf die Benutzeroberfläche, um Aktionen zu verbieten.

Die Datenbank kontrolliert selbst, welche Operationen erlaubt sind.

Unter anderem wurden folgende Fälle getestet:

- direkte Rundenerstellung aus dem Browser → blockiert
- direkte Membership-Erstellung → blockiert
- direkte Membership-Rollenänderung → blockiert
- direkte Membership-Löschung → blockiert
- eigener `display_name` ändern → erlaubt
- eigene globale Rolle ändern → blockiert
- Superadmin direkt verändern → blockiert
- Nutzer ohne Berechtigung führen Adminfunktionen aus → blockiert

Sicherheitskritische Aktionen sollen über kontrollierte RPC-Funktionen oder Edge Functions erfolgen.

---

# Zeitstempel

Die Tabellen

```text
profiles
rounds
```

besitzen:

```text
created_at
updated_at
```

`created_at` enthält den Zeitpunkt der Erstellung.

`updated_at` wird bei Änderungen automatisch aktualisiert.

---

# Docker

Docker wird für den aktuellen Entwicklungsworkflow nicht benötigt.

Die lokale React-Anwendung verbindet sich direkt mit dem gemeinsamen gehosteten Supabase-Projekt.

Docker wäre später relevant, wenn ein vollständiger lokaler Supabase-Stack mit

```bash
npx supabase start
```

verwendet werden soll.

---

# E-Mail-Bestätigung

Während der Entwicklung kann die E-Mail-Bestätigung in Supabase Authentication deaktiviert sein.

Vor einem produktiven Einsatz muss die Auth-Konfiguration erneut geprüft werden.

Insbesondere müssen dann Themen wie folgende geprüft werden:

- E-Mail-Bestätigung
- Passwort-Reset
- SMTP-Konfiguration
- Redirect-URLs
- Production-Domain

---

# Entwicklungsstatus

Aktueller Entwicklungsschritt:

```text
Phase 0 – Technisches Fundament
```

In Phase 0 wurden unter anderem umgesetzt:

- React-/TypeScript-/Vite-Grundprojekt
- gemeinsamer Git-Workflow
- Supabase-Anbindung
- versionierte Datenbankmigrationen
- Auth-/Profilmodell
- automatische Profilerstellung
- Rundenmodell
- Membershipmodell
- Row Level Security
- sichere Erstellung von Runden
- Spieler hinzufügen
- Spieler entfernen
- Spielleitung übertragen
- Adminverwaltung
- Superadmin-Schutz
- sichere Nutzerlöschung
- Edge Function für Auth-Löschung
- automatische `updated_at`-Zeitstempel
- Security-/RLS-Tests

---

# Geplante weitere Entwicklung

Nach Abschluss von Phase 0 folgen schrittweise unter anderem:

## Phase 1

- Registrierung
- Login
- Logout
- Profiloberfläche
- Rundenübersicht
- neue Runde erstellen
- Runden verwalten
- Spieler hinzufügen und entfernen
- Adminoberflächen

## Spätere Phasen

- mehrere Charaktere pro Spieler und Runde
- systemabhängige Charaktervorlagen
- NPCs und Monster
- Charakterfreigaben durch die Spielleitung
- aktiver Charakter
- Würfelsystem
- In-Character-Chat
- geheime Würfe
- direkt aus Charakterbögen würfeln
- PDF-Export
- gemeinsames Journal
- Handouts
- Spieltisch / Whiteboard
- Szenen
- Tokens
- Sichtbarkeiten
- weitere PnP-Werkzeuge

---

# Grundprinzipien des Projekts

Bei der Entwicklung gelten folgende Grundsätze:

1. Kleine und schnell testbare Entwicklungsschritte.
2. Sicherheitsregeln werden möglichst auf Datenbankebene abgesichert.
3. Die Benutzeroberfläche ist nicht die einzige Sicherheitsbarriere.
4. Sensible Schlüssel kommen niemals in die Browser-Anwendung.
5. Datenbankänderungen werden ausschließlich über versionierte Migrationen durchgeführt.
6. Ein Feature wird möglichst praktisch getestet, bevor der nächste größere Block beginnt.
7. Die Architektur soll spätere Funktionen ermöglichen, ohne das Grundsystem neu schreiben zu müssen.