# Phase 2.16g – Realtime-Abschlussreview

Stand: 2026-09-11, geprüfter Ausgangscommit `2d36c89` (`admin real time`). Der Arbeitsbaum war zu Beginn sauber. Geändert wurden ausschließlich diese Dokumentation und kleine Ergänzungen der vorhandenen Testsuite. Keine Änderungen an Anwendungscode, Dependencies, SQL, RLS oder Grants; kein db push, Commit, Push oder Beginn von Phase 3.

**Ergebnis: noch keine uneingeschränkte Abschlussfreigabe für Phase 2.16.** Die vorhandenen 63 Tests bestehen. Sechs ergänzte Tests ergeben einen erfolgreichen Publication-Vertragstest und fünf reproduzierbare Cleanup-Fehlerfälle. Insgesamt: **69 Tests, 64 erfolgreich, 5 fehlgeschlagen**, keine übersprungenen Tests oder TODO-Markierungen. Die Fehler stammen aus dem geprüften Anwendungscode; dieser wurde im Review nicht verändert.

Die Angabe, dass 2.16a–f bereits auf Staging manuell geprüft wurden, wird als Nutzerangabe berücksichtigt. Dieses Review hat keine neuen echten Mehr-Session-/WebSocket-/RLS- oder Desktop-/Mobiltests auf Staging durchgeführt und keine Remote-Publication ausgelesen. Die Tests verwenden die bestehende Hook-/Seiten-Simulation, Fake-Timer und kontrollierte Backend-Antworten, keinen echten Browser. Das ist keine neue Live-Abnahme.

## Befunde

| Priorität | Fundstelle | Nachweis / Wirkung | Benötigte Korrektur, hier nicht implementiert |
| --- | --- | --- | --- |
| P2, Abschlussblocker | `src/pages/CharacterPage.tsx`, `confirmCopy` / `confirmDelete`; `useCopyCharacter`, `useSoftDeleteCharacter` | Aktion starten, Seite verlassen, dann RPC erfolgreich beantworten: Die alte Seite ruft noch `navigate` auf, beim Kopieren auf den neuen Charakter und beim Löschen auf `/app/characters`. Zwei neue Tests weisen diese unerwünschte Navigation nach. Auch die zugehörigen Hooks und Seiten setzen nach `await` noch State ohne Lebenszyklusprüfung. | Alte Mutationsantworten nach Unmount/Scopewechsel nicht mehr an die Seite weitergeben und keine Navigation/State-Änderung aus veralteten Handlern. Der serverseitige Write darf abgeschlossen sein; ein Client-Cleanup macht ihn nicht rückgängig. |
| P3, Cleanup-Kriterium offen | `src/hooks/useUploadCharacterPortrait.ts`, `src/hooks/useRemoveCharacterPortrait.ts` | Beide Storage-Aktionen rufen im `finally` nach Unmount noch `setIsSubmitting(false)` auf; Fehlermeldungen sind ebenfalls ungeschützt. Zwei neue Erfolgspfad-Tests messen jeweils einen unerlaubten zusätzlichen Setter-Aufruf. Die CharacterPage schützt ihren nachgelagerten Portrait-Reload bereits. | Lifecycle-Prüfung für die Antwort und alle nachgelagerten State-Updates ergänzen, einschließlich Fehlerpfaden. Keine neue Storage-Subscription nötig. |
| P3, Cleanup-Kriterium offen | `src/pages/ProfilePage.tsx`, `handleSubmit` | Der gemeinsame ProfileProvider lebt beim Wechsel innerhalb `/app` weiter. Sein Save darf erfolgreich enden, doch die verlassene ProfilePage setzt anschließend noch Draft und Erfolgsmeldung. Ein neuer Test misst zwei Setter-Aufrufe nach Unmount. | Nur die lokale Seitenfortsetzung an deren Lebenszyklus binden; den legitimen Save und den Abgleich im gemeinsamen Provider erhalten. |

Die P3-Setter-Aufrufe belegen keinen Zugriff auf den State einer neuen React-Instanz und kein Datenleck; sie verletzen die explizite Cleanup-Anforderung. Die P2-Navigation ist eine konkrete Nebenwirkung außerhalb der alten Seite. Verwandte ältere Aktions-Hooks wurden nicht pauschal umgebaut. Eine Folgekorrektur sollte die genannten Pfade einschließlich Fehlerantworten, Navigation, Accountwechsel und StrictMode gezielt prüfen.

## Publication-Review

| Bestehende Migration | Ergänzung |
| --- | --- |
| `20260911115021_enable_round_memberships_realtime.sql` | `public.round_memberships` |
| `20260911121357_enable_round_view_realtime.sql` | `public.rounds`, `public.characters`, jeweils einzeln geprüft |
| `20260911135849_enable_own_profile_realtime.sql` | `public.profiles` |

Alle prüfen `pg_catalog.pg_publication_tables` mit `pubname = 'supabase_realtime'`, `schemaname = 'public'` und dem jeweiligen `tablename`. Nur bei fehlendem Eintrag folgt `ALTER PUBLICATION supabase_realtime ADD TABLE public.<Tabelle>`. Keine Publication-Neuerstellung, kein DROP, kein SET TABLE, keine Entfernung oder zusätzliche Tabelle. Keine RLS-/Grant-/REPLICA-IDENTITY-Änderungen in diesen Migrationen. Genau diese vier Tabellen sind statisch vorgesehen; es fehlt keine weitere Migration. Der ergänzte Test schützt diese SQL-Struktur, führt aber kein SQL aus.

## Vollständiges Channel-Inventar

Alle Postgres-Changes-Bindings verwenden Schema `public` und `useRealtimeInvalidation`. U = aktuelle User-ID, R = konkrete Runden-ID, C = konkrete Charakter-ID. Jede Tabellenzeile beschreibt einen Channel; mehrere exakte Rundenfilter der Übersicht teilen sich einen Channel.

| Ansicht / Lebensdauer | Tabelle | Events | Filter | Cleanup |
| --- | --- | --- | --- | --- |
| Gemeinsames AppLayout / U | `profiles` | UPDATE | `id=eq.U` | Userwechsel, Logout oder Layout-Unmount |
| RoundDetailsPage / U:R | `rounds` | UPDATE | `id=eq.R` | Runden-/Accountwechsel oder Unmount |
| RoundDetailsPage / U:R | `round_memberships` | INSERT, UPDATE | `round_id=eq.R` | wie oben |
| RoundDetailsPage / U:R | `characters` | INSERT, UPDATE | `round_id=eq.R` | wie oben; aktive Liste und Prepared-Papierkorb teilen das Signal |
| CharacterPage / U:C | `characters` | UPDATE | `id=eq.C` | Charakter-/Accountwechsel oder Unmount |
| CharacterPage / U:C:R, nur bei bekannter R | `rounds` | UPDATE | `id=eq.R` | zusätzlich Rundenabhängigkeitswechsel |
| CharacterPage / U:C:R, nur bei bekannter R | `round_memberships` | INSERT, UPDATE | `round_id=eq.R` | wie oben |
| RoundsPage oder CharactersPage / U | `round_memberships` | INSERT, UPDATE | `user_id=eq.U` | Accountwechsel oder Übersichts-Unmount |
| RoundsPage oder CharactersPage / U | `rounds` | UPDATE | je bekannter R `id=eq.R` | zusätzlich Änderung der sortierten, deduplizierten ID-Menge; bei leerer Menge kein Channel |
| Nur CharactersPage / U | `characters` | INSERT, UPDATE | `owner_user_id=eq.U` | Accountwechsel oder Übersichts-Unmount; aktive Liste und Papierkorb teilen das Signal |

Die gezeigten Seiten sind alternative Routen. Einschließlich des gemeinsamen Profil-Channels gibt es auf der Rundenansicht maximal vier, auf dem zugeordneten Charakterbogen maximal vier, auf Meine Runden maximal drei und auf Meine Charaktere maximal vier eigene App-Channels je geöffneter App-Instanz. Profil-, Admin-Nutzer-, Admin-Runden- und Admin-Detailseiten erzeugen außer dem gemeinsamen Profil-Channel keine Channels. Weitere Tabs besitzen jeweils ihre eigene App-Instanz; tabübergreifende Deduplizierung ist nicht vorgesehen.

Es gibt nur eine Stelle mit `supabase.channel` im Anwendungscode. Kein unfiltriertes Tabellenabo, kein DELETE, kein Storage-Realtime, keine Presence-/Broadcast- oder Suchlisten-Channels. `ProfileProvider` umschließt Header und Outlet einmal; `useProfile` ist nur Context-Verbraucher. Rundenlisten und -papierkorb enthalten keine eigenen doppelten Abonnements.

Bei Cleanup werden die alten Handler inaktiv gesetzt und `removeChannel` aufgerufen. Channel-Namen enthalten Instanz und Generation, sodass StrictMode-Replay nicht versehentlich einen noch abzumeldenden Channel wiederverwendet. Scopes und Filterinhalte sind stabil; identische Refetch-Ergebnisse erzeugen keine neuen Channels. Die Coordinator-Hooks entfernen Event-Listener und Timer; Daten-Hooks brechen Reads ab und ignorieren alte Antworten. Vorübergehend überlappende An-/Abmeldung ist wegen asynchroner SDK-Abmeldung möglich; die Simulation prüft Callback-Sperre und Abmeldeaufrufe, keine tatsächliche WebSocket-Freigabe auf Staging.

## Live- und Reconciliation-Wege

Realtime ist überall ein Invalidierungssignal. Payload-Inhalte werden nicht als autorisierter fachlicher Zustand übernommen. Die bestehenden authentifizierten SELECTs beziehungsweise privaten Storage-Abfragen bleiben maßgeblich.

| Bereich | Live bei zugestelltem Event | Bewusst verzögert / zusätzlicher Abgleich |
| --- | --- | --- |
| Rundenansicht | Aktiver Charakter, Membership INSERT/UPDATE, GM-Wechsel, Name/Beschreibung/Status, Lock/Unlock, Prepared-INSERT, Zuweisung, Soft Delete/Restore. Runden-/Membership-Signale laden alle abhängigen Daten, Character-Signale Listen/Papierkorb und Memberships. | Membership-DELETE und wegen RLS oder Verlassen eines Filters fehlende Events: Fokus, sichtbarer Tab, Online, Subscribe/Reconnect. |
| Charakterbogen | Name, Daten, Checks und Zuordnung; Runden-/Membership-Events invalidieren Lock-/GM-Abhängigkeiten. | Entzug von Leserechten kann sein eigenes Signal verhindern. Fokus/Online/Reconnect korrigiert dann den Serverstand; die letzte bekannte Runden-ID bleibt als Abhängigkeit erhalten, private Inhalte werden nach bestätigtem Zugriffsentzug entfernt. |
| Persönliche Übersichten | Eigene Membership-Eintritte/Updates, bekannte Rundennamen/Archivzustände; eigene Charakter-INSERT/UPDATE einschließlich Prepared-Zuweisung mit neuem Owner, Soft Delete und Restore. | Membership-Entfernung, physischer Purge und Scope-Verlassen benötigen ggf. Reconciliation. Nach Entfernen einer Runde aus dem bekannten Rundenscope wird ihre erneute Sichtbarkeit ggf. erst bei Rückkehr entdeckt. |
| Eigenes Profil | UPDATE genau des eigenen Profils; gemeinsamer Refetch aktualisiert Header, Rollenlabel, `RequireAdmin` und dessen Outlet. | Zusätzlicher Browser-/Reconnect-Abgleich; Netzwerkfehler lassen den letzten Stand stehen. |
| Admin/Recovery | Eigene bestehende Aktionen lösen weiterhin Reloads aus. | Nutzerliste und Rundenliste in AdminPage, Detail und Mitglieder/Recovery in AdminRoundDetailsPage: Fokus, sichtbar, Online und Reconnect-Signal des eigenen Profil-Channels. Keine Live-Updates aller Adminobjekte oder automatische Suchwiederholung. |
| Portrait | Eigener Upload/Replace erzwingt frischen Abruf; eigenes Delete entfernt die Anzeige. | Anderer Client: Metadatenabgleich bei Fokus, sichtbar, Online oder Character-Channel-(Re-)Subscribe, kein sofortiges Storage-Signal. |

Alle vier Coordinator-/Focus-Hooks bündeln Ereignisse über ein festes 100-ms-Fenster. Gleichzeitige Fokus-/Visibility-/Online-/Channel-Ereignisse werden pro Coordinator gesammelt. Die jeweiligen Quellen besitzen einen laufenden Read plus höchstens einen vorgemerkten Folgeabruf. Bei dauerhaft eintreffenden echten Änderungen sind weitere serielle Folgeabrufe beabsichtigt; das ist keine globale Begrenzung über alle Quellen. Initialer Subscribe schließt die Fetch-/Subscribe-Lücke und darf deshalb einen zusätzlichen Abgleich auslösen. Keine Intervalle, kein Polling und kein kompletter Seitenreload im geprüften Anwendungscode.

## Zustände und Request-Koordination

Geprüft wurden `useRoundDetails`, `useRoundMembers`, `useRoundCharacters`, `useRoundDeletedPreparedCharacters`, `useCharacter`, `useMyRounds`, `useMyCharacters`, `useMyDeletedCharacters`, `useOwnProfile`, `useAdminUsers`, `useAdminRounds`, `useAdminRoundDetails` sowie der Portrait-Lesehook und ihre Seitenanbindungen.

- Initiales Loading ist vom stillen Hintergrundabruf getrennt. Erfolgreich geladene Inhalte bleiben während Reads und temporären Fehlern bestehen. Bestätigtes Fehlen beziehungsweise `42501` entfernt Daten; Portraits entfernen/revozieren bei fehlendem Objekt oder 401/403/404. Andere Fehler werden konservativ als temporär behandelt; nicht jeder beliebige Backend-Fehlercode bedeutet automatisch Rechteentzug.
- `active`, Abbruchsignale und Scope-Vergleiche schützen die Read-Zustände. Rollenabhängige Character-Listen wechseln den Zugriffsscope beim GM-Wechsel; alter GM-Inhalt wird nicht weiter als neue Berechtigungsbasis übernommen. Der GM-Papierkorb wird bei Rollenverlust deaktiviert.
- Character-Saves/Checks koordinieren eigene Writes mit Read-Generationen, erhalten optimistische Checks und gleichen nach Abschluss – auch nach RPC-Fehlern – den Serverstand ab. Eigene Profil-Saves besitzen ebenfalls Read-/Write-Koordination.
- `remoteChangesPending` vergleicht die Bearbeitungsbaseline einschließlich Zeitstempel, Inhalt, Zuordnung und Lock. Remote-Updates erhalten den Draft; erkannte Konflikte blockieren Button und Submit. Bewusster Reload ersetzt ihn nur bei erfolgreichem Abruf. Eigener Save beendet den Editmodus ohne falsche Konfliktwarnung. Lock nimmt einem GM ohne Ownership die Schreibmöglichkeit, erhält jedoch den Entwurf.
- Archiv-/Papierkorb-Tabs, geöffnete Formulare und Bestätigungen bleiben bei gewöhnlichen Refetches bestehen. Änderungen von Account, Ressource oder Berechtigungsrolle dürfen bewusst Inhalte zurücksetzen. Entfallene Auswahlkandidaten können nicht weiter zugewiesen werden.
- Die allgemeinen Cleanup-Anforderungen sind wegen der oben nachgewiesenen Mutationsfortsetzungen noch nicht vollständig erfüllt. Erfolgreiche Read-/Channel-Tests sind kein Beweis für alle älteren Aktions-Hooks.

## Portraits und Cache

Privater Bucket `character-portraits`, Pfad `<characterId>/portrait`, authentifizierter Blob-Download. Keine öffentliche URL und kein `storage.objects`-Channel. Metadaten liefern Objekt-ID, `updated_at` und gegebenenfalls ETag als Versionsschlüssel. Unveränderte Versionen laden keinen neuen Blob; veränderte Versionen werden mit `cacheNonce` und `cache: 'no-store'` geladen. Die installierte Storage-SDK-Implementierung übernimmt `cacheNonce` als URL-Parameter. Ohne verfügbare Versionsmetadaten wird vorsichtshalber erneut heruntergeladen.

Eigene Uploads setzen den Versionsvergleich zurück. Löschen und Scopewechsel entwerten alte Antworten. Ersetzte, gelöschte und beim Unmount gehaltene Blob-URLs werden revoziert. Die Tests prüfen diesen Ablauf und Requests, nicht reales CDN-/Browsercache-Verhalten. Metadaten und Download sind keine atomare Transaktion; ein zeitgleicher Replace kann einen weiteren Abgleich benötigen. Die oben genannten Cleanup-Lücken liegen in den Upload-/Remove-Mutationshooks, nicht im Blob-Lesehook.

## Security-Bewertung

Statisch kein neu eingeführter Rechtepfad durch Realtime gefunden. `src/lib/supabase.ts` verwendet den vorhandenen Publishable-Key; im Frontend kein Service-Role-Pfad. Ein Subscription-Filter ist keine Autorisierung. Die Bewertung beruht auf den vorhandenen Migrationen und autorisierten Abfragen; eine echte RLS-Prüfung mit mehreren Accounts wurde hier nicht ausgeführt.

| Fall | Bestehende Rechte laut geprüftem Code/SQL |
| --- | --- |
| Spieler | Ungesperrte Mitgliedsrunden und Memberships; Charakter-Inhalte nur bei Ownership, keine allgemeinen Mitspieler-Charakterrechte. |
| GM | Runden-/Mitgliederzugriff und SELECT auf aktive Rundencharaktere sowie gelöschte Prepared Characters. Kein Eigentümer-Papierkorb anderer Nutzer. |
| Admin / Bewahrer ohne GM | Administrative Runden-/Mitgliederdaten, aber keine fremden Character-Inhalts- oder Portraitrechte allein aus der Accountrolle. Lock nur mit `is_superadmin`; Character-SELECT enthält keine Admin-Ausnahme. |
| Locked Round | Gewöhnliche Spieler verlieren Rundensicht, GM/Admin dürfen Metadaten sehen. GM ohne Character-Ownership darf lesen, aber die betreffenden Character-/Check-/Portrait-RPCs bzw. Policies verweigern Writes. Owner-Rechte bleiben erhalten. |
| Archived Round | Kein allgemeiner Character-Leseentzug. Vorbereitete Charakter-Lifecycle-Aktionen sind nach bestehenden RPC-/UI-Regeln eingeschränkt; Archiv und administrativer Lock sind unterschiedliche Zustände. |
| Eigener / fremder / Prepared Character | SELECT über Owner oder tatsächliche GM-Mitgliedschaft; Prepared ohne Owner nur für den GM. Writes über unveränderte autorisierende RPCs. |
| Privates Portrait | Bestehende Storage-SELECT-Regel verlangt Owner/GM-Bezug; Write-Prüfung berücksichtigt zusätzlich Character-Verfügbarkeit und Round-Lock. |
| Profil / Demotion | Authentifizierte Profil-SELECTs sind schon zuvor erlaubt; Live-Scope bleibt eigene ID. Der gemeinsame Serverstand steuert `RequireAdmin`. Rollenaktionen prüfen Rechte serverseitig, Superadmin-Schutz unverändert. |

Wenn Leserechte entfallen, kann das entziehende Event selbst wegen RLS ausbleiben. Bereits geladene Informationen können deshalb bis zum nächsten erfolgreichen Abgleich sichtbar bleiben; neue autorisierte Reads/Writes werden dadurch nicht erlaubt. Auch Offline-Zustände behalten absichtlich den letzten Stand. Dies ist keine garantierte sofortige Fernlöschung bereits geladener Daten.

## Bekannte Grenzen und Lost Updates

- Keine DELETE-Subscription: Membership-DELETE und physischer Character-Purge sind Reconciliation-Fälle.
- Portraits, Admin-Gesamtlisten und fremde Profilnamen in Joins sind nicht vollständig live; Suchen werden nicht im Hintergrund wiederholt. Dauerhaft fokussierte Sessions benötigen für diese Änderungen einen Abgleichauslöser.
- `update_character` ersetzt weiterhin das vollständige JSON-Dokument. Ein zwischen letzter Baseline und Save erfolgter fremder Check/Save kann überschrieben werden, wenn das Event noch nicht verarbeitet wurde. Die Frontend-Konfliktsperre ist keine atomare Versionsbedingung im RPC. Kein Merge und keine neue Lösung in diesem Review.
- Profil-Anzeigenamen verwenden ebenfalls keinen atomaren Konfliktvergleich; ein späterer eigener Save kann eine parallele Änderung überschreiben.
- Echtzeit-Zustellung, Auth-/RLS-Effekte, reale StrictMode-/WebSocket-Freigabe, mobile Darstellung und Browser-/CDN-Verhalten sind durch die isolierten Tests nicht vollständig bewiesen.

## Vollständige manuelle Smoke-Test-Matrix

Staging, mindestens Spieler/Owner + GM + berechtigter Bewahrer; für eigene Übersichten und Profil zwei Sessions desselben Accounts verwenden. Testdaten, Runden-/Charakter-IDs und tatsächliches Ergebnis je Fall protokollieren. Live-Fälle mit sichtbar bleibender Empfängersession prüfen, damit Fokus-Refetch fehlende Eventzustellung nicht verdeckt. Fälle zusätzlich auf schmalem Mobilgerät prüfen, insbesondere geöffnete Formulare und lange Texte.

| Fall | Ablauf | Erwartung |
| --- | --- | --- |
| A – Spieler + GM | Aktiven Charakter wechseln; Mitglied hinzufügen und Membership aktualisieren; Name/Beschreibung der Runde ändern. Check und Character-Name/Daten ändern; in zweiter Session gleichzeitig editieren, Speichern/Enter versuchen, bewusst Serverstand laden, anschließend eigenen Save ausführen. Prepared erstellen, zuweisen (auch Kopie), Soft Delete/Restore; Runde archivieren/entarchivieren. | Autorisierte Empfänger übernehmen Werte ohne Reload. Draft bleibt erhalten, erkannter Konflikt sperrt Save; eigener Save erzeugt keine falsche Warnung. Zuweisung, aktive Auswahl und Papierkorb stimmen; Archivaktionen respektieren bestehende Einschränkungen. |
| B – GM-Wechsel | Alter GM überträgt an neuen GM, beide haben Rundenansicht bzw. fremden Character offen. | Neue GM-Aktionen erscheinen, alte verschwinden; fremde Inhalte nach bestätigtem Zugriffsentzug entfernt. Falls RLS das Signal unterdrückt, Fokus/Reconnect prüfen. Eigene Character-Rechte bleiben erhalten. |
| C – Bewahrer/Lock | Lock/Unlock aus Admin-Detail; als normaler Spieler, GM, Owner und Admin/Bewahrer ohne GM vergleichen. Direkte fremde Character-/Portrait-Zugriffe ohne GM/Ownership versuchen. | Spieler-Rundenzugriff wird korrekt entzogen/wiederhergestellt; GM-Writes gesperrt, Owner-Writes erlaubt. Adminrolle allein gibt keine fremden Character-/Portrait-Inhaltsrechte. RLS-verdeckten Lock zusätzlich durch Fokus abgleichen. |
| D – Übersichten | Meine Runden/Archiv und Meine Charaktere/Papierkorb geöffnet lassen. Mitglied hinzufügen/entfernen, Character neu erstellen/zuweisen, löschen, wiederherstellen und im vorhandenen erlaubten Purge-Verfahren entfernen. | Listen und Rundennamen aktualisieren sich; DELETE/Purge spätestens nach Fokus/Reconnect. Archiv-/Papierkorb-Tab, Formulareingaben und Bestätigungen bleiben bei normalen Refetches erhalten. |
| E – Portrait | Upload, deutlich anderes Replace, Delete; zweite Session jeweils durch Fokus/Visibility/Reconnect abgleichen. Mehrmals unverändert abgleichen. | Neues Bild/Leerzustand, keine alte Cacheversion; unverändert nur Metadatenabruf, kein weiterer Download. Keine öffentliche URL; alte Blob-URLs werden freigegeben. |
| F – Profil | Bewahrer befördert/demotiert gewöhnlichen Account; dieser hat Profil bzw. Adminseite offen. Eigenen Anzeigenamen in zweiter Session ändern, während die erste einen Entwurf hält. | Navigation, Rolle und Adminzugriff folgen Serverstand; Entwurf bleibt. Ein Profil-Channel pro App-Instanz. Schutz des Bewahrers nicht umgehen. |
| G – Admin | Nutzerrolle, Rundendaten und Mitgliedschaft in anderer Session ändern, danach zu Nutzerliste, Rundenliste und Detail zurückkehren. Recovery öffnen/ausfüllen und Abgleich auslösen; eigene Recovery abschließen. | Stille Aktualisierung, keine Leer-/Ladephase, Recovery-Entwurf bleibt; keine erneute Suche ohne Eingabeaktion. Eigene Recovery lädt Details/Mitglieder neu; keine breiten Admin-Channels. |
| H – Netzwerk | Offline während Read und während Check/Save, wieder online; Fokus und Visibility kurz hintereinander, WebSocket-Reconnect. | Letzter bestätigter Inhalt bleibt bei temporären Fehlern. Folgeabruf geht nicht verloren; nach Writes kanonischer Stand. Gebündelte statt paralleler doppelter Reads, kein Polling/Seitenreload. |
| I – Cleanup | Mit laufenden Reads, Checks, Saves, Kopier-/Lösch- und Portraitaktionen navigieren, ausloggen, Account wechseln. Unter StrictMode wiederholen; neue Seite geöffnet lassen, alte Requests dann beantworten. | Keine alten Inhalte, zusätzlichen Channels/Listener/Timer oder nachträgliche Navigation; keine Setter nach Unmount. Dieser Punkt ist wegen der fünf automatisiert reproduzierten Fehlerfälle derzeit nicht vollständig erfüllt. |

Alle A–I stehen als neuer finaler Mehr-Session-Smoke-Test in diesem Review auf **nicht selbst ausgeführt**; die Nutzerbestätigung zu den früheren Einzelphasen ersetzt nicht das Ergebnis dieser neuen Fehlerfälle.

## Ausgeführte Qualitätsprüfungen und Freigabe

- `npm run build`: erfolgreich, bestehender Hinweis auf JavaScript-Chunk über 500 kB (602,07 kB minifiziert).
- `npm run lint`: erfolgreich.
- `node tests/realtime-round.test.mjs`: Ausgangssuite 63/63 erfolgreich; nach sechs gezielten Ergänzungen **64/69 erfolgreich, fünf Fehler**, Exitcode 1. Die Fehler bleiben sichtbar und sind nicht als erwartete Erfolge oder TODOs kaschiert.
- `git diff --check`: erfolgreich. Statisches Diff-Review: nur Tests und dieser Bericht, keine Produktionscode-/DB-Änderungen.

**Abschlussentscheidung:** Publication- und Realtime-/Reconciliation-Lesewege zeigen im geprüften Stand keinen neuen Rechte- oder Channel-Blocker. Der reproduzierte Navigationsfehler ist jedoch ein Abschlussblocker; außerdem bleiben die Mutations-Cleanup-Kriterien offen. Phase 2.16 derzeit nicht als vollständig abgeschlossen markieren. Erst die kleinen, getrennten Lifecycle-Korrekturen samt grüner Regressionstests und gezielter manueller Nachprüfung der betroffenen Fälle abschließen. Keine Phase 3 begonnen.
