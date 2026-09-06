# Necronomicon as a Service

Necronomicon as a Service ist eine Webplattform für die Organisation von Pen-&-Paper-Runden. Sie verbindet Account- und Profilverwaltung, Rundenorganisation und eine persönliche Charakterbibliothek mit serverseitig abgesicherten Rollen und Rechten.

## Aktueller Stand

- Phase 1 ist abgeschlossen.
- Phase 2 ist abgeschlossen.
- Das Projekt wird auf eine Closed Beta vorbereitet.
- Phase 3 hat noch nicht begonnen.

Der aktuelle Fokus liegt auf Stabilität, Bugfixes und der Bereinigung von Testdaten vor dem Start der Closed Beta.

## Kernfunktionen

### Auth und Profile

- Supabase Auth mit Registrierung, E-Mail-Bestätigung sowie bewusstem anschließendem Login
- Login und lokaler Logout
- Passwort-Reset per E-Mail und Passwortänderung im eingeloggten Zustand
- bestätigte Änderung der E-Mail-Adresse
- Profile mit eindeutigem `username` und persönlichem `display_name`
- geschützte App- und Adminrouten
- administrative Accountlöschung mit serverseitigem Cleanup

Eine Self-Service-Accountlöschung auf der Profilseite ist derzeit nicht implementiert. Accounts werden ausschließlich im vorgesehenen administrativen Rahmen gelöscht.

### Runden und Mitglieder

- Erstellen und Bearbeiten eigener Runden mit Name sowie optional System, Beschreibung und Termin
- Rundenstatus `active`, `paused` und `archived`
- getrennte Ansichten für laufende Runden und das Archiv
- archivierte Runden bleiben als Historie erhalten und werden nicht gelöscht
- Rundenrollen `game_master` und `player`
- Spieler suchen, hinzufügen und entfernen
- Spielleitung an ein bestehendes Rundenmitglied übertragen

Eine administrative Rundensperre mit Grund ist vom normalen Rundenstatus getrennt. Bei einer Sperre wird die Runde für den GM read-only; Spieler können die gesperrte Runde nicht sehen. Persönliche Rechte eines Character-Owners bleiben davon unberührt.

Wird der Account eines GM gelöscht, bleibt die Runde bestehen. Sie wird archiviert und als verwaist markiert; vorhandene Mitgliedschaften und Rundendaten bleiben erhalten. Ausschließlich der Superadmin kann einer solchen Runde eine neue Spielleitung zuweisen. Die spätere Reaktivierung erfolgt getrennt über den normalen Archiv-Lifecycle.

### Charaktere

- globale persönliche Charakterbibliothek, unabhängig von einzelnen Runden
- persönliche Characters und vom GM vorbereitete Characters
- Character Templates mit Versionierung
- Zuweisung persönlicher und vorbereiteter Characters zu Runden
- optionales Kopieren bei der Zuweisung eines vorbereiteten Characters
- maximal ein aktiver Character je Spieler und Runde
- Owner-Rechte auf den eigenen Character, auch bei einer gesperrten Runde
- GM-Rechte auf Characters der eigenen Runde; bei administrativer Sperre nur lesend
- Soft Delete mit persönlichem und GM-bezogenem Papierkorb
- Wiederherstellung bis einschließlich 14 Tage nach dem Löschen
- automatischer Purge nach Ablauf der Wiederherstellungsfrist
- private Character-Portraits in Supabase Storage

Globale Adminrechte verleihen keine Character-, Character-Portrait- oder sonstigen Contentrechte.

### Administration

Normale Admins erhalten eine administrative Nutzer- und Rundenübersicht. Sie können Nutzer im vorgesehenen Rollenrahmen verwalten und administrative Archiv-/Lifecycle-Funktionen verwenden. Daraus entstehen keine automatischen GM-, Character- oder Portraitrechte.

Der Superadmin ist ein besonders geschützter Admin. Er verwaltet das Admin-Tier, kann verwaiste Runden wiederherstellen und Runden administrativ sperren oder entsperren. Auch der Superadmin ist kein Super-GM und erhält keine zusätzlichen Character- oder Portrait-Contentrechte.

Im Produktmodell ist genau ein permanenter geschützter Superadmin vorgesehen. Die Datenbank verhindert mehrere Superadmins und schützt den vorhandenen Superadmin vor Herabstufung und Löschung. Sie erzwingt technisch nicht, dass zu jedem Zeitpunkt mindestens ein Superadmin existiert.

## Rollen- und Sicherheitsmodell

Globale Rollen:

- `user`: regulärer Nutzer
- `admin`: globaler Administrator
- Superadmin: `role = 'admin'` und zusätzlich `is_superadmin = true`

Rollen innerhalb einer Runde:

- `player`: Spieler der Runde
- `game_master`: Spielleitung der Runde

Globale und rundenbezogene Rollen sind voneinander getrennt: Admin ist nicht automatisch GM, und der Superadmin ist kein Super-GM. Ein regulärer Nutzer kann eine Runde leiten, während ein Admin in einer Runde lediglich Spieler sein kann.

Für die Sicherheit gilt:

- UI-Gating dient der Benutzerführung und ist keine Sicherheitsgrenze.
- Autorisierung und Datenzugriff werden serverseitig über RLS, RPCs und abgesicherte Edge Functions geprüft.
- Service-Role- oder andere privilegierte Schlüssel gehören niemals ins Frontend.
- Secrets und lokale Environment-Dateien dürfen nicht committed werden.

## Technik

- React 19
- TypeScript 6
- Vite 8
- React Router 7
- Supabase JS 2
- Supabase mit PostgreSQL, Auth, Storage, Row Level Security und RPCs
- Deno für Supabase Edge Functions
- Vercel für das Frontend-Deployment
- Node.js 24
- ESLint 10

Die erwartete Node.js-Version ist in `.nvmrc` und unter `engines` in `package.json` festgelegt.

## Lokale Einrichtung

### 1. Repository klonen

```bash
git clone <REPOSITORY_URL>
cd necronomicon-as-a-service-test
```

### 2. Node.js und Abhängigkeiten

Mit `nvm` kann die erwartete Node.js-Version direkt verwendet werden:

```bash
nvm use
npm install
```

Für eine reproduzierbare Installation exakt aus `package-lock.json` ist alternativ möglich:

```bash
npm ci
```

### 3. Frontend-Umgebung konfigurieren

Im Projektstamm eine lokale, nicht versionierte `.env.local` anlegen:

```env
VITE_SUPABASE_URL=<SUPABASE_URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<SUPABASE_PUBLISHABLE_KEY>
VITE_APP_ENV=staging
```

Die Umgebungskennzeichnung wird zentral in `src/lib/environment.ts` aus
`import.meta.env.VITE_APP_ENV` abgeleitet. Nur der exakte Wert `production`
blendet das Badge `TESTSYSTEM` aus; `staging`, fehlende und unbekannte Werte
zeigen es sicherheitshalber an.

Lokal bleibt `VITE_APP_ENV=staging` in `.env.local` unabhängig vom Git-Branch.
In Vercel wird `VITE_APP_ENV=staging` für Staging/Preview und
`VITE_APP_ENV=production` für Production in der jeweiligen Environment-Konfiguration
gesetzt. Vite übernimmt den Wert beim Start beziehungsweise Build: Nach einer
Änderung den Entwicklungsserver neu starten beziehungsweise das Deployment neu bauen.
Beim Wechsel oder Merge zwischen `staging` und `main` müssen keine Dateien
manuell angepasst, gestasht oder vom Merge ausgeschlossen werden.

### 4. Entwicklungsserver starten

```bash
npm run dev
```

Vite stellt die Anwendung standardmäßig unter `http://localhost:5173` bereit.

Weitere verfügbare Scripts:

```bash
# TypeScript prüfen und Produktions-Bundle bauen
npm run build

# ESLint ausführen
npm run lint

# Produktions-Bundle lokal ansehen
npm run preview
```

Das Verknüpfen der Supabase CLI mit einem Projekt ist für den normalen Frontend-Start nicht erforderlich. Es wird erst für Arbeiten an Datenbankmigrationen oder Edge Functions benötigt.

## Environment-Variablen

Das Frontend benötigt ausschließlich:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_APP_ENV
```

Die Edge Functions verwenden abhängig vom jeweiligen Ablauf folgende ausschließlich serverseitige Variablen:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SECRET_KEYS
CHARACTER_PURGE_CRON_SECRET
```

Serverseitige Schlüssel und Secrets dürfen niemals als `VITE_`-Variable bereitgestellt oder in das Repository aufgenommen werden. Reale URLs, Schlüssel und Secret-Werte gehören nicht in diese Dokumentation.

## Supabase und Migrationen

Die Supabase-Bestandteile liegen unter:

```text
supabase/
├── migrations/   versioniertes Schema, Constraints, RLS und RPCs
└── functions/    Deno Edge Functions
```

Für Datenbank- und Function-Arbeit gelten folgende Regeln:

1. Datenbankänderungen werden ausschließlich als neue Migration unter `supabase/migrations/` angelegt.
2. Vor einem `npx supabase db push` werden Migrationstand, Git-Historie und die im Team noch ausstehende Migration geprüft.
3. Datenbankänderungen werden möglichst kompatibel und additiv ausgerollt.
4. Benötigte Datenbankstrukturen werden zuerst bereitgestellt; anschließend folgt ein dazu kompatibles Frontend.
5. Migrationen, Edge-Function-Deployments und Vercel-Deployments sind voneinander getrennte Schritte.

Hilfreich vor Datenbankarbeiten:

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase migration list
```

`db push` darf nicht unbesehen ausgeführt werden. Das Supabase-Linking ist eine lokale Einstellung und kein Bestandteil des Frontend-Builds.

Die eingecheckte lokale Supabase-Konfiguration ist nicht mit der Produktionsumgebung identisch. Insbesondere reproduziert ein lokaler Supabase-Start die produktive Auth- und Mailkonfiguration nicht automatisch vollständig.

## Deployment

Der aktuelle einfache Produktionspfad besteht aus:

- Git-Branch `main`
- Vercel Production für das Frontend
- Supabase Production für Datenbank, Auth, Storage und Edge Functions

Die Rewrite-Regel in `vercel.json` leitet direkte Browseraufrufe von React-Router-Routen auf `index.html` weiter.

Ein Vercel-Deployment führt keine Migrationen aus und deployt keine Supabase Edge Functions. Alle drei Deployment-Arten werden bewusst getrennt ausgeführt und geprüft.

Eine separate Staging- oder Testumgebung besteht derzeit noch nicht. Nach der Closed Beta wird sie vor weiterer Feature-Entwicklung eingerichtet.

## Closed Beta

- Die Closed Beta findet mit einem kleinen Nutzerkreis statt.
- Vor dem Start werden vorhandene Produktions-Testdaten bereinigt.
- Ab Beginn der Beta wird Production nicht mehr als allgemeine Testspielwiese verwendet.
- Während der Beta liegt der Schwerpunkt auf Bugfixes und Stabilität.

Private Namen, Teilnehmerdaten und Testaccounts werden nicht im Repository dokumentiert.

## Noch nicht implementiert

- Chat und Würfelsystem
- Journal
- Spieltisch beziehungsweise Whiteboard
