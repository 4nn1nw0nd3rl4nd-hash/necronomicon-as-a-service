create function public.set_active_character(
  p_character_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  character_owner_id uuid;
  character_round_id uuid;
  membership_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_character_id is null then
    raise exception 'Character is not available for active selection';
  end if;

  select owner_user_id, round_id
  into character_owner_id, character_round_id
  from public.characters
  where id = p_character_id
    and deleted_at is null
    and owner_user_id is not null
    and round_id is not null
  for update;

  if not found then
    raise exception 'Character is not available for active selection';
  end if;

  if current_user_id is distinct from character_owner_id
    and not public.is_round_game_master(character_round_id) then
    raise exception 'Character is not available for active selection';
  end if;

  select id
  into membership_id
  from public.round_memberships
  where round_id = character_round_id
    and user_id = character_owner_id
  for update;

  if not found then
    raise exception 'Character membership is not available';
  end if;

  update public.round_memberships
  set active_character_id = p_character_id
  where id = membership_id;
end;
$$;

revoke all
on function public.set_active_character(uuid)
from public;

revoke all
on function public.set_active_character(uuid)
from anon;

grant execute
on function public.set_active_character(uuid)
to authenticated;
