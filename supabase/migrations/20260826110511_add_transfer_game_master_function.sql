create or replace function public.transfer_game_master(
  p_round_id uuid,
  p_new_game_master_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_game_master_id uuid;
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

  select user_id
  into current_game_master_id
  from public.round_memberships
  where round_id = p_round_id
    and role = 'game_master'
  for update;

  if current_game_master_id is null then
    raise exception 'Round has no game master';
  end if;

  if current_game_master_id = p_new_game_master_id then
    raise exception 'User is already game master';
  end if;

  if not exists (
    select 1
    from public.round_memberships
    where round_id = p_round_id
      and user_id = p_new_game_master_id
      and role = 'player'
  ) then
    raise exception 'New game master must be a player in the round';
  end if;

  update public.round_memberships
  set role = 'player'
  where round_id = p_round_id
    and user_id = current_game_master_id;

  update public.round_memberships
  set role = 'game_master'
  where round_id = p_round_id
    and user_id = p_new_game_master_id;
end;
$$;

revoke all
on function public.transfer_game_master(uuid, uuid)
from public;

grant execute
on function public.transfer_game_master(uuid, uuid)
to authenticated;