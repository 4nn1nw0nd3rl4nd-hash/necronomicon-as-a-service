# Necronomicon

Necronomicon ist eine Webplattform für die Organisation von Pen-&-Paper-Runden.

Phase 1 ist funktional abgeschlossen. Ein produktionsreifer Mail- und Account-Flow sowie die Charakterverwaltung folgen in späteren Schritten.

## Aktueller Funktionsumfang

### Accounts und Auth

- Registrierung mit Benutzername, Anzeigename, E-Mail-Adresse und Passwort
- Login und lokaler Logout
- geschützte App-Routen und Weiterleitung nicht angemeldeter Nutzer
- Weiterleitung angemeldeter Nutzer von Login und Registrierung in die App
- Anzeige des eigenen Profils und der globalen Rolle
- Änderung des eigenen Anzeigenamens
- Änderung des Passworts mit Prüfung des aktuellen Passworts
- technische UI und Datenlogik zum Ändern der E-Mail-Adresse

Ein produktionsreifer Mailflow ist noch nicht Bestandteil des aktuellen Stands. E-Mail-Verifikation, Secure Email Change, Passwort-Reset, Custom SMTP und die zugehörigen Redirects folgen bewusst in Phase 1.9.

### Runden

- Anzeige aller Runden, in denen der aktuelle Nutzer Mitglied ist
- Erstellen einer Runde mit Name sowie optional System, Beschreibung und Termin
- der Ersteller wird automatisch Spielleitung
- Rundendetailseite mit Mitgliederliste
- Bearbeitung von Name, System, Beschreibung, Termin und Status
- Statuswerte `active`, `paused` und `archived`

### Mitglieder und Spielleitung

- registrierte Nutzer per Benutzername suchen und als Spieler hinzufügen
- Spieler aus einer Runde entfernen
- Mitglieder und deren Rundenrolle anzeigen
- Spielleitung an einen vorhandenen Spieler übertragen
- genau eine Spielleitung pro Runde im regulären Anwendungsablauf

### Administration

- zusätzlicher, geschützter Adminbereich für Admins und den Superadmin
- Nutzerübersicht mit globalen Rollen
- normale Nutzer zu Admins machen
- andere Admins zu normalen Nutzern zurückstufen
- Nutzer über die Supabase Edge Function `delete-user` löschen
- Schutz des eigenen Adminaccounts und des Superadmins
- Übersicht aller Runden, unabhängig von der eigenen Mitgliedschaft
- fremde Runden vollständig ansehen und bearbeiten

## Rollenmodell

### Globale Rollen

- `user`: normaler Nutzer
- `admin`: globaler Administrator
- Superadmin: `role = 'admin'` und zusätzlich `is_superadmin = true`

Der Superadmin ist dauerhaft geschützt. Er kann nicht zurückgestuft oder gelöscht werden, und es kann höchstens einen Superadmin geben.

### Rollen innerhalb einer Runde

- `player`: Spieler der Runde
- `game_master`: Spielleitung der Runde

Die Rundenrolle ist unabhängig von der globalen Benutzerrolle. Spielleitung ist keine globale Rolle: Ein Admin kann beispielsweise Spieler einer Runde sein, und ein normaler Nutzer kann eine Runde leiten.

## Technik

Kerntechnologien des aktuellen Projekts:

- React 19
- TypeScript 6
- Vite 8
- React Router 7
- Supabase mit PostgreSQL, Authentication, Row Level Security, RPCs und Edge Functions
- Vercel für das Frontend-Deployment
- Deno für Supabase Edge Functions

Das Projekt verwendet Node.js 24. Die erwartete Version ist in `.nvmrc` und unter `engines` in `package.json` festgelegt.

## Lokale Einrichtung

### 1. Repository klonen

```bash
git clone <REPOSITORY_URL>
cd necronomicon-as-a-service-test
```

### 2. Node.js 24 verwenden

Mit `nvm` beispielsweise:

```bash
nvm use
node --version
```

### 3. Abhängigkeiten installieren

```bash
npm ci
```

### 4. Frontend-Umgebung konfigurieren

Im Projektstamm lokal eine nicht versionierte `.env.local` anlegen:

```env
VITE_SUPABASE_URL=<SUPABASE_URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<SUPABASE_PUBLISHABLE_KEY>
```

Beide Variablen sind öffentliche Frontend-Konfiguration. Niemals einen Service-Role-Key, Secret Key oder andere privilegierte Zugangsdaten in einer `VITE_`-Variable ablegen.

### 5. Supabase CLI verbinden

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase migration list
```

Das Linking ist eine lokale Einstellung. Auf einem neuen Rechner nicht automatisch `npx supabase db push` ausführen: Zuerst mit `migration list`, Git-Historie und Team prüfen, welche Migrationen im gemeinsamen Supabase-Projekt bereits angewendet wurden.

### 6. Entwicklungsserver starten

```bash
npm run dev
```

Vite stellt die Anwendung standardmäßig unter `http://localhost:5173` bereit.

## Wichtige Befehle

```bash
# Entwicklungsserver
npm run dev

# TypeScript prüfen und Produktions-Bundle bauen
npm run build

# ESLint ausführen
npm run lint

# Produktions-Bundle lokal ansehen
npm run preview

# Lokale und verknüpfte Migrationen vergleichen
npx supabase migration list
```

## Projektstruktur

```text
src/
├── auth/          Auth-Provider und Auth-Kontext
├── components/    Formulare und wiederverwendbare UI
├── hooks/         Daten- und Aktionslogik
├── layouts/       App-Layout
├── lib/           zentraler Supabase-Client und Hilfslogik
├── pages/         öffentliche, App- und Adminseiten
├── routes/        Guest-, Auth- und Admin-Guards
└── types/         gemeinsame TypeScript-Datentypen

supabase/
├── migrations/    versioniertes Schema, RLS-Policies und RPCs
└── functions/
    └── delete-user/  serverseitige Nutzerlöschung
```

Der Browser verwendet ausschließlich den zentralen Client in `src/lib/supabase.ts` mit dem Publishable Key.

## Supabase- und Migrations-Workflow

Schema, Constraints, Trigger, RLS-Policies und Datenbankfunktionen liegen als versionierte SQL-Migrationen unter `supabase/migrations/`.

Für Datenbankänderungen gilt:

1. Vor Beginn den aktuellen Git-Stand holen und offene Datenbankarbeiten im Team abstimmen.
2. Eine neue Migration mit einem klar begrenzten Zweck erstellen.
3. Migration und Auswirkungen prüfen, bei Bedarf zunächst `npx supabase db push --dry-run` verwenden.
4. Nur eine Person führt die abgestimmte neue Migration beziehungsweise `db push` gegen das gemeinsame Projekt aus.
5. Diese Person committet und pusht anschließend die Migration.
6. Andere Entwickler holen sie über Git und prüfen den Stand mit `npx supabase migration list`.

Nicht nach jedem `git pull` automatisch `db push` ausführen. Bereits remote angewendete gemeinsame Migrationen werden nicht erneut angewendet.

Sicherheitsregeln:

- Secrets und lokale `.env`-Dateien niemals committen.
- Den Service-Role-Key niemals im Browser oder in `VITE_`-Variablen verwenden.
- Privilegierte Abläufe gehören in abgesicherte Datenbankfunktionen oder Edge Functions.
- Die Benutzeroberfläche ist nicht die Sicherheitsgrenze; RLS und serverseitige Prüfungen bleiben maßgeblich.

## Zentrale Daten- und Sicherheitsabläufe

- Neue Auth-Nutzer erhalten automatisch ein Profil in `public.profiles`.
- `create_round` erstellt Runde und `game_master`-Membership gemeinsam.
- `add_player_to_round`, `remove_player_from_round` und `transfer_game_master` prüfen Spielleitung beziehungsweise Adminstatus serverseitig.
- `promote_user_to_admin` und `demote_admin_to_user` ändern ausschließlich die globale Rolle und schützen Selbständerung sowie Superadmin.
- `delete-user` authentifiziert den Aufrufer, bereitet die Löschung über `prepare_user_deletion` vor und löscht den Auth-Nutzer serverseitig. Geleitete Runden werden zuvor an den Superadmin übertragen.
- Direkte Rollenänderungen aus dem Browser bleiben durch Spaltenrechte, RLS und Datenbankprüfungen blockiert.

## Deployment

Das Frontend wird über Vercel deployt. Dort werden mindestens diese Environment-Variablen benötigt:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Die vorhandene `vercel.json` leitet Browser-Routen auf `index.html` um, sodass direkte Aufrufe von React-Router-Seiten funktionieren.

Frontend-Deployment, Supabase-Datenbankänderungen und Edge-Function-Deployments sind getrennte Vorgänge:

- Ein Vercel-Deployment spielt keine Migrationen ein.
- Ein Vercel-Deployment deployt keine Supabase Edge Functions.
- Migrationen und Functions müssen bewusst über den jeweiligen Supabase-Workflow ausgerollt werden.

Die Edge Function zur Nutzerlöschung befindet sich unter `supabase/functions/delete-user/`. Ihre privilegierten Variablen werden ausschließlich serverseitig von Supabase bereitgestellt.

## Projektstatus und Roadmap

- **Phase 0 – Fundament, Datenbank und Sicherheit:** abgeschlossen
- **Phase 1 – Auth, Profile, Runden, Mitglieder und Administration:** funktional abgeschlossen
- **Phase 1.9 – Produktionsreifer Mail- und Account-Flow:** Custom SMTP, E-Mail-Verifikation, Secure Email Change und Passwort-Reset
- **Phase 2 – Charaktere und Charakterbögen**
- anschließend **Closed Beta**
- spätere Phasen: Chat und Würfel, intelligente Charakterbögen/PDF, Journal sowie ein einfacher virtueller Spieltisch

Mögliche spätere Komfortverbesserungen sind unter anderem eine flexiblere Nutzersuche, Status-/Archivfilter und weiteres Code-Splitting. Diese Funktionen sind aktuell nicht vorhanden.

## Bekannte Hinweise

Der Produktions-Bundle liegt derzeit knapp über Vites Warnschwelle von 500 kB. `npm run build` wird trotzdem erfolgreich abgeschlossen. Code-Splitting ist eine spätere Optimierung und aktuell kein Blocker für den Funktionsumfang von Phase 1.

Der produktive Mailflow ist noch nicht abgenommen. Vor einem öffentlichen Betrieb müssen insbesondere SMTP-Konfiguration, Auth-Redirect-URLs, E-Mail-Verifikation, Secure Email Change und Passwort-Reset im Rahmen von Phase 1.9 umgesetzt und getestet werden.
