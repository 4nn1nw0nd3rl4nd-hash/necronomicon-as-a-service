drop policy if exists "Game masters can update rounds"
on public.rounds;

create policy "Game masters can update rounds"
on public.rounds
for update
to authenticated
using (
  public.is_round_game_master(id)
)
with check (
  public.is_round_game_master(id)
);


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

  if not public.is_round_game_master(p_round_id) then
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

  if not public.is_round_game_master(p_round_id) then
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

  update public.characters
  set round_id = null
  where round_id = p_round_id
    and owner_user_id = p_user_id;

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

  if not public.is_round_game_master(p_round_id) then
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


create function public.set_round_archived(
  p_round_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_archived is null then
    raise exception 'Archived state is required';
  end if;

  select status
  into current_status
  from public.rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'Round does not exist';
  end if;

  if not (
    public.is_round_game_master(p_round_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_archived then
    if current_status = 'archived' then
      return;
    end if;

    update public.rounds
    set status = 'archived'
    where id = p_round_id;

    return;
  end if;

  if current_status <> 'archived' then
    raise exception 'Round is not archived';
  end if;

  update public.rounds
  set status = 'paused'
  where id = p_round_id;
end;
$$;

revoke all
on function public.set_round_archived(uuid, boolean)
from public;

grant execute
on function public.set_round_archived(uuid, boolean)
to authenticated;
