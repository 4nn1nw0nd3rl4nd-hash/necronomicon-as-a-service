-- Mitglieder einer Runde dürfen die Runde sehen.
create policy "Round members can view rounds"
on public.rounds
for select
to authenticated
using (
  public.is_round_member(id)
  or public.is_admin()
);


-- Nur der Spielleiter dieser Runde oder ein Admin darf die Runde ändern.
create policy "Game masters can update rounds"
on public.rounds
for update
to authenticated
using (
  public.is_round_game_master(id)
  or public.is_admin()
)
with check (
  public.is_round_game_master(id)
  or public.is_admin()
);


-- Löschen dürfen ebenfalls nur Spielleiter oder Admins.
create policy "Game masters can delete rounds"
on public.rounds
for delete
to authenticated
using (
  public.is_round_game_master(id)
  or public.is_admin()
);