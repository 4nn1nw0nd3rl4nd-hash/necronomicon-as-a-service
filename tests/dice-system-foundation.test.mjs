import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const read = path => readFileSync(path, 'utf8')
const normalize = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
const path = 'supabase/migrations/20260925100000_add_dice_system_foundation.sql'
const migration = normalize(read(path))
const prior = normalize(read('supabase/migrations/20260918120000_add_generic_dice_roll_rpc.sql'))
const security = normalize(read('supabase/tests/dice_system_foundation_security.sql'))
const backfill = read('supabase/tests/dice_system_foundation_backfill.sql')
function definition(sql, name) {
  const found = new RegExp('create (?:or replace )?function public\\.' + name + '\\((.*?)\\) (.*?) as \\$\\$(.*?)\\$\\$;').exec(sql)
  assert.ok(found, name)
  return { signature: found[1], attributes: found[2], body: found[3] }
}
const setter = definition(migration, 'set_round_dice_system')
const dice = definition(migration, 'send_round_dice_roll')
const oldDice = definition(prior, 'send_round_dice_roll')
function inOrder(source, fragments) {
  let offset = 0
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, offset)
    assert.ok(index >= offset, fragment)
    offset = index + fragment.length
  }
}

test('3.5f1 adds both text snapshots with constant backfill defaults and generic-only checks', () => {
  assert.equal(readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort().at(-1),
    path.split('/').at(-1))
  for (const table of ['rounds', 'round_message_dice_rolls']) {
    assert.ok(migration.includes('alter table public.' + table +
      " add column dice_system text not null default 'generic', add constraint " + table +
      "_dice_system_check check (dice_system in ('generic'));"))
  }
  assert.doesNotMatch(migration, /create type|\benum\b|'vaesen'|'splinter_portals'|drop (?:table|column|constraint)/)
})

test('3.5f1 exposes only the focused setter and replaces only the existing dice RPC', () => {
  assert.deepEqual([...migration.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map(m => m[1]),
    ['set_round_dice_system', 'send_round_dice_roll'])
  assert.equal(setter.signature, ' p_round_id uuid, p_dice_system text ')
  assert.equal(setter.attributes, "returns void language plpgsql security definer set search_path = ''")
  assert.match(setter.body, /caller_user_id uuid := auth.uid\(\)/)
  assert.match(setter.body, /if caller_user_id is null then raise exception using errcode = '42501'/)
  assert.match(setter.body, /p_round_id is null or p_dice_system is null or p_dice_system not in \('generic'\)/)
  assert.doesNotMatch(setter.body, /btrim|lower|upper|coalesce|is_admin|is_superadmin/)
})

test('setter locks live profile, shared sequence, round and final GM membership in order', () => {
  inOrder(setter.body, [
    'from public.profiles where id = caller_user_id and deletion_pending_at is null for share;',
    "if not found then raise exception using errcode = '42501', message = 'Not authorized'",
    "'round-message-sequence:' || p_round_id::text",
    'from public.rounds where id = p_round_id for update;',
    "if current_round.locked_at is not null then raise exception using errcode = '42501', message = 'Round is locked'",
    'from public.round_memberships where round_id = p_round_id and user_id = caller_user_id for share;',
    "if not found or caller_membership_role is distinct from 'game_master'",
    'update public.rounds set dice_system = p_dice_system where id = p_round_id;',
  ])
  assert.equal((setter.body.match(/pg_advisory_xact_lock/g) ?? []).length, 1)
  assert.doesNotMatch(setter.body, /current_round.status|insert into|update public.round_message_dice_rolls/)
})

test('RPC and column ACLs keep authenticated execution but deny direct snapshot writes', () => {
  assert.match(migration, /revoke all on function public.set_round_dice_system\(uuid, text\) from public, anon;/)
  assert.match(migration, /grant execute on function public.set_round_dice_system\(uuid, text\) to authenticated;/)
  for (const table of ['rounds', 'round_message_dice_rolls']) {
    assert.ok(migration.includes('revoke update (dice_system) on table public.' + table + ' from public, anon, authenticated;'))
  }
  const grants = normalize(read('supabase/migrations/20260916120000_add_controlled_round_edit.sql'))
  assert.match(grants, /revoke update on table public.rounds from public, anon, authenticated;/)
  assert.match(grants, /grant update \(name, system, description, appointment\) on table public.rounds to authenticated;/)
  assert.doesNotMatch(migration, /grant .* on table|create policy|alter policy|publication|trigger/)
})

test('dice executable body changes only snapshot INSERT and receipt, preserving all existing guards and retries', () => {
  assert.equal(dice.signature, oldDice.signature)
  assert.equal(dice.attributes, oldDice.attributes)
  assert.ok(dice.body.includes('total, dice_system ) values'))
  assert.ok(dice.body.includes('rolled_raw_total + p_modifier, current_round.dice_system'))
  assert.ok(dice.body.includes("'dice_system', dice_detail.dice_system"))
  const reverted = dice.body
    .replace('total, dice_system ) values', 'total ) values')
    .replace('rolled_raw_total + p_modifier, current_round.dice_system', 'rolled_raw_total + p_modifier')
    .replace(", 'dice_system', dice_detail.dice_system", '')
  assert.equal(reverted, oldDice.body)
})

test('new snapshot reads locked round, while replay uses only stored detail before new-roll locks', () => {
  inOrder(dice.body, ['round-message-sequence:',
    'select * into current_round from public.rounds where id = p_round_id for share;',
    'insert into public.round_messages', 'insert into public.round_message_dice_rolls',
    'rolled_raw_total + p_modifier, current_round.dice_system'])
  const retry = dice.body.slice(dice.body.indexOf('if found then'), dice.body.indexOf('else perform 1 from public.profiles'))
  assert.match(retry, /select \* into dice_detail from public.round_message_dice_rolls where message_id = message.id/)
  assert.doesNotMatch(retry, /current_round|dice_system|insert|update|random|pg_advisory_xact_lock/)
  assert.match(dice.body, /'dice_system', dice_detail.dice_system/)
})

test('SQL security fixtures exercise real auth, constraints, stored snapshots, idempotency and transfer', () => {
  for (const fragment of [
    "'round default is generic'", "'detail default is generic'", "'23502'", "'23514'",
    "array[null,'','vaesen','splinter_portals','foo',' generic','GENERIC']",
    "array['player','admin','super','outsider']", "'Not authenticated'", 'set local role anon',
    'acl.grantee=0', 'has_column_privilege', "array['active','paused','archived']",
    "'Round is locked'", 'set deletion_pending_at=now()', 'set deletion_pending_at=null',
    "'RPC persists generic snapshot'", "'retry creates no second parent or detail'",
    'a.receipt=b.receipt', 'public.transfer_game_master(', "'original details remain unchanged'",
  ]) assert.ok(security.includes(fragment), fragment)
  assert.ok(security.startsWith('begin;') && security.endsWith('rollback;'))
})

test('backfill fixture applies the actual migration to preexisting rows and compares all prior data', () => {
  inOrder(backfill, ['begin;', 'insert into public.rounds', 'insert into public.round_messages',
    'insert into public.round_message_dice_rolls', 'create temporary table before_backfill',
    '\\ir ../migrations/20260925100000_add_dice_system_foundation.sql',
    "r.dice_system='generic' and d.dice_system='generic'",
    "to_jsonb(r)-'dice_system'=old.round_row", 'to_jsonb(m)=old.message_row',
    "to_jsonb(d)-'dice_system'=old.detail_row", 'rollback;'])
  assert.doesNotMatch(backfill, /\bdrop column\b/i)
})

test('unchanged frontend decoder ignores the additional RPC snapshot field', () => {
  const require = createRequire(import.meta.url)
  const ts = require('typescript')
  const source = read('src/types/roundMessage.ts')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const exports = {}
  vm.runInNewContext(compiled, { exports })
  const message = {
    id: 'roll', round_id: 'round', round_seq: 1, author_user_id: 'gm', recipient_user_id: null,
    character_id: null, speaker_name_snapshot: 'Spielleitung', client_request_id: 'request',
    created_at: '2026-09-25T10:00:00Z', kind: 'dice_roll', speaker_kind: 'game_master', body: null,
    dice_roll: { message_id: 'roll', dice_count: 3, dice_sides: 6, modifier: 2,
      results: [2, 6, 4], raw_total: 12, total: 14 },
  }
  const original = exports.decodeRoundMessage(message)
  const extended = exports.decodeRoundMessage({ ...message, dice_roll: { ...message.dice_roll, dice_system: 'generic' } })
  assert.ok(extended?.dice_roll)
  assert.equal(JSON.stringify(extended), JSON.stringify(original))
})

test('3.5f1 leaves frontend system selection and character templates outside its scope', () => {
  for (const path of ['src/components/PlayChatPanel.tsx', 'src/components/EditRoundForm.tsx',
    'src/hooks/useSendRoundMessage.ts', 'src/types/round.ts', 'src/types/roundMessage.ts']) {
    assert.doesNotMatch(read(path), /set_round_dice_system|dice_system|splinter_portals|Wurf pushen/)
  }
  assert.doesNotMatch(migration, /alter table public.characters|template_key|template_version|visibility|reroll_of/)
})
