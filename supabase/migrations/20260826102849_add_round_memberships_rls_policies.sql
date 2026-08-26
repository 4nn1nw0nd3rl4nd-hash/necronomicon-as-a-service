-- Mitglieder einer Runde dürfen sehen, wer ebenfalls zu dieser Runde gehört.
-- Admins dürfen alle Rundenzugehörigkeiten sehen.
create policy "Round members can view memberships"
on public.round_memberships
for select
to authenticated
using (
  public.is_round_member(round_id)
  or public.is_admin()
);