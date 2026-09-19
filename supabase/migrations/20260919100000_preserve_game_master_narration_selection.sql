create or replace function public.recalculate_active_character(
  p_round_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_id uuid;
  membership_role text;
  current_active_character_id uuid;
  valid_character_count bigint;
  valid_character_ids uuid[];
  calculated_active_character_id uuid;
begin
  select id, role, active_character_id
  into membership_id, membership_role, current_active_character_id
  from public.round_memberships
  where round_id = p_round_id
    and user_id = p_user_id
  for update;

  if not found then
    return;
  end if;

  -- NULL is an explicit narration choice for a game master. Character lifecycle
  -- changes may clear an invalid selection, but must never select a replacement.
  if membership_role = 'game_master' then
    if current_active_character_id is null then
      return;
    end if;

    if exists (
      select 1
      from public.characters
      where id = current_active_character_id
        and owner_user_id = p_user_id
        and round_id = p_round_id
        and deleted_at is null
    ) then
      return;
    end if;

    update public.round_memberships
    set active_character_id = null
    where id = membership_id
      and active_character_id is not null;
    return;
  end if;

  if current_active_character_id is not null
    and exists (
      select 1
      from public.characters
      where id = current_active_character_id
        and owner_user_id = p_user_id
        and round_id = p_round_id
        and deleted_at is null
    ) then
    return;
  end if;

  select pg_catalog.count(*), pg_catalog.array_agg(id)
  into valid_character_count, valid_character_ids
  from public.characters
  where owner_user_id = p_user_id
    and round_id = p_round_id
    and deleted_at is null;

  if valid_character_count = 1 then
    calculated_active_character_id := valid_character_ids[1];
  else
    calculated_active_character_id := null;
  end if;

  update public.round_memberships
  set active_character_id = calculated_active_character_id
  where id = membership_id
    and active_character_id is distinct from calculated_active_character_id;
end;
$$;


-- Product contract: players select their own character; GMs may also select
-- for other round members. Only the caller's own GM membership accepts NULL.
create function public.set_active_character(
  p_round_id uuid,
  p_character_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  discovered_owner_id uuid;
  locked_profile_count integer;
  caller_role text;
  target_membership_id uuid;
  round_locked_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_round_id is null then
    raise exception 'Character is not available for active selection';
  end if;

  -- Discovery only; revalidate the owner and round after taking locks.
  if p_character_id is null then
    discovered_owner_id := caller_id;
  else
    select owner_user_id into discovered_owner_id
    from public.characters
    where id = p_character_id and round_id = p_round_id
      and deleted_at is null and owner_user_id is not null;
    if not found then
      raise exception 'Character is not available for active selection';
    end if;
  end if;

  -- Protect BOTH caller and target from deletion preparation before taking any
  -- sequence/character/round/membership lock. SHARE also stabilizes pending state.
  perform id from public.profiles
  where id in (caller_id, discovered_owner_id) and deletion_pending_at is null
  order by id for share;
  get diagnostics locked_profile_count = row_count;
  if locked_profile_count <> (case when caller_id = discovered_owner_id then 1 else 2 end) then
    raise exception 'Character is not available for active selection';
  end if;

  -- Same gate as sends, assignments, transfer, archive and deletion preparation.
  -- Acquire it BEFORE Character -> Round, preserving the lifecycle lock order
  -- without competing with a sequence-protected Round -> Character operation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'round-message-sequence:' || p_round_id::text, 0));

  if p_character_id is not null then
    perform id from public.characters
    where id = p_character_id and round_id = p_round_id
      and deleted_at is null and owner_user_id = discovered_owner_id
    for update;
    if not found then
      raise exception 'Character is not available for active selection';
    end if;
  end if;

  select locked_at into round_locked_at from public.rounds
  where id = p_round_id for share;
  if not found then
    raise exception 'Character is not available for active selection';
  end if;
  if round_locked_at is not null then
    raise exception 'Round is locked';
  end if;
  -- Preserve existing status semantics: active, paused and archived are allowed.

  perform id from public.round_memberships
  where round_id = p_round_id and user_id in (caller_id, discovered_owner_id)
  order by user_id for update;

  -- Final authorization under the relevant locks, never an early GM snapshot.
  select role into caller_role from public.round_memberships
  where round_id = p_round_id and user_id = caller_id;
  if not found or caller_role not in ('player', 'game_master') then
    raise exception 'Character is not available for active selection';
  end if;
  if (p_character_id is null or caller_id <> discovered_owner_id)
    and caller_role <> 'game_master' then
    raise exception 'Character is not available for active selection';
  end if;

  select id into target_membership_id from public.round_memberships
  where round_id = p_round_id and user_id = discovered_owner_id;
  if not found then
    raise exception 'Character membership is not available';
  end if;

  update public.round_memberships set active_character_id = p_character_id
  where id = target_membership_id;
end;
$$;

revoke all on function public.set_active_character(uuid, uuid) from public;
revoke all on function public.set_active_character(uuid, uuid) from anon;
grant execute on function public.set_active_character(uuid, uuid) to authenticated;

-- The old entry point must not retain the unguarded Character -> Round path:
-- deletion could otherwise hold Round while waiting for its Character lock.
-- Keep its signature and NULL rejection; delegate all writes to the guarded RPC.
create or replace function public.set_active_character(p_character_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare character_round_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select round_id into character_round_id from public.characters
  where id = p_character_id and round_id is not null
    and owner_user_id is not null and deleted_at is null;
  if not found then
    raise exception 'Character is not available for active selection';
  end if;
  perform public.set_active_character(character_round_id, p_character_id);
end;
$$;
revoke all on function public.set_active_character(uuid) from public;
revoke all on function public.set_active_character(uuid) from anon;
grant execute on function public.set_active_character(uuid) to authenticated;
