create function public.assign_prepared_character(
  p_character_id uuid,
  p_user_id uuid
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
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select owner_user_id, round_id
  into character_owner_id, character_round_id
  from public.characters
  where id = p_character_id
    and round_id is not null
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Character is not available';
  end if;

  if not public.is_round_game_master(character_round_id) then
    raise exception 'Character is not available';
  end if;

  if character_owner_id is not null then
    raise exception 'Character already has an owner';
  end if;

  if not exists (
    select 1
    from public.round_memberships
    where round_id = character_round_id
      and user_id = p_user_id
  ) then
    raise exception 'Target user is not a member of this round';
  end if;

  update public.characters
  set owner_user_id = p_user_id
  where id = p_character_id;
end;
$$;

revoke all
on function public.assign_prepared_character(uuid, uuid)
from public;

revoke all
on function public.assign_prepared_character(uuid, uuid)
from anon;

grant execute
on function public.assign_prepared_character(uuid, uuid)
to authenticated;
