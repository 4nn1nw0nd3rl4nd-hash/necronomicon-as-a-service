-- Phase 3.4b: preserve the chat signature and every behavior except retry matching.
-- CREATE OR REPLACE retains the existing chat EXECUTE grants.
create or replace function public.send_round_message(
  p_round_id uuid,
  p_body text,
  p_client_request_id uuid,
  p_expected_active_character_id uuid
)
returns public.round_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  current_membership public.round_memberships%rowtype;
  current_round public.rounds%rowtype;
  current_character public.characters%rowtype;
  message public.round_messages%rowtype;
  next_round_seq bigint;
  speaker_kind text;
  speaker_name text;
begin
  if caller_user_id is null then
    raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
  end if;
  if p_round_id is null or p_client_request_id is null then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_REQUEST';
  end if;
  if p_body is null or pg_catalog.char_length(p_body) not between 1 and 4000
    or pg_catalog.btrim(p_body, E' \t\n\r\f' || pg_catalog.chr(11) ||
      U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '' then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_BODY';
  end if;

  -- Same account/request is serialized even if a caller reuses it across rounds.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'round-message-request:' || caller_user_id::text || ':' || p_client_request_id::text, 0));

  if not public.can_read_round_messages(p_round_id) then
    raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
  end if;

  select * into message from public.round_messages
  where author_user_id = caller_user_id and client_request_id = p_client_request_id;
  if found then
    if message.round_id is distinct from p_round_id
      or message.kind is distinct from 'character_message'
      or message.body is distinct from p_body then
      raise exception using errcode = '22023', message = 'CHAT_REQUEST_CONFLICT';
    end if;
    -- A retry is an authorized read, not another write. It survives rename,
    -- character removal, role change and archiving, but never loss of read access.
    return message;
  end if;

  -- prepare_user_deletion locks the target profile before changing characters,
  -- rounds or memberships. Acquire the INSERT's author FK lock first as well,
  -- before holding the round sequence lock or any of those row locks.
  perform 1 from public.profiles where id = caller_user_id for key share;
  if not found then
    raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
  end if;

  -- All sends in one round serialize until COMMIT, including the max+1 SELECT.
  -- Under the API's READ COMMITTED isolation, a waiter sees the previous commit.
  -- Hash collisions only serialize unrelated rounds; the unique key is a backstop.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'round-message-sequence:' || p_round_id::text, 0));

  -- Follow existing character actions: character -> round -> membership.
  -- Lock the expected character, then revalidate current membership, never trust
  -- its client-supplied ID as the speaker. FOR SHARE also stabilizes its name.
  if p_expected_active_character_id is not null then
    select * into current_character from public.characters
    where id = p_expected_active_character_id
      and owner_user_id = caller_user_id and round_id = p_round_id
      and deleted_at is null
    for share;
    if not found then
      raise exception using errcode = '22023', message = 'CHAT_CHARACTER_UNAVAILABLE';
    end if;
  end if;

  select * into current_round from public.rounds where id = p_round_id for share;
  if not found then
    raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
  end if;
  select * into current_membership from public.round_memberships
  where round_id = p_round_id and user_id = caller_user_id for share;
  if not found then
    raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
  end if;
  if current_round.locked_at is not null then
    raise exception using errcode = '42501', message = 'CHAT_ROUND_LOCKED';
  end if;
  if current_round.status = 'archived' then
    raise exception using errcode = '42501', message = 'CHAT_ROUND_ARCHIVED';
  end if;

  -- Narration is GM-only. Every character message uses the same active/owner
  -- checks, based on the locked current membership, including after a transfer.
  if current_membership.role = 'game_master'
    and p_expected_active_character_id is null then
    speaker_kind := 'game_master';
    speaker_name := 'Spielleitung';
  elsif current_membership.role = 'player' or current_membership.role = 'game_master' then
    if current_membership.active_character_id is null then
      raise exception using errcode = '22023', message = 'CHAT_NO_ACTIVE_CHARACTER';
    end if;
    if p_expected_active_character_id is null
      or current_membership.active_character_id is distinct from p_expected_active_character_id then
      raise exception using errcode = '22023', message = 'CHAT_IDENTITY_CHANGED';
    end if;
    speaker_kind := 'character';
    speaker_name := current_character.name;
  else
    raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
  end if;

  select coalesce(max(round_seq), 0) + 1 into next_round_seq
  from public.round_messages where round_id = p_round_id;

  insert into public.round_messages (
    round_id, round_seq, author_user_id, character_id, speaker_kind,
    speaker_name_snapshot, kind, body, client_request_id
  ) values (
    p_round_id, next_round_seq, caller_user_id,
    case when speaker_kind = 'character' then current_character.id else null end,
    speaker_kind, speaker_name, 'character_message', p_body, p_client_request_id
  ) returning * into message;
  return message;
end;
$$;

-- PostgreSQL 17 integer-range random; new rolls and retries share one explicit receipt.
create function public.send_round_dice_roll(
  p_round_id uuid,
  p_dice_count integer,
  p_dice_sides integer,
  p_modifier integer,
  p_client_request_id uuid,
  p_expected_active_character_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  current_membership public.round_memberships%rowtype;
  current_round public.rounds%rowtype;
  current_character public.characters%rowtype;
  message public.round_messages%rowtype;
  dice_detail public.round_message_dice_rolls%rowtype;
  next_round_seq bigint;
  speaker_kind text;
  speaker_name text;
  rolled_results integer[] := array[]::integer[];
  rolled_raw_total integer;
begin
  if caller_user_id is null then
    raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
  end if;
  if p_round_id is null or p_client_request_id is null then
    raise exception using errcode = '22023', message = 'CHAT_INVALID_REQUEST';
  end if;
  if p_dice_count is null or p_dice_count not between 1 and 50
    or p_dice_sides is null or p_dice_sides not between 2 and 1000
    or p_modifier is null or p_modifier not between -9999 and 9999 then
    raise exception using errcode = '22023', message = 'DICE_INVALID_PARAMETERS';
  end if;

  -- Deliberately the same author/request namespace as character messages.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'round-message-request:' || caller_user_id::text || ':' || p_client_request_id::text, 0));

  -- Both supported request kinds are public; preserve chat's current read gate.
  if not public.can_read_round_messages(p_round_id) then
    raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
  end if;

  select * into message from public.round_messages
  where author_user_id = caller_user_id and client_request_id = p_client_request_id;
  if found then
    if message.round_id is distinct from p_round_id or message.kind is distinct from 'dice_roll' then
      raise exception using errcode = '22023', message = 'CHAT_REQUEST_CONFLICT';
    end if;
    select * into dice_detail from public.round_message_dice_rolls
    where message_id = message.id;
    if not found then
      raise exception using errcode = '22000', message = 'DICE_STORED_ROLL_INCOMPLETE';
    end if;
    if dice_detail.dice_count is distinct from p_dice_count
      or dice_detail.dice_sides is distinct from p_dice_sides
      or dice_detail.modifier is distinct from p_modifier then
      raise exception using errcode = '22023', message = 'CHAT_REQUEST_CONFLICT';
    end if;
    -- No identity refresh, random call, sequence allocation or INSERT on replay.
  else
    -- prepare_user_deletion locks the target profile before changing characters,
    -- rounds or memberships. Acquire the INSERT's author FK lock first as well,
    -- before holding the round sequence lock or any of those row locks.
    perform 1 from public.profiles where id = caller_user_id for key share;
    if not found then
      raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
    end if;

    -- All sends in one round serialize until COMMIT, including the max+1 SELECT.
    -- Under the API's READ COMMITTED isolation, a waiter sees the previous commit.
    -- Hash collisions only serialize unrelated rounds; the unique key is a backstop.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'round-message-sequence:' || p_round_id::text, 0));

    -- Follow existing character actions: character -> round -> membership.
    -- Lock the expected character, then revalidate current membership, never trust
    -- its client-supplied ID as the speaker. FOR SHARE also stabilizes its name.
    if p_expected_active_character_id is not null then
      select * into current_character from public.characters
      where id = p_expected_active_character_id
        and owner_user_id = caller_user_id and round_id = p_round_id
        and deleted_at is null
      for share;
      if not found then
        raise exception using errcode = '22023', message = 'CHAT_CHARACTER_UNAVAILABLE';
      end if;
    end if;

    select * into current_round from public.rounds where id = p_round_id for share;
    if not found then
      raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
    end if;
    select * into current_membership from public.round_memberships
    where round_id = p_round_id and user_id = caller_user_id for share;
    if not found then
      raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
    end if;
    if current_round.locked_at is not null then
      raise exception using errcode = '42501', message = 'CHAT_ROUND_LOCKED';
    end if;
    if current_round.status = 'archived' then
      raise exception using errcode = '42501', message = 'CHAT_ROUND_ARCHIVED';
    end if;

    -- Narration is GM-only. Every character message uses the same active/owner
    -- checks, based on the locked current membership, including after a transfer.
    if current_membership.role = 'game_master'
      and p_expected_active_character_id is null then
      speaker_kind := 'game_master';
      speaker_name := 'Spielleitung';
    elsif current_membership.role = 'player' or current_membership.role = 'game_master' then
      if current_membership.active_character_id is null then
        raise exception using errcode = '22023', message = 'CHAT_NO_ACTIVE_CHARACTER';
      end if;
      if p_expected_active_character_id is null
        or current_membership.active_character_id is distinct from p_expected_active_character_id then
        raise exception using errcode = '22023', message = 'CHAT_IDENTITY_CHANGED';
      end if;
      speaker_kind := 'character';
      speaker_name := current_character.name;
    else
      raise exception using errcode = '42501', message = 'CHAT_NOT_AUTHORIZED';
    end if;

    -- Generate once, append in generation order, then sum that exact array.
    for die_index in 1..p_dice_count loop
      rolled_results := pg_catalog.array_append(rolled_results, pg_catalog.random(1, p_dice_sides));
    end loop;
    select pg_catalog.sum(result)::integer into rolled_raw_total
    from pg_catalog.unnest(rolled_results) as die(result);

    select coalesce(pg_catalog.max(round_seq), 0) + 1 into next_round_seq
    from public.round_messages where round_id = p_round_id;

    insert into public.round_messages (
      round_id, round_seq, author_user_id, character_id, speaker_kind,
      speaker_name_snapshot, kind, body, recipient_user_id, client_request_id
    ) values (
      p_round_id, next_round_seq, caller_user_id,
      case when speaker_kind = 'character' then current_character.id else null end,
      speaker_kind, speaker_name, 'dice_roll', null, null, p_client_request_id
    ) returning * into message;

    insert into public.round_message_dice_rolls (
      message_id, dice_count, dice_sides, modifier, results, raw_total, total
    ) values (
      message.id, p_dice_count, p_dice_sides, p_modifier, rolled_results,
      rolled_raw_total, rolled_raw_total + p_modifier
    ) returning * into dice_detail;
  end if;

  -- One allowlisted shape for new and stored rolls; no automatic row-to-JSON exposure.
  return pg_catalog.jsonb_build_object(
    'id', message.id,
    'round_id', message.round_id,
    'round_seq', message.round_seq,
    'author_user_id', message.author_user_id,
    'character_id', message.character_id,
    'speaker_kind', message.speaker_kind,
    'speaker_name_snapshot', message.speaker_name_snapshot,
    'kind', message.kind,
    'body', message.body,
    'recipient_user_id', message.recipient_user_id,
    'client_request_id', message.client_request_id,
    'created_at', message.created_at,
    'dice_roll', pg_catalog.jsonb_build_object(
      'message_id', dice_detail.message_id,
      'dice_count', dice_detail.dice_count,
      'dice_sides', dice_detail.dice_sides,
      'modifier', dice_detail.modifier,
      'results', dice_detail.results,
      'raw_total', dice_detail.raw_total,
      'total', dice_detail.total
    )
  );
  -- No exception handler: a failed detail or receipt rolls back the parent too.
end;
$$;

revoke all on function public.send_round_dice_roll(uuid, integer, integer, integer, uuid, uuid) from public, anon;
grant execute on function public.send_round_dice_roll(uuid, integer, integer, integer, uuid, uuid) to authenticated;
