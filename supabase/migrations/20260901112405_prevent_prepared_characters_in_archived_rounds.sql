create or replace function public.create_character(
  p_name text,
  p_template_key text,
  p_template_version integer,
  p_round_id uuid default null,
  p_is_prepared boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  normalized_name text;
  normalized_template_key text;
  new_character_id uuid;
  character_owner_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  normalized_name := pg_catalog.btrim(p_name);

  if normalized_name is null
    or pg_catalog.char_length(normalized_name) = 0 then
    raise exception 'Character name is required';
  end if;

  if pg_catalog.char_length(normalized_name) > 100 then
    raise exception 'Character name must not exceed 100 characters';
  end if;

  normalized_template_key := pg_catalog.btrim(p_template_key);

  if normalized_template_key is null
    or pg_catalog.char_length(normalized_template_key) = 0 then
    raise exception 'Character template key is required';
  end if;

  if p_template_version is null or p_template_version <= 0 then
    raise exception 'Character template version must be positive';
  end if;

  if not exists (
    select 1
    from public.character_template_versions
    where template_key = normalized_template_key
      and template_version = p_template_version
      and is_available_for_creation = true
  ) then
    raise exception 'Character template is not available for creation';
  end if;

  if p_is_prepared is true then
    if p_round_id is null then
      raise exception 'Prepared characters require a round';
    end if;

    if not public.is_round_game_master(p_round_id) then
      raise exception 'Only the game master can create prepared characters';
    end if;

    if exists (
      select 1
      from public.rounds
      where id = p_round_id
        and status = 'archived'
    ) then
      raise exception 'Cannot create prepared character in archived round';
    end if;

    character_owner_id := null;
  else
    if p_round_id is not null
      and not public.is_round_member(p_round_id) then
      raise exception 'You must be a round member to assign this character';
    end if;

    character_owner_id := current_user_id;
  end if;

  insert into public.characters (
    name,
    owner_user_id,
    round_id,
    template_key,
    template_version,
    data,
    created_by_user_id,
    deleted_at
  )
  values (
    normalized_name,
    character_owner_id,
    p_round_id,
    normalized_template_key,
    p_template_version,
    '{}'::jsonb,
    current_user_id,
    null
  )
  returning id into new_character_id;

  return new_character_id;
end;
$$;

revoke all
on function public.create_character(text, text, integer, uuid, boolean)
from public;

revoke all
on function public.create_character(text, text, integer, uuid, boolean)
from anon;

grant execute
on function public.create_character(text, text, integer, uuid, boolean)
to authenticated;
