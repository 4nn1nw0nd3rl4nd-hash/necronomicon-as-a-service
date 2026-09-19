import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const migrationPath = 'supabase/migrations/20260918110000_add_dice_roll_message_foundation.sql'
const normalize = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
const migration = normalize(readFileSync(migrationPath, 'utf8'))
const originalSchema = normalize(readFileSync('supabase/migrations/20260914100000_create_round_messages.sql', 'utf8'))
const previousIdentity = normalize(readFileSync('supabase/migrations/20260916100000_allow_public_system_messages.sql', 'utf8'))
const sqlTests = readFileSync('supabase/tests/round_message_dice_rolls_security.sql', 'utf8')

// Extract a named CHECK by balanced parentheses, independent of indentation.
function check(sql, name) {
  const match = new RegExp(`\\bconstraint ${name} check \\(`).exec(sql)
  assert.ok(match, `missing CHECK ${name}`)
  const start = match.index + match[0].length
  let depth = 1
  for (let position = start; position < sql.length; position++) {
    if (sql[position] === '(') depth++
    if (sql[position] === ')' && --depth === 0) return sql.slice(start, position).trim()
  }
  assert.fail(`unclosed CHECK ${name}`)
}
const constraints = [...migration.matchAll(/(?:add )?constraint (\w+) check/g)].map(match => match[1])

test('3.4a adds exactly the dice kind and preserves existing identity branches', () => {
  assert.equal(check(migration, 'round_messages_kind_check'), "kind in ('character_message', 'system_message', 'dice_roll')")
  const identity = check(migration, 'round_messages_message_identity')
  assert.ok(identity.startsWith(check(previousIdentity, 'round_messages_message_identity') + ' or '))
  assert.match(identity, /or \( kind = 'dice_roll' and recipient_user_id is null and speaker_kind in \('character', 'game_master'\) \)$/)
  assert.doesNotMatch(identity, /auth\.uid|author_user_id is not null|character_id is not null/)
})

test('body nullability is kind-dependent and all existing text checks remain in place', () => {
  assert.match(migration, /alter column body drop not null/)
  assert.equal(check(migration, 'round_messages_body_kind'),
    "(kind = 'dice_roll' and body is null) or (kind in ('character_message', 'system_message') and body is not null)")
  assert.deepEqual([...migration.matchAll(/drop constraint (\w+)/g)].map(match => match[1]),
    ['round_messages_kind_check', 'round_messages_message_identity'])
  assert.equal(check(originalSchema, 'round_messages_body_length'), 'char_length(body) between 1 and 4000')
  assert.match(check(originalSchema, 'round_messages_body_not_blank'), /btrim\(body,.*<> ''$/)
  assert.doesNotMatch(migration, /(?:add|drop) constraint round_messages_(?:speaker_kind_check|gm_identity|body_length|body_not_blank)/)
})

test('detail schema has exactly seven columns, integer data, one PK and cascading parent FK', () => {
  const columns = migration.split('create table public.round_message_dice_rolls (')[1].split(', constraint ')[0]
    .split(',').map(column => column.trim())
  assert.deepEqual(columns, [
    'message_id uuid primary key references public.round_messages(id) on delete cascade',
    'dice_count integer not null', 'dice_sides integer not null',
    'modifier integer not null default 0', 'results integer[] not null',
    'raw_total integer not null', 'total integer not null',
  ])
  assert.doesNotMatch(migration, /\bbigint\b|create (?:unique )?index/)
})

test('numeric constraints enforce all agreed limits and arithmetic without a SUM helper', () => {
  for (const [suffix, expression] of [
    ['count_range', 'dice_count between 1 and 50'],
    ['sides_range', 'dice_sides between 2 and 1000'],
    ['modifier_range', 'modifier between -9999 and 9999'],
    ['raw_total_range', 'raw_total between dice_count and dice_count * dice_sides'],
    ['total', 'total = raw_total + modifier'],
  ]) assert.equal(check(migration, `round_message_dice_rolls_${suffix}`), expression)
  assert.equal(constraints.length, 10)
})

test('array checks reject empty, multidimensional, non-one-based and NULL-containing results', () => {
  const shape = check(migration, 'round_message_dice_rolls_results_shape')
  for (const expression of ['cardinality(results) > 0', 'array_ndims(results) = 1',
    'array_lower(results, 1) = 1', 'cardinality(results) = dice_count', 'array_length(results, 1) = dice_count']) {
    assert.ok(shape.includes(expression), expression)
  }
  assert.match(shape, /\) is true$/)
  assert.equal(check(migration, 'round_message_dice_rolls_results_values'),
    '( 1 <= all(results) and dice_sides >= all(results) ) is true')
})

test('detail SELECT uses parent RLS and kind, with no definer or broader round helper', () => {
  assert.match(migration, /alter table public.round_message_dice_rolls enable row level security/)
  const policy = migration.slice(migration.indexOf('create policy'))
  assert.match(policy, /on public.round_message_dice_rolls for select to authenticated using \( exists \(/)
  assert.match(policy, /from public.round_messages as message where message.id = round_message_dice_rolls.message_id and message.kind = 'dice_roll'/)
  assert.doesNotMatch(policy, /can_read_round_messages|can_view_round|is_admin|security definer/)
  assert.equal((migration.match(/create policy/g) ?? []).length, 1)
  assert.doesNotMatch(migration, /alter policy/)
})

test('explicit ACL reset defeats default grants; only detail SELECT is granted', () => {
  const statements = migration.split(';').map(statement => statement.trim())
  assert.deepEqual(statements.filter(statement => /^(grant|revoke) /.test(statement)), [
    'revoke all on table public.round_message_dice_rolls from public, anon, authenticated',
    'grant select on table public.round_message_dice_rolls to authenticated',
  ])
  assert.doesNotMatch(migration, /for (?:insert|update|delete|all) to/)
})

test('foundation introduces no RPC, randomness, triggers, parent policy or publication changes', () => {
  assert.doesNotMatch(migration, /\b(?:function|procedure|trigger|publication|random|gen_random_bytes|security definer)\b/i)
  assert.doesNotMatch(migration, /\b(?:insert into|update public|delete from|create view|create type)\b/i)
  assert.equal((migration.match(/create table/g) ?? []).length, 1)
})

test('SQL coverage exercises boundaries, NULLs, parent visibility, ACLs and cascades in a rollback transaction', () => {
  for (const label of ['minimum count and sides', 'maximum count and sides', 'minimum modifier',
    'zero count', 'count 51', 'one side', 'side 1001', 'modifier below', 'modifier above',
    'wrong length', 'empty array', 'NULL element', 'all NULL elements', 'zero result',
    'result above sides', 'multiple dimensions', 'lower bound zero', 'raw below', 'raw above',
    'wrong total', 'NULL count', 'NULL sides', 'NULL modifier', 'NULL results', 'NULL raw total', 'NULL total']) {
    assert.ok(sqlTests.includes(`'${label}'`), label)
  }
  for (const state of ['23502', '23503', '23505', '23514', '42501']) assert.ok(sqlTests.includes(`'${state}'`))
  assert.match(sqlTests, /has_any_column_privilege/)
  assert.match(sqlTests, /acl\.grantee=0/)
  assert.match(sqlTests, /as restrictive\s+for select to authenticated/)
  assert.match(sqlTests, /rollback to savepoint dice_parent_policy/)
  assert.match(sqlTests, /foreach identity_key in array array\['other','admin','super'\]/)
  assert.match(sqlTests, /locked player cannot read dice details/)
  assert.match(sqlTests, /locked GM can read dice details/)
  assert.match(sqlTests, /removed member loses detail access/)
  assert.match(sqlTests, /modifier=0 and results=array\[2,6,1,4,5\]/)
  const executable = normalize(sqlTests)
  assert.ok(executable.startsWith('begin;'))
  assert.ok(executable.endsWith('rollback;'))
  assert.doesNotMatch(executable, /delete from auth\.users|create (?:or replace )?function public\./)
})
