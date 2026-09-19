-- Phase 3.4b RPC integration. NOT EXECUTED: run after all migrations through
-- 20260918120000 in an approved isolated test database as postgres, ON_ERROR_STOP.
-- Setup is privileged SQL; all dice creation under test uses the authenticated RPC.
-- If execution stops in an open session, explicitly issue ROLLBACK.
begin;

create temporary table dice_test_ids (key text primary key, id uuid not null default gen_random_uuid());
insert into dice_test_ids(key) values
  ('player'),('other'),('gm'),('admin'),('round'),('character');
insert into dice_test_ids(key,id) values ('super',coalesce(
  (select id from public.profiles where is_superadmin),gen_random_uuid()));
grant select on dice_test_ids to authenticated, anon;
do $$ begin
  execute format('grant usage on schema %I to authenticated, anon',
    (select nspname from pg_catalog.pg_namespace where oid=pg_my_temp_schema()));
end $$;
create function pg_temp.dice_id(p_key text) returns uuid language sql stable as $$
  select id from pg_temp.dice_test_ids where key=p_key;
$$;
create function pg_temp.dice_check(p_ok boolean,p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL: %',p_label; end if;
end;
$$;
create function pg_temp.dice_error(p_sql text,p_state text,p_constraint text default null)
returns void language plpgsql as $$
declare actual_constraint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics actual_constraint=constraint_name;
    if sqlstate=p_state and (p_constraint is null or actual_constraint=p_constraint) then return; end if;
    raise;
  end;
  -- A successful statement affecting zero rows is not an expected SQL error.
  raise exception 'Expected SQLSTATE % for %',p_state,p_sql;
end;
$$;

insert into auth.users(id,raw_user_meta_data)
select id,jsonb_build_object('username','dice34_'||id::text,'display_name','Dice Test')
from dice_test_ids where key in ('player','other','gm','admin','super')
and not exists(select 1 from auth.users where auth.users.id=dice_test_ids.id);
update public.profiles set role='admin' where id=pg_temp.dice_id('admin');
update public.profiles set role='admin',is_superadmin=true
where id=pg_temp.dice_id('super') and not is_superadmin;
insert into public.rounds(id,name) values (pg_temp.dice_id('round'),'Dice RPC Test');
insert into public.round_memberships(round_id,user_id,role) values
  (pg_temp.dice_id('round'),pg_temp.dice_id('player'),'player'),
  (pg_temp.dice_id('round'),pg_temp.dice_id('gm'),'game_master');
insert into public.characters(id,name,owner_user_id,round_id,template_key,template_version)
values(pg_temp.dice_id('character'),'Dice Character',pg_temp.dice_id('player'),pg_temp.dice_id('round'),'vaesen',1);

insert into dice_test_ids(key) values
  ('second'),('other_round'),('sequence_round'),('sequence_character'),('sequence_prepared'),
  ('gm_character'),('inactive'),('foreign_character'),('prepared'),('deleted'),('other_character'),
  ('incomplete_request'),('incomplete_message'),('atomic_request');
insert into auth.users(id,raw_user_meta_data)
values(pg_temp.dice_id('second'),jsonb_build_object('username','dice34_'||pg_temp.dice_id('second')::text));
insert into public.rounds(id,name) values
  (pg_temp.dice_id('other_round'),'Other Dice Round'),(pg_temp.dice_id('sequence_round'),'Mixed Sequence Round');
insert into public.round_memberships(round_id,user_id,role) values
  (pg_temp.dice_id('round'),pg_temp.dice_id('second'),'player'),
  (pg_temp.dice_id('other_round'),pg_temp.dice_id('player'),'player'),
  (pg_temp.dice_id('sequence_round'),pg_temp.dice_id('player'),'player'),
  (pg_temp.dice_id('sequence_round'),pg_temp.dice_id('gm'),'game_master');
insert into public.characters(id,name,owner_user_id,round_id,template_key,template_version,deleted_at) values
  (pg_temp.dice_id('gm_character'),'GM Character',pg_temp.dice_id('gm'),pg_temp.dice_id('round'),'vaesen',1,null),
  (pg_temp.dice_id('inactive'),'Inactive Character',pg_temp.dice_id('player'),pg_temp.dice_id('round'),'vaesen',1,null),
  (pg_temp.dice_id('foreign_character'),'Foreign Round',pg_temp.dice_id('player'),pg_temp.dice_id('other_round'),'vaesen',1,null),
  (pg_temp.dice_id('prepared'),'Prepared',null,pg_temp.dice_id('round'),'vaesen',1,null),
  (pg_temp.dice_id('deleted'),'Deleted',pg_temp.dice_id('player'),pg_temp.dice_id('round'),'vaesen',1,now()),
  (pg_temp.dice_id('other_character'),'Other Owner',pg_temp.dice_id('second'),pg_temp.dice_id('round'),'vaesen',1,null),
  (pg_temp.dice_id('sequence_character'),'Sequence Character',pg_temp.dice_id('player'),pg_temp.dice_id('sequence_round'),'vaesen',1,null),
  (pg_temp.dice_id('sequence_prepared'),'Sequence Prepared',null,pg_temp.dice_id('sequence_round'),'vaesen',1,null);
update public.round_memberships set active_character_id=pg_temp.dice_id('character')
where round_id=pg_temp.dice_id('round') and user_id=pg_temp.dice_id('player');
update public.round_memberships set active_character_id=pg_temp.dice_id('gm_character')
where round_id=pg_temp.dice_id('round') and user_id=pg_temp.dice_id('gm');
update public.round_memberships set active_character_id=pg_temp.dice_id('other_character')
where round_id=pg_temp.dice_id('round') and user_id=pg_temp.dice_id('second');
update public.round_memberships set active_character_id=pg_temp.dice_id('sequence_character')
where round_id=pg_temp.dice_id('sequence_round') and user_id=pg_temp.dice_id('player');

create temporary table dice_receipts(key text primary key, receipt jsonb not null);
grant select,insert on dice_receipts to authenticated;
create function pg_temp.check_roll(p_receipt jsonb) returns void language plpgsql as $$
declare expected jsonb; stored public.round_message_dice_rolls%rowtype;
begin
  select to_jsonb(m)||jsonb_build_object('dice_roll',to_jsonb(d)) into expected
  from public.round_messages m join public.round_message_dice_rolls d on d.message_id=m.id
  where m.id=(p_receipt->>'id')::uuid;
  perform pg_temp.dice_check(found and p_receipt=expected,'receipt exactly matches stored envelope and ordered details');
  select * into stored from public.round_message_dice_rolls where message_id=(p_receipt->>'id')::uuid;
  perform pg_temp.dice_check(cardinality(stored.results)=stored.dice_count
    and (1 <= all(stored.results)) is true and (stored.dice_sides >= all(stored.results)) is true
    and stored.raw_total=(select sum(value) from unnest(stored.results) as die(value))
    and stored.total=stored.raw_total+stored.modifier,'exact array sum and all result bounds');
  perform pg_temp.dice_check(p_receipt->>'kind'='dice_roll' and p_receipt->'body'='null'::jsonb
    and p_receipt->'recipient_user_id'='null'::jsonb and p_receipt->>'author_user_id'=auth.uid()::text,
    'server public dice identity');
end;
$$;
create function pg_temp.rpc_error(p_sql text,p_state text,p_message text default null,p_constraint text default null)
returns void language plpgsql as $$
declare before_messages bigint; before_details bigint; actual_constraint text;
begin
  select count(*) into before_messages from public.round_messages;
  select count(*) into before_details from public.round_message_dice_rolls;
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics actual_constraint=constraint_name;
    if sqlstate<>p_state or (p_message is not null and sqlerrm<>p_message)
      or (p_constraint is not null and actual_constraint<>p_constraint) then raise; end if;
    perform pg_temp.dice_check((select count(*)=before_messages from public.round_messages)
      and (select count(*)=before_details from public.round_message_dice_rolls),'rejection leaves no parent or detail');
    return;
  end;
  raise exception 'Expected SQLSTATE % for %',p_state,p_sql;
end;
$$;

-- Validate target capability without drawing or exposing a seed API.
select pg_temp.dice_check(to_regprocedure('pg_catalog.random(integer,integer)') is not null,'integer-range random exists');
select pg_temp.dice_check(has_function_privilege('authenticated','public.send_round_dice_roll(uuid,integer,integer,integer,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.send_round_dice_roll(uuid,integer,integer,integer,uuid,uuid)','EXECUTE'),
  'only authenticated client role can execute dice RPC');
select pg_temp.dice_check(not exists(select 1 from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  where p.oid='public.send_round_dice_roll(uuid,integer,integer,integer,uuid,uuid)'::regprocedure
    and acl.grantee=0 and acl.privilege_type='EXECUTE'),'PUBLIC cannot execute dice RPC');
select pg_temp.dice_check(not has_table_privilege('authenticated','public.round_message_dice_rolls','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.round_messages','INSERT,UPDATE,DELETE'), 'RPC adds no table write rights');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
do $$ declare candidate record; receipt jsonb;
begin
  for candidate in select * from (values
    ('1d6',1,6,0),('5d6',5,6,0),('2d6+3',2,6,3),('2d6-3',2,6,-3),
    ('maximum',50,1000,9999),('minimum',1,2,-9999),('d2',1,2,0)
  ) as cases(label,n,s,m) loop
    receipt := public.send_round_dice_roll(pg_temp.dice_id('round'),candidate.n,candidate.s,candidate.m,gen_random_uuid(),pg_temp.dice_id('character'));
    perform pg_temp.check_roll(receipt);
    perform pg_temp.dice_check((receipt->'dice_roll'->>'dice_count')::integer=candidate.n
      and (receipt->'dice_roll'->>'dice_sides')::integer=candidate.s
      and (receipt->'dice_roll'->>'modifier')::integer=candidate.m
      and receipt->>'speaker_kind'='character' and receipt->>'character_id'=pg_temp.dice_id('character')::text
      and receipt->>'speaker_name_snapshot'='Dice Character',candidate.label||' parameters and speaker');
    insert into dice_receipts values(candidate.label,receipt);
  end loop;
end;
$$;
select pg_temp.dice_check((select count(*)=7 from public.round_messages where round_id=pg_temp.dice_id('round'))
  and (select count(*)=7 from public.round_message_dice_rolls where message_id in(select (receipt->>'id')::uuid from dice_receipts)),
  'one message and one detail per successful request');

do $$ declare candidate record;
begin
  for candidate in select * from (values
    (0,6,0),(51,6,0),(1,1,0),(1,1001,0),(1,6,-10000),(1,6,10000),
    (null,6,0),(1,null,0),(1,6,null)
  ) as cases(n,s,m) loop
    perform pg_temp.rpc_error(format('select public.send_round_dice_roll(%L,%L::integer,%L::integer,%L::integer,%L,%L)',
      pg_temp.dice_id('round'),candidate.n,candidate.s,candidate.m,gen_random_uuid(),pg_temp.dice_id('character')),
      '22023','DICE_INVALID_PARAMETERS');
  end loop;
end;
$$;
select pg_temp.rpc_error($q$select public.send_round_dice_roll(null,1,6,0,gen_random_uuid(),pg_temp.dice_id('character'))$q$,'22023','CHAT_INVALID_REQUEST');
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,null,pg_temp.dice_id('character'))$q$,'22023','CHAT_INVALID_REQUEST');

-- Retry equality includes request/id/seq/time/results/snapshot; never require different random values.
select pg_temp.dice_check(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='1d6'),pg_temp.dice_id('character'))
  =(select receipt from dice_receipts where key='1d6'),'identical retry returns original complete receipt');
select pg_temp.dice_check((select count(*)=7 from public.round_messages where round_id=pg_temp.dice_id('round'))
  and (select count(*)=7 from public.round_message_dice_rolls where message_id in(select (receipt->>'id')::uuid from dice_receipts)),
  'retry creates neither second message nor second detail');
insert into dice_receipts values('fresh',public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('character')));
select pg_temp.dice_check((select (fresh.receipt->>'id')<>(original.receipt->>'id')
  and (fresh.receipt->>'round_seq')::bigint>(original.receipt->>'round_seq')::bigint
  and (fresh.receipt->>'client_request_id')<>(original.receipt->>'client_request_id')
  from dice_receipts fresh,dice_receipts original where fresh.key='fresh' and original.key='1d6'),'new UUID creates independent event');
do $$ declare candidate record; request_id uuid;
begin
  select (receipt->>'client_request_id')::uuid into request_id from dice_receipts where key='1d6';
  for candidate in select * from (values (2,6,0),(1,8,0),(1,6,1)) as cases(n,s,m) loop
    perform pg_temp.rpc_error(format('select public.send_round_dice_roll(%L,%s,%s,%s,%L,%L)',
      pg_temp.dice_id('round'),candidate.n,candidate.s,candidate.m,request_id,pg_temp.dice_id('character')),'22023','CHAT_REQUEST_CONFLICT');
  end loop;
  perform pg_temp.rpc_error(format('select public.send_round_dice_roll(%L,1,6,0,%L,%L)',
    pg_temp.dice_id('other_round'),request_id,pg_temp.dice_id('foreign_character')),'22023','CHAT_REQUEST_CONFLICT');
  perform pg_temp.rpc_error(format('select public.send_round_message(%L,%L,%L,%L)',
    pg_temp.dice_id('round'),'Dice request cannot be a chat retry',request_id,pg_temp.dice_id('character')),'22023','CHAT_REQUEST_CONFLICT');
end;
$$;
insert into dice_receipts select 'chat',to_jsonb(public.send_round_message(pg_temp.dice_id('round'),'Chat regression',gen_random_uuid(),pg_temp.dice_id('character')));
select pg_temp.dice_check(to_jsonb(public.send_round_message(pg_temp.dice_id('round'),'Chat regression',
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='chat'),pg_temp.dice_id('character')))
  =(select receipt from dice_receipts where key='chat'),'normal chat retry unchanged');
select pg_temp.rpc_error($q$select public.send_round_message(pg_temp.dice_id('round'),'Changed body',
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='chat'),pg_temp.dice_id('character'))$q$,'22023','CHAT_REQUEST_CONFLICT');
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='chat'),pg_temp.dice_id('character'))$q$,'22023','CHAT_REQUEST_CONFLICT');

-- Missing historical details are an error, never an invitation to roll again.
reset role;
insert into public.round_messages(id,round_id,round_seq,author_user_id,kind,speaker_kind,speaker_name_snapshot,body,client_request_id)
select pg_temp.dice_id('incomplete_message'),pg_temp.dice_id('round'),max(round_seq)+1,pg_temp.dice_id('player'),
  'dice_roll','character','Incomplete',null,pg_temp.dice_id('incomplete_request')
from public.round_messages where round_id=pg_temp.dice_id('round');
set local role authenticated;
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  pg_temp.dice_id('incomplete_request'),pg_temp.dice_id('character'))$q$,'22000','DICE_STORED_ROLL_INCOMPLETE');

do $$ declare character_key text;
begin
  foreach character_key in array array['other_character','prepared','deleted','foreign_character'] loop
    perform pg_temp.rpc_error(format('select public.send_round_dice_roll(%L,1,6,0,%L,%L)',
      pg_temp.dice_id('round'),gen_random_uuid(),pg_temp.dice_id(character_key)),'22023','CHAT_CHARACTER_UNAVAILABLE');
  end loop;
end;
$$;
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('inactive'))$q$,'22023','CHAT_IDENTITY_CHANGED');
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null)$q$,'22023','CHAT_IDENTITY_CHANGED');
reset role;
update public.round_memberships set active_character_id=null where round_id=pg_temp.dice_id('round') and user_id=pg_temp.dice_id('player');
set local role authenticated;
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null)$q$,'22023','CHAT_NO_ACTIVE_CHARACTER');
reset role;
update public.characters set name='Renamed Character' where id=pg_temp.dice_id('character');
update public.round_memberships set active_character_id=pg_temp.dice_id('inactive') where round_id=pg_temp.dice_id('round') and user_id=pg_temp.dice_id('player');
set local role authenticated;
select pg_temp.dice_check(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='1d6'),pg_temp.dice_id('character'))
  =(select receipt from dice_receipts where key='1d6'),'retry after rename and active switch keeps original snapshot and results');
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('character'))$q$,'22023','CHAT_IDENTITY_CHANGED');
reset role;
update public.round_memberships set active_character_id=pg_temp.dice_id('character') where round_id=pg_temp.dice_id('round') and user_id=pg_temp.dice_id('player');
set local role authenticated;
select pg_temp.dice_check(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('character'))->>'speaker_name_snapshot'='Renamed Character','new roll takes current locked name');

select set_config('request.jwt.claim.sub',pg_temp.dice_id('gm')::text,true);
insert into dice_receipts values('gm',public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null));
select pg_temp.check_roll(receipt) from dice_receipts where key='gm';
select pg_temp.dice_check((select receipt->>'speaker_kind'='game_master' and receipt->>'speaker_name_snapshot'='Spielleitung'
  and receipt->'character_id'='null'::jsonb from dice_receipts where key='gm'),'GM narration identity');
insert into dice_receipts values('gm_character',public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('gm_character')));
select pg_temp.check_roll(receipt) from dice_receipts where key='gm_character';
select pg_temp.dice_check((select receipt->>'speaker_kind'='character' and receipt->>'speaker_name_snapshot'='GM Character'
  and receipt->>'character_id'=pg_temp.dice_id('gm_character')::text from dice_receipts where key='gm_character'),'GM own active character identity');
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('character'))$q$,'22023','CHAT_CHARACTER_UNAVAILABLE');
select pg_temp.dice_check((public.send_round_message(pg_temp.dice_id('round'),'GM chat',gen_random_uuid(),null)).speaker_kind='game_master','GM chat narration regression');
select pg_temp.dice_check((public.send_round_message(pg_temp.dice_id('round'),'GM character chat',gen_random_uuid(),pg_temp.dice_id('gm_character'))).speaker_kind='character','GM character chat regression');

-- Same UUID belongs independently to different authors; no cross-author replay.
select set_config('request.jwt.claim.sub',pg_temp.dice_id('second')::text,true);
select pg_temp.dice_check(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='1d6'),pg_temp.dice_id('other_character'))->>'author_user_id'=pg_temp.dice_id('second')::text,
  'another author cannot read original receipt through request collision');
select set_config('request.jwt.claim.sub',pg_temp.dice_id('gm')::text,true);
select public.transfer_game_master(pg_temp.dice_id('round'),pg_temp.dice_id('second'));
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null)$q$,'22023','CHAT_IDENTITY_CHANGED');
select pg_temp.dice_check(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='gm'),null)
  =(select receipt from dice_receipts where key='gm'),'historical GM retry survives role loss');
select set_config('request.jwt.claim.sub',pg_temp.dice_id('second')::text,true);
select public.transfer_game_master(pg_temp.dice_id('round'),pg_temp.dice_id('gm'));

-- Isolated sequence through actual existing producers, including private history.
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
select public.send_round_message(pg_temp.dice_id('sequence_round'),'Sequence chat',gen_random_uuid(),pg_temp.dice_id('sequence_character'));
select public.send_round_dice_roll(pg_temp.dice_id('sequence_round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('sequence_character'));
select set_config('request.jwt.claim.sub',pg_temp.dice_id('gm')::text,true);
select public.assign_prepared_character(pg_temp.dice_id('sequence_prepared'),pg_temp.dice_id('player'));
select public.send_round_dice_roll(pg_temp.dice_id('sequence_round'),1,6,0,gen_random_uuid(),null);
select public.set_round_archived(pg_temp.dice_id('sequence_round'),true);
reset role;
select pg_temp.dice_check((select array_agg(kind order by round_seq)=array['character_message','dice_roll','system_message','dice_roll','system_message']
  and array_agg(round_seq order by round_seq)=array[1,2,3,4,5]::bigint[] from public.round_messages where round_id=pg_temp.dice_id('sequence_round'))
  and (select recipient_user_id=pg_temp.dice_id('player') from public.round_messages where round_id=pg_temp.dice_id('sequence_round') and round_seq=3),
  'one sequence includes chat dice private assignment and public archive');

-- Controlled late failure AFTER parent INSERT. The temporary CHECK is rolled back.
create temporary table dice_atomic_before as
select count(*) as messages,max(round_seq) as seq from public.round_messages where round_id=pg_temp.dice_id('round');
grant select on dice_atomic_before to authenticated;
savepoint dice_late_failure;
alter table public.round_message_dice_rolls add constraint dice_test_late_failure check(modifier<>777) not valid;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,777,pg_temp.dice_id('atomic_request'),pg_temp.dice_id('character'))$q$,'23514',null,'dice_test_late_failure');
select pg_temp.dice_check(not exists(select 1 from public.round_messages where client_request_id=pg_temp.dice_id('atomic_request'))
  and (select count(*) from public.round_messages where round_id=pg_temp.dice_id('round'))=(select messages from dice_atomic_before)
  and (select max(round_seq) from public.round_messages where round_id=pg_temp.dice_id('round'))=(select seq from dice_atomic_before),
  'late detail failure leaves no parent detail or persisted sequence');
rollback to savepoint dice_late_failure;
release savepoint dice_late_failure;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
select pg_temp.dice_check((public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,777,pg_temp.dice_id('atomic_request'),pg_temp.dice_id('character'))->>'round_seq')::bigint
  =(select seq+1 from dice_atomic_before),'same request succeeds after rollback with next unconsumed sequence');

reset role;
update public.rounds set status='paused' where id=pg_temp.dice_id('round');
set local role authenticated;
select pg_temp.check_roll(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('character')));
select set_config('request.jwt.claim.sub',pg_temp.dice_id('gm')::text,true);
select pg_temp.check_roll(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null));
select pg_temp.check_roll(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('gm_character')));
reset role;
update public.rounds set status='archived' where id=pg_temp.dice_id('round');
set local role authenticated;
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null)$q$,'42501','CHAT_ROUND_ARCHIVED');
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('gm_character'))$q$,'42501','CHAT_ROUND_ARCHIVED');
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('character'))$q$,'42501','CHAT_ROUND_ARCHIVED');
select pg_temp.dice_check(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='1d6'),pg_temp.dice_id('character'))
  =(select receipt from dice_receipts where key='1d6'),'archive permits existing authorized retry');
reset role;
update public.rounds set status='active',locked_at=now(),locked_reason='Dice test' where id=pg_temp.dice_id('round');
set local role authenticated;
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('character'))$q$,'42501','CHAT_NOT_AUTHORIZED');
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='1d6'),pg_temp.dice_id('character'))$q$,'42501','CHAT_NOT_AUTHORIZED');
select set_config('request.jwt.claim.sub',pg_temp.dice_id('gm')::text,true);
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null)$q$,'42501','CHAT_ROUND_LOCKED');
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('gm_character'))$q$,'42501','CHAT_ROUND_LOCKED');
select pg_temp.dice_check(public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='gm'),null)
  =(select receipt from dice_receipts where key='gm'),'locked GM may replay but never create');
reset role;
update public.rounds set locked_at=null,locked_reason=null where id=pg_temp.dice_id('round');
set local role authenticated;
do $$ declare user_key text;
begin
  foreach user_key in array array['other','admin','super'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.dice_id(user_key)::text,true);
    perform pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null)$q$,'42501','CHAT_NOT_AUTHORIZED');
  end loop;
end;
$$;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null)$q$,'42501','CHAT_NOT_AUTHORIZED');
reset role;
delete from public.round_memberships where round_id=pg_temp.dice_id('round') and user_id=pg_temp.dice_id('player');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),pg_temp.dice_id('character'))$q$,'42501','CHAT_NOT_AUTHORIZED');
select pg_temp.rpc_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,
  (select (receipt->>'client_request_id')::uuid from dice_receipts where key='1d6'),pg_temp.dice_id('character'))$q$,'42501','CHAT_NOT_AUTHORIZED');
reset role;
set local role anon;
select pg_temp.dice_error($q$select public.send_round_dice_roll(pg_temp.dice_id('round'),1,6,0,gen_random_uuid(),null)$q$,'42501');
reset role;
-- Real concurrency is MANUAL / SEPARATE TEST; see phase-3.4b-generic-dice-rpc.md.
rollback;
