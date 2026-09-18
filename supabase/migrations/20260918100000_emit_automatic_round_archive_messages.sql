-- Phase 3.3c2-3: deletion preparation and automatic archive events are atomic.
-- Preserve the existing signature, owner, grants and early profile-lock order.
create or replace function public.prepare_user_deletion(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  caller_role text;
  caller_is_superadmin boolean;
  target_role text;
  target_is_superadmin boolean;
  gm_membership record;
  candidate_round_ids uuid[] := array[]::uuid[];
  candidate_round_id uuid;
  gm_round_ids uuid[] := array[]::uuid[];
  newly_archived_round_ids uuid[] := array[]::uuid[];
  next_round_seq bigint;
begin
  if caller_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select role, is_superadmin
  into caller_role, caller_is_superadmin
  from public.profiles
  where id = caller_user_id
  for share;

  if not found then
    raise exception 'Not authorized';
  end if;

  if not caller_is_superadmin and caller_role <> 'admin' then
    raise exception 'Not authorized';
  end if;

  if caller_user_id = p_user_id then
    raise exception 'You cannot delete your own account';
  end if;

  select role, is_superadmin
  into target_role, target_is_superadmin
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User does not exist';
  end if;

  if target_is_superadmin then
    raise exception 'Superadmin cannot be deleted';
  end if;

  if caller_is_superadmin then
    if target_role not in ('user', 'admin') then
      raise exception 'Target user cannot be deleted';
    end if;
  elsif caller_role = 'admin' then
    if target_role <> 'user' then
      raise exception 'Admins can only delete users';
    end if;
  end if;

  update public.profiles
  set deletion_pending_at = coalesce(
    deletion_pending_at,
    pg_catalog.now()
  )
  where id = p_user_id;

  -- Discovery only: the profile U-lock precedes this read and blocks the
  -- target's transfer/FK paths. Never take row locks while discovering candidates.
  select coalesce(pg_catalog.array_agg(round_id order by round_id), array[]::uuid[])
  into candidate_round_ids
  from public.round_memberships
  where user_id = p_user_id and role = 'game_master';

  -- Acquire EVERY candidate sequence before ANY round/membership/character lock,
  -- including already archived rounds. UUID order, never hash order.
  foreach candidate_round_id in array candidate_round_ids
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'round-message-sequence:' || candidate_round_id::text, 0));
  end loop;

  -- Revalidate current membership, existence and status under the existing locks.
  -- Constrain this pass to candidates whose sequence locks are already held.
  for gm_membership in
    select membership.id, membership.round_id,
      round_to_lock.status, round_to_lock.orphaned_at
    from public.round_memberships as membership
    join public.rounds as round_to_lock
      on round_to_lock.id = membership.round_id
    where membership.user_id = p_user_id
      and membership.role = 'game_master'
      and membership.round_id = any(candidate_round_ids)
    order by membership.round_id
    for update of round_to_lock, membership
  loop
    gm_round_ids := pg_catalog.array_append(
      gm_round_ids,
      gm_membership.round_id
    );
    if gm_membership.status <> 'archived' then
      newly_archived_round_ids := pg_catalog.array_append(
        newly_archived_round_ids,
        gm_membership.round_id
      );
    end if;
  end loop;

  -- Preserve cleanup and the existing active-character lifecycle triggers.
  update public.characters
  set round_id = null
  where owner_user_id = p_user_id
    and round_id is not null;

  foreach candidate_round_id in array gm_round_ids
  loop
    -- As before: orphan every confirmed GM round, even if archived or locked.
    update public.rounds
    set
      status = 'archived',
      orphaned_at = pg_catalog.now()
    where id = candidate_round_id;

    if candidate_round_id = any(newly_archived_round_ids) then
      select coalesce(max(round_seq), 0) + 1 into next_round_seq
      from public.round_messages where round_id = candidate_round_id;
      insert into public.round_messages (
        round_id, round_seq, author_user_id, character_id, speaker_kind,
        speaker_name_snapshot, kind, recipient_user_id, body, client_request_id
      ) values (
        candidate_round_id, next_round_seq, null, null, 'system',
        'System', 'system_message', null, 'Die Runde wurde archiviert.',
        pg_catalog.gen_random_uuid()
      );
    end if;
  end loop;

  delete from public.round_memberships
  where user_id = p_user_id;
  -- No exception handler: even a late-round failure rolls back the whole RPC.
end;
$$;
