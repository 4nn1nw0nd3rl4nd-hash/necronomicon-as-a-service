import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const schema=readFileSync('supabase/migrations/20260914100000_create_round_messages.sql','utf8')
const security=readFileSync('supabase/migrations/20260914101000_secure_round_messages.sql','utf8')
const gmSecurity=readFileSync('supabase/migrations/20260915100000_allow_game_master_active_character_chat.sql','utf8')
const publication=readFileSync('supabase/migrations/20260914102000_enable_round_messages_realtime.sql','utf8')
const code=security.replace(/--[^\n]*/g,'')
const reader=code.slice(0,code.indexOf('create function public.send_round_message'))
const sender=gmSecurity.replace(/--[^\n]*/g,'')

test('chat history FKs survive account/character deletion, protect rounds, and contain only Phase 3.1 fields',()=>{
  assert.match(schema,/round_id uuid not null references public.rounds\(id\) on delete restrict/)
  assert.match(schema,/author_user_id uuid references public.profiles\(id\) on delete set null/)
  assert.match(schema,/character_id uuid references public.characters\(id\) on delete set null/)
  assert.match(schema,/speaker_name_snapshot text not null/)
  assert.doesNotMatch(schema,/on delete cascade|roll_data|system_data|visibility/)
  assert.match(schema,/kind = 'character_message'/)
  assert.match(schema,/char_length\(body\) between 1 and 4000/)
  assert.match(schema,/round_messages_body_not_blank/)
})
test('SELECT is membership-only including locked GM exception; no admin/superadmin helper or policy bypass',()=>{
  assert.match(reader,/membership.user_id = \(select auth.uid\(\)\)/)
  assert.match(reader,/round.locked_at is null or membership.role = 'game_master'/)
  assert.doesNotMatch(reader,/can_view_round|is_admin|is_superadmin/)
  assert.match(reader,/on public.round_messages for select to authenticated/)
  assert.match(schema,/enable row level security/)
  assert.match(schema,/revoke all on table public.round_messages from public, anon, authenticated/)
  assert.match(reader,/grant select on table public.round_messages to authenticated/)
  assert.doesNotMatch(code,/grant\s+(?:insert|update|delete|all)\b|for\s+(?:insert|update|delete)\s+to/i)
})
test('send exposes only four inputs; user, role, current active character, owner, round, snapshot and ordering are server-derived',()=>{
  assert.match(sender,/p_round_id uuid,\s+p_body text,\s+p_client_request_id uuid,\s+p_expected_active_character_id uuid\s*\)/)
  assert.match(sender,/caller_user_id uuid := auth.uid\(\)/)
  assert.match(sender,/owner_user_id = caller_user_id and round_id = p_round_id\s+and deleted_at is null\s+for share/)
  assert.match(sender,/where round_id = p_round_id and user_id = caller_user_id for share/)
  assert.match(sender,/current_membership.active_character_id is distinct from p_expected_active_character_id/)
  assert.match(sender,/current_membership.active_character_id is null/)
  assert.match(sender,/speaker_name := current_character.name/)
  assert.match(sender,/speaker_kind := 'game_master';\s+speaker_name := 'Spielleitung'/)
  assert.match(sender,/case when speaker_kind = 'character' then current_character.id else null end/)
})
test('round/member/character locks protect authorization and archived/locked write guards precede INSERT',()=>{
  assert.match(sender,/from public.rounds where id = p_round_id for share/)
  for(const guard of ["current_round.locked_at is not null","current_round.status = 'archived'","current_membership.role = 'game_master'","current_membership.role = 'player'"]) {
    assert.ok(sender.indexOf(guard)>0)
    assert.ok(sender.indexOf(guard)<sender.indexOf('insert into public.round_messages'))
  }
  assert.doesNotMatch(sender,/status = 'paused'/)
  assert.ok(sender.indexOf('if not public.can_read_round_messages')<sender.indexOf('return message'))
})
test('idempotency and round sequences use separate transaction-scoped locks and unique database backstops',()=>{
  assert.match(schema,/unique \(round_id, round_seq\)/)
  assert.match(schema,/unique \(author_user_id, client_request_id\)/)
  assert.equal((sender.match(/pg_advisory_xact_lock/g)||[]).length,2)
  assert.match(sender,/'round-message-request:' \|\| caller_user_id::text \|\| ':' \|\| p_client_request_id::text/)
  assert.match(sender,/'round-message-sequence:' \|\| p_round_id::text/)
  assert.ok(sender.indexOf("'round-message-sequence:'")<sender.indexOf('max(round_seq)'))
  assert.match(sender,/where author_user_id = caller_user_id and client_request_id = p_client_request_id/)
  assert.match(sender,/message.round_id <> p_round_id or message.body <> p_body/)
  assert.match(sender,/coalesce\(max\(round_seq\), 0\) \+ 1/)
  assert.doesNotMatch(sender,/nextval|setval|create sequence/)
})
test('definers have empty search paths, qualified tables and explicit authenticated-only execute grants',()=>{
  assert.equal((code.match(/security definer\s+set search_path = ''/g)||[]).length,2)
  assert.doesNotMatch(code,/\b(?:from|join|into)\s+(?:rounds|characters|round_messages|round_memberships)\b/)
  assert.match(code,/revoke all on function public.send_round_message\(uuid, text, uuid, uuid\) from public, anon/)
  assert.match(code,/grant execute on function public.send_round_message\(uuid, text, uuid, uuid\) to authenticated/)
  assert.match(sender,/security definer\s+set search_path = ''/)
  assert.doesNotMatch(sender,/\b(?:grant|revoke)\b/i)
})
test('Phase 3.2b changes only the GM dispatch; player validation, retries, locks and INSERT remain identical',()=>{
  const original=code.slice(code.indexOf('create function public.send_round_message'),code.indexOf('revoke all on function public.send_round_message'))
  const expected=original
    .replace('create function public.send_round_message','create or replace function public.send_round_message')
    .replace(/if current_membership.role = 'game_master' then\s+if p_expected_active_character_id is not null then\s+raise exception using errcode = '22023', message = 'CHAT_IDENTITY_CHANGED';\s+end if;/,
      "if current_membership.role = 'game_master' and p_expected_active_character_id is null then")
    .replace("elsif current_membership.role = 'player' then", "elsif current_membership.role = 'player' or current_membership.role = 'game_master' then")
  const normalize=sql=>sql.replace(/\s+/g,' ').trim()
  assert.equal(normalize(sender),normalize(expected))
  assert.equal((sender.match(/create or replace function/g)||[]).length,1)
  assert.doesNotMatch(sender,/\b(?:alter|drop|policy|publication|p_gm_character_id)\b/i)
})
test('GM narration is the only NULL-identity exception; both roles otherwise require the locked own active character',()=>{
  assert.match(sender,/if current_membership.role = 'game_master'\s+and p_expected_active_character_id is null then\s+speaker_kind := 'game_master';\s+speaker_name := 'Spielleitung';\s+elsif current_membership.role = 'player' or current_membership.role = 'game_master' then\s+if current_membership.active_character_id is null then/)
  assert.match(sender,/if p_expected_active_character_id is null\s+or current_membership.active_character_id is distinct from p_expected_active_character_id then\s+raise exception using errcode = '22023', message = 'CHAT_IDENTITY_CHANGED';\s+end if;\s+speaker_kind := 'character';\s+speaker_name := current_character.name/)
})
test('profile lock remains before round sequence, character, round and membership locks and active-character validation',()=>{
  const steps=[
    'from public.profiles where id = caller_user_id for key share',
    "'round-message-sequence:'",
    'select * into current_character from public.characters',
    'from public.rounds where id = p_round_id for share',
    'where round_id = p_round_id and user_id = caller_user_id for share',
    'current_membership.active_character_id is distinct from p_expected_active_character_id',
    'insert into public.round_messages',
  ].map(text=>sender.indexOf(text))
  assert.ok(steps.every((position,index)=>position>=0 && (index===0 || position>steps[index-1])))
})
test('publication migration only adds round_messages with an existence guard and leaves other tables untouched',()=>{
  assert.match(publication,/if not exists[\s\S]*tablename = 'round_messages'/)
  assert.equal((publication.match(/alter publication/g)||[]).length,1)
  assert.match(publication,/alter publication supabase_realtime add table public.round_messages/)
  assert.doesNotMatch(publication,/\b(?:drop|create|set|delete|truncate)\b/i)
})

const privateFoundation=readFileSync('supabase/migrations/20260915110000_add_private_assignment_message_foundation.sql','utf8')
  .replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()

test('Phase 3.3a1 adds only a nullable cascading recipient and replaces the original column CHECKs',()=>{
  assert.match(privateFoundation,/add column recipient_user_id uuid constraint round_messages_recipient_user_id_fkey references public.profiles\(id\) on delete cascade/)
  assert.doesNotMatch(privateFoundation,/recipient_user_id uuid (?:not null|default)/)
  assert.deepEqual([...privateFoundation.matchAll(/drop constraint (\w+)/g)].map(match=>match[1]),
    ['round_messages_kind_check','round_messages_speaker_kind_check'])
  // The Phase 3.1 inline CHECKs produce these table_column_check names.
  assert.match(schema,/kind text not null default 'character_message' check \(kind = 'character_message'\)/)
  assert.match(schema,/speaker_kind text not null check \(speaker_kind in \('character', 'game_master'\)\)/)
  assert.match(privateFoundation,/check \(kind in \('character_message', 'system_message'\)\)/)
  assert.match(privateFoundation,/check \(speaker_kind in \('character', 'game_master', 'system'\)\)/)
})
test('historical Phase 3.3a1 identity restricts system recipients before the Phase 3.3b1 relaxation',()=>{
  assert.match(privateFoundation,/add constraint round_messages_message_identity check \( \( kind = 'character_message' and recipient_user_id is null and speaker_kind in \('character', 'game_master'\) \) or \( kind = 'system_message' and speaker_kind = 'system' and recipient_user_id is not null and author_user_id is null and speaker_name_snapshot = 'System' \) \)/)
  assert.doesNotMatch(privateFoundation,/character_id is not null/)
  assert.match(schema,/constraint round_messages_gm_identity check \(\s+speaker_kind <> 'game_master'\s+or \(character_id is null and speaker_name_snapshot = 'Spielleitung'\)/)
  assert.doesNotMatch(privateFoundation,/drop constraint round_messages_(?:gm_identity|request_key|round_seq_key)/)
  assert.match(schema,/client_request_id uuid not null/)
  assert.match(schema,/unique \(author_user_id, client_request_id\)/)
  assert.match(schema,/unique \(round_id, round_seq\)/)
})
const publicFoundation=readFileSync('supabase/migrations/20260916100000_allow_public_system_messages.sql','utf8')
  .replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()

test('Phase 3.3b1 only allows both public and private system recipients, keeping strict system and character identities',()=>{
  assert.equal(publicFoundation, `alter table public.round_messages
    drop constraint round_messages_message_identity,
    add constraint round_messages_message_identity check (
      ( kind = 'character_message' and recipient_user_id is null
        and speaker_kind in ('character', 'game_master') )
      or ( kind = 'system_message' and speaker_kind = 'system'
        and author_user_id is null and speaker_name_snapshot = 'System' )
    );`.replace(/\s+/g,' ').trim())
  // The entire replacement must equal the historical CHECK minus this one rule.
  const previous=privateFoundation.slice(privateFoundation.indexOf('add constraint round_messages_message_identity'),privateFoundation.indexOf(';'))
  assert.equal(publicFoundation.slice(publicFoundation.indexOf('add constraint')),
    previous.replace(' and recipient_user_id is not null','')+';')
})
test('Phase 3.3a1 narrows the sole existing SELECT policy with AND; no functions, grants, writes or publication changes',()=>{
  assert.match(privateFoundation,/alter policy "Current members can read round chat" on public.round_messages using \( public.can_read_round_messages\(round_id\) and \(recipient_user_id is null or recipient_user_id = \(select auth.uid\(\)\)\) \);$/)
  assert.equal((privateFoundation.match(/alter policy/g)||[]).length,1)
  assert.equal((privateFoundation.match(/alter table public.round_messages/g)||[]).length,1)
  assert.equal(privateFoundation.split(';').filter(statement=>statement.trim()).length,2)
  assert.doesNotMatch(privateFoundation,/\b(?:function|trigger|grant|revoke|publication|insert|update|truncate|create policy|drop policy|disable|is_admin|is_superadmin)\b/i)
})
test('Phase 3.3a1 SQL fixtures cover recipient RLS, invalid identities and catalog cascade without account deletion',()=>{
  const sql=readFileSync('supabase/tests/round_messages_security.sql','utf8')
  const fixtures=sql.slice(sql.indexOf('-- Phase 3.3a1:'))
  for(const label of [
    'public system message without character allowed','public system message with character allowed',
    'private system messages remain valid with and without character reference','private assignment keeps its character reference',
    'public system author forbidden','public system character speaker forbidden',
    'public system GM speaker forbidden','public system wrong snapshot forbidden',
    'public system history visibility with normal round access',
    'private character forbidden','system author forbidden',
    'system character speaker forbidden','system GM speaker forbidden','system wrong snapshot forbidden',
    'character system speaker forbidden','GM character ID forbidden','GM wrong snapshot forbidden',
    'private assignment visibility by known message ID','GM has private access only as recipient',
    'former member loses public and private access','other member still sees exactly public history',
    'rejoined recipient sees public and own private history again',
    'character FK SET NULL preserves public and private history',
    'locked player cannot read even own private message',
    'recipient reads public and own private history in archive',
  ]) assert.ok(fixtures.includes(label),label)
  assert.match(fixtures,/\('admin',false,false\), \('super',false,false\)/)
  assert.match(fixtures,/fk\.confrelid='public.profiles'::regclass/)
  assert.match(fixtures,/fk\.confdeltype='c' and not source_column\.attnotnull and fk\.convalidated/)
  assert.match(sql,/\nbegin;/)
  assert.match(sql,/rollback;\s*$/)
  assert.doesNotMatch(sql,/delete from (?:auth\.users|public\.profiles)/i)
})

const assignmentSql=readFileSync('supabase/migrations/20260915120000_emit_private_prepared_assignment_messages.sql','utf8')
const assignmentCode=assignmentSql.replace(/--[^\n]*/g,'')
const assignmentCore=assignmentCode.slice(0,assignmentCode.indexOf('revoke all on function'))
const assignmentWrappers=assignmentCode.slice(assignmentCode.indexOf('create or replace function'))

test('assignment wrappers keep signatures and enter the same private core before any copy or mutation',()=>{
  assert.deepEqual([...assignmentCode.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map(match=>match[1]),[
    'assign_prepared_character_internal','assign_prepared_character','assign_prepared_character_keep_copy',
  ])
  assert.match(assignmentWrappers,/function public.assign_prepared_character\(\s+p_character_id uuid,\s+p_user_id uuid\s*\)\s*returns void/)
  assert.match(assignmentWrappers,/function public.assign_prepared_character_keep_copy\(\s+p_character_id uuid,\s+p_user_id uuid\s*\)\s*returns uuid/)
  assert.match(assignmentWrappers,/perform public.assign_prepared_character_internal\(p_character_id, p_user_id, false\)/)
  assert.match(assignmentWrappers,/return public.assign_prepared_character_internal\(p_character_id, p_user_id, true\)/)
  assert.doesNotMatch(assignmentWrappers,/copy_character|\b(?:insert|update|for share)\b/i)
  assert.equal((assignmentCode.match(/security definer\s+set search_path = ''/g)||[]).length,3)
  assert.match(assignmentCode,/revoke all on function public.assign_prepared_character_internal\(uuid, uuid, boolean\)\s+from public, anon, authenticated/)
  assert.doesNotMatch(assignmentCode,/\b(?:grant|alter|policy|publication|trigger|deletion_pending_at|exception when)\b/i)
})
test('assignment lock order starts with deduplicated ordered profiles and the existing round sequence namespace',()=>{
  const steps=[
    'caller_user_id uuid := auth.uid()',
    'select round_id into initial_round_id',
    'perform id from public.profiles',
    'for key share',
    "'round-message-sequence:' || initial_round_id::text, 0",
    'select * into current_character from public.characters',
    'select * into current_round from public.rounds',
    'select role into caller_membership_role from public.round_memberships',
    'perform 1 from public.round_memberships',
    'copied_character_id := public.copy_character',
    'update public.characters',
    'coalesce(max(round_seq), 0) + 1',
    'insert into public.round_messages',
  ].map(text=>assignmentCore.indexOf(text))
  assert.ok(steps.every((position,index)=>position>=0 && (index===0 || position>steps[index-1])))
  assert.match(assignmentCore,/where id in \(caller_user_id, p_user_id\)\s+order by id\s+for key share/)
  assert.match(assignmentCore,/get diagnostics locked_profile_count = row_count/)
  assert.match(assignmentCore,/locked_profile_count <> \(case when caller_user_id = p_user_id then 1 else 2 end\)/)
  assert.equal((assignmentCore.match(/pg_advisory_xact_lock/g)||[]).length,1)
  assert.match(sender,/'round-message-sequence:' \|\| p_round_id::text, 0/)
  assert.doesNotMatch(assignmentCore.slice(0,assignmentCore.indexOf('pg_advisory_xact_lock')),/for update|for share/)
})
test('assignment revalidates locked character round and role; self-assignment takes membership U immediately',()=>{
  assert.match(assignmentCore,/select \* into current_character from public.characters\s+where id = p_character_id\s+for update/)
  assert.match(assignmentCore,/current_character.deleted_at is not null\s+or current_character.round_id is distinct from initial_round_id/)
  assert.match(assignmentCore,/if current_character.owner_user_id is not null then\s+raise exception 'Character already has an owner'/)
  assert.match(assignmentCore,/select \* into current_round from public.rounds\s+where id = initial_round_id\s+for share/)
  assert.match(assignmentCore,/current_round.locked_at is not null/)
  assert.match(assignmentCore,/current_round.status = 'archived'/)
  assert.doesNotMatch(assignmentCore,/status = 'paused'|is_round_game_master/)
  assert.match(assignmentCore,/if caller_user_id = p_user_id then\s+select role into caller_membership_role from public.round_memberships\s+where round_id = initial_round_id and user_id = caller_user_id\s+for update;\s+else\s+select role into caller_membership_role from public.round_memberships\s+where round_id = initial_round_id and user_id = caller_user_id\s+for share;\s+end if;\s+if not found or caller_membership_role is distinct from 'game_master'/)
  assert.match(assignmentCore,/if caller_user_id <> p_user_id then\s+perform 1 from public.round_memberships\s+where round_id = initial_round_id and user_id = p_user_id\s+for update;\s+if not found then/)
})
test('assignment message uses only the updated original and server values after normal trigger execution',()=>{
  assert.match(assignmentCore,/update public.characters\s+set owner_user_id = p_user_id\s+where id = p_character_id\s+returning \* into current_character/)
  assert.match(assignmentCore,/coalesce\(max\(round_seq\), 0\) \+ 1 into next_round_seq\s+from public.round_messages where round_id = initial_round_id/)
  assert.match(assignmentCore,/initial_round_id, next_round_seq, null, current_character.id, 'system',\s+'System', 'system_message', current_character.owner_user_id,\s+'Dir wurde der Charakter ' \|\| current_character.name \|\| ' zugewiesen.',\s+pg_catalog.gen_random_uuid\(\)/)
  assert.doesNotMatch(assignmentCore,/p_body|p_client_request_id|nextval|setval|on conflict|exception when|\bcommit\b/i)
  assert.equal((assignmentCore.match(/insert into public.round_messages/g)||[]).length,1)
})
test('assignment SQL tests cover real RPCs, RLS, copy, self-assignment and late-insert rollback without a parallel harness',()=>{
  const sql=readFileSync('supabase/tests/round_messages_security.sql','utf8')
  const block=sql.slice(sql.indexOf('-- Phase 3.3a2-1:'))
  for(const label of [
    'assignment internal helper has no PUBLIC execute','assignment internal helper denies anon and authenticated',
    'assignment sets original owner','assignment trigger selects the sole owned character',
    'assigning GM cannot read recipient message','other current member cannot read assignment message',
    'recipient reads exactly one assignment message','assignment message has server identity snapshot request and sequence',
    'keep_copy returns a new prepared copy','keep_copy assigns original',
    'assignment preserves an existing valid active character','keep_copy emits exactly one message for original',
    'GM self-assignment sees only own private message','assignment retries create neither extra messages nor extra copies',
    'message failure rolls back owner active selection copy and message',
    'rejected assignments leave characters copies and messages unchanged',
    'assignment succeeds in paused round after rollback','real assignment snapshot survives rename removal and harddelete',
  ]) assert.ok(block.includes(label),label)
  assert.match(block,/9007199254740991/)
  assert.match(block,/assign_prepared_character_keep_copy[^\n]+\$q\$,'23514'/)
  assert.match(block,/Phase 3.3a2-2 remains a SEPARATE step/)
  assert.doesNotMatch(block,/delete from (?:auth\.users|public\.profiles)|dblink/i)
})

const transferCode=readFileSync('supabase/migrations/20260916110000_emit_game_master_transfer_messages.sql','utf8').replace(/--[^\n]*/g,'')
const transfer=transferCode.replace(/\s+/g,' ').trim()
test('transfer keeps its public signature, security and grants without changing other database objects',()=>{
  assert.match(transfer,/^create or replace function public\.transfer_game_master\( p_round_id uuid, p_new_game_master_id uuid \) returns void language plpgsql security definer set search_path = '' as \$\$/)
  assert.match(transfer,/end; \$\$;$/)
  assert.equal((transfer.match(/create or replace function/g)||[]).length,1)
  assert.doesNotMatch(transfer,/\b(?:alter|drop|grant|revoke|policy|trigger|publication|delete|commit|rollback|exception when|deletion_pending_at|status|is_round_game_master)\b/i)
  assert.match(transfer,/caller_user_id uuid := auth\.uid\(\);/)
  assert.match(transfer,/if caller_user_id is null then raise exception 'Not authenticated'; end if; if p_round_id is null or p_new_game_master_id is null then raise exception 'Invalid transfer parameters'; end if;/)
})
test('transfer locks ordered profiles before the shared sequence, round, caller and target memberships',()=>{
  const steps=[
    "raise exception 'Invalid transfer parameters'",
    'perform id from public.profiles',
    'for key share;',
    'perform pg_catalog.pg_advisory_xact_lock',
    'select locked_at into current_locked_at from public.rounds',
    "if current_locked_at is not null then raise exception 'Round is locked'; end if;",
    'select role into caller_membership_role from public.round_memberships',
    "if not found or caller_membership_role is distinct from 'game_master'",
    "if caller_user_id = p_new_game_master_id then raise exception 'User is already game master'; end if;",
    'select role into target_membership_role from public.round_memberships',
    "if not found or target_membership_role is distinct from 'player'",
    'select username into target_username from public.profiles',
    "update public.round_memberships set role = 'player'",
    "update public.round_memberships set role = 'game_master'",
    'select coalesce(max(round_seq), 0) + 1 into next_round_seq',
    'insert into public.round_messages',
  ].map(text=>transfer.indexOf(text))
  assert.ok(steps.every((position,index)=>position>=0 && (index===0 || position>steps[index-1])))
  assert.match(transfer,/perform id from public\.profiles where id in \(caller_user_id, p_new_game_master_id\) order by id for key share; get diagnostics locked_profile_count = row_count; if locked_profile_count <> \(case when caller_user_id = p_new_game_master_id then 1 else 2 end\) then raise exception 'Transfer profile is not available'; end if;/)
  assert.match(transfer,/perform pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\( 'round-message-sequence:' \|\| p_round_id::text, 0\)\);/)
  assert.match(transfer,/select locked_at into current_locked_at from public\.rounds where id = p_round_id for share; if not found then raise exception 'Round does not exist'; end if;/)
  assert.deepEqual(transfer.match(/for (?:key share|share|update);/g),['for key share;','for share;','for update;','for update;'])
  assert.equal((transfer.match(/pg_advisory_xact_lock/g)||[]).length,1)
  assert.match(sender,/'round-message-sequence:' \|\| p_round_id::text, 0/)
  assert.match(assignmentCore,/'round-message-sequence:' \|\| initial_round_id::text, 0/)
})
test('transfer checks locked caller and target roles and exactly one row for each demotion/promotion',()=>{
  assert.match(transfer,/select role into caller_membership_role from public\.round_memberships where round_id = p_round_id and user_id = caller_user_id for update; if not found or caller_membership_role is distinct from 'game_master' then raise exception 'Not authorized'; end if;/)
  assert.match(transfer,/select role into target_membership_role from public\.round_memberships where round_id = p_round_id and user_id = p_new_game_master_id for update; if not found or target_membership_role is distinct from 'player' then raise exception 'New game master must be a player in the round'; end if;/)
  assert.match(transfer,/update public\.round_memberships set role = 'player' where round_id = p_round_id and user_id = caller_user_id and role = 'game_master'; get diagnostics updated_membership_count = row_count; if updated_membership_count <> 1 then raise exception 'Game master update failed'; end if;/)
  assert.match(transfer,/update public\.round_memberships set role = 'game_master' where round_id = p_round_id and user_id = p_new_game_master_id and role = 'player'; get diagnostics updated_membership_count = row_count; if updated_membership_count <> 1 then raise exception 'New game master update failed'; end if;/)
  assert.equal((transfer.match(/\bupdate public\./g)||[]).length,2)
})
test('transfer inserts one public system snapshot with no account or character FK and no client message API',()=>{
  assert.match(transfer,/select username into target_username from public\.profiles where id = p_new_game_master_id;/)
  assert.match(transfer,/select coalesce\(max\(round_seq\), 0\) \+ 1 into next_round_seq from public\.round_messages where round_id = p_round_id;/)
  assert.match(transfer,/insert into public\.round_messages \( round_id, round_seq, author_user_id, character_id, speaker_kind, speaker_name_snapshot, kind, recipient_user_id, body, client_request_id \) values \( p_round_id, next_round_seq, null, null, 'system', 'System', 'system_message', null, '@' \|\| target_username \|\| ' ist jetzt Spielleitung\.', pg_catalog\.gen_random_uuid\(\) \);/)
  assert.equal((transfer.match(/\binsert into\b/g)||[]).length,1)
  assert.doesNotMatch(transfer,/p_body|p_client_request_id|p_recipient|nextval|setval|on conflict|active_character_id|substring|left\(/)
})
test('transfer SQL tests cover rollback, stale authority, snapshots, statuses and private sequence coexistence',()=>{
  const sql=readFileSync('supabase/tests/round_messages_security.sql','utf8')
  const block=sql.slice(sql.indexOf('-- Phase 3.3b2:'))
  for(const label of [
    'transfer execute grants preserved','invalid transfer targets create no message',
    'transfer demotes caller and promotes target',
    'transfer creates exactly one public server snapshot with sequence one',
    'old GM retry and unauthorized player create no second message',
    'administrative accounts cannot transfer or create messages without GM membership',
    'transfer snapshot survives later username change',
    'transfer message failure rolls back both roles with no partial message',
    'active paused archived transfers use unique ordered sequences and current snapshots',
    'locked transfer leaves roles messages and active selections unchanged',
  ]) assert.ok(block.includes(label),label)
  assert.match(block,/transfer_game_master[^\n]+\$q\$,'23514'/)
  assert.match(block,/9007199254740991/)
  assert.match(sql,/transfer sequence follows all three private assignment messages/)
  assert.match(sql,/character_id=pg_temp.chat_id\('assignment_failure'\) and round_seq=5/)
  assert.doesNotMatch(block,/delete from (?:auth\.users|public\.profiles)|dblink/i)
})
