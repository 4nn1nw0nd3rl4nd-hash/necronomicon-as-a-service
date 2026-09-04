alter table public.rounds
add column locked_at timestamptz,
add column locked_reason text;


alter table public.rounds
add constraint rounds_lock_state_is_consistent
check (
  (
    locked_at is null
    and locked_reason is null
  )
  or (
    locked_at is not null
    and locked_reason is not null
    and pg_catalog.btrim(locked_reason) <> ''
    and pg_catalog.char_length(pg_catalog.btrim(locked_reason)) <= 500
  )
);


create function public.set_round_locked(
  p_round_id uuid,
  p_locked boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  current_locked_at timestamptz;
  current_locked_reason text;
  normalized_reason text;
begin
  if caller_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = caller_user_id
      and is_superadmin = true
  ) then
    raise exception 'Not authorized';
  end if;

  if p_locked is null then
    raise exception 'Locked state is required';
  end if;

  select locked_at, locked_reason
  into current_locked_at, current_locked_reason
  from public.rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'Round does not exist';
  end if;

  if p_locked then
    normalized_reason := pg_catalog.btrim(p_reason);

    if normalized_reason is null
      or pg_catalog.char_length(normalized_reason) = 0 then
      raise exception 'Lock reason is required';
    end if;

    if pg_catalog.char_length(normalized_reason) > 500 then
      raise exception 'Lock reason must not exceed 500 characters';
    end if;

    if current_locked_at is not null then
      if current_locked_reason = normalized_reason then
        return;
      end if;

      raise exception 'Round is already locked with a different reason';
    end if;

    update public.rounds
    set
      locked_at = pg_catalog.now(),
      locked_reason = normalized_reason
    where id = p_round_id;

    return;
  end if;

  if current_locked_at is null then
    return;
  end if;

  update public.rounds
  set
    locked_at = null,
    locked_reason = null
  where id = p_round_id;
end;
$$;

revoke all
on function public.set_round_locked(uuid, boolean, text)
from public;

revoke all
on function public.set_round_locked(uuid, boolean, text)
from anon;

grant execute
on function public.set_round_locked(uuid, boolean, text)
to authenticated;


create function public.can_view_round(
  p_round_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_round_game_master(p_round_id)
    or (
      public.is_round_member(p_round_id)
      and exists (
        select 1
        from public.rounds
        where id = p_round_id
          and locked_at is null
      )
    );
$$;

revoke all
on function public.can_view_round(uuid)
from public;

revoke all
on function public.can_view_round(uuid)
from anon;

grant execute
on function public.can_view_round(uuid)
to authenticated;


drop policy if exists "Round members can view rounds"
on public.rounds;

create policy "Round members can view rounds"
on public.rounds
for select
to authenticated
using (
  public.can_view_round(id)
);


drop policy if exists "Round members can view memberships"
on public.round_memberships;

create policy "Round members can view memberships"
on public.round_memberships
for select
to authenticated
using (
  public.can_view_round(round_id)
);


drop policy if exists "Game masters can update rounds"
on public.rounds;

create policy "Game masters can update rounds"
on public.rounds
for update
to authenticated
using (
  public.is_round_game_master(id)
  and locked_at is null
)
with check (
  public.is_round_game_master(id)
  and locked_at is null
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
declare
  current_locked_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_round_game_master(p_round_id) then
    raise exception 'Not authorized';
  end if;

  select locked_at
  into current_locked_at
  from public.rounds
  where id = p_round_id
  for share;

  if not found then
    raise exception 'Round does not exist';
  end if;

  if current_locked_at is not null then
    raise exception 'Round is locked';
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

revoke all
on function public.add_player_to_round(uuid, uuid)
from anon;

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
declare
  current_locked_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_round_game_master(p_round_id) then
    raise exception 'Not authorized';
  end if;

  select locked_at
  into current_locked_at
  from public.rounds
  where id = p_round_id
  for share;

  if not found then
    raise exception 'Round does not exist';
  end if;

  if current_locked_at is not null then
    raise exception 'Round is locked';
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

revoke all
on function public.remove_player_from_round(uuid, uuid)
from anon;

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
  current_locked_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_round_game_master(p_round_id) then
    raise exception 'Not authorized';
  end if;

  select locked_at
  into current_locked_at
  from public.rounds
  where id = p_round_id
  for share;

  if not found then
    raise exception 'Round does not exist';
  end if;

  if current_locked_at is not null then
    raise exception 'Round is locked';
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

revoke all
on function public.transfer_game_master(uuid, uuid)
from anon;

grant execute
on function public.transfer_game_master(uuid, uuid)
to authenticated;


create or replace function public.set_round_archived(
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
  current_orphaned_at timestamptz;
  current_locked_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_archived is null then
    raise exception 'Archived state is required';
  end if;

  select status, orphaned_at, locked_at
  into current_status, current_orphaned_at, current_locked_at
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

  if current_locked_at is not null then
    raise exception 'Round is locked';
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

  if current_orphaned_at is not null then
    raise exception 'Round must be recovered before it can leave the archive';
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

revoke all
on function public.set_round_archived(uuid, boolean)
from anon;

grant execute
on function public.set_round_archived(uuid, boolean)
to authenticated;


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
  character_round_locked_at timestamptz;
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

    character_owner_id := null;
  else
    if p_round_id is not null
      and not public.is_round_member(p_round_id) then
      raise exception 'You must be a round member to assign this character';
    end if;

    character_owner_id := current_user_id;
  end if;

  if p_round_id is not null then
    select status, locked_at
    into character_round_status, character_round_locked_at
    from public.rounds
    where id = p_round_id
    for share;

    if not found then
      raise exception 'Round does not exist';
    end if;

    if character_round_locked_at is not null then
      raise exception 'Round is locked';
    end if;

    if p_is_prepared is true
      and character_round_status = 'archived' then
      raise exception 'Cannot create prepared character in archived round';
    end if;
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


create or replace function public.assign_character_to_round(
  p_character_id uuid,
  p_round_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  character_round_id uuid;
  target_round_locked_at timestamptz;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select round_id
  into character_round_id
  from public.characters
  where id = p_character_id
    and owner_user_id = current_user_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Character is not available';
  end if;

  if character_round_id is not null then
    raise exception 'Character is already assigned to a round';
  end if;

  if p_round_id is null
    or not public.is_round_member(p_round_id) then
    raise exception 'You must be a member of the target round';
  end if;

  select locked_at
  into target_round_locked_at
  from public.rounds
  where id = p_round_id
  for share;

  if not found then
    raise exception 'Round does not exist';
  end if;

  if target_round_locked_at is not null then
    raise exception 'Round is locked';
  end if;

  update public.characters
  set round_id = p_round_id
  where id = p_character_id;
end;
$$;

revoke all
on function public.assign_character_to_round(uuid, uuid)
from public;

revoke all
on function public.assign_character_to_round(uuid, uuid)
from anon;

grant execute
on function public.assign_character_to_round(uuid, uuid)
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
  character_round_locked_at timestamptz;
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

  select status, locked_at
  into character_round_status, character_round_locked_at
  from public.rounds
  where id = character_round_id
  for share;

  if character_round_locked_at is not null then
    raise exception 'Round is locked';
  end if;

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
  original_round_locked_at timestamptz;
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
    select status, locked_at
    into original_round_status, original_round_locked_at
    from public.rounds
    where id = original_round_id
    for share;

    if original_round_locked_at is not null then
      raise exception 'Round is locked';
    end if;

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
  character_round_locked_at timestamptz;
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
    select status, locked_at
    into character_round_status, character_round_locked_at
    from public.rounds
    where id = character_round_id
    for share;

    if character_round_locked_at is not null then
      raise exception 'Round is locked';
    end if;

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
  character_round_locked_at timestamptz;
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
    select status, locked_at
    into character_round_status, character_round_locked_at
    from public.rounds
    where id = character_round_id
    for share;

    if character_round_locked_at is not null then
      raise exception 'Round is locked';
    end if;

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


create or replace function public.update_character(
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
  character_round_locked_at timestamptz;
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

  if character_owner_id is distinct from current_user_id then
    if character_round_id is null
      or not public.is_round_game_master(character_round_id) then
      raise exception 'Character is not available';
    end if;

    select locked_at
    into character_round_locked_at
    from public.rounds
    where id = character_round_id
    for share;

    if character_round_locked_at is not null then
      raise exception 'Round is locked';
    end if;
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


create or replace function public.set_character_check(
  p_character_id uuid,
  p_field_key text,
  p_checked boolean
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
  character_round_locked_at timestamptz;
  normalized_field_key text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  normalized_field_key := pg_catalog.btrim(p_field_key);

  if normalized_field_key is null
    or pg_catalog.char_length(normalized_field_key) = 0 then
    raise exception 'Character field key is required';
  end if;

  if pg_catalog.char_length(normalized_field_key) > 100 then
    raise exception 'Character field key must not exceed 100 characters';
  end if;

  if p_checked is null then
    raise exception 'Character check value is required';
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

  if character_owner_id is distinct from current_user_id then
    if character_round_id is null
      or not public.is_round_game_master(character_round_id) then
      raise exception 'Character is not available';
    end if;

    select locked_at
    into character_round_locked_at
    from public.rounds
    where id = character_round_id
    for share;

    if character_round_locked_at is not null then
      raise exception 'Round is locked';
    end if;
  end if;

  update public.characters
  set data = pg_catalog.jsonb_set(
    data,
    array[normalized_field_key],
    pg_catalog.to_jsonb(p_checked),
    true
  )
  where id = p_character_id;
end;
$$;

revoke all
on function public.set_character_check(uuid, text, boolean)
from public;

revoke all
on function public.set_character_check(uuid, text, boolean)
from anon;

grant execute
on function public.set_character_check(uuid, text, boolean)
to authenticated;


create or replace function public.set_active_character(
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
  character_round_locked_at timestamptz;
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

  select locked_at
  into character_round_locked_at
  from public.rounds
  where id = character_round_id
  for share;

  if character_round_locked_at is not null then
    raise exception 'Round is locked';
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


create function public.can_mutate_character_portrait(
  p_character_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  character_owner_id uuid;
  character_round_id uuid;
  character_round_locked_at timestamptz;
begin
  if current_user_id is null then
    return false;
  end if;

  select owner_user_id, round_id
  into character_owner_id, character_round_id
  from public.characters
  where id = p_character_id
    and deleted_at is null
  for share;

  if not found then
    return false;
  end if;

  if character_owner_id is not distinct from current_user_id then
    return true;
  end if;

  if character_round_id is null
    or not public.is_round_game_master(character_round_id) then
    return false;
  end if;

  select locked_at
  into character_round_locked_at
  from public.rounds
  where id = character_round_id
  for share;

  if not found then
    return false;
  end if;

  return character_round_locked_at is null;
end;
$$;

revoke all
on function public.can_mutate_character_portrait(uuid)
from public;

revoke all
on function public.can_mutate_character_portrait(uuid)
from anon;

grant execute
on function public.can_mutate_character_portrait(uuid)
to authenticated;


drop policy if exists "Character portrait editors can insert"
on storage.objects;

create policy "Character portrait editors can insert"
on storage.objects
for insert
to authenticated
with check (
  storage.objects.bucket_id = 'character-portraits'
  and case
    when storage.objects.name ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/portrait$'
    then public.can_mutate_character_portrait(
      pg_catalog.lower(
        pg_catalog.split_part(storage.objects.name, '/', 1)
      )::uuid
    )
    else false
  end
);


drop policy if exists "Character portrait editors can update"
on storage.objects;

create policy "Character portrait editors can update"
on storage.objects
for update
to authenticated
using (
  storage.objects.bucket_id = 'character-portraits'
  and case
    when storage.objects.name ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/portrait$'
    then public.can_mutate_character_portrait(
      pg_catalog.lower(
        pg_catalog.split_part(storage.objects.name, '/', 1)
      )::uuid
    )
    else false
  end
)
with check (
  storage.objects.bucket_id = 'character-portraits'
  and case
    when storage.objects.name ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/portrait$'
    then public.can_mutate_character_portrait(
      pg_catalog.lower(
        pg_catalog.split_part(storage.objects.name, '/', 1)
      )::uuid
    )
    else false
  end
);


drop policy if exists "Character portrait editors can delete"
on storage.objects;

create policy "Character portrait editors can delete"
on storage.objects
for delete
to authenticated
using (
  storage.objects.bucket_id = 'character-portraits'
  and case
    when storage.objects.name ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/portrait$'
    then public.can_mutate_character_portrait(
      pg_catalog.lower(
        pg_catalog.split_part(storage.objects.name, '/', 1)
      )::uuid
    )
    else false
  end
);
