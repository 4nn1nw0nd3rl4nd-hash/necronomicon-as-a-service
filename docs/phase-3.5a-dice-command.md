# Phase 3.5a – `/r` im bestehenden Chat

`/r` ist der dauerhaft verfügbare Befehl für einen generischen Würfelwurf im
vorhandenen Chat-Eingabefeld. Ein gewöhnlicher Text wird wie bisher als
Character- oder GM-Chatnachricht gesendet. `/r 3d6+5` erzeugt dagegen nur einen
Wurf über `send_round_dice_roll`; der Befehlsstring wird nicht als Chatnachricht
gespeichert.

## Syntax und Grenzen

Erlaubt ist genau `/r XdN`, `/r XdN+M` oder `/r XdN-M` mit ganzen Dezimalzahlen:

- `X`: 1–50 Würfel.
- `N`: 2–1000 Seiten.
- `M`: 0–9999; ohne Angabe ist der Modifier 0.

Beispiele: `/r 1d20`, `/r 3d6`, `/r 3d6+5`, `/r 2d10-2`,
`/r 1d100-10`. Äußere Leerzeichen, mehrere Leerzeichen nach `/r`,
Leerzeichen um das Vorzeichen und `D` statt `d` sind erlaubt. `/r 3d6+0` ist
gültig und entspricht strukturiert dem Modifier 0. Der Backend-Aufruf erhält
Zahlen; die Anzeige verwendet weiterhin `formatDiceExpression` und lässt `+0`
weg.

[Der reine Parser](../src/lib/parseDiceCommand.ts)
erkennt `/r` nur als eigenständigen Befehl, gefolgt von Whitespace oder dem
Textende. `/random` und `/rhello` bleiben normale Texte. Der ganze Ausdruck
muss passen. `/r`, `d20`, `0d6`, `2d1`, Werte außerhalb der Grenzen,
Fließkommazahlen, angehängter Text und gemischte Ausdrücke wie
`/r 2d6+1d4` werden nicht teilweise interpretiert. Ein erkennbarer, aber
ungültiger `/r`-Befehl zeigt lokal eine kurze Fehlermeldung und behält den
Entwurf. Es läuft dabei kein RPC. Der Parser verwendet weder eine Bibliothek
noch dynamische Ausführung. Die serverseitige Validierung bleibt maßgeblich.

## Sendeflow und Identität

[Der Composer](../src/hooks/useSendRoundMessage.ts)
verwaltet weiterhin den einzigen Entwurf, Busy-Zustand, Request-ID, Netzwerk-
Retry und Fehlertext. Beim Senden entscheidet er zuerst zwischen normalem Text
und `/r`. Ein gültiger Würfelbefehl wird an
[useSendDiceRoll](../src/hooks/useSendDiceRoll.ts)
übergeben. Dieser Hook ruft den bestehenden RPC mit genau sechs Parametern auf:
Runde, Anzahl, Seiten, Modifier, neuer Request-UUID und erwarteter aktiver
Character-ID.

Die Character-ID stammt unverändert aus der vorhandenen Sprecherwahl:
Spieler und GM im Character-Modus senden ihre aktive ID; GM im Spielleitungsmodus
sendet NULL. Es gibt keine lokale Ersatzwahl. Der Server prüft die aktuelle
Mitgliedschaft und Identität erneut.

Ein neuer Wurf erhält eine neue UUID. Ein erfolgreich bestätigter Wurf leert
den Entwurf und gibt seinen Intent frei; auch derselbe Befehlstext erhält beim
nächsten Submit eine neue UUID. Bei einem unbestätigten Netzwerk- oder
Transportversuch bleibt die UUID mit dem unveränderten Entwurf und der damals
gewählten Sprecheridentität verbunden. Erneutes Senden desselben Entwurfs
wiederholt diesen Request idempotent. Bearbeiten des Entwurfs oder ein anderer
Sprecherzustand beginnt einen neuen Request. Bekannte, eindeutige serverseitige
Ablehnungen geben den Dice-Intent frei, behalten aber Entwurf und Fehlermeldung:
Der nächste bewusste Submit erhält eine neue UUID. Das gilt auch für
`DICE_STORED_ROLL_INCOMPLETE`: Der bereits gespeicherte Parent ohne vollständiges
Dice-Detail kann durch Wiederholen derselben UUID nicht repariert werden. Ein
unbekannter RPC-Fehler bleibt dagegen ein unbestätigter Versuch. Während ein
Request läuft, verhindert der bestehende Composer einen zweiten Submit.

Die RPC-Antwort wird als `unknown` durch `decodeRoundMessage` geprüft. Akzeptiert
wird nur `kind = 'dice_roll'` mit vollständigem Detail, derselben Runde und
derselben Request-ID. Bei Decode- oder Contract-Abweichungen kann der Server
den Wurf bereits gespeichert haben. Der Entwurf und die UUID bleiben deshalb
für einen idempotenten Retry erhalten. Auch RPC-/Netzwerkfehler erhalten die
Eingabe und zeigen einen kontrollierten Fehler. Die bestehenden Meldungen für
Identitätswechsel, nicht verfügbaren Character, archivierte/gesperrte Runde,
fehlende Berechtigung und Request-Konflikt gelten auch für Dice. Das bestehende
Refresh-Signal für Zugriffs-/Identitätsänderungen wird weiter ausgelöst.

Nach erfolgreicher Quittung ruft der Composer wie beim Text `chat.reload()` auf.
Der autorisierte Delta-Refetch mit eingebetteten Details bleibt die Quelle für
den sichtbaren Verlauf. Es gibt keine optimistische Dice-Nachricht, keine eigene
Deduplizierung und keine Änderung an Realtime, Pagination oder Unread.
[PlayChatPanel](../src/components/PlayChatPanel.tsx)
nutzt weiterhin das eine Formular. Enter sendet, Shift+Enter fügt einen
Zeilenumbruch ein, und die vorhandene Fokuswiederherstellung gilt auch für
Würfe. Das vorläufige Ergebnis `3d6+2 → 14` bleibt unverändert.

## Abgrenzung und Prüfung

Die Verhaltensprüfungen in `tests/realtime-round.test.mjs` decken gültige und
ungültige Syntax, Grenzen, Command-Routing, alle RPC-Parameter, Modifier,
Request-ID-Neuvergabe und Retry, Spieler-/GM-Identität, Doppel-Submit,
Fehler- und Antwortprüfung sowie Formular/Enter ab. Die bestehenden Chat-,
Realtime-, Pagination- und Unread-Tests bleiben Teil der vollständigen Suite.

Phase 3.5b ergänzt die ausführliche Hilfe, 3.5c Schnellwürfel und 3.5d die
Dice-Card. Würfelbuttons, Pools, gemischte Würfelarten, Secret Rolls,
systemspezifische Masken, Character-Sheet-Rolls und Reroll gehören nicht zu
3.5a. Diese Phase enthält keine Datenbankmigration oder SQL-Änderung.
