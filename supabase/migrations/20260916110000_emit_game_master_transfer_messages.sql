-- Phase 3.3b2: role transfer and public historical message succeed together.
-- CREATE OR REPLACE preserves the existing signature and execute grants.
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
  caller_user_id uuid := auth.uid();
  locked_profile_count integer;
  current_locked_at timestamptz;
  caller_membership_role text;
  target_membership_role text;
  target_username text;
  updated_membership_count integer;
  next_round_seq bigint;
begin
  if caller_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_round_id is null or p_new_game_master_id is null then
    raise exception 'Invalid transfer parameters';
  end if;

  -- Profile-first ordering also protects against concurrent account deletion.
  -- IN deduplicates self-transfer; UUID ordering is deterministic.
  perform id from public.profiles
  where id in (caller_user_id, p_new_game_master_id)
  order by id
  for key share;
  get diagnostics locked_profile_count = row_count;
  if locked_profile_count <> (case when caller_user_id = p_new_game_master_id then 1 else 2 end) then
    raise exception 'Transfer profile is not available';
  end if;

  -- Shared with send_round_message and assign_prepared_character_internal.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'round-message-sequence:' || p_round_id::text, 0));

  select locked_at into current_locked_at from public.rounds
  where id = p_round_id
  for share;
  if not found then
    raise exception 'Round does not exist';
  end if;
  if current_locked_at is not null then
    raise exception 'Round is locked';
  end if;
  -- Preserve transfer semantics: active, paused AND archived are allowed.

  select role into caller_membership_role from public.round_memberships
  where round_id = p_round_id and user_id = caller_user_id
  for update;
  if not found or caller_membership_role is distinct from 'game_master' then
    raise exception 'Not authorized';
  end if;
  if caller_user_id = p_new_game_master_id then
    raise exception 'User is already game master';
  end if;

  select role into target_membership_role from public.round_memberships
  where round_id = p_round_id and user_id = p_new_game_master_id
  for update;
  if not found or target_membership_role is distinct from 'player' then
    raise exception 'New game master must be a player in the round';
  end if;

  select username into target_username from public.profiles
  where id = p_new_game_master_id;

  -- Demote first to respect the unique game-master-per-round index.
  update public.round_memberships set role = 'player'
  where round_id = p_round_id and user_id = caller_user_id and role = 'game_master';
  get diagnostics updated_membership_count = row_count;
  if updated_membership_count <> 1 then
    raise exception 'Game master update failed';
  end if;
  update public.round_memberships set role = 'game_master'
  where round_id = p_round_id and user_id = p_new_game_master_id and role = 'player';
  get diagnostics updated_membership_count = row_count;
  if updated_membership_count <> 1 then
    raise exception 'New game master update failed';
  end if;

  -- Include private rows, using the same sequence lock as other producers.
  select coalesce(max(round_seq), 0) + 1 into next_round_seq
  from public.round_messages where round_id = p_round_id;
  insert into public.round_messages (
    round_id, round_seq, author_user_id, character_id, speaker_kind,
    speaker_name_snapshot, kind, recipient_user_id, body, client_request_id
  ) values (
    p_round_id, next_round_seq, null, null, 'system',
    'System', 'system_message', null,
    '@' || target_username || ' ist jetzt Spielleitung.',
    pg_catalog.gen_random_uuid()
  );
  -- No exception handler: any failure rolls back BOTH updates and the message.
end;
$$;
