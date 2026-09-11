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

## Charakter-Realtime (Phase 2.16d)

Die geöffnete CharacterPage verwendet den vorhandenen Realtime-Hook als Invalidierungssignal und liest anschließend den autorisierten Serverstand. Sie abonniert `characters UPDATE` mit `id=eq.<characterId>`. Für einen zugeordneten Charakter kommen `rounds UPDATE` mit `id=eq.<roundId>` und `round_memberships INSERT/UPDATE` mit `round_id=eq.<roundId>` hinzu, damit Rundensperren und GM-Wechsel berücksichtigt werden. Diese Stringfilter werden von der eingesetzten Supabase-JS-Version 2.112.4 unterstützt; siehe auch die [Supabase-Dokumentation zu Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

Ereignisse und Fokus-/Visibility-/Reconnect-Abgleiche werden über 100 ms gebündelt. `useCharacter` hält höchstens eine Leseanfrage gleichzeitig offen und merkt weitere Invalidierungen für einen Folgeabruf vor. Eigene Saves und Checks pausieren die Übernahme von Leseantworten; auch eine schon vor dem Write gestartete Antwort wird verworfen. Nach Abschluss aller eigenen Writes erfolgt immer ein Serverabgleich, auch bei RPC-Fehlern. Optimistische Checks bleiben während des Writes erhalten. Es wird kein vermeintlicher Urheber aus einem Event-Payload abgeleitet.

Im Lesemodus werden neue Daten still übernommen. Im Edit-Modus bleiben `draftName` und `draftData` getrennt vom Serverstand. Die Baseline umfasst das vom vorhandenen Trigger gepflegte `updated_at` sowie Inhalt, Zuordnung und den geladenen Sperrstatus. Ein abweichender Serverstand erzeugt einen Hinweis und blockiert sowohl den Speichern-Button als auch den Submit-Handler. „Serverstand laden und lokalen Entwurf verwerfen“ ersetzt den Entwurf erst nach erfolgreichem Reload; bei einem Netzwerkfehler bleibt er erhalten. Ein normaler eigener Save beendet den Edit-Modus und gleicht anschließend den Serverstand ab. Ein Charakter-/Accountwechsel setzt den lokalen Komponenten-State zurück; gewöhnliche Refetches tun dies nicht.

**Verbleibendes Lost-Update-Risiko:** `update_character(uuid, text, jsonb)` ersetzt weiterhin das vollständige `data`-Dokument. Beginnt A mit dem Bearbeiten, setzt B einen Check und speichert A, bevor die fremde Änderung erkannt wurde, kann As alter Draft Bs Check überschreiben. Die Warnung und Speichersperre verhindern das Speichern bei einem bereits erkannten Konflikt, bieten aber keinen atomaren Schutz zwischen Lesen und Schreiben. `updated_at` ist hier eine Frontend-Baseline, keine serverseitige Versionsbedingung. Es gibt kein automatisches Merge und keinen Überschreiben-Button für bekannte Konflikte.

Temporäre Lesefehler erhalten den zuletzt geladenen Inhalt. Eine erfolgreiche leere Antwort, Soft Delete oder ein bestätigter Berechtigungsfehler entfernt ihn aus der Anzeige. Bei einem Round Lock bleiben persönliche Owner-Rechte erhalten; ein GM ohne Besitzrechte sieht den Bogen nur lesend. Ein schon offener GM-Entwurf bleibt dabei erhalten, seine Felder und Speichern werden gesperrt. Falls ein Event wegen RLS/Zugriffsverlust nicht zugestellt wird, erfolgt der Abgleich bei Fokus-/Visibility-Rückkehr oder Reconnect. Eine zuletzt bekannte Runden-ID bleibt dafür als Subscription-Scope erhalten, ohne den nicht mehr autorisierten Charakterinhalt anzuzeigen. Keine DELETE-Subscription, kein Polling, keine RLS-/Grant-/Publication-Änderung.

Automatisierte Prüfung: `node tests/realtime-round.test.mjs`, außerdem `npm run build`, `npm run lint` und `git diff --check`. Die Tests simulieren Hook-Lebenszyklen, Seitenzustände, Zeit und Backend-Antworten; sie ersetzen keinen echten Zwei-Session-/RLS-Test.

### MANUAL: Zwei Sessions auf Staging

Für gemeinsame Character-Rechte beispielsweise Owner und GM derselben ungesperrten Runde verwenden. Die empfangende Session im Vordergrund lassen, damit ein Fokusabgleich fehlende Live-Events nicht verdeckt.

| Fall | Ablauf und erwartetes Ergebnis |
| --- | --- |
| A: Lesen | Beide öffnen denselben Charakter. A ändert Name/Wert und speichert; B zeigt den neuen Stand ohne Reload oder Ladeflackern. |
| B: Check | A setzt einen Check; B zeigt ihn ohne Reload. |
| C: Edit-Konflikt | A bearbeitet Name und Text, B ändert den Charakter. As Eingaben bleiben erhalten, der Hinweis erscheint. |
| D: Konflikt-Save | A versucht zu speichern, auch per Enter. Der erkannte Konflikt blockiert den Save; kein `update_character`-RPC wird gesendet. |
| E: Bewusster Reload | A lädt den Serverstand über den ausdrücklich als Verwerfen beschrifteten Button. Der aktuelle Entwurf wird ersetzt, der Hinweis verschwindet. Bei Netzwerkfehler bleiben Entwurf und Hinweis erhalten. Auch Abbrechen prüfen. |
| F: Eigener Save | Ohne Konflikt speichern, danach erneut Bearbeiten öffnen. Keine falsche Konfliktwarnung durch das eigene Event. |
| G: Schnelle Checks | Beide Sessions setzen schnell Checks, auch auf unterschiedlichen Feldern. Nach Ende der Anfragen entspricht die Anzeige dem Serverstand. Offline-/Fehlerfall ebenfalls prüfen. |
| H: Round Lock/Zugriff | Die Runde mit berechtigtem Account sperren/entsperren. Owner bleibt editierberechtigt; GM ohne Besitzrechte wird read-only, ein offener Entwurf bleibt erhalten. GM-Wechsel, Zuordnung und Soft Delete prüfen; bei ausbleibendem Event muss Fokus/Reconnect den Zugriff korrigieren. |
| I: Navigation/Logout | Mit laufender Anfrage Charakter wechseln oder ausloggen. Keine alten Inhalte/Entwürfe in der neuen Ansicht, keine verbleibenden Channels der alten Seite. StrictMode und Reconnect mitprüfen. |

Den Konflikthinweis zusätzlich auf Desktop und schmalem Mobilgerät mit Tastatur und langen Texten prüfen. Diese manuellen Tests wurden durch die isolierte Testumgebung nicht ausgeführt. Portrait-Realtime und Portrait-Versionierung bleiben Phase 2.16e vorbehalten; globale Übersichten, Profile und Administration werden hier nicht live synchronisiert.
