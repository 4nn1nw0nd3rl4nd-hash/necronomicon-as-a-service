-- Phase 3.2b: GM narration or own currently active character only.
-- Same signature; CREATE OR REPLACE preserves the existing EXECUTE privileges.
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
    if message.round_id <> p_round_id or message.body <> p_body then
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
