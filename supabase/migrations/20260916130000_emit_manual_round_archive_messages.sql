-- Phase 3.3c2-2: both manual archive paths emit one atomic public event.
-- CREATE OR REPLACE preserves signatures, owners and existing execute grants.
create or replace function public.update_round(
  p_round_id uuid,
  p_name text,
  p_system text,
  p_description text,
  p_appointment text,
  p_status text
)
returns public.rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  current_round public.rounds%rowtype;
  updated_round public.rounds%rowtype;
  caller_membership_role text;
  message_body text;
  next_round_seq bigint;
begin
  if caller_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_round_id is null or p_status is null
    or p_status not in ('active', 'paused', 'archived') then
    raise exception 'Invalid round parameters';
  end if;
  if p_name is null or pg_catalog.btrim(p_name) = '' then
    raise exception 'Round name is required';
  end if;

  -- Profile first, before any sequence/round/membership locks. SHARE prevents
  -- concurrent profile deletion/changes, without a later lock upgrade.
  perform id from public.profiles where id = caller_user_id for share;
  if not found then
    raise exception 'Not authorized';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'round-message-sequence:' || p_round_id::text, 0));

  select * into current_round from public.rounds
  where id = p_round_id
  for update;
  if not found then
    raise exception 'Round does not exist';
  end if;
  if current_round.locked_at is not null then
    raise exception 'Round is locked';
  end if;

  -- SHARE is sufficient: this RPC reads but never updates membership.
  select role into caller_membership_role from public.round_memberships
  where round_id = p_round_id and user_id = caller_user_id
  for share;
  if not found or caller_membership_role is distinct from 'game_master' then
    raise exception 'Not authorized';
  end if;

  -- The locked OLD status, not the update row count, determines the event.
  if current_round.status = 'active' and p_status = 'paused' then
    message_body := 'Die Runde wurde pausiert.';
  elsif current_round.status = 'paused' and p_status = 'active' then
    message_body := 'Die Runde wurde fortgesetzt.';
  elsif current_round.status in ('active', 'paused') and p_status = 'archived' then
    message_body := 'Die Runde wurde archiviert.';
  end if;
  -- Unarchive and unchanged status remain message-free.
  update public.rounds
  set name = pg_catalog.btrim(p_name),
    system = nullif(pg_catalog.btrim(p_system), ''),
    description = nullif(pg_catalog.btrim(p_description), ''),
    appointment = nullif(pg_catalog.btrim(p_appointment), ''),
    status = p_status
  where id = p_round_id
  returning * into updated_round;
  if not found then
    raise exception 'Round update failed';
  end if;

  if message_body is not null then
    select coalesce(max(round_seq), 0) + 1 into next_round_seq
    from public.round_messages where round_id = p_round_id;
    insert into public.round_messages (
      round_id, round_seq, author_user_id, character_id, speaker_kind,
      speaker_name_snapshot, kind, recipient_user_id, body, client_request_id
    ) values (
      p_round_id, next_round_seq, null, null, 'system',
      'System', 'system_message', null, message_body, pg_catalog.gen_random_uuid()
    );
  end if;
  -- No exception handler: a failed insert rolls back metadata AND status.
  return updated_round;
end;
$$;

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
  caller_user_id uuid := auth.uid();
  caller_is_admin boolean;
  caller_membership_role text;
  current_status text;
  current_orphaned_at timestamptz;
  current_locked_at timestamptz;
  next_round_seq bigint;
begin
  if caller_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_archived is null then
    raise exception 'Archived state is required';
  end if;

  -- Same role predicate as is_admin(), read under SHARE before sequence/round.
  -- This protects admin demotion and caller deletion without any late upgrade.
  select (role = 'admin' or is_superadmin) into caller_is_admin
  from public.profiles where id = caller_user_id
  for share;
  if not found then
    raise exception 'Not authorized';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'round-message-sequence:' || p_round_id::text, 0));

  select status, orphaned_at, locked_at
  into current_status, current_orphaned_at, current_locked_at
  from public.rounds
  where id = p_round_id
  for update;
  if not found then
    raise exception 'Round does not exist';
  end if;

  -- Admin/Bewahrer need no membership; regular users must still be current GM.
  if not caller_is_admin then
    select role into caller_membership_role from public.round_memberships
    where round_id = p_round_id and user_id = caller_user_id
    for share;
    if not found or caller_membership_role is distinct from 'game_master' then
      raise exception 'Not authorized';
    end if;
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

    -- Definer sees private as well as public history; sequence lock is held.
    select coalesce(max(round_seq), 0) + 1 into next_round_seq
    from public.round_messages where round_id = p_round_id;
    insert into public.round_messages (
      round_id, round_seq, author_user_id, character_id, speaker_kind,
      speaker_name_snapshot, kind, recipient_user_id, body, client_request_id
    ) values (
      p_round_id, next_round_seq, null, null, 'system',
      'System', 'system_message', null, 'Die Runde wurde archiviert.',
      pg_catalog.gen_random_uuid()
    );
    return;
  end if;

  -- Preserve unarchive errors, orphan recovery requirement and target status.
  if current_orphaned_at is not null then
    raise exception 'Round must be recovered before it can leave the archive';
  end if;
  if current_status <> 'archived' then
    raise exception 'Round is not archived';
  end if;
  update public.rounds
  set status = 'paused'
  where id = p_round_id;
  -- No exception handler: insert errors roll back the complete RPC call.
end;
$$;

