-- NOT EXECUTED. Run only after the three Phase 3.1 migrations in an approved
-- isolated staging/test database, as postgres, with psql ON_ERROR_STOP enabled.
-- Everything, including fixture accounts, rolls back. No production data edits.
-- If ON_ERROR_STOP aborts execution, issue ROLLBACK in any still-open session.
begin;
create temporary table chat_test_ids (key text primary key, id uuid not null default gen_random_uuid());
insert into chat_test_ids(key) values ('player'), ('second'), ('gm'), ('admin'), ('round'), ('foreign'), ('round_fk'), ('character'), ('other_character'), ('spare_character'), ('request');
insert into chat_test_ids(key,id) values ('super',coalesce(
  (select id from public.profiles where is_superadmin), gen_random_uuid()));
grant select on chat_test_ids to authenticated;
do $$ begin
  execute format('grant usage on schema %I to authenticated',
    (select nspname from pg_catalog.pg_namespace where oid=pg_my_temp_schema()));
end $$;
create function pg_temp.chat_id(p_key text) returns uuid language sql stable as $$
  select id from pg_temp.chat_test_ids where key = p_key;
$$;
create function pg_temp.check_chat(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL: %',p_label; end if;
end;
$$;
create function pg_temp.chat_error(p_sql text, p_state text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE % for %',p_state,p_sql;
end;
$$;

insert into auth.users(id,raw_user_meta_data)
select id,jsonb_build_object('username','chat31_'||id::text,'display_name','Chat Test')
from chat_test_ids where key in ('player','second','gm','admin','super')
and not exists (select 1 from auth.users where auth.users.id=chat_test_ids.id);
update public.profiles set role='admin' where id=pg_temp.chat_id('admin');
update public.profiles set role='admin',is_superadmin=true
where id=pg_temp.chat_id('super') and not is_superadmin;
insert into public.rounds(id,name) values (pg_temp.chat_id('round'),'Chat Test'),(pg_temp.chat_id('foreign'),'Other Chat');
insert into public.round_memberships(round_id,user_id,role) values
(pg_temp.chat_id('round'),pg_temp.chat_id('gm'),'game_master'),
(pg_temp.chat_id('round'),pg_temp.chat_id('player'),'player'),
(pg_temp.chat_id('round'),pg_temp.chat_id('second'),'player');
insert into public.characters(id,name,owner_user_id,round_id,template_key,template_version) values
(pg_temp.chat_id('character'),'Astrid',pg_temp.chat_id('player'),pg_temp.chat_id('round'),'vaesen',1),
(pg_temp.chat_id('other_character'),'Bertil',pg_temp.chat_id('second'),pg_temp.chat_id('round'),'vaesen',1),
(pg_temp.chat_id('spare_character'),'Astrid Ersatz',pg_temp.chat_id('player'),pg_temp.chat_id('round'),'vaesen',1);
-- Two valid characters leave the automatic selection empty; select explicitly.
update public.round_memberships
set active_character_id=pg_temp.chat_id('character')
where round_id=pg_temp.chat_id('round') and user_id=pg_temp.chat_id('player');
select pg_temp.check_chat((
  select active_character_id=pg_temp.chat_id('character')
  from public.round_memberships
  where round_id=pg_temp.chat_id('round') and user_id=pg_temp.chat_id('player')
),'fixture active character selected before sending');
insert into public.round_messages(round_id,round_seq,author_user_id,speaker_kind,speaker_name_snapshot,body,client_request_id)
values(pg_temp.chat_id('foreign'),1,pg_temp.chat_id('gm'),'game_master','Spielleitung','Foreign fixture',gen_random_uuid());

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select pg_temp.check_chat(public.can_read_round_messages(pg_temp.chat_id('round')),'player reads own round');
select pg_temp.check_chat(not public.can_read_round_messages(pg_temp.chat_id('foreign')),'player cannot read foreign round');
select pg_temp.check_chat((select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('foreign')),'foreign message hidden by RLS');
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'Hello',pg_temp.chat_id('request'),pg_temp.chat_id('character'))).speaker_name_snapshot='Astrid','server character snapshot');
select public.send_round_message(pg_temp.chat_id('round'),'Hello',pg_temp.chat_id('request'),pg_temp.chat_id('character'));
select pg_temp.check_chat((select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('round')),'idempotency');
select pg_temp.check_chat((select author_user_id=auth.uid() and character_id=pg_temp.chat_id('character') and round_seq=1 and speaker_kind='character' from public.round_messages where client_request_id=pg_temp.chat_id('request')),'server identity and sequence');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'different',pg_temp.chat_id('request'),pg_temp.chat_id('character'))$q$,'22023');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'spoof',gen_random_uuid(),pg_temp.chat_id('other_character'))$q$,'22023');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'inactive',gen_random_uuid(),pg_temp.chat_id('spare_character'))$q$,'22023');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('foreign'),'foreign',gen_random_uuid(),pg_temp.chat_id('character'))$q$,'42501');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),E' \t\n',gen_random_uuid(),pg_temp.chat_id('character'))$q$,'22023');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),U&'\00A0\2003\FEFF',gen_random_uuid(),pg_temp.chat_id('character'))$q$,'22023');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),repeat('x',4001),gen_random_uuid(),pg_temp.chat_id('character'))$q$,'22023');
select public.send_round_message(pg_temp.chat_id('round'),'<script>alert(1)</script>',gen_random_uuid(),pg_temp.chat_id('character'));
-- No write privilege: this also prevents forging author/seq/snapshot/timestamps.
select pg_temp.chat_error($q$insert into public.round_messages default values$q$,'42501');
select pg_temp.chat_error($q$update public.round_messages set body='spoof'$q$,'42501');
select pg_temp.chat_error($q$delete from public.round_messages$q$,'42501');
select pg_temp.check_chat(not has_table_privilege('authenticated','public.round_messages','INSERT,UPDATE,DELETE'),'no direct mutations');
select pg_temp.check_chat(not has_function_privilege('anon','public.send_round_message(uuid,text,uuid,uuid)','EXECUTE'),'anon cannot send');

reset role;
update public.round_memberships set active_character_id=null where user_id=pg_temp.chat_id('player');
set local role authenticated;
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'no active',gen_random_uuid(),null)$q$,'22023');
reset role;
update public.round_memberships set active_character_id=pg_temp.chat_id('character') where user_id=pg_temp.chat_id('player');
update public.characters set name='Astrid Neu' where id=pg_temp.chat_id('character');
set local role authenticated;
select pg_temp.check_chat((select speaker_name_snapshot='Astrid' from public.round_messages where client_request_id=pg_temp.chat_id('request')),'rename preserves old snapshot');
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'After rename',gen_random_uuid(),pg_temp.chat_id('character'))).speaker_name_snapshot='Astrid Neu','new snapshot after rename');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'Narration',gen_random_uuid(),null)).speaker_name_snapshot='Spielleitung','GM speaker');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'GM spoof',gen_random_uuid(),pg_temp.chat_id('character'))$q$,'22023');

-- General administrative roles never confer chat content rights.
select set_config('request.jwt.claim.sub',pg_temp.chat_id('admin')::text,true);
select pg_temp.check_chat((select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('round')),'admin no content');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'admin',gen_random_uuid(),null)$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('super')::text,true);
select pg_temp.check_chat((select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('round')),'superadmin no content');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'superadmin',gen_random_uuid(),null)$q$,'42501');

reset role;
update public.rounds set status='paused' where id=pg_temp.chat_id('round');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select public.send_round_message(pg_temp.chat_id('round'),'Paused allowed',gen_random_uuid(),pg_temp.chat_id('character'));
reset role;
update public.rounds set status='archived' where id=pg_temp.chat_id('round');
set local role authenticated;
select pg_temp.check_chat((select count(*)>0 from public.round_messages where round_id=pg_temp.chat_id('round')),'archived history readable');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'archive',gen_random_uuid(),pg_temp.chat_id('character'))$q$,'42501');
-- Retrying a committed request is a read, including after archiving.
select public.send_round_message(pg_temp.chat_id('round'),'Hello',pg_temp.chat_id('request'),pg_temp.chat_id('character'));
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'archive gm',gen_random_uuid(),null)$q$,'42501');
reset role;
update public.rounds set status='active',locked_at=now(),locked_reason='Chat test' where id=pg_temp.chat_id('round');
set local role authenticated;
select pg_temp.check_chat((select count(*)>0 from public.round_messages where round_id=pg_temp.chat_id('round')),'locked GM reads');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'locked gm',gen_random_uuid(),null)$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select pg_temp.check_chat((select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('round')),'locked player cannot read');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'locked player',gen_random_uuid(),pg_temp.chat_id('character'))$q$,'42501');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'Hello',pg_temp.chat_id('request'),pg_temp.chat_id('character'))$q$,'42501');

reset role;
update public.rounds set locked_at=null,locked_reason=null where id=pg_temp.chat_id('round');
delete from public.characters where id=pg_temp.chat_id('character');
select pg_temp.check_chat((select character_id is null and speaker_name_snapshot='Astrid' from public.round_messages where client_request_id=pg_temp.chat_id('request')),'physical character deletion preserves history');
delete from public.round_memberships where user_id=pg_temp.chat_id('player');
set local role authenticated;
select pg_temp.check_chat((select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('round')),'removed member cannot read');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'removed member',gen_random_uuid(),null)$q$,'42501');
reset role;
-- Inspect the actual single-column FK; this is not an account deletion test.
select pg_temp.check_chat(exists (
  select 1
  from pg_catalog.pg_constraint as fk
  join pg_catalog.pg_attribute as source_column
    on source_column.attrelid=fk.conrelid
    and source_column.attname='author_user_id' and not source_column.attisdropped
  join pg_catalog.pg_attribute as target_column
    on target_column.attrelid=fk.confrelid
    and target_column.attname='id' and not target_column.attisdropped
  where fk.contype='f'
    and fk.conrelid='public.round_messages'::regclass
    and fk.confrelid='public.profiles'::regclass
    and fk.conkey=array[source_column.attnum]
    and fk.confkey=array[target_column.attnum]
    and fk.confdeltype='n'
    and not source_column.attnotnull
    and fk.convalidated
),'author FK references profiles(id) with ON DELETE SET NULL and nullable author');

-- Sequential assertions only: all sends above run in this one transaction.
select pg_temp.check_chat((select count(*)>1 and count(*)=count(distinct round_seq) from public.round_messages where round_id=pg_temp.chat_id('round')),'sequential sends have distinct sequences');
select pg_temp.check_chat((
  select array_agg(body order by round_seq)=array[
    'Hello','<script>alert(1)</script>','After rename','Narration','Paused allowed'
  ]::text[]
  from public.round_messages where round_id=pg_temp.chat_id('round')
),'sequential sequence order matches send order');

-- Isolate the round_messages FK: no characters or memberships in this round.
insert into public.rounds(id,name) values (pg_temp.chat_id('round_fk'),'Chat FK Test');
insert into public.round_messages(round_id,round_seq,speaker_kind,speaker_name_snapshot,body,client_request_id)
values(pg_temp.chat_id('round_fk'),1,'game_master','Spielleitung','Round FK fixture',gen_random_uuid());
select pg_temp.check_chat(
  not exists(select 1 from public.characters where round_id=pg_temp.chat_id('round_fk'))
  and not exists(select 1 from public.round_memberships where round_id=pg_temp.chat_id('round_fk'))
  and (select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('round_fk')),
  'round FK fixture contains only one message and no characters or memberships'
);
select pg_temp.chat_error($q$delete from public.rounds where id=pg_temp.chat_id('round_fk')$q$,'23503');

-- MANUAL / SEPARATE TEST: use independent connections in a controlled disposable
-- environment; this single-transaction script does not test concurrency.
-- 1. Two users send simultaneously into the same round: distinct ordered seqs.
-- 2. Same author + identical client_request_id/body concurrently: one stored row,
--    both successful calls return that row (also verify request-conflict cases).
-- 3. Hold the first sender's transaction open; verify the waiting sender after
--    COMMIT and separately after ROLLBACK, including an identical-request retry.
-- 4. Send concurrently with character selection changes, membership removal,
--    round locking and account deletion: check authorization and lock completion.
-- 5. Actual account deletion + chat history: message/snapshot survives with a
--    NULL author. The catalog assertion above does not replace this integration
--    test. Account deletion is deliberately not performed by this script.
rollback;
