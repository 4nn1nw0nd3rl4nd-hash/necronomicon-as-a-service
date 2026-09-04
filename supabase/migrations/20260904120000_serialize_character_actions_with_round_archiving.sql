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
  character_round_status text;
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

    select status
    into character_round_status
    from public.rounds
    where id = p_round_id
    for share;

    if character_round_status = 'archived' then
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


create or replace function public.assign_prepared_character(
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
  character_round_status text;
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

  select status
  into character_round_status
  from public.rounds
  where id = character_round_id
  for share;

  if character_round_status = 'archived' then
    raise exception 'Cannot assign prepared character in archived round';
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


create or replace function public.copy_character(
  p_character_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  original_name text;
  original_owner_id uuid;
  original_round_id uuid;
  original_round_status text;
  original_template_key text;
  original_template_version integer;
  original_data jsonb;
  copy_owner_id uuid;
  copy_round_id uuid;
  copy_name text;
  copy_suffix constant text := ' – Kopie';
  new_character_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select
    name,
    owner_user_id,
    round_id,
    template_key,
    template_version,
    data
  into
    original_name,
    original_owner_id,
    original_round_id,
    original_template_key,
    original_template_version,
    original_data
  from public.characters
  where id = p_character_id
    and deleted_at is null
  for share;

  if not found then
    raise exception 'Character is not available';
  end if;

  if original_owner_id is not distinct from current_user_id then
    copy_owner_id := current_user_id;
    copy_round_id := null;
  elsif original_owner_id is null
    and original_round_id is not null
    and public.is_round_game_master(original_round_id) then
    select status
    into original_round_status
    from public.rounds
    where id = original_round_id
    for share;

    if original_round_status = 'archived' then
      raise exception 'Cannot copy prepared character in archived round';
    end if;

    copy_owner_id := null;
    copy_round_id := original_round_id;
  else
    raise exception 'Character is not available';
  end if;

  copy_name := pg_catalog.left(
    original_name,
    100 - pg_catalog.char_length(copy_suffix)
  ) || copy_suffix;

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
    copy_name,
    copy_owner_id,
    copy_round_id,
    original_template_key,
    original_template_version,
    original_data,
    current_user_id,
    null
  )
  returning id into new_character_id;

  return new_character_id;
end;
$$;

revoke all
on function public.copy_character(uuid)
from public;

revoke all
on function public.copy_character(uuid)
from anon;

grant execute
on function public.copy_character(uuid)
to authenticated;


create or replace function public.soft_delete_character(
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
  character_round_status text;
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

  if character_deleted_at is not null then
    raise exception 'Character is already deleted';
  end if;

  if character_owner_id is null
    and character_round_id is not null then
    select status
    into character_round_status
    from public.rounds
    where id = character_round_id
    for share;

    if character_round_status = 'archived' then
      raise exception 'Cannot delete prepared character in archived round';
    end if;
  end if;

  update public.characters
  set deleted_at = pg_catalog.now()
  where id = p_character_id;
end;
$$;

revoke all
on function public.soft_delete_character(uuid)
from public;

revoke all
on function public.soft_delete_character(uuid)
from anon;

grant execute
on function public.soft_delete_character(uuid)
to authenticated;


create or replace function public.restore_character(
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
  character_round_status text;
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

  if character_owner_id is null
    and character_round_id is not null then
    select status
    into character_round_status
    from public.rounds
    where id = character_round_id
    for share;

    if character_round_status = 'archived' then
      raise exception 'Cannot restore prepared character in archived round';
    end if;
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
