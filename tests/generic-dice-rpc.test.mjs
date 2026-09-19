import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = path => readFileSync(path, 'utf8')
const normalize = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
const migration = normalize(read('supabase/migrations/20260918120000_add_generic_dice_roll_rpc.sql'))
const previous = normalize(read('supabase/migrations/20260915100000_allow_game_master_active_character_chat.sql'))
const sqlTests = normalize(read('supabase/tests/generic_dice_roll_rpc_security.sql'))

function definition(sql, name) {
  const match = new RegExp(`create (?:or replace )?function public\\.${name}\\((.*?)\\) (.*?) as \\$\\$(.*?)\\$\\$;`).exec(sql)
  assert.ok(match, `missing function ${name}`)
  return { parameters: match[1].trim().split(/,\s*/), attributes: match[2], body: match[3].trim() }
}
const dice = definition(migration, 'send_round_dice_roll')
const chat = definition(migration, 'send_round_message')
const previousChat = definition(previous, 'send_round_message')
const retryStart = dice.body.indexOf('if found then')
const newStart = dice.body.indexOf('else perform 1 from public.profiles')
assert.ok(retryStart >= 0 && newStart > retryStart)
const retry = dice.body.slice(retryStart, newStart)
const newRoll = dice.body.slice(newStart)
const receipt = dice.body.slice(dice.body.indexOf('return pg_catalog.jsonb_build_object'))

function inOrder(source, fragments) {
  let last = -1
  for (const fragment of fragments) {
    const position = source.indexOf(fragment, last + 1)
    assert.ok(position > last, `missing or out of order: ${fragment}`)
    last = position
  }
}

test('3.4b exposes only six structured dice inputs and a definer JSON receipt', () => {
  assert.deepEqual(dice.parameters, [
    'p_round_id uuid', 'p_dice_count integer', 'p_dice_sides integer', 'p_modifier integer',
    'p_client_request_id uuid', 'p_expected_active_character_id uuid',
  ])
  assert.equal(dice.attributes, "returns jsonb language plpgsql security definer set search_path = ''")
  assert.deepEqual([...migration.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map(match => match[1]),
    ['send_round_message', 'send_round_dice_roll'])
})

test('dice EXECUTE is authenticated-only and the migration changes no table ACL or publication', () => {
  assert.deepEqual(migration.split(';').map(statement => statement.trim()).filter(statement => /^(grant|revoke) /.test(statement)), [
    'revoke all on function public.send_round_dice_roll(uuid, integer, integer, integer, uuid, uuid) from public, anon',
    'grant execute on function public.send_round_dice_roll(uuid, integer, integer, integer, uuid, uuid) to authenticated',
  ])
  assert.doesNotMatch(migration, /\b(?:table|policy|publication|trigger|index|view)\b|\bexecute\s+(?:format|'|p_)/i)
})

test('chat preserves its signature, guards and write path; only the retry predicate changes', () => {
  assert.deepEqual(chat.parameters, previousChat.parameters)
  assert.equal(chat.attributes, previousChat.attributes)
  const oldPredicate = 'message.round_id <> p_round_id or message.body <> p_body'
  const newPredicate = "message.round_id is distinct from p_round_id or message.kind is distinct from 'character_message' or message.body is distinct from p_body"
  assert.ok(chat.body.includes(newPredicate))
  // Compare the executable body after undoing just the authorized predicate change.
  // Whitespace/comments are ignored; this catches unintended chat behavior changes.
  assert.equal(chat.body.replace(newPredicate, oldPredicate), previousChat.body)
})

test('all invalid mathematical and required request inputs fail before any draw', () => {
  for (const [parameter, bounds] of [['p_dice_count', '1 and 50'], ['p_dice_sides', '2 and 1000'], ['p_modifier', '-9999 and 9999']]) {
    assert.ok(dice.body.includes(`${parameter} is null or ${parameter} not between ${bounds}`))
  }
  inOrder(dice.body, ["caller_user_id uuid := auth.uid()", 'if caller_user_id is null',
    'if p_round_id is null or p_client_request_id is null', 'DICE_INVALID_PARAMETERS', 'pg_catalog.random('])
  assert.doesNotMatch(dice.body, /(?:coalesce|greatest|least)\(p_(?:dice_count|dice_sides|modifier)/)
})

test('chat and dice share both advisory key expressions, without a second namespace', () => {
  const keys = body => [...body.matchAll(/pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\( (.*?), 0\)\)/g)].map(match => match[1])
  assert.deepEqual(keys(dice.body), keys(chat.body))
  assert.deepEqual(keys(dice.body), [
    "'round-message-request:' || caller_user_id::text || ':' || p_client_request_id::text",
    "'round-message-sequence:' || p_round_id::text",
  ])
})

test('retry requires current read access, author/request identity, same kind/round and stored parameters', () => {
  inOrder(dice.body, ['round-message-request:', 'public.can_read_round_messages(p_round_id)',
    'where author_user_id = caller_user_id and client_request_id = p_client_request_id', 'if found then'])
  for (const predicate of ["message.round_id is distinct from p_round_id", "message.kind is distinct from 'dice_roll'",
    'dice_detail.dice_count is distinct from p_dice_count', 'dice_detail.dice_sides is distinct from p_dice_sides',
    'dice_detail.modifier is distinct from p_modifier']) assert.ok(retry.includes(predicate), predicate)
  assert.match(retry, /select \* into dice_detail from public\.round_message_dice_rolls where message_id = message.id; if not found then raise exception using errcode = '22000', message = 'DICE_STORED_ROLL_INCOMPLETE'/)
  assert.doesNotMatch(retry, /\b(?:insert|random|pg_advisory_xact_lock|active_character_id|next_round_seq)\b/)
})

test('new writes follow profile, shared sequence, character, round and membership lock order', () => {
  inOrder(newRoll, [
    'from public.profiles where id = caller_user_id for key share', 'round-message-sequence:',
    'select * into current_character from public.characters', 'for share;',
    'select * into current_round from public.rounds', 'for share;',
    'select * into current_membership from public.round_memberships', 'for share;',
    'CHAT_ROUND_LOCKED', 'CHAT_ROUND_ARCHIVED', 'CHAT_IDENTITY_CHANGED', 'pg_catalog.random(',
    'pg_catalog.max(round_seq)', 'insert into public.round_messages', 'insert into public.round_message_dice_rolls',
  ])
  assert.doesNotMatch(newRoll, /for update|is_admin|is_superadmin/)
})

test('dice copies current chat membership, status, character and GM narration semantics', () => {
  const guards = body => body.slice(body.indexOf('perform 1 from public.profiles'), body.indexOf('select coalesce(')).trim()
  const diceGuards = dice.body.slice(dice.body.indexOf('perform 1 from public.profiles'), dice.body.indexOf('for die_index')).trim()
  assert.equal(diceGuards, guards(chat.body))
  assert.match(diceGuards, /owner_user_id = caller_user_id and round_id = p_round_id and deleted_at is null for share/)
  assert.match(diceGuards, /current_membership.role = 'game_master' and p_expected_active_character_id is null/)
  assert.match(diceGuards, /current_membership.active_character_id is distinct from p_expected_active_character_id/)
})

test('one inclusive integer draw per die is appended in order; the stored array is summed exactly', () => {
  assert.match(newRoll, /for die_index in 1\.\.p_dice_count loop rolled_results := pg_catalog.array_append\(rolled_results, pg_catalog.random\(1, p_dice_sides\)\); end loop;/)
  assert.match(newRoll, /select pg_catalog.sum\(result\)::integer into rolled_raw_total from pg_catalog.unnest\(rolled_results\) as die\(result\)/)
  assert.equal((dice.body.match(/pg_catalog\.random\(/g) ?? []).length, 1)
  assert.doesNotMatch(newRoll, /\b(?:setseed|mod|floor|gen_random_bytes)\s*\(|%|\border by\b/)
})

test('sequence allocation includes all round history and the public parent uses server identity', () => {
  assert.match(newRoll, /select coalesce\(pg_catalog.max\(round_seq\), 0\) \+ 1 into next_round_seq from public.round_messages where round_id = p_round_id;/)
  assert.match(newRoll, /insert into public.round_messages \( round_id, round_seq, author_user_id, character_id, speaker_kind, speaker_name_snapshot, kind, body, recipient_user_id, client_request_id \) values \( p_round_id, next_round_seq, caller_user_id, case when speaker_kind = 'character' then current_character.id else null end, speaker_kind, speaker_name, 'dice_roll', null, null, p_client_request_id \) returning \* into message;/)
})

test('parent and seven detail fields are inserted atomically with no swallowed exception', () => {
  assert.match(newRoll, /insert into public.round_message_dice_rolls \( message_id, dice_count, dice_sides, modifier, results, raw_total, total \) values \( message.id, p_dice_count, p_dice_sides, p_modifier, rolled_results, rolled_raw_total, rolled_raw_total \+ p_modifier \) returning \* into dice_detail;/)
  assert.equal((dice.body.match(/insert into /g) ?? []).length, 2)
  assert.doesNotMatch(dice.body, /\bexception when\b|\b(?:commit|rollback)\b/)
})

test('new writes and retries converge on one explicit allowlisted receipt', () => {
  assert.equal((dice.body.match(/\breturn /g) ?? []).length, 1)
  assert.deepEqual([...receipt.matchAll(/'(\w+)',/g)].map(match => match[1]), [
    'id', 'round_id', 'round_seq', 'author_user_id', 'character_id', 'speaker_kind',
    'speaker_name_snapshot', 'kind', 'body', 'recipient_user_id', 'client_request_id', 'created_at', 'dice_roll',
    'message_id', 'dice_count', 'dice_sides', 'modifier', 'results', 'raw_total', 'total',
  ])
  assert.doesNotMatch(dice.body, /to_jsonb|row_to_json|jsonb_agg/)
  assert.match(receipt, /'dice_roll', pg_catalog.jsonb_build_object/)
})

test('SQL fixtures cover arithmetic, bounds, replay, both type conflicts and exact stored receipts', () => {
  for (const fragment of ["('1d6',1,6,0)", "('5d6',5,6,0)", "('2d6+3',2,6,3)", "('2d6-3',2,6,-3)",
    "('maximum',50,1000,9999)", "('minimum',1,2,-9999)", '(0,6,0)', '(51,6,0)', '(1,1,0)', '(1,1001,0)',
    '(1,6,-10000)', '(1,6,10000)', '(null,6,0)', '(1,null,0)', '(1,6,null)',
    'p_receipt=expected', 'stored.raw_total=(select sum(value) from unnest(stored.results)',
    'identical retry returns original complete receipt', 'retry creates neither second message nor second detail',
    'Dice request cannot be a chat retry', "where key='chat'", 'DICE_STORED_ROLL_INCOMPLETE']) {
    assert.ok(sqlTests.includes(fragment), fragment)
  }
})

test('SQL fixtures cover identities, read gates, shared producers and a specific late detail failure', () => {
  for (const fragment of ['CHAT_CHARACTER_UNAVAILABLE', 'CHAT_IDENTITY_CHANGED', 'CHAT_NO_ACTIVE_CHARACTER',
    'GM narration identity', 'GM own active character identity', 'historical GM retry survives role loss',
    'retry after rename and active switch keeps original snapshot and results', 'CHAT_ROUND_ARCHIVED',
    'CHAT_ROUND_LOCKED', 'CHAT_NOT_AUTHORIZED', "array['other','admin','super']", 'set local role anon',
    'public.assign_prepared_character(', 'public.set_round_archived(', 'public.transfer_game_master(',
    "array['character_message','dice_roll','system_message','dice_roll','system_message']", "'23514',null,'dice_test_late_failure'",
    'rollback to savepoint dice_late_failure', 'same request succeeds after rollback with next unconsumed sequence']) {
    assert.ok(sqlTests.includes(fragment), fragment)
  }
  assert.ok(sqlTests.startsWith('begin;') && sqlTests.endsWith('rollback;'))
  assert.doesNotMatch(sqlTests, /delete from auth\.users|create (?:or replace )?function public\./)
})
