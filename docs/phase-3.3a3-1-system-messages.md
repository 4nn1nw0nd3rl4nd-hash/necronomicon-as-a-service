# Phase 3.3a3-1: Systemnachrichten im Chat

Der bestehende Chat lädt weiterhin alle für den angemeldeten Nutzer durch RLS
sichtbaren Zeilen über Initial Load, Pagination und autorisierten Delta-Refetch.
Es gibt keinen clientseitigen Empfängerfilter und keine zusätzliche
Realtime-Subscription.

Der zentrale Nachrichtentyp bildet nun `system_message`, den Sprecher `system`
und `recipient_user_id` ab. Sichtbare Systemnachrichten bleiben Teil der nach
`round_seq` sortierten Historie und erscheinen als kompakter Informationsblock
mit dem gespeicherten Label, Body-Snapshot und Zeitstempel. Die Character-ID
wird weder aufgelöst noch verlinkt.

Die bestehende Unread-Berechnung zählt geladene sichtbare Nachrichten unabhängig
von ihrer Art. Deshalb war dafür keine Produktänderung nötig.

Die Frontend-Tests prüfen Darstellung, Reihenfolge, nullable Autor-ID, Feldübernahme
und Unread-Verhalten mit kontrollierten Daten. Sie beweisen nicht, dass Realtime
private Systemnachrichten niemals an andere Clients überträgt. Der echte
Mehrsession-/Realtime-Leak-Test auf Staging bleibt Phase 3.3a3-2 beziehungsweise
3.3a3-3 vorbehalten.
