-- Phase 3.3a2-1: both public entry points share one atomic assignment path.
-- No exception handler: a failed message also rolls back the assignment/copy.
create function public.assign_prepared_character_internal(
  p_character_id uuid,
  p_user_id uuid,
  p_keep_copy boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  initial_round_id uuid;
  current_character public.characters%rowtype;
  current_round public.rounds%rowtype;
  caller_membership_role text;
  locked_profile_count integer;
  copied_character_id uuid;
  next_round_seq bigint;
begin
  if caller_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_character_id is null or p_user_id is null or p_keep_copy is null then
    raise exception 'Invalid assignment parameters';
  end if;

  -- Discovery only: no character/round/membership row locks before the sequence.
  select round_id into initial_round_id
  from public.characters
  where id = p_character_id and deleted_at is null and round_id is not null;
  if not found then
    raise exception 'Character is not available';
  end if;

  -- Both the recipient FK and copy's creator FK must be protected before any
  -- sequence/character locks, matching prepare_user_deletion's profile-first path.
  -- IN deduplicates self-assignment; UUID ordering is deterministic.
  perform id from public.profiles
  where id in (caller_user_id, p_user_id)
  order by id
  for key share;
  get diagnostics locked_profile_count = row_count;
  if locked_profile_count <> (case when caller_user_id = p_user_id then 1 else 2 end) then
    raise exception 'Assignment profile is not available';
  end if;

  -- Exact same namespace/hash as send_round_message; held until transaction end.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'round-message-sequence:' || initial_round_id::text, 0));

  select * into current_character from public.characters
  where id = p_character_id
  for update;
  if not found then
    raise exception 'Character is not available';
  end if;
  if current_character.deleted_at is not null
    or current_character.round_id is distinct from initial_round_id then
    -- Never acquire a second round's sequence lock while holding this character.
    raise exception 'Character is not available';
  end if;
  if current_character.owner_user_id is not null then
    raise exception 'Character already has an owner';
  end if;

  select * into current_round from public.rounds
  where id = initial_round_id
  for share;
  if not found then
    raise exception 'Round does not exist';
  end if;
  if current_round.locked_at is not null then
    raise exception 'Round is locked';
  end if;
  if current_round.status = 'archived' then
    raise exception 'Cannot assign prepared character in archived round';
  end if;

  -- GM before target, matching transfer_game_master. Read role AFTER locking.
  -- Self-assignment takes the stronger lock immediately, with no S -> U upgrade.
  if caller_user_id = p_user_id then
    select role into caller_membership_role from public.round_memberships
    where round_id = initial_round_id and user_id = caller_user_id
    for update;
  else
    select role into caller_membership_role from public.round_memberships
    where round_id = initial_round_id and user_id = caller_user_id
    for share;
  end if;
  if not found or caller_membership_role is distinct from 'game_master' then
    raise exception 'Character is not available';
  end if;

  if caller_user_id <> p_user_id then
    perform 1 from public.round_memberships
    where round_id = initial_round_id and user_id = p_user_id
    for update;
    if not found then
      raise exception 'Target user is not a member of this round';
    end if;
  end if;

  -- Original is already U-locked before copy_character takes its S-lock.
  if p_keep_copy then
    copied_character_id := public.copy_character(p_character_id);
  end if;

  update public.characters
  set owner_user_id = p_user_id
  where id = p_character_id
  returning * into current_character;
  -- The existing active-character triggers have completed with target U held.
  select coalesce(max(round_seq), 0) + 1 into next_round_seq
  from public.round_messages where round_id = initial_round_id;

  insert into public.round_messages (
    round_id, round_seq, author_user_id, character_id, speaker_kind,
    speaker_name_snapshot, kind, recipient_user_id, body, client_request_id
  ) values (
    initial_round_id, next_round_seq, null, current_character.id, 'system',
    'System', 'system_message', current_character.owner_user_id,
    'Dir wurde der Charakter ' || current_character.name || ' zugewiesen.',
    pg_catalog.gen_random_uuid()
  );

  return copied_character_id;
end;
$$;

revoke all on function public.assign_prepared_character_internal(uuid, uuid, boolean)
from public, anon, authenticated;

-- CREATE OR REPLACE preserves the existing authenticated-only EXECUTE grants.
create or replace function public.assign_prepared_character(
  p_character_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assign_prepared_character_internal(p_character_id, p_user_id, false);
end;
$$;

create or replace function public.assign_prepared_character_keep_copy(
  p_character_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.assign_prepared_character_internal(p_character_id, p_user_id, true);
end;
$$;
