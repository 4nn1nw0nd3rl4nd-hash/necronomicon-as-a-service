# Phase 3.5e: Generic Reroll

Vollständige generische Würfelwürfe bieten in ihrer aufgeklappten
Detailansicht die Aktion `↻ Nochmal würfeln`. Jeder für die aktuelle Person
sichtbare Wurf kann als Vorlage dienen; die Aktion ist nicht auf eigene Würfe
beschränkt.

## Neuer Wurf aus einer Vorlage

Ein Reroll übernimmt ausschließlich `dice_count`, `dice_sides` und `modifier`
aus den gespeicherten Würfeldetails. Die beim Klick aktuelle eigene
Sprecheridentität wird wie bei `/r` und Schnellwürfeln als
`expected_active_character_id` verwendet. Die historische Identität des
Message-Autors wird weder übernommen noch an den Server gesendet.

Der Reroll verwendet denselben Dice-Sendekern und denselben
`send_round_dice_roll`-RPC wie die bestehenden Eingabewege. Er erzeugt eine
neue, unabhängige Dice-Message. Der ursprüngliche Wurf bleibt unverändert;
es gibt keinen lokalen Message-Insert und keine persistente Verknüpfung zur
Quellnachricht. Der bestehende Delta-/Realtime-Pfad nimmt den neuen Wurf auf.

## Request-ID und Retry

Jeder erfolgreich abgeschlossene und danach erneut bewusst ausgelöste Reroll
erhält eine neue `client_request_id`. Nach einem ambigen Transport-, Decoder-
oder Contract-Fehler verwendet ein erneuter Klick auf denselben Quellwurf mit
denselben Parametern und derselben aktuellen Identität dieselbe Request-ID.
Definitive serverseitige Ablehnungen geben den Intent wie bisher frei.

Die `source message_id` unterscheidet nur clientseitig Reroll-Intents mit
ansonsten identischen Diceparametern. Ein Reroll einer anderen Quellnachricht
erhält deshalb nach einem ambigen Fehler eine neue Request-ID. Die ID der
Quellnachricht wird nicht an den RPC gesendet und nicht persistiert. Auch eine
geänderte aktuelle Sprecheridentität erzeugt einen neuen Intent mit neuer
Request-ID.

## Isolation und Abgrenzung

Reroll liest oder verändert weder den Chatdraft noch die vorbereitete
Schnellwürfel-Auswahl. Es schreibt keinen `/r`-Befehl in den Composer. Busy-
und Fehlermeldungen bleiben gemeinsam mit den bestehenden Sendewegen; ein
Doppelklick erzeugt keinen parallelen RPC.

Fehlen vollständige Dice-Details, bleibt es beim bestehenden Fallback ohne
Reroll-Aktion. Phase 3.5e enthält keine Secret Rolls und keine
systemspezifischen Aktionen. Die spätere Regel lautet:

- Generic: `Nochmal würfeln`
- Vaesen: `Wurf pushen`

Vaesen Push wird in dieser Phase nicht implementiert.
