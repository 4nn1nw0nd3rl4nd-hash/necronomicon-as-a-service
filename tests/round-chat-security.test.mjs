import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const schema=readFileSync('supabase/migrations/20260914100000_create_round_messages.sql','utf8')
const security=readFileSync('supabase/migrations/20260914101000_secure_round_messages.sql','utf8')
const gmSecurity=readFileSync('supabase/migrations/20260915100000_allow_game_master_active_character_chat.sql','utf8')
const publication=readFileSync('supabase/migrations/20260914102000_enable_round_messages_realtime.sql','utf8')
const gmNarrationSelection=readFileSync('supabase/migrations/20260919100000_preserve_game_master_narration_selection.sql','utf8')
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
test('GM narration persistence scopes NULL by round and preserves player-only lifecycle auto-selection',()=>{
  const migration=gmNarrationSelection.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()
  assert.match(migration,/create or replace function public\.recalculate_active_character\( p_round_id uuid, p_user_id uuid \)/)
  assert.match(migration,/select id, role, active_character_id into membership_id, membership_role, current_active_character_id/)
  assert.match(migration,/if membership_role = 'game_master' then if current_active_character_id is null then return; end if;/)
  assert.ok(migration.indexOf("if membership_role = 'game_master'")<migration.indexOf('select pg_catalog.count(*)'))
  assert.match(migration,/if valid_character_count = 1 then calculated_active_character_id := valid_character_ids\[1\]/)
  assert.match(migration,/create function public\.set_active_character\( p_round_id uuid, p_character_id uuid \)/)
  assert.match(migration,/if \(p_character_id is null or caller_id <> discovered_owner_id\) and caller_role <> 'game_master'/)
  assert.match(migration,/where id = p_character_id and round_id = p_round_id/)
  assert.match(migration,/revoke all on function public\.set_active_character\(uuid, uuid\) from public; revoke all on function public\.set_active_character\(uuid, uuid\) from anon; grant execute on function public\.set_active_character\(uuid, uuid\) to authenticated;/)
  assert.doesNotMatch(migration,/\b(?:round_messages|dice_roll|policy|publication|alter table)\b/i)
})

test('selection serializes before row locks, revalidates both memberships and guards the legacy entry point',()=>{
  const sql=gmNarrationSelection.replace(/--[^\n]*/g,'').replace(/\s+/g,' ')
  const rpc=sql.slice(sql.indexOf('create function public.set_active_character('),sql.indexOf('revoke all on function public.set_active_character'))
  const ordered=[
    'order by id for share;',
    "'round-message-sequence:' || p_round_id::text, 0)",
    'owner_user_id = discovered_owner_id for update;',
    'where id = p_round_id for share;',
    'order by user_id for update;',
    'select role into caller_role',
    "caller_role <> 'game_master'",
    'update public.round_memberships set active_character_id = p_character_id',
  ].map(fragment=>{const position=rpc.indexOf(fragment);assert.ok(position>=0,fragment);return position})
  assert.deepEqual([...ordered].sort((a,b)=>a-b),ordered)
  assert.match(rpc,/user_id = caller_id/)
  assert.match(rpc,/user_id = discovered_owner_id/)
  assert.match(rpc,/deletion_pending_at is null/)
  assert.doesNotMatch(rpc,/is_round_game_master/)
  const legacy=sql.slice(sql.indexOf('create or replace function public.set_active_character(p_character_id uuid)'))
  assert.match(legacy,/perform public\.set_active_character\(character_round_id, p_character_id\)/)
  assert.doesNotMatch(legacy,/for update|for share|update public\./)
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

const editMigration=readFileSync('supabase/migrations/20260916120000_add_controlled_round_edit.sql','utf8')
  .replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()
const editRpc=editMigration.slice(0,editMigration.indexOf('$$;')+3)
test('round edit has one authenticated-only definer RPC with exactly the existing form fields',()=>{
  assert.match(editRpc,/^create function public\.update_round\( p_round_id uuid, p_name text, p_system text, p_description text, p_appointment text, p_status text \) returns public\.rounds language plpgsql security definer set search_path = '' as \$\$/)
  assert.match(editRpc,/caller_user_id uuid := auth\.uid\(\);/)
  assert.match(editRpc,/if caller_user_id is null then raise exception 'Not authenticated'; end if;/)
  assert.match(editRpc,/if p_round_id is null or p_status is null or p_status not in \('active', 'paused', 'archived'\) then raise exception 'Invalid round parameters'; end if;/)
  assert.match(editRpc,/if p_name is null or pg_catalog\.btrim\(p_name\) = '' then raise exception 'Round name is required'; end if;/)
  assert.match(editMigration,/revoke all on function public\.update_round\(uuid, text, text, text, text, text\) from public, anon; grant execute on function public\.update_round\(uuid, text, text, text, text, text\) to authenticated;/)
  assert.equal((editMigration.match(/create function/g)||[]).length,1)
  assert.doesNotMatch(editRpc,/is_admin|is_superadmin|is_round_game_master|exception when|set_round_archived|prepare_user_deletion/)
})
test('round edit takes profile S then shared sequence then round U then membership S with locked authorization',()=>{
  const steps=[
    'perform id from public.profiles',
    'perform pg_catalog.pg_advisory_xact_lock',
    'select * into current_round from public.rounds',
    'if current_round.locked_at is not null',
    'select role into caller_membership_role from public.round_memberships',
    "if not found or caller_membership_role is distinct from 'game_master'",
    "if current_round.status = 'active' and p_status = 'paused'",
    'update public.rounds',
    'if message_body is not null then',
    'select coalesce(max(round_seq), 0) + 1',
    'insert into public.round_messages',
    'return updated_round;',
  ].map(text=>editRpc.indexOf(text))
  assert.ok(steps.every((position,index)=>position>=0 && (index===0 || position>steps[index-1])))
  assert.match(editRpc,/perform id from public\.profiles where id = caller_user_id for share; if not found then raise exception 'Not authorized'; end if;/)
  assert.match(editRpc,/pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\( 'round-message-sequence:' \|\| p_round_id::text, 0\)\);/)
  assert.match(editRpc,/select \* into current_round from public\.rounds where id = p_round_id for update; if not found then raise exception 'Round does not exist'; end if; if current_round.locked_at is not null then raise exception 'Round is locked'; end if;/)
  assert.match(editRpc,/select role into caller_membership_role from public\.round_memberships where round_id = p_round_id and user_id = caller_user_id for share; if not found or caller_membership_role is distinct from 'game_master' then raise exception 'Not authorized'; end if;/)
  assert.deepEqual(editRpc.match(/for (?:key share|share|update);/g),['for share;','for update;','for share;'])
  assert.equal((editRpc.match(/pg_advisory_xact_lock/g)||[]).length,1)
})
test('only active-paused and paused-active set an exact server text; insert is conditional after atomic edit',()=>{
  assert.match(editRpc,/message_body text;/)
  assert.match(editRpc,/if current_round.status = 'active' and p_status = 'paused' then message_body := 'Die Runde wurde pausiert\.'; elsif current_round.status = 'paused' and p_status = 'active' then message_body := 'Die Runde wurde fortgesetzt\.'; end if;/)
  assert.equal((editRpc.match(/message_body :=/g)||[]).length,2)
  assert.match(editRpc,/update public\.rounds set name = pg_catalog\.btrim\(p_name\), system = nullif\(pg_catalog\.btrim\(p_system\), ''\), description = nullif\(pg_catalog\.btrim\(p_description\), ''\), appointment = nullif\(pg_catalog\.btrim\(p_appointment\), ''\), status = p_status where id = p_round_id returning \* into updated_round; if not found then raise exception 'Round update failed'; end if;/)
  assert.match(editRpc,/if message_body is not null then select coalesce\(max\(round_seq\), 0\) \+ 1 into next_round_seq from public\.round_messages where round_id = p_round_id; insert into public\.round_messages \( round_id, round_seq, author_user_id, character_id, speaker_kind, speaker_name_snapshot, kind, recipient_user_id, body, client_request_id \) values \( p_round_id, next_round_seq, null, null, 'system', 'System', 'system_message', null, message_body, pg_catalog\.gen_random_uuid\(\) \); end if; return updated_round; end; \$\$;$/)
  assert.equal((editRpc.match(/insert into/g)||[]).length,1)
  assert.equal((editRpc.match(/return updated_round/g)||[]).length,1)
  assert.doesNotMatch(editRpc,/archiviert\.|username|p_body|p_client_request_id|p_recipient|on conflict|\bcommit\b/i)
})
test('direct status update is revoked at both table and column level; metadata grants keep existing RLS',()=>{
  assert.equal(editMigration.slice(editMigration.indexOf('revoke update')),`revoke update on table public.rounds from public, anon, authenticated;
    revoke update (status) on table public.rounds from public, anon, authenticated;
    grant update (name, system, description, appointment) on table public.rounds to authenticated;`.replace(/\s+/g,' '))
  assert.doesNotMatch(editMigration,/\b(?:policy|trigger|publication|alter table|disable row level|grant all)\b/i)
})
test('round edit frontend calls the RPC with all form fields and preserves one-row result and error handling',()=>{
  const hook=readFileSync('src/hooks/useUpdateRound.ts','utf8')
  assert.match(hook,/\.rpc\('update_round', \{\s+p_round_id: roundId,\s+p_name: normalizedName,\s+p_system: normalizedSystem,\s+p_description: normalizedDescription,\s+p_appointment: normalizedAppointment,\s+p_status: input.status,\s+\}\)/)
  assert.doesNotMatch(hook,/\.from\('rounds'\)|\.update\(|round_messages|\.insert\(/)
  assert.match(hook,/\.maybeSingle\(\)\s+\.overrideTypes<RoundDetails, \{ merge: false \}>\(\)/)
  assert.match(hook,/if \(error \|\| !data\) \{\s+setState\(\{ \.\.\.initialState, error: unavailableError \}\)\s+return null/)
  assert.match(hook,/return data/)
})
test('round edit SQL fixtures cover real transitions, hidden history, authorization, grants and late failure',()=>{
  const sql=readFileSync('supabase/tests/round_messages_security.sql','utf8')
  const block=sql.slice(sql.indexOf('-- Phase 3.3c2-1:'))
  for(const label of [
    'pause returns updated metadata and status in one row',
    'pause shares sequence with character private assignment and public transfer messages',
    'paused to paused creates no additional visible message','resume creates exactly one public system message',
    'active to active creates no additional visible message','metadata-only RPC edit changes all fields without a message',
    'direct status bypass denied while legitimate GM metadata update still works',
    'player former GM admin and superadmin cannot edit without current GM membership',
    'locked edit preserves complete round row and messages',
    'late edit message failure rolls back status all metadata and message',
    'edit failure and no-ops preserve hidden private history too',
    'existing form archive transitions emit three archive events while unarchive stays message-free',
  ]) assert.ok(block.includes(label),label)
  assert.match(block,/update public.rounds set status='paused'[^\n]+\$q\$,'42501'/)
  assert.match(block,/update_round[^\n]+\$q\$,'23514'/)
  assert.match(block,/r is not distinct from before_round/)
  assert.match(block,/not has_column_privilege\('authenticated','public.rounds','status','UPDATE'\)/)
})

const manualArchiveMigration=readFileSync('supabase/migrations/20260916130000_emit_manual_round_archive_messages.sql','utf8')
  .replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()
const currentEditRpc=manualArchiveMigration.slice(0,manualArchiveMigration.indexOf('$$;')+3)
const archiveRpc=manualArchiveMigration.slice(manualArchiveMigration.indexOf('create or replace function public.set_round_archived'))
test('manual archive migration replaces only two existing signatures without touching grants RLS or automatic archival',()=>{
  assert.deepEqual([...manualArchiveMigration.matchAll(/create or replace function public\.(\w+)\(/g)].map(match=>match[1]),
    ['update_round','set_round_archived'])
  assert.equal((manualArchiveMigration.match(/\$\$/g)||[]).length,4)
  assert.doesNotMatch(manualArchiveMigration,/\b(?:drop|grant|revoke|alter|trigger|policy|publication|prepare_user_deletion|recover_orphaned_round|send_round_message|execute)\b/i)
  assert.match(archiveRpc,/^create or replace function public\.set_round_archived\( p_round_id uuid, p_archived boolean \) returns void language plpgsql security definer set search_path = '' as \$\$/)
  assert.equal((manualArchiveMigration.match(/security definer set search_path = ''/g)||[]).length,2)
})
test('current round edit differs from Phase 3.3c2-1 only by the explicit active-or-paused archive branch',()=>{
  const expected=editRpc.replace('create function','create or replace function')
    .replace("message_body := 'Die Runde wurde fortgesetzt.'; end if;",
      "message_body := 'Die Runde wurde fortgesetzt.'; elsif current_round.status in ('active', 'paused') and p_status = 'archived' then message_body := 'Die Runde wurde archiviert.'; end if;")
  assert.equal(currentEditRpc,expected)
  // Full-function equality preserves the already tested locks, metadata update,
  // validation, conditional insert, server identity and one-row return contract.
})
test('manual archive locks profile S before shared sequence and round U, then optional membership S',()=>{
  const steps=[
    "select (role = 'admin' or is_superadmin) into caller_is_admin",
    'perform pg_catalog.pg_advisory_xact_lock',
    'select status, orphaned_at, locked_at',
    'if not caller_is_admin then',
    'select role into caller_membership_role from public.round_memberships',
    'if current_locked_at is not null then',
    'if p_archived then',
    "update public.rounds set status = 'archived'",
    'select coalesce(max(round_seq), 0) + 1',
    'insert into public.round_messages',
  ].map(text=>archiveRpc.indexOf(text))
  assert.ok(steps.every((position,index)=>position>=0 && (index===0 || position>steps[index-1])))
  assert.match(archiveRpc,/select \(role = 'admin' or is_superadmin\) into caller_is_admin from public\.profiles where id = caller_user_id for share; if not found then raise exception 'Not authorized'; end if; perform pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\( 'round-message-sequence:' \|\| p_round_id::text, 0\)\);/)
  assert.match(archiveRpc,/select status, orphaned_at, locked_at into current_status, current_orphaned_at, current_locked_at from public\.rounds where id = p_round_id for update; if not found then raise exception 'Round does not exist'; end if;/)
  assert.match(archiveRpc,/if not caller_is_admin then select role into caller_membership_role from public\.round_memberships where round_id = p_round_id and user_id = caller_user_id for share; if not found or caller_membership_role is distinct from 'game_master' then raise exception 'Not authorized'; end if; end if; if current_locked_at is not null then raise exception 'Round is locked'; end if;/)
  assert.deepEqual(archiveRpc.match(/for (?:key share|share|update);/g),['for share;','for update;','for share;'])
  assert.equal((archiveRpc.match(/pg_advisory_xact_lock/g)||[]).length,1)
  assert.equal((archiveRpc.match(/from public\.profiles/g)||[]).length,1)
  assert.doesNotMatch(archiveRpc.slice(steps[2]),/pg_advisory_xact_lock|from public\.profiles/)
  assert.match(archiveRpc,/caller_user_id uuid := auth\.uid\(\);/)
  assert.match(archiveRpc,/if caller_user_id is null then raise exception 'Not authenticated'; end if; if p_archived is null then raise exception 'Archived state is required'; end if;/)
})
test('archive insert is exclusively in the non-archived true branch; unarchive retains errors and paused target',()=>{
  assert.match(archiveRpc,/if p_archived then if current_status = 'archived' then return; end if; update public\.rounds set status = 'archived' where id = p_round_id; select coalesce\(max\(round_seq\), 0\) \+ 1 into next_round_seq from public\.round_messages where round_id = p_round_id; insert into public\.round_messages \( round_id, round_seq, author_user_id, character_id, speaker_kind, speaker_name_snapshot, kind, recipient_user_id, body, client_request_id \) values \( p_round_id, next_round_seq, null, null, 'system', 'System', 'system_message', null, 'Die Runde wurde archiviert\.', pg_catalog\.gen_random_uuid\(\) \); return; end if;/)
  assert.match(archiveRpc,/if current_orphaned_at is not null then raise exception 'Round must be recovered before it can leave the archive'; end if; if current_status <> 'archived' then raise exception 'Round is not archived'; end if; update public\.rounds set status = 'paused' where id = p_round_id; end; \$\$;$/)
  assert.equal((archiveRpc.match(/insert into public\.round_messages/g)||[]).length,1)
  assert.equal((archiveRpc.match(/Die Runde wurde archiviert\./g)||[]).length,1)
  assert.doesNotMatch(manualArchiveMigration,/exception when|\bcommit\b|p_body|p_client_request_id|username|wieder geöffnet|reaktiviert|entarchiviert|set orphaned_at/i)
})
test('manual archive SQL tests exercise both paths, both starting states, authorization, rollback and read-only history',()=>{
  const sql=readFileSync('supabase/tests/round_messages_security.sql','utf8')
  const block=sql.slice(sql.indexOf('-- Phase 3.3c2-2:'),sql.indexOf('-- Phase 3.3c2-3:'))
  assert.match(block,/foreach archive_path in array array\['update_round','set_round_archived'\] loop\s+foreach starting_status in array array\['active','paused'\] loop/)
  assert.match(block,/archive_message\.author_user_id is null\s+and archive_message\.recipient_user_id is null and archive_message\.character_id is null/)
  assert.match(block,/expected_seq bigint := 6;/)
  assert.match(block,/max\(round_seq\)=5 and count\(\*\)=4/)
  assert.match(block,/update_round[^\n]+\$q\$,'23514'/)
  assert.match(block,/set_round_archived[^\n]+\$q\$,'23514'/)
  assert.match(block,/foreach administrator in array array\['admin','super'\]/)
  assert.match(block,/foreach caller in array array\['second','admin','super'\]/)
  assert.match(block,/r is not distinct from before_round/)
  assert.match(block,/'42501','CHAT_ROUND_ARCHIVED'/)
  for(const label of [
    'same and opposite archive paths never duplicate the archive event',
    'ordinary member reads all archive events in archived history',
    'archive RPC unarchives to paused without a message',
    'archive authority never grants chat access',
    'player and former GM archive attempts change neither round nor messages',
    'moderation lock blocks both archive paths including admin and Bewahrer',
    'late archive insert failure rolls back edit status and every metadata field',
    'late archive insert failure rolls back archive-only RPC completely',
    'archive no-ops and failed writes preserve private history too',
    'orphan archive no-op and blocked unarchive preserve state without a message',
    'recovery clears orphan marker but neither unarchives nor emits a message',
    'recovered round unarchives silently to paused',
  ]) assert.ok(block.includes(label),label)
  assert.doesNotMatch(block.replace(/--[^\n]*/g,''),/delete from (?:auth\.users|public\.profiles)|public\.prepare_user_deletion\(/i)
})

const automaticArchiveRpc=readFileSync('supabase/migrations/20260918100000_emit_automatic_round_archive_messages.sql','utf8')
  .replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()
const previousDeletionSql=readFileSync('supabase/migrations/20260903140000_harden_admin_role_management.sql','utf8')
  .replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()
const previousDeletionRpc=previousDeletionSql.slice(previousDeletionSql.indexOf('create or replace function public.prepare_user_deletion'))
  .split('$$;')[0]+'$$;'

test('automatic archive replaces only prepare_user_deletion and preserves its complete authorization and early profile locks',()=>{
  assert.deepEqual([...automaticArchiveRpc.matchAll(/create or replace function public\.(\w+)\(/g)].map(match=>match[1]),['prepare_user_deletion'])
  assert.equal((automaticArchiveRpc.match(/\$\$/g)||[]).length,2)
  assert.match(automaticArchiveRpc,/^create or replace function public\.prepare_user_deletion\( p_user_id uuid \) returns void language plpgsql security definer set search_path = '' as \$\$/)
  const originalPrefix=previousDeletionRpc.slice(previousDeletionRpc.indexOf('begin '),previousDeletionRpc.indexOf('for gm_membership in'))
  const currentPrefix=automaticArchiveRpc.slice(automaticArchiveRpc.indexOf('begin '),automaticArchiveRpc.indexOf('select coalesce(pg_catalog.array_agg'))
  assert.equal(currentPrefix,originalPrefix)
  assert.doesNotMatch(automaticArchiveRpc,/\b(?:drop|grant|revoke|alter|trigger|policy|publication|execute|update_round|set_round_archived|recover_orphaned_round|send_round_message)\b/i)
})

test('automatic archive acquires ALL UUID-sorted GM sequence locks before any round membership or character locks',()=>{
  const discovery=automaticArchiveRpc.slice(automaticArchiveRpc.indexOf('select coalesce(pg_catalog.array_agg'),automaticArchiveRpc.indexOf('for gm_membership in'))
  assert.equal(discovery,
    "select coalesce(pg_catalog.array_agg(round_id order by round_id), array[]::uuid[]) into candidate_round_ids from public.round_memberships where user_id = p_user_id and role = 'game_master'; "+
    "foreach candidate_round_id in array candidate_round_ids loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( 'round-message-sequence:' || candidate_round_id::text, 0)); end loop; ")
  const positions=[
    'from public.profiles where id = caller_user_id for share;',
    'from public.profiles where id = p_user_id for update;',
    'update public.profiles',
    'select coalesce(pg_catalog.array_agg',
    'perform pg_catalog.pg_advisory_xact_lock',
    'for gm_membership in',
    'for update of round_to_lock, membership',
    'update public.characters',
    'foreach candidate_round_id in array gm_round_ids',
    'update public.rounds',
    'insert into public.round_messages',
    'delete from public.round_memberships',
  ].map(step=>automaticArchiveRpc.indexOf(step))
  assert.ok(positions.every((position,index)=>position>=0 && (!index || position>positions[index-1])))
  assert.equal((automaticArchiveRpc.match(/pg_advisory_xact_lock/g)||[]).length,1)
  assert.doesNotMatch(automaticArchiveRpc.slice(positions[5]),/pg_advisory_xact_lock|from public\.profiles/)
  assert.deepEqual(automaticArchiveRpc.match(/for (?:share|update(?: of round_to_lock, membership)?)[; ]/g),
    ['for share;','for update;','for update of round_to_lock, membership '])
})

test('automatic archive revalidates only locked candidate GM rounds and classifies archived status under row locks',()=>{
  const lockedPass=automaticArchiveRpc.slice(automaticArchiveRpc.indexOf('for gm_membership in'),automaticArchiveRpc.indexOf('update public.characters'))
  assert.equal(lockedPass,
    "for gm_membership in select membership.id, membership.round_id, round_to_lock.status, round_to_lock.orphaned_at "+
    "from public.round_memberships as membership join public.rounds as round_to_lock on round_to_lock.id = membership.round_id "+
    "where membership.user_id = p_user_id and membership.role = 'game_master' and membership.round_id = any(candidate_round_ids) "+
    "order by membership.round_id for update of round_to_lock, membership loop "+
    "gm_round_ids := pg_catalog.array_append( gm_round_ids, gm_membership.round_id ); "+
    "if gm_membership.status <> 'archived' then newly_archived_round_ids := pg_catalog.array_append( newly_archived_round_ids, gm_membership.round_id ); end if; end loop; ")
  assert.doesNotMatch(automaticArchiveRpc,/locked_at|Round is locked/)
})

test('automatic archive preserves character cleanup and emits one atomic public event only for newly archived rounds',()=>{
  const tail=automaticArchiveRpc.slice(automaticArchiveRpc.indexOf('update public.characters'))
  assert.equal(tail,
    "update public.characters set round_id = null where owner_user_id = p_user_id and round_id is not null; "+
    "foreach candidate_round_id in array gm_round_ids loop update public.rounds set status = 'archived', orphaned_at = pg_catalog.now() where id = candidate_round_id; "+
    "if candidate_round_id = any(newly_archived_round_ids) then "+
    "select coalesce(max(round_seq), 0) + 1 into next_round_seq from public.round_messages where round_id = candidate_round_id; "+
    "insert into public.round_messages ( round_id, round_seq, author_user_id, character_id, speaker_kind, speaker_name_snapshot, kind, recipient_user_id, body, client_request_id ) "+
    "values ( candidate_round_id, next_round_seq, null, null, 'system', 'System', 'system_message', null, 'Die Runde wurde archiviert.', pg_catalog.gen_random_uuid() ); "+
    "end if; end loop; delete from public.round_memberships where user_id = p_user_id; end; $$;")
  assert.doesNotMatch(automaticArchiveRpc,/exception when|\b(?:commit|rollback)\b|delete from (?:auth\.users|public\.profiles)|p_body|username/i)
})

test('automatic archive SQL coverage includes locked and multiple rounds, authorization and full late-round rollback snapshots',()=>{
  const sql=readFileSync('supabase/tests/round_messages_security.sql','utf8')
  const block=sql.slice(sql.indexOf('-- Phase 3.3c2-3:'),sql.indexOf('-- Phase 3.3b3:'))
  for(const fixture of [
    "('active','active','active',false,true,2)",
    "('paused','paused','paused',false,true,2)",
    "('archived','archived','archived',false,true,2)",
    "('locked_active','locked_active','active',true,true,2)",
    "('locked_paused','locked_paused','paused',true,true,2)",
    "('player_only','player_only','active',false,false,2)",
    "('multi_active','multi','active',false,true,10)",
    "('multi_paused','multi','paused',false,true,20)",
    "('multi_archived','multi','archived',false,true,30)",
    "('super_user','user','super')","('admin_target','admin','super')",
  ]) assert.ok(block.includes(fixture),fixture)
  assert.match(block,/row_number\(\) over\(order by id\)/)
  assert.match(block,/case when position=1 then 2 else 9007199254740991 end/)
  assert.match(block,/prepare_user_deletion\(\(select id from deletion_targets where key='rollback'\)\)\$q\$,'23514'/)
  assert.match(block,/pg_temp\.deletion_snapshot\('rollback'\)=\(select data from deletion_snapshots where key='rollback'\)/)
  for(const table of ['profiles','rounds','round_memberships','characters','round_messages']) {
    assert.match(block,new RegExp('jsonb_agg\\(to_jsonb\\(\\w+\\) order by \\w+\\.id\\) from public\\.'+table))
  }
  for(const error of ['Not authorized','You cannot delete your own account','Admins can only delete users',
    'Superadmin cannot be deleted','User does not exist','Not authenticated']) {
    assert.ok(block.includes("'P0001','"+error+"'"),error)
  }
  for(const label of [
    'automatic archive preserves locked and player-only semantics',
    'deletion marker membership cleanup and character lifecycle preserved',
    'public server archive event follows private highest sequence independently per round',
    'rejected deletion preparations preserve all profiles rounds memberships characters and messages',
    'repeated preparation preserves original marker orphan timestamps and message counts',
    'late second-round insert failure rolls back marker every round orphan membership active ID character and message',
    'retry after late rollback archives both rounds without partial earlier messages',
  ]) assert.ok(block.includes(label),label)
  assert.match(block,/new_message\.author_user_id is null\s+and new_message\.recipient_user_id is null and new_message\.character_id is null/)
  assert.doesNotMatch(block.replace(/--[^\n]*/g,''),/delete from (?:auth\.users|public\.profiles)/i)
  assert.match(sql,/^begin;/m)
  assert.match(sql,/rollback;\s*$/)
})

test('deletion grant hardening revokes explicit anon access without replacing the function or changing other role grants',()=>{
  const migration=readFileSync('supabase/migrations/20260918101000_harden_prepare_user_deletion_execute_grants.sql','utf8')
    .replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()
  assert.equal(migration,
    'REVOKE ALL ON FUNCTION public.prepare_user_deletion(uuid) FROM PUBLIC; '+
    'REVOKE ALL ON FUNCTION public.prepare_user_deletion(uuid) FROM anon; '+
    'GRANT EXECUTE ON FUNCTION public.prepare_user_deletion(uuid) TO authenticated;')
})
