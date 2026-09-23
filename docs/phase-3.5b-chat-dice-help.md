# Phase 3.5b – Chat- und Würfelhilfe

Direkt beim bestehenden Chat steht „Chat & Würfelbefehle“ als natives
`<details>/<summary>`. Die Hilfe ist standardmäßig geschlossen und lässt sich
mit Maus, Touch oder Tastatur öffnen. Sie löst weder einen Submit noch eine
Serveraktion aus und verändert den Chat-Entwurf nicht.

Die kurze Anleitung erklärt normale Textnachrichten und `/r`-Würfe anhand von
`/r d20`, `/r 3d6`, `/r 3d6+5` und `/r 2d10-2`. Sie nennt die Grenzen von
1–50 Würfeln, d2–d1000, Modifier −9999 bis +9999 und eine Würfelart pro Wurf.
Die Kurzform `dN±M` verwendet denselben Parser und RPC wie `1dN±M`.

Die Hilfe steht außerhalb des Sendeformulars. Ihre Höhe ist begrenzt und ihr
Inhalt kann innerhalb der Hilfe scrollen; Beispiele dürfen auf schmalen
Bildschirmen umbrechen. Das native Disclosure liefert die Tastaturbedienung und
Semantik ohne zusätzliche ARIA-Attribute oder eigenen Zustand.

Phase 3.5c bleibt die Schnellwürfelmaske. Buttons, Würfelpool, Modifier-Regler,
Dice-Card und Reroll gehören nicht zu dieser Hilfe.
