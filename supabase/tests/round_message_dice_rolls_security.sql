-- Phase 3.4a only. NOT EXECUTED: run after all migrations through the dice
-- foundation in an approved isolated test database as postgres, ON_ERROR_STOP.
-- Fixtures are privileged SQL, not a dice RPC or an account-deletion test.
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
insert into public.rounds(id,name) values (pg_temp.dice_id('round'),'Dice Foundation Test');
insert into public.round_memberships(round_id,user_id,role) values
  (pg_temp.dice_id('round'),pg_temp.dice_id('player'),'player'),
  (pg_temp.dice_id('round'),pg_temp.dice_id('gm'),'game_master');
insert into public.characters(id,name,owner_user_id,round_id,template_key,template_version)
values(pg_temp.dice_id('character'),'Dice Character',pg_temp.dice_id('player'),pg_temp.dice_id('round'),'vaesen',1);

-- All previous identities, including private assignments WITH a character, stay valid.
create temporary table dice_message_cases (
  key text primary key, seq integer unique, kind text, speaker text, name text, body text,
  id uuid not null default gen_random_uuid()
);
insert into dice_message_cases(key,seq,kind,speaker,name,body) values
  ('dice_character',1,'dice_roll','character','Dice Character',null),
  ('dice_gm',2,'dice_roll','game_master','Spielleitung',null),
  ('historical',3,'dice_roll','character','Historical Character',null),
  ('missing_detail',4,'dice_roll','character','Missing Detail',null),
  ('text',5,'character_message','character','Dice Character','Hello'),
  ('narration',6,'character_message','game_master','Spielleitung','Narration'),
  ('private_assignment',7,'system_message','system','System','Dir wurde der Charakter Dice Character zugewiesen.'),
  ('transfer',8,'system_message','system','System','@fixture ist jetzt Spielleitung.'),
  ('pause',9,'system_message','system','System','Die Runde wurde pausiert.'),
  ('resume',10,'system_message','system','System','Die Runde wurde fortgesetzt.'),
  ('archive',11,'system_message','system','System','Die Runde wurde archiviert.'),
  ('cascade',12,'dice_roll','game_master','Spielleitung',null),
  ('raw_mismatch',13,'dice_roll','character','Privileged Inconsistency',null);
insert into dice_test_ids(key,id) select key,id from dice_message_cases;
insert into public.round_messages(
  id,round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,body,
  author_user_id,recipient_user_id,character_id,client_request_id
)
select id,pg_temp.dice_id('round'),seq,kind,speaker,name,body,
  case when kind='system_message' or key in ('historical','missing_detail','raw_mismatch') then null
    when speaker='game_master' then pg_temp.dice_id('gm') else pg_temp.dice_id('player') end,
  case when key='private_assignment' then pg_temp.dice_id('player') else null end,
  case when key in ('dice_character','text','private_assignment') then pg_temp.dice_id('character') else null end,
  gen_random_uuid()
from dice_message_cases;
select pg_temp.dice_check((select count(*)=13 from public.round_messages where round_id=pg_temp.dice_id('round')),
  'all legacy message identities and public dice parents remain valid');

-- DEFAULT modifier=0, unsorted order, historical nullable references, CASCADE.
insert into public.round_message_dice_rolls(message_id,dice_count,dice_sides,results,raw_total,total)
values(pg_temp.dice_id('dice_character'),5,6,array[2,6,1,4,5],18,18);
select pg_temp.dice_check((select modifier=0 and results=array[2,6,1,4,5]
  from public.round_message_dice_rolls where message_id=pg_temp.dice_id('dice_character')),
  'modifier defaults to zero and results retain their exact unsorted order');
insert into public.round_message_dice_rolls(message_id,dice_count,dice_sides,results,raw_total,total)
select pg_temp.dice_id(key),1,6,array[1],1,1
from unnest(array['dice_gm','historical','cascade','text','private_assignment']) as fixture(key);
-- Privileged inconsistency C is deliberately allowed; exact SUM belongs to 3.4b.
insert into public.round_message_dice_rolls(message_id,dice_count,dice_sides,results,raw_total,total)
values(pg_temp.dice_id('raw_mismatch'),1,6,array[1],2,2);
select pg_temp.dice_check(
  not exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('missing_detail'))
  and exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('text'))
  and exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('raw_mismatch') and raw_total=2),
  'privileged missing detail wrong parent kind and raw sum mismatch are not cross-table-trigger enforced');

-- Text NULL, blank, Unicode whitespace and maximum length rules must survive.
do $$
declare message_kind text; invalid_body text; message_speaker text; message_name text;
begin
  foreach message_kind in array array['character_message','system_message'] loop
    message_speaker := case when message_kind='system_message' then 'system' else 'character' end;
    message_name := case when message_kind='system_message' then 'System' else 'Fixture' end;
    foreach invalid_body in array array[null,'',E' \t\n',U&'\00A0\2003\FEFF',repeat('x',4001)] loop
      perform pg_temp.dice_error(format(
        'insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,body,client_request_id) values (%L,100,%L,%L,%L,%L,gen_random_uuid())',
        pg_temp.dice_id('round'),message_kind,message_speaker,message_name,invalid_body),'23514');
    end loop;
  end loop;
end;
$$;
select pg_temp.dice_error($q$insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,body,client_request_id)
  values(pg_temp.dice_id('round'),100,'dice_roll','character','Fixture','not null',gen_random_uuid())$q$,
  '23514','round_messages_body_kind');
select pg_temp.dice_error($q$insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,body,client_request_id)
  values(pg_temp.dice_id('round'),100,'dice_roll','system','System',null,gen_random_uuid())$q$,
  '23514','round_messages_message_identity');
select pg_temp.dice_error($q$insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,body,recipient_user_id,client_request_id)
  values(pg_temp.dice_id('round'),100,'dice_roll','character','Fixture',null,pg_temp.dice_id('player'),gen_random_uuid())$q$,
  '23514','round_messages_message_identity');
select pg_temp.dice_error($q$insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,body,client_request_id)
  values(pg_temp.dice_id('round'),100,'dice_roll','game_master','Forged name',null,gen_random_uuid())$q$,
  '23514','round_messages_gm_identity');

-- Each candidate gets a valid, separate parent; errors cannot be masked by PK/FK.
create temporary table dice_detail_cases (
  label text, dice_count integer, dice_sides integer, modifier integer,
  results integer[], raw_total integer, total integer, expected_state text
);
insert into dice_detail_cases values
  ('minimum count and sides',1,2,0,array[1],1,1,null),
  ('maximum count and sides',50,1000,9999,array_fill(1000,array[50]),50000,59999,null),
  ('minimum modifier',1,2,-9999,array[1],1,-9998,null),
  ('zero count',0,6,0,array[1],1,1,'23514'),
  ('count 51',51,6,0,array_fill(1,array[51]),51,51,'23514'),
  ('one side',1,1,0,array[1],1,1,'23514'),
  ('side 1001',1,1001,0,array[1],1,1,'23514'),
  ('modifier below',1,6,-10000,array[1],1,-9999,'23514'),
  ('modifier above',1,6,10000,array[1],1,10001,'23514'),
  ('wrong length',2,6,0,array[2],2,2,'23514'),
  ('empty array',1,6,0,array[]::integer[],1,1,'23514'),
  ('NULL element',2,6,0,array[1,null],2,2,'23514'),
  ('all NULL elements',1,6,0,array[null]::integer[],1,1,'23514'),
  ('zero result',1,6,0,array[0],1,1,'23514'),
  ('result above sides',1,6,0,array[7],1,1,'23514'),
  ('multiple dimensions',2,6,0,array[[1,1]],2,2,'23514'),
  ('lower bound zero',2,6,0,'[0:1]={1,1}'::integer[],2,2,'23514'),
  ('raw below',2,6,0,array[1,1],1,1,'23514'),
  ('raw above',2,6,0,array[6,6],13,13,'23514'),
  ('wrong total',1,6,3,array[1],1,5,'23514'),
  ('NULL count',null,6,0,array[1],1,1,'23502'),
  ('NULL sides',1,null,0,array[1],1,1,'23502'),
  ('NULL modifier',1,6,null,array[1],1,1,'23502'),
  ('NULL results',1,6,0,null,1,1,'23502'),
  ('NULL raw total',1,6,0,array[1],null,1,'23502'),
  ('NULL total',1,6,0,array[1],1,null,'23502');
do $$
declare candidate record; parent_id uuid; statement text;
begin
  for candidate in select * from dice_detail_cases loop
    insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,body,client_request_id)
    values(pg_temp.dice_id('round'),100,'dice_roll','game_master','Spielleitung',null,gen_random_uuid())
    returning id into parent_id;
    statement := format('insert into public.round_message_dice_rolls values (%L::uuid,%L::integer,%L::integer,%L::integer,%L::integer[],%L::integer,%L::integer)',
      parent_id,candidate.dice_count,candidate.dice_sides,candidate.modifier,candidate.results,candidate.raw_total,candidate.total);
    if candidate.expected_state is null then
      execute statement;
      perform pg_temp.dice_check(exists(select 1 from public.round_message_dice_rolls
        where message_id=parent_id and results=candidate.results and total=candidate.total),candidate.label);
    else
      perform pg_temp.dice_error(statement,candidate.expected_state);
      perform pg_temp.dice_check(not exists(select 1 from public.round_message_dice_rolls where message_id=parent_id),candidate.label);
    end if;
    delete from public.round_messages where id=parent_id;
    perform pg_temp.dice_check(not exists(select 1 from public.round_message_dice_rolls where message_id=parent_id),'case cleanup cascades');
  end loop;
end;
$$;
select pg_temp.dice_error($q$insert into public.round_message_dice_rolls values(gen_random_uuid(),1,6,0,array[1],1,1)$q$,'23503');
select pg_temp.dice_error($q$insert into public.round_message_dice_rolls values(null,1,6,0,array[1],1,1)$q$,'23502');
select pg_temp.dice_error($q$insert into public.round_message_dice_rolls values(pg_temp.dice_id('dice_character'),1,6,0,array[1],1,1)$q$,'23505');
delete from public.round_messages where id=pg_temp.dice_id('cascade');
select pg_temp.dice_check(not exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('cascade')),
  'parent delete cascades to details');

-- Effective grants, including column grants and PUBLIC/default ACL entries.
select pg_temp.dice_check(has_table_privilege('authenticated','public.round_message_dice_rolls','SELECT')
  and not has_table_privilege('authenticated','public.round_message_dice_rolls','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
  and not has_any_column_privilege('authenticated','public.round_message_dice_rolls','INSERT,UPDATE,REFERENCES'),
  'authenticated has SELECT only, with no column write bypass');
select pg_temp.dice_check(not has_table_privilege('anon','public.round_message_dice_rolls','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
  and not has_any_column_privilege('anon','public.round_message_dice_rolls','SELECT,INSERT,UPDATE,REFERENCES'),
  'anon has no effective table or column rights');
select pg_temp.dice_check(not exists(
  select 1 from pg_catalog.pg_class as relation
  cross join lateral pg_catalog.aclexplode(coalesce(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) as acl
  where relation.oid='public.round_message_dice_rolls'::regclass and acl.grantee=0
), 'PUBLIC has no table ACL privileges');
select pg_temp.dice_check(not exists(
  select 1 from pg_catalog.pg_attribute as column_info
  cross join lateral pg_catalog.aclexplode(column_info.attacl) as acl
  where column_info.attrelid='public.round_message_dice_rolls'::regclass and acl.grantee=0
), 'PUBLIC has no column ACL privileges');
select pg_temp.dice_check(not has_table_privilege('authenticated','public.round_messages','INSERT,UPDATE,DELETE')
  and not has_any_column_privilege('authenticated','public.round_messages','INSERT,UPDATE'),
  'parent remains unavailable for direct client writes');
select pg_temp.dice_check((select relrowsecurity from pg_catalog.pg_class where oid='public.round_message_dice_rolls'::regclass),
  'detail RLS is enabled');
select pg_temp.dice_check(not exists(select 1 from pg_catalog.pg_publication_tables
  where schemaname='public' and tablename='round_message_dice_rolls' and pubname='supabase_realtime'),
  'details are not in the Realtime publication');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
select pg_temp.dice_check((select count(*)=2 from public.round_message_dice_rolls
  where message_id in(pg_temp.dice_id('dice_character'),pg_temp.dice_id('dice_gm'))),
  'member reads both public character and GM dice details');
select pg_temp.dice_check(exists(select 1 from public.round_messages where id=pg_temp.dice_id('private_assignment'))
  and not exists(select 1 from public.round_message_dice_rolls where message_id in(pg_temp.dice_id('text'),pg_temp.dice_id('private_assignment'))),
  'even readable non-dice parents do not expose attached details');
select pg_temp.dice_error($q$insert into public.round_message_dice_rolls values(pg_temp.dice_id('missing_detail'),1,6,0,array[1],1,1)$q$,'42501');
select pg_temp.dice_error($q$update public.round_message_dice_rolls set total=total where message_id=pg_temp.dice_id('dice_character')$q$,'42501');
select pg_temp.dice_error($q$delete from public.round_message_dice_rolls where message_id=pg_temp.dice_id('dice_character')$q$,'42501');
select pg_temp.dice_error($q$insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,body,client_request_id)
  values(pg_temp.dice_id('round'),100,'dice_roll','game_master','Spielleitung',null,gen_random_uuid())$q$,'42501');
select pg_temp.dice_error($q$update public.round_messages set body=null where id=pg_temp.dice_id('dice_character')$q$,'42501');
select pg_temp.dice_error($q$delete from public.round_messages where id=pg_temp.dice_id('dice_character')$q$,'42501');
do $$ declare identity_key text;
begin
  foreach identity_key in array array['other','admin','super'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.dice_id(identity_key)::text,true);
    perform pg_temp.dice_check(not exists(select 1 from public.round_messages where round_id=pg_temp.dice_id('round')),
      identity_key||' has no parent access');
    perform pg_temp.dice_check(not exists(select 1 from public.round_message_dice_rolls
      where message_id in(select id from pg_temp.dice_test_ids)),identity_key||' has no details');
  end loop;
end;
$$;
select set_config('request.jwt.claim.sub',pg_temp.dice_id('gm')::text,true);
select pg_temp.dice_check(not exists(select 1 from public.round_messages where id=pg_temp.dice_id('private_assignment'))
  and not exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('private_assignment')),
  'private recipient parent and its misplaced details stay hidden from GM');

-- Prove that detail visibility follows parent policies, not just round membership.
reset role;
savepoint dice_parent_policy;
create policy "Dice test restricts parent" on public.round_messages as restrictive
for select to authenticated using (round_seq <> 2);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
select pg_temp.dice_check(exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('dice_character'))
  and not exists(select 1 from public.round_messages where id=pg_temp.dice_id('dice_gm'))
  and not exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('dice_gm')),
  'additional parent RLS restriction propagates to dice details');
rollback to savepoint dice_parent_policy;
release savepoint dice_parent_policy;
reset role;

update public.rounds set status='archived' where id=pg_temp.dice_id('round');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
select pg_temp.dice_check(exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('dice_character')),
  'archived member retains detail history');
reset role;
update public.rounds set locked_at=now(),locked_reason='Dice RLS test' where id=pg_temp.dice_id('round');
set local role authenticated;
select pg_temp.dice_check(not exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('dice_character')),
  'locked player cannot read dice details');
select set_config('request.jwt.claim.sub',pg_temp.dice_id('gm')::text,true);
select pg_temp.dice_check(exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('dice_character')),
  'locked GM can read dice details');
reset role;
update public.rounds set locked_at=null,locked_reason=null where id=pg_temp.dice_id('round');
delete from public.round_memberships where round_id=pg_temp.dice_id('round') and user_id=pg_temp.dice_id('player');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.dice_id('player')::text,true);
select pg_temp.dice_check(not exists(select 1 from public.round_message_dice_rolls where message_id=pg_temp.dice_id('dice_character')),
  'removed member loses detail access');
reset role;
set local role anon;
select pg_temp.dice_error('select * from public.round_message_dice_rolls','42501');
select pg_temp.dice_error('insert into public.round_message_dice_rolls default values','42501');
select pg_temp.dice_error('update public.round_message_dice_rolls set total=total','42501');
select pg_temp.dice_error('delete from public.round_message_dice_rolls','42501');
reset role;
rollback;
