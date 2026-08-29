create function public.update_character(
  p_character_id uuid,
  p_name text,
  p_data jsonb
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
  normalized_name text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select owner_user_id, round_id
  into character_owner_id, character_round_id
  from public.characters
  where id = p_character_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Character is not available';
  end if;

  if character_owner_id is distinct from current_user_id
    and (
      character_round_id is null
      or not public.is_round_game_master(character_round_id)
    ) then
    raise exception 'Character is not available';
  end if;

  normalized_name := pg_catalog.btrim(p_name);

  if normalized_name is null
    or pg_catalog.char_length(normalized_name) = 0 then
    raise exception 'Character name is required';
  end if;

  if pg_catalog.char_length(normalized_name) > 100 then
    raise exception 'Character name must not exceed 100 characters';
  end if;

  if p_data is null or pg_catalog.jsonb_typeof(p_data) <> 'object' then
    raise exception 'Character data must be a JSON object';
  end if;

  update public.characters
  set name = normalized_name,
      data = p_data
  where id = p_character_id;
end;
$$;

revoke all
on function public.update_character(uuid, text, jsonb)
from public;

revoke all
on function public.update_character(uuid, text, jsonb)
from anon;

grant execute
on function public.update_character(uuid, text, jsonb)
to authenticated;
