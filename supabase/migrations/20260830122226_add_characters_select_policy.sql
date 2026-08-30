create policy "Character owners and game masters can view characters"
on public.characters
for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  or (
    round_id is not null
    and public.is_round_game_master(round_id)
    and (
      deleted_at is null
      or owner_user_id is null
    )
  )
);

grant select on table public.characters to authenticated;
