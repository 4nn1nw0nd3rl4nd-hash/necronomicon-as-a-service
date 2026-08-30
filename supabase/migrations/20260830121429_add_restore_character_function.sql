create function public.restore_character(
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
  character_deleted_at timestamptz;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select owner_user_id, round_id, deleted_at
  into character_owner_id, character_round_id, character_deleted_at
  from public.characters
  where id = p_character_id
  for update;

  if not found then
    raise exception 'Character is not available';
  end if;

  if character_owner_id is distinct from current_user_id
    and not (
      character_owner_id is null
      and character_round_id is not null
      and public.is_round_game_master(character_round_id)
    ) then
    raise exception 'Character is not available';
  end if;

  if character_deleted_at is null then
    raise exception 'Character is not deleted';
  end if;

  if character_deleted_at < pg_catalog.now() - interval '14 days' then
    raise exception 'Character recovery period has expired';
  end if;

  update public.characters
  set deleted_at = null
  where id = p_character_id;
end;
$$;

revoke all
on function public.restore_character(uuid)
from public;

revoke all
on function public.restore_character(uuid)
from anon;

grant execute
on function public.restore_character(uuid)
to authenticated;
