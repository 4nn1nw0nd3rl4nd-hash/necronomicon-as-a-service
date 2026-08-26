create or replace function public.remove_player_from_round(
  p_round_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    public.is_round_game_master(p_round_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1
    from public.round_memberships
    where round_id = p_round_id
      and user_id = p_user_id
      and role = 'player'
  ) then
    raise exception 'Player membership does not exist';
  end if;

  delete from public.round_memberships
  where round_id = p_round_id
    and user_id = p_user_id
    and role = 'player';
end;
$$;

revoke all
on function public.remove_player_from_round(uuid, uuid)
from public;

grant execute
on function public.remove_player_from_round(uuid, uuid)
to authenticated;