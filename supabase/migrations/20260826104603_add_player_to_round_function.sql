create or replace function public.add_player_to_round(
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
    from public.profiles
    where id = p_user_id
  ) then
    raise exception 'User does not exist';
  end if;

  insert into public.round_memberships (
    round_id,
    user_id,
    role
  )
  values (
    p_round_id,
    p_user_id,
    'player'
  );
end;
$$;

revoke all
on function public.add_player_to_round(uuid, uuid)
from public;

grant execute
on function public.add_player_to_round(uuid, uuid)
to authenticated;