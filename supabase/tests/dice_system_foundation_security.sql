-- Phase 3.5f1. Run as postgres against an isolated LOCAL PostgreSQL 17 database
-- after all migrations, with psql -X -v ON_ERROR_STOP=1 -f this-file.
-- Every fixture and change rolls back. No remote execution in this phase.
begin;

create temporary table system_test_ids(key text primary key, id uuid not null default gen_random_uuid());
insert into system_test_ids(key) values ('gm'),('player'),('outsider'),('admin'),('round'),('request'),('default_message');
insert into system_test_ids(key,id) values ('super',coalesce(
  (select id from public.profiles where is_superadmin),gen_random_uuid()));
grant select on system_test_ids to authenticated, anon;
do $$ begin
  execute format('grant usage on schema %I to authenticated, anon',
    (select nspname from pg_catalog.pg_namespace where oid=pg_my_temp_schema()));
end $$;
create function pg_temp.system_id(p_key text) returns uuid language sql stable as $$
  select id from pg_temp.system_test_ids where key=p_key;
$$;
create function pg_temp.system_check(p_ok boolean,p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL: %',p_label; end if;
end;
$$;
create function pg_temp.system_error(p_sql text,p_state text,p_message text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate=p_state and (p_message is null or sqlerrm=p_message) then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE % for %',p_state,p_sql;
end;
$$;

insert into auth.users(id,raw_user_meta_data)
select id,jsonb_build_object('username','ds35_'||id::text,'display_name','Dice System Test')
from system_test_ids where key in ('gm','player','outsider','admin','super')
and not exists(select 1 from auth.users where auth.users.id=system_test_ids.id);
update public.profiles set role='admin' where id=pg_temp.system_id('admin');
update public.profiles set role='admin',is_superadmin=true
where id=pg_temp.system_id('super') and not is_superadmin;
insert into public.rounds(id,name) values(pg_temp.system_id('round'),'Dice System Test');
insert into public.round_memberships(round_id,user_id,role) values
  (pg_temp.system_id('round'),pg_temp.system_id('gm'),'game_master'),
  (pg_temp.system_id('round'),pg_temp.system_id('player'),'player');
insert into public.round_messages(id,round_id,round_seq,author_user_id,character_id,
  speaker_kind,speaker_name_snapshot,kind,body,client_request_id)
values(pg_temp.system_id('default_message'),pg_temp.system_id('round'),1,pg_temp.system_id('gm'),null,
  'game_master','Spielleitung','dice_roll',null,gen_random_uuid());
insert into public.round_message_dice_rolls(message_id,dice_count,dice_sides,modifier,results,raw_total,total)
values(pg_temp.system_id('default_message'),3,6,2,array[2,6,4],12,14);

select pg_temp.system_check((select dice_system='generic' from public.rounds where id=pg_temp.system_id('round')),
  'round default is generic');
select pg_temp.system_check((select dice_system='generic' from public.round_message_dice_rolls
  where message_id=pg_temp.system_id('default_message')),'detail default is generic');

-- Execute constraint checks as owner so failures cannot be confused with RLS/ACL denial.
select pg_temp.system_error($q$update public.rounds set dice_system=null where id=pg_temp.system_id('round')$q$,'23502');
select pg_temp.system_error($q$update public.round_message_dice_rolls set dice_system=null
  where message_id=pg_temp.system_id('default_message')$q$,'23502');
do $$ declare candidate text; begin
  foreach candidate in array array['','vaesen','splinter_portals','foo',' generic','GENERIC'] loop
    perform pg_temp.system_error(format('update public.rounds set dice_system=%L where id=%L',
      candidate,pg_temp.system_id('round')),'23514');
    perform pg_temp.system_error(format('update public.round_message_dice_rolls set dice_system=%L where message_id=%L',
      candidate,pg_temp.system_id('default_message')),'23514');
  end loop;
end $$;

select pg_temp.system_check(has_function_privilege('authenticated','public.set_round_dice_system(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.set_round_dice_system(uuid,text)','EXECUTE'),
  'authenticated only setter EXECUTE');
select pg_temp.system_check(not exists(select 1 from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  where p.oid='public.set_round_dice_system(uuid,text)'::regprocedure
    and acl.grantee=0 and acl.privilege_type='EXECUTE'),'no PUBLIC setter EXECUTE');
select pg_temp.system_check(not has_column_privilege('authenticated','public.rounds','dice_system','UPDATE')
  and not has_column_privilege('anon','public.rounds','dice_system','UPDATE'),
  'no direct system UPDATE even for GM');
select pg_temp.system_check(has_column_privilege('authenticated','public.rounds','name','UPDATE'),
  'existing metadata grant retained');
select pg_temp.system_check(not has_column_privilege('authenticated','public.round_message_dice_rolls','dice_system','UPDATE'),
  'historical snapshot cannot be updated by client');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.system_id('gm')::text,true);
select public.set_round_dice_system(pg_temp.system_id('round'),'generic');
select pg_temp.system_check((select dice_system='generic' from public.rounds where id=pg_temp.system_id('round')),
  'current GM sets generic');
select pg_temp.system_error($q$update public.rounds set dice_system='generic' where id=pg_temp.system_id('round')$q$,'42501');
do $$ declare candidate text; begin
  foreach candidate in array array[null,'','vaesen','splinter_portals','foo',' generic','GENERIC'] loop
    perform pg_temp.system_error(format('select public.set_round_dice_system(%L,%L)',
      pg_temp.system_id('round'),candidate),'22023','Invalid dice system');
  end loop;
end $$;
select pg_temp.system_error($q$select public.set_round_dice_system(null,'generic')$q$,'22023','Invalid dice system');
do $$ declare actor text; begin
  foreach actor in array array['player','admin','super','outsider'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.system_id(actor)::text,true);
    perform pg_temp.system_error(format('select public.set_round_dice_system(%L,%L)',
      pg_temp.system_id('round'),'generic'),'42501','Not authorized');
    perform pg_temp.system_error(format('update public.rounds set dice_system=%L where id=%L',
      'generic',pg_temp.system_id('round')),'42501');
  end loop;
end $$;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.system_error($q$select public.set_round_dice_system(pg_temp.system_id('round'),'generic')$q$,'42501','Not authenticated');
reset role;
set local role anon;
select pg_temp.system_error($q$select public.set_round_dice_system(pg_temp.system_id('round'),'generic')$q$,'42501');
reset role;

-- The existing settings contract allows archived metadata, but rejects moderation locks.
do $$ declare status_value text; begin
  foreach status_value in array array['active','paused','archived'] loop
    update public.rounds set status=status_value where id=pg_temp.system_id('round');
    perform set_config('request.jwt.claim.sub',pg_temp.system_id('gm')::text,true);
    execute 'set local role authenticated';
    perform public.set_round_dice_system(pg_temp.system_id('round'),'generic');
    execute 'reset role';
  end loop;
end $$;
update public.rounds set status='active',locked_at=now(),locked_reason='Test'
where id=pg_temp.system_id('round');
set local role authenticated;
select pg_temp.system_error($q$select public.set_round_dice_system(pg_temp.system_id('round'),'generic')$q$,'42501','Round is locked');
reset role;
update public.rounds set locked_at=null,locked_reason=null where id=pg_temp.system_id('round');

-- Pending profile must be denied even while the GM membership still exists.
update public.profiles set deletion_pending_at=now() where id=pg_temp.system_id('gm');
set local role authenticated;
select pg_temp.system_error($q$select public.set_round_dice_system(pg_temp.system_id('round'),'generic')$q$,'42501','Not authorized');
reset role;
update public.profiles set deletion_pending_at=null where id=pg_temp.system_id('gm');

create temporary table system_receipts(label text primary key, receipt jsonb not null);
grant select,insert on system_receipts to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.system_id('gm')::text,true);
insert into system_receipts values('first',public.send_round_dice_roll(
  pg_temp.system_id('round'),3,6,2,pg_temp.system_id('request'),null));
-- Check the actual detail row, not just the returned JSON.
select pg_temp.system_check((select d.dice_system='generic'
  from public.round_message_dice_rolls d join system_receipts r on d.message_id=(r.receipt->>'id')::uuid
  where r.label='first'),'RPC persists generic snapshot');
select public.set_round_dice_system(pg_temp.system_id('round'),'generic');
insert into system_receipts values('retry',public.send_round_dice_roll(
  pg_temp.system_id('round'),3,6,2,pg_temp.system_id('request'),null));
select pg_temp.system_check((select a.receipt=b.receipt and a.receipt->'dice_roll'->>'dice_system'='generic'
  from system_receipts a,system_receipts b where a.label='first' and b.label='retry'),
  'retry returns identical stored snapshot and complete receipt');
reset role;
select pg_temp.system_check((select count(*)=1 from public.round_messages
  where client_request_id=pg_temp.system_id('request') and author_user_id=pg_temp.system_id('gm'))
  and (select count(*)=1 from public.round_message_dice_rolls
    where message_id=(select (receipt->>'id')::uuid from system_receipts where label='first')),
  'retry creates no second parent or detail');

-- Real transfer: old GM loses rights, new GM gains them.
set local role authenticated;
select public.transfer_game_master(pg_temp.system_id('round'),pg_temp.system_id('player'));
select pg_temp.system_error($q$select public.set_round_dice_system(pg_temp.system_id('round'),'generic')$q$,'42501','Not authorized');
select set_config('request.jwt.claim.sub',pg_temp.system_id('player')::text,true);
select public.set_round_dice_system(pg_temp.system_id('round'),'generic');
reset role;
select pg_temp.system_check((select dice_system='generic' and results=array[2,6,4] and raw_total=12 and total=14
  from public.round_message_dice_rolls where message_id=pg_temp.system_id('default_message')),
  'original details remain unchanged');
rollback;
