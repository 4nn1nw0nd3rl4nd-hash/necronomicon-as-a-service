-- Run only after the Phase 3.1 through Phase 3.3c2-3 migrations
-- in an approved isolated test database, as postgres, with psql ON_ERROR_STOP enabled.
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
create function pg_temp.chat_error(p_sql text, p_state text, p_message text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state and (p_message is null or sqlerrm = p_message) then return; end if;
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

-- Phase 3.2b: use the same authenticated RPC, real active-character constraints
-- and membership transfer. These are sequential state-change tests, not races.
insert into chat_test_ids(key) values
  ('gm_active'), ('gm_spare'), ('gm_prepared'), ('gm_foreign'), ('gm_deleted'),
  ('gm_unassigned'), ('gm_request');
insert into public.round_memberships(round_id,user_id,role)
values(pg_temp.chat_id('foreign'),pg_temp.chat_id('gm'),'player');
insert into public.characters(id,name,owner_user_id,round_id,template_key,template_version) values
(pg_temp.chat_id('gm_active'),'GM Astrid',pg_temp.chat_id('gm'),pg_temp.chat_id('round'),'vaesen',1),
(pg_temp.chat_id('gm_spare'),'GM Ersatz',pg_temp.chat_id('gm'),pg_temp.chat_id('round'),'vaesen',1),
(pg_temp.chat_id('gm_prepared'),'Prepared',null,pg_temp.chat_id('round'),'vaesen',1),
(pg_temp.chat_id('gm_foreign'),'Foreign GM',pg_temp.chat_id('gm'),pg_temp.chat_id('foreign'),'vaesen',1),
(pg_temp.chat_id('gm_deleted'),'Deleted GM',pg_temp.chat_id('gm'),pg_temp.chat_id('round'),'vaesen',1),
(pg_temp.chat_id('gm_unassigned'),'Unassigned GM',pg_temp.chat_id('gm'),null,'vaesen',1);
update public.characters set deleted_at=now() where id=pg_temp.chat_id('gm_deleted');
update public.round_memberships set active_character_id=pg_temp.chat_id('gm_active')
where round_id=pg_temp.chat_id('round') and user_id=pg_temp.chat_id('gm');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
-- D/E: narration is still distinct from an owned active character.
select pg_temp.check_chat((
  select speaker_kind='game_master' and character_id is null
    and speaker_name_snapshot='Spielleitung' and author_user_id=auth.uid()
  from public.send_round_message(pg_temp.chat_id('round'),'GM narration with active',gen_random_uuid(),null)
),'GM narration ignores existing active selection');
select pg_temp.check_chat((
  select speaker_kind='character' and character_id=pg_temp.chat_id('gm_active')
    and speaker_name_snapshot='GM Astrid' and author_user_id=auth.uid()
  from public.send_round_message(pg_temp.chat_id('round'),'GM active',pg_temp.chat_id('gm_request'),pg_temp.chat_id('gm_active'))
),'GM active character identity and real author');
-- F/G/H/I/J and missing/unassigned character: read/edit permission is insufficient.
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'inactive GM',gen_random_uuid(),pg_temp.chat_id('gm_spare'))$q$,'22023','CHAT_IDENTITY_CHANGED');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'foreign owner',gen_random_uuid(),pg_temp.chat_id('other_character'))$q$,'22023','CHAT_CHARACTER_UNAVAILABLE');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'prepared',gen_random_uuid(),pg_temp.chat_id('gm_prepared'))$q$,'22023','CHAT_CHARACTER_UNAVAILABLE');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'foreign round',gen_random_uuid(),pg_temp.chat_id('gm_foreign'))$q$,'22023','CHAT_CHARACTER_UNAVAILABLE');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'deleted',gen_random_uuid(),pg_temp.chat_id('gm_deleted'))$q$,'22023','CHAT_CHARACTER_UNAVAILABLE');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'unassigned',gen_random_uuid(),pg_temp.chat_id('gm_unassigned'))$q$,'22023','CHAT_CHARACTER_UNAVAILABLE');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'missing',gen_random_uuid(),gen_random_uuid())$q$,'22023','CHAT_CHARACTER_UNAVAILABLE');

-- K: no active character blocks character mode, but never GM narration.
reset role;
update public.round_memberships set active_character_id=null
where round_id=pg_temp.chat_id('round') and user_id=pg_temp.chat_id('gm');
set local role authenticated;
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'no GM active',gen_random_uuid(),pg_temp.chat_id('gm_active'))$q$,'22023','CHAT_NO_ACTIVE_CHARACTER');
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'GM no active narration',gen_random_uuid(),null)).speaker_kind='game_master','GM without active can narrate');

-- N/O: server-side rename changes only new snapshots, never the original receipt.
reset role;
update public.round_memberships set active_character_id=pg_temp.chat_id('gm_active')
where round_id=pg_temp.chat_id('round') and user_id=pg_temp.chat_id('gm');
update public.characters set name='GM Astrid Neu' where id=pg_temp.chat_id('gm_active');
set local role authenticated;
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'GM after rename',gen_random_uuid(),pg_temp.chat_id('gm_active'))).speaker_name_snapshot='GM Astrid Neu','GM new snapshot after rename');
select pg_temp.check_chat((
  select receipt.id=stored.id and receipt.round_seq=stored.round_seq
    and receipt.speaker_name_snapshot='GM Astrid' and receipt.character_id=pg_temp.chat_id('gm_active')
  from public.send_round_message(pg_temp.chat_id('round'),'GM active',pg_temp.chat_id('gm_request'),pg_temp.chat_id('gm_active')) receipt
  join public.round_messages stored on stored.client_request_id=pg_temp.chat_id('gm_request')
),'GM retry returns original row and snapshot after rename');

-- L/O: expected A must not silently become B; a committed A retry still returns A.
reset role;
update public.round_memberships set active_character_id=pg_temp.chat_id('gm_spare')
where round_id=pg_temp.chat_id('round') and user_id=pg_temp.chat_id('gm');
set local role authenticated;
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'stale GM active',gen_random_uuid(),pg_temp.chat_id('gm_active'))$q$,'22023','CHAT_IDENTITY_CHANGED');
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'GM active',pg_temp.chat_id('gm_request'),pg_temp.chat_id('gm_active'))).speaker_name_snapshot='GM Astrid','GM retry survives active-character switch');
select pg_temp.check_chat((select count(*)=1 from public.round_messages where author_user_id=auth.uid() and client_request_id=pg_temp.chat_id('gm_request')),'GM retries never duplicate');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'different GM body',pg_temp.chat_id('gm_request'),pg_temp.chat_id('gm_spare'))$q$,'22023','CHAT_REQUEST_CONFLICT');

-- M: transfer through the real RPC. Former GM is a player; NULL and stale A fail.
select public.transfer_game_master(pg_temp.chat_id('round'),pg_temp.chat_id('second'));
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'former GM narration',gen_random_uuid(),null)$q$,'22023','CHAT_IDENTITY_CHANGED');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'former GM stale A',gen_random_uuid(),pg_temp.chat_id('gm_active'))$q$,'22023','CHAT_IDENTITY_CHANGED');
select pg_temp.check_chat((
  select speaker_kind='character' and character_id=pg_temp.chat_id('gm_spare') and author_user_id=auth.uid()
  from public.send_round_message(pg_temp.chat_id('round'),'former GM current B',gen_random_uuid(),pg_temp.chat_id('gm_spare'))
),'former GM follows current player rules using only expected B');
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'GM active',pg_temp.chat_id('gm_request'),pg_temp.chat_id('gm_active'))).speaker_name_snapshot='GM Astrid','committed GM receipt survives role change');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select public.transfer_game_master(pg_temp.chat_id('round'),pg_temp.chat_id('gm'));
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);

-- Historical narration retry after role loss is distinct from a new send.
-- Capture the original receipt, including its ID, before transferring the GM role.
do $$
declare
  former_gm_id uuid := auth.uid();
  request_id uuid := gen_random_uuid();
  original_message public.round_messages;
  retried_message public.round_messages;
begin
  perform pg_temp.check_chat(public.is_round_game_master(pg_temp.chat_id('round')),'narration retry starts as current GM');
  select * into original_message from public.send_round_message(
    pg_temp.chat_id('round'),'Narration retry after role loss',request_id,null);
  perform pg_temp.check_chat(original_message.speaker_kind='game_master'
    and original_message.character_id is null
    and original_message.speaker_name_snapshot='Spielleitung'
    and original_message.author_user_id=former_gm_id,'original narration receipt');

  perform public.transfer_game_master(pg_temp.chat_id('round'),pg_temp.chat_id('second'));
  perform pg_temp.check_chat((select role='player' from public.round_memberships
    where round_id=pg_temp.chat_id('round') and user_id=former_gm_id)
    and public.can_read_round_messages(pg_temp.chat_id('round')),'former GM is now a player with current read access');
  select * into retried_message from public.send_round_message(
    pg_temp.chat_id('round'),'Narration retry after role loss',request_id,null);
  perform pg_temp.check_chat(retried_message is not distinct from original_message
    and retried_message.speaker_kind='game_master'
    and retried_message.speaker_name_snapshot='Spielleitung','historical narration retry returns unchanged original receipt');
  perform pg_temp.check_chat((select count(*)=1 from public.round_messages
    where author_user_id=former_gm_id and client_request_id=request_id),'historical narration retry creates no second message');
  perform pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'Narration retry after role loss',gen_random_uuid(),null)$q$,'22023','CHAT_IDENTITY_CHANGED');

  -- Restore the existing fixture roles for subsequent tests.
  perform set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
  perform public.transfer_game_master(pg_temp.chat_id('round'),former_gm_id);
  perform set_config('request.jwt.claim.sub',former_gm_id::text,true);
end;
$$;

-- Both rounds are readable and writable: only reusing the request ID conflicts.
do $$
declare
  request_id uuid := gen_random_uuid();
  original_message public.round_messages;
  round_b_receipt public.round_messages;
begin
  perform pg_temp.check_chat(public.can_read_round_messages(pg_temp.chat_id('round'))
    and public.can_read_round_messages(pg_temp.chat_id('foreign')),'cross-round caller reads both rounds');
  select * into original_message from public.send_round_message(
    pg_temp.chat_id('round'),'Cross-round request identity',request_id,null);
  -- Identical B payload with a fresh ID succeeds: no access, status or active-ID failure.
  select * into round_b_receipt from public.send_round_message(
    pg_temp.chat_id('foreign'),'Cross-round request identity',gen_random_uuid(),pg_temp.chat_id('gm_foreign'));
  perform pg_temp.check_chat(round_b_receipt.round_id=pg_temp.chat_id('foreign')
    and round_b_receipt.author_user_id=auth.uid()
    and round_b_receipt.character_id=pg_temp.chat_id('gm_foreign'),'round B accepts a valid new request');
  perform pg_temp.chat_error(format(
    'select public.send_round_message(%L::uuid,%L,%L::uuid,%L::uuid)',
    pg_temp.chat_id('foreign'),'Cross-round request identity',request_id,pg_temp.chat_id('gm_foreign')),
    '22023','CHAT_REQUEST_CONFLICT');
  perform pg_temp.check_chat((select count(*)=1 from public.round_messages
    where author_user_id=auth.uid() and client_request_id=request_id)
    and exists(select 1 from public.round_messages
      where id=original_message.id and round_id=pg_temp.chat_id('round')
        and author_user_id=auth.uid() and client_request_id=request_id),
    'cross-round conflict preserves the single original message in A');
end;
$$;

-- P: both GM modes may write in paused rounds; neither bypasses archive/lock.
reset role;
update public.rounds set status='paused' where id=pg_temp.chat_id('round');
set local role authenticated;
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'paused GM narration',gen_random_uuid(),null)).speaker_kind='game_master','paused GM narration');
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'paused GM character',gen_random_uuid(),pg_temp.chat_id('gm_spare'))).speaker_kind='character','paused GM character');
reset role;
update public.rounds set status='archived' where id=pg_temp.chat_id('round');
set local role authenticated;
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'archived GM narration',gen_random_uuid(),null)$q$,'42501','CHAT_ROUND_ARCHIVED');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'archived GM character',gen_random_uuid(),pg_temp.chat_id('gm_spare'))$q$,'42501','CHAT_ROUND_ARCHIVED');
select pg_temp.check_chat((public.send_round_message(pg_temp.chat_id('round'),'GM active',pg_temp.chat_id('gm_request'),pg_temp.chat_id('gm_active'))).speaker_name_snapshot='GM Astrid','GM committed retry in archive');
reset role;
update public.rounds set status='active',locked_at=now(),locked_reason='GM chat test' where id=pg_temp.chat_id('round');
set local role authenticated;
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'locked GM narration',gen_random_uuid(),null)$q$,'42501','CHAT_ROUND_LOCKED');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('round'),'locked GM character',gen_random_uuid(),pg_temp.chat_id('gm_spare'))$q$,'42501','CHAT_ROUND_LOCKED');
reset role;
update public.rounds set locked_at=null,locked_reason=null where id=pg_temp.chat_id('round');

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

-- Phase 3.3a1: isolated schema/RLS fixtures, not automatic assignment messages.
-- The original test rounds, sends and sequence assertions above remain unchanged.
insert into chat_test_ids(key) values
  ('private_round'), ('private_character'), ('private_message'), ('private_gm_message'),
  ('public_system_message'), ('public_system_character_message');
insert into public.rounds(id,name) values (pg_temp.chat_id('private_round'),'Private Chat Test');
insert into public.round_memberships(round_id,user_id,role) values
(pg_temp.chat_id('private_round'),pg_temp.chat_id('gm'),'game_master'),
(pg_temp.chat_id('private_round'),pg_temp.chat_id('player'),'player'),
(pg_temp.chat_id('private_round'),pg_temp.chat_id('second'),'player');
insert into public.characters(id,name,owner_user_id,round_id,template_key,template_version)
values(pg_temp.chat_id('private_character'),'Sven Svenson',pg_temp.chat_id('player'),pg_temp.chat_id('private_round'),'vaesen',1);
-- Privileged fixtures only; no client write grants or new message-producing RPC.
insert into public.round_messages(round_id,round_seq,author_user_id,character_id,speaker_kind,speaker_name_snapshot,body,client_request_id) values
(pg_temp.chat_id('private_round'),1,pg_temp.chat_id('player'),pg_temp.chat_id('private_character'),'character','Sven Svenson','Public character fixture',gen_random_uuid()),
(pg_temp.chat_id('private_round'),2,pg_temp.chat_id('gm'),null,'game_master','Spielleitung','Public GM fixture',gen_random_uuid());
insert into public.round_messages(id,round_id,round_seq,recipient_user_id,character_id,kind,speaker_kind,speaker_name_snapshot,body,client_request_id) values
(pg_temp.chat_id('private_message'),pg_temp.chat_id('private_round'),3,pg_temp.chat_id('player'),pg_temp.chat_id('private_character'),'system_message','system','System','Dir wurde der Charakter Sven Svenson zugewiesen.',gen_random_uuid()),
(pg_temp.chat_id('private_gm_message'),pg_temp.chat_id('private_round'),4,pg_temp.chat_id('gm'),null,'system_message','system','System','GM recipient fixture',gen_random_uuid());

-- Phase 3.3b1: public system fixtures only, no productive message-producing RPC.
insert into public.round_messages(id,round_id,round_seq,recipient_user_id,character_id,kind,speaker_kind,speaker_name_snapshot,body,client_request_id) values
(pg_temp.chat_id('public_system_message'),pg_temp.chat_id('private_round'),5,null,null,'system_message','system','System','Public system fixture',gen_random_uuid()),
(pg_temp.chat_id('public_system_character_message'),pg_temp.chat_id('private_round'),6,null,pg_temp.chat_id('private_character'),'system_message','system','System','Public system character fixture',gen_random_uuid());
select pg_temp.check_chat((select count(*)=2 from public.round_messages
  where id in (pg_temp.chat_id('private_message'),pg_temp.chat_id('private_gm_message'))
    and kind='system_message' and speaker_kind='system' and speaker_name_snapshot='System'
    and author_user_id is null and recipient_user_id is not null),
  'private system messages remain valid with and without character reference');
select pg_temp.check_chat((select recipient_user_id=pg_temp.chat_id('player')
  and character_id=pg_temp.chat_id('private_character') from public.round_messages
  where id=pg_temp.chat_id('private_message')),'private assignment keeps its character reference');
select pg_temp.check_chat((select kind='system_message' and speaker_kind='system'
  and speaker_name_snapshot='System' and author_user_id is null
  and recipient_user_id is null and character_id is null from public.round_messages
  where id=pg_temp.chat_id('public_system_message')),'public system message without character allowed');
select pg_temp.check_chat((select kind='system_message' and speaker_kind='system'
  and speaker_name_snapshot='System' and author_user_id is null
  and recipient_user_id is null and character_id=pg_temp.chat_id('private_character')
  from public.round_messages where id=pg_temp.chat_id('public_system_character_message')),
  'public system message with character allowed');

-- H/I/J/K: each candidate otherwise has valid fields, unique IDs and a valid FK.
-- Check failures must be CHECK violations, not access/NOT NULL/FK/uniqueness errors.
do $$
declare
  candidate record;
begin
  for candidate in select * from (values
    ('public system author forbidden','system_message','system','System',null::uuid,pg_temp.chat_id('gm'),null::uuid),
    ('public system character speaker forbidden','system_message','character','System',null::uuid,null::uuid,null::uuid),
    ('public system GM speaker forbidden','system_message','game_master','Spielleitung',null::uuid,null::uuid,null::uuid),
    ('public system wrong snapshot forbidden','system_message','system','Spielleitung',null::uuid,null::uuid,null::uuid),
    ('private character forbidden','character_message','character','Sven',pg_temp.chat_id('player'),null::uuid,null::uuid),
    ('system author forbidden','system_message','system','System',pg_temp.chat_id('player'),pg_temp.chat_id('gm'),null::uuid),
    ('system character speaker forbidden','system_message','character','System',pg_temp.chat_id('player'),null::uuid,null::uuid),
    ('system GM speaker forbidden','system_message','game_master','Spielleitung',pg_temp.chat_id('player'),null::uuid,null::uuid),
    ('system wrong snapshot forbidden','system_message','system','Spielleitung',pg_temp.chat_id('player'),null::uuid,null::uuid),
    ('character system speaker forbidden','character_message','system','System',null::uuid,null::uuid,null::uuid),
    ('unknown kind forbidden','other_message','character','Sven',null::uuid,null::uuid,null::uuid),
    ('unknown speaker forbidden','character_message','other','Sven',null::uuid,null::uuid,null::uuid),
    ('GM character ID forbidden','character_message','game_master','Spielleitung',null::uuid,null::uuid,pg_temp.chat_id('private_character')),
    ('GM wrong snapshot forbidden','character_message','game_master','System',null::uuid,null::uuid,null::uuid)
  ) as cases(label,kind,speaker_kind,snapshot,recipient,author,character_id)
  loop
    perform pg_temp.chat_error(format(
      'insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,recipient_user_id,author_user_id,character_id,body,client_request_id) values (%L::uuid,100,%L,%L,%L,%L::uuid,%L::uuid,%L::uuid,%L,gen_random_uuid())',
      pg_temp.chat_id('private_round'),candidate.kind,candidate.speaker_kind,candidate.snapshot,
      candidate.recipient,candidate.author,candidate.character_id,candidate.label), '23514');
  end loop;
end;
$$;

-- L: inspect the real single-column recipient FK without deleting any account.
select pg_temp.check_chat(exists (
  select 1 from pg_catalog.pg_constraint as fk
  join pg_catalog.pg_attribute as source_column
    on source_column.attrelid=fk.conrelid
    and source_column.attname='recipient_user_id' and not source_column.attisdropped
  join pg_catalog.pg_attribute as target_column
    on target_column.attrelid=fk.confrelid
    and target_column.attname='id' and not target_column.attisdropped
  where fk.contype='f' and fk.conrelid='public.round_messages'::regclass
    and fk.confrelid='public.profiles'::regclass
    and fk.conkey=array[source_column.attnum] and fk.confkey=array[target_column.attnum]
    and fk.confdeltype='c' and not source_column.attnotnull and fk.convalidated
),'recipient FK references profiles(id) with ON DELETE CASCADE and nullable column');
select pg_temp.check_chat((select count(*)=1 from pg_catalog.pg_policy
  where polrelid='public.round_messages'::regclass and polcmd in ('r','*')),
  'exactly one SELECT policy, no parallel broad policy');

-- A/B/C/D/E/G: normal public history remains visible; private rows are recipient-only.
set local role authenticated;
do $$
declare
  viewer record;
begin
  for viewer in select * from (values
    ('player',true,true), ('second',true,false), ('gm',true,false),
    ('admin',false,false), ('super',false,false)
  ) as viewers(user_key,can_read,is_recipient)
  loop
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id(viewer.user_key)::text,true);
    perform pg_temp.check_chat(public.can_read_round_messages(pg_temp.chat_id('private_round'))=viewer.can_read,
      viewer.user_key || ' round access fixture');
    perform pg_temp.check_chat((select count(*)=case when viewer.can_read then 2 else 0 end
      from public.round_messages where round_id=pg_temp.chat_id('private_round') and kind='character_message'),
      viewer.user_key || ' public character and GM history visibility');
    perform pg_temp.check_chat((select count(*)=case when viewer.can_read then 2 else 0 end
      from public.round_messages where id in (pg_temp.chat_id('public_system_message'),pg_temp.chat_id('public_system_character_message'))),
      viewer.user_key || ' public system history visibility with normal round access');
    perform pg_temp.check_chat((select count(*)=case when viewer.is_recipient then 1 else 0 end
      from public.round_messages where id=pg_temp.chat_id('private_message')),
      viewer.user_key || ' private assignment visibility by known message ID');
    perform pg_temp.check_chat((select count(*)=case when viewer.user_key='gm' then 1 else 0 end
      from public.round_messages where id=pg_temp.chat_id('private_gm_message')),
      viewer.user_key || ' GM has private access only as recipient');
  end loop;
end;
$$;
select pg_temp.check_chat(not has_table_privilege('authenticated','public.round_messages','INSERT,UPDATE,DELETE'),
  'private message foundation grants no direct mutations');

-- Both kinds retain their stored name/body after rename and character harddelete.
reset role;
-- Restore the original fixture counts for the existing lifecycle assertions.
delete from public.round_messages
where id in (pg_temp.chat_id('public_system_message'),pg_temp.chat_id('public_system_character_message'));
update public.characters set name='Sven Neu' where id=pg_temp.chat_id('private_character');
select pg_temp.check_chat((select body='Dir wurde der Charakter Sven Svenson zugewiesen.'
  from public.round_messages where id=pg_temp.chat_id('private_message')),'private assignment text survives rename');
delete from public.characters where id=pg_temp.chat_id('private_character');
select pg_temp.check_chat((select count(*)=2 from public.round_messages
  where round_id=pg_temp.chat_id('private_round') and round_seq in (1,3) and character_id is null),
  'character FK SET NULL preserves public and private history');
select pg_temp.check_chat((select recipient_user_id=pg_temp.chat_id('player') and author_user_id is null
  and body='Dir wurde der Charakter Sven Svenson zugewiesen.'
  from public.round_messages where id=pg_temp.chat_id('private_message')),'harddelete never makes private history public');

-- Archived history and locked-round access retain the existing helper semantics.
update public.rounds set status='archived' where id=pg_temp.chat_id('private_round');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select pg_temp.check_chat((select count(*)=3 from public.round_messages where round_id=pg_temp.chat_id('private_round')),
  'recipient reads public and own private history in archive');
reset role;
update public.rounds set status='active',locked_at=now(),locked_reason='Private chat test' where id=pg_temp.chat_id('private_round');
set local role authenticated;
select pg_temp.check_chat((select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('private_round')),
  'locked player cannot read even own private message');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select pg_temp.check_chat((select count(*)=3 from public.round_messages where round_id=pg_temp.chat_id('private_round'))
  and not exists(select 1 from public.round_messages where id=pg_temp.chat_id('private_message')),
  'locked GM reads public and own private history, never another recipient message');

-- F/G: removing membership denies even a known private ID; rejoining restores history.
reset role;
update public.rounds set locked_at=null,locked_reason=null where id=pg_temp.chat_id('private_round');
delete from public.round_memberships where round_id=pg_temp.chat_id('private_round') and user_id=pg_temp.chat_id('player');
select pg_temp.check_chat(exists(select 1 from public.round_messages where id=pg_temp.chat_id('private_message')),
  'membership removal retains private row');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select pg_temp.check_chat(not public.can_read_round_messages(pg_temp.chat_id('private_round'))
  and not exists(select 1 from public.round_messages where id=pg_temp.chat_id('private_message'))
  and (select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('private_round')),
  'former member loses public and private access despite knowing recipient and message ID');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select pg_temp.check_chat((select count(*)=2 from public.round_messages where round_id=pg_temp.chat_id('private_round')),
  'other member still sees exactly public history after recipient removal');
reset role;
insert into public.round_memberships(round_id,user_id,role)
values(pg_temp.chat_id('private_round'),pg_temp.chat_id('player'),'player');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select pg_temp.check_chat((select count(*)=3 from public.round_messages where round_id=pg_temp.chat_id('private_round')),
  'rejoined recipient sees public and own private history again');
reset role;

-- Phase 3.3a2-1: real public assignment RPCs in an isolated round.
insert into chat_test_ids(key) values
  ('assignment_round'), ('assignment_original'), ('assignment_copy_original'),
  ('assignment_self'), ('assignment_failure');
insert into public.rounds(id,name) values (pg_temp.chat_id('assignment_round'),'Assignment Chat Test');
insert into public.round_memberships(round_id,user_id,role) values
(pg_temp.chat_id('assignment_round'),pg_temp.chat_id('gm'),'game_master'),
(pg_temp.chat_id('assignment_round'),pg_temp.chat_id('player'),'player'),
(pg_temp.chat_id('assignment_round'),pg_temp.chat_id('second'),'player');
insert into public.characters(id,name,round_id,template_key,template_version)
select id,case key when 'assignment_original' then 'Sven Svenson'
  when 'assignment_copy_original' then 'Original zum Kopieren'
  when 'assignment_self' then 'GM Original' else 'Rollback Original' end,
  pg_temp.chat_id('assignment_round'),'vaesen',1
from chat_test_ids where key in ('assignment_original','assignment_copy_original','assignment_self','assignment_failure');

-- The internal definer is not an additional externally callable RPC.
select pg_temp.check_chat(not exists (
  select 1 from pg_catalog.pg_proc p,
    lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
  where p.oid='public.assign_prepared_character_internal(uuid,uuid,boolean)'::regprocedure
    and acl.grantee=0 and acl.privilege_type='EXECUTE'
),'assignment internal helper has no PUBLIC execute');
select pg_temp.check_chat(
  not has_function_privilege('anon','public.assign_prepared_character_internal(uuid,uuid,boolean)','EXECUTE')
  and not has_function_privilege('authenticated','public.assign_prepared_character_internal(uuid,uuid,boolean)','EXECUTE'),
  'assignment internal helper denies anon and authenticated');
select pg_temp.check_chat(
  has_function_privilege('authenticated','public.assign_prepared_character(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.assign_prepared_character_keep_copy(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.assign_prepared_character(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.assign_prepared_character_keep_copy(uuid,uuid)','EXECUTE'),
  'assignment public RPC execute grants preserved');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select pg_temp.chat_error($q$select public.assign_prepared_character_internal(pg_temp.chat_id('assignment_original'),pg_temp.chat_id('player'),false)$q$,'42501');
select public.assign_prepared_character(pg_temp.chat_id('assignment_original'),pg_temp.chat_id('player'));
select pg_temp.check_chat((select owner_user_id=pg_temp.chat_id('player') from public.characters
  where id=pg_temp.chat_id('assignment_original')),'assignment sets original owner');
select pg_temp.check_chat((select active_character_id=pg_temp.chat_id('assignment_original') from public.round_memberships
  where round_id=pg_temp.chat_id('assignment_round') and user_id=pg_temp.chat_id('player')),
  'assignment trigger selects the sole owned character');
select pg_temp.check_chat((select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('assignment_round')),
  'assigning GM cannot read recipient message');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select pg_temp.check_chat(public.can_read_round_messages(pg_temp.chat_id('assignment_round'))
  and (select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('assignment_round')),
  'other current member cannot read assignment message');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select pg_temp.check_chat((select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('assignment_round')),
  'recipient reads exactly one assignment message');
select pg_temp.check_chat((select character_id=pg_temp.chat_id('assignment_original')
  and recipient_user_id=auth.uid() and author_user_id is null and speaker_kind='system'
  and speaker_name_snapshot='System' and kind='system_message' and round_seq=1
  and body='Dir wurde der Charakter Sven Svenson zugewiesen.'
  and client_request_id is not null and created_at is not null
  from public.round_messages where round_id=pg_temp.chat_id('assignment_round')),
  'assignment message has server identity snapshot request and sequence');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select pg_temp.chat_error($q$select public.assign_prepared_character(pg_temp.chat_id('assignment_original'),pg_temp.chat_id('player'))$q$,
  'P0001','Character already has an owner');

-- Return value remains the new prepared copy ID; the message names the ORIGINAL.
do $$
declare copied_id uuid;
begin
  copied_id := public.assign_prepared_character_keep_copy(pg_temp.chat_id('assignment_copy_original'),pg_temp.chat_id('player'));
  perform pg_temp.check_chat(copied_id is not null and copied_id<>pg_temp.chat_id('assignment_copy_original')
    and exists(select 1 from public.characters where id=copied_id and owner_user_id is null
      and round_id=pg_temp.chat_id('assignment_round') and name='Original zum Kopieren – Kopie'
      and created_by_user_id=auth.uid()),'keep_copy returns a new prepared copy');
  perform pg_temp.check_chat((select owner_user_id=pg_temp.chat_id('player') from public.characters
    where id=pg_temp.chat_id('assignment_copy_original')),'keep_copy assigns original');
  perform pg_temp.check_chat((select active_character_id=pg_temp.chat_id('assignment_original') from public.round_memberships
    where round_id=pg_temp.chat_id('assignment_round') and user_id=pg_temp.chat_id('player')),
    'assignment preserves an existing valid active character');
end;
$$;
select pg_temp.chat_error($q$select public.assign_prepared_character_keep_copy(pg_temp.chat_id('assignment_copy_original'),pg_temp.chat_id('player'))$q$,
  'P0001','Character already has an owner');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select pg_temp.check_chat((select count(*)=1 from public.round_messages
  where round_id=pg_temp.chat_id('assignment_round') and character_id=pg_temp.chat_id('assignment_copy_original')
    and recipient_user_id=auth.uid() and round_seq=2 and body='Dir wurde der Charakter Original zum Kopieren zugewiesen.'),
  'keep_copy emits exactly one message for original');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select public.assign_prepared_character(pg_temp.chat_id('assignment_self'),pg_temp.chat_id('gm'));
select pg_temp.check_chat((select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('assignment_round'))
  and exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('assignment_round')
    and character_id=pg_temp.chat_id('assignment_self') and recipient_user_id=auth.uid()
    and author_user_id is null and round_seq=3 and body='Dir wurde der Charakter GM Original zugewiesen.'),
  'GM self-assignment sees only own private message');
select pg_temp.check_chat((select active_character_id=pg_temp.chat_id('assignment_self') from public.round_memberships
  where round_id=pg_temp.chat_id('assignment_round') and user_id=auth.uid()),'GM self-assignment recalculates active character');
reset role;
select pg_temp.check_chat((select count(*)=3 from public.round_messages where round_id=pg_temp.chat_id('assignment_round'))
  and (select count(*)=5 from public.characters where round_id=pg_temp.chat_id('assignment_round')),
  'assignment retries create neither extra messages nor extra copies');

-- Fail AFTER owner update, trigger and optional copy using the existing seq CHECK.
-- chat_error's exception subtransaction must roll back the entire RPC call.
insert into public.round_messages(round_id,round_seq,speaker_kind,speaker_name_snapshot,body,client_request_id)
values(pg_temp.chat_id('assignment_round'),9007199254740991,'game_master','Spielleitung','Sequence limit fixture',gen_random_uuid());
set local role authenticated;
select pg_temp.chat_error($q$select public.assign_prepared_character(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('second'))$q$,'23514');
select pg_temp.chat_error($q$select public.assign_prepared_character_keep_copy(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('second'))$q$,'23514');
reset role;
select pg_temp.check_chat((select owner_user_id is null from public.characters where id=pg_temp.chat_id('assignment_failure'))
  and (select active_character_id is null from public.round_memberships
    where round_id=pg_temp.chat_id('assignment_round') and user_id=pg_temp.chat_id('second'))
  and (select count(*)=5 from public.characters where round_id=pg_temp.chat_id('assignment_round'))
  and (select count(*)=4 from public.round_messages where round_id=pg_temp.chat_id('assignment_round')),
  'message failure rolls back owner active selection copy and message');
delete from public.round_messages where round_id=pg_temp.chat_id('assignment_round') and round_seq=9007199254740991;

-- Existing status/member rules; both entry points must fail without partial copies.
update public.rounds set status='archived' where id=pg_temp.chat_id('assignment_round');
set local role authenticated;
select pg_temp.chat_error($q$select public.assign_prepared_character(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('second'))$q$,
  'P0001','Cannot assign prepared character in archived round');
select pg_temp.chat_error($q$select public.assign_prepared_character_keep_copy(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('second'))$q$,
  'P0001','Cannot assign prepared character in archived round');
reset role;
update public.rounds set status='active',locked_at=now(),locked_reason='Assignment test' where id=pg_temp.chat_id('assignment_round');
set local role authenticated;
select pg_temp.chat_error($q$select public.assign_prepared_character(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('second'))$q$,'P0001','Round is locked');
select pg_temp.chat_error($q$select public.assign_prepared_character_keep_copy(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('second'))$q$,'P0001','Round is locked');
reset role;
update public.rounds set locked_at=null,locked_reason=null where id=pg_temp.chat_id('assignment_round');
set local role authenticated;
select pg_temp.chat_error($q$select public.assign_prepared_character(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('admin'))$q$,
  'P0001','Target user is not a member of this round');
select pg_temp.chat_error($q$select public.assign_prepared_character_keep_copy(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('admin'))$q$,
  'P0001','Target user is not a member of this round');
-- A real sequential transfer proves the final current-role check (not concurrency).
select public.transfer_game_master(pg_temp.chat_id('assignment_round'),pg_temp.chat_id('second'));
select pg_temp.check_chat((select count(*)=1 from public.round_messages
  where round_id=pg_temp.chat_id('assignment_round') and round_seq=4
    and kind='system_message' and recipient_user_id is null and author_user_id is null
    and character_id is null and speaker_kind='system' and speaker_name_snapshot='System'),
  'transfer sequence follows all three private assignment messages');
select pg_temp.chat_error($q$select public.assign_prepared_character(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('player'))$q$,
  'P0001','Character is not available');
select pg_temp.chat_error($q$select public.assign_prepared_character_keep_copy(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('player'))$q$,
  'P0001','Character is not available');
reset role;
select pg_temp.check_chat((select owner_user_id is null from public.characters where id=pg_temp.chat_id('assignment_failure'))
  and (select count(*)=5 from public.characters where round_id=pg_temp.chat_id('assignment_round'))
  and (select count(*)=4 from public.round_messages where round_id=pg_temp.chat_id('assignment_round'))
  and (select count(*)=3 from public.round_messages where round_id=pg_temp.chat_id('assignment_round')
    and kind='system_message' and recipient_user_id is not null),
  'rejected assignments leave characters copies and messages unchanged');
-- A paused round still permits assignment; the previously failed original is usable.
update public.rounds set status='paused' where id=pg_temp.chat_id('assignment_round');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select public.assign_prepared_character(pg_temp.chat_id('assignment_failure'),pg_temp.chat_id('second'));
select pg_temp.check_chat((select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('assignment_round')
  and character_id=pg_temp.chat_id('assignment_failure') and round_seq=5),'assignment succeeds in paused round after rollback');
reset role;
update public.characters set name='Sven Neu' where id=pg_temp.chat_id('assignment_original');
update public.characters set round_id=null where id=pg_temp.chat_id('assignment_original');
delete from public.characters where id=pg_temp.chat_id('assignment_original');
select pg_temp.check_chat((select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('assignment_round')
  and round_seq=1 and character_id is null and body='Dir wurde der Charakter Sven Svenson zugewiesen.'
  and recipient_user_id=pg_temp.chat_id('player')),'real assignment snapshot survives rename removal and harddelete');

-- Phase 3.3b2: isolated real transfers; all fixture changes still roll back.
insert into chat_test_ids(key) values ('transfer_round');
insert into public.rounds(id,name) values (pg_temp.chat_id('transfer_round'),'Transfer Chat Test');
insert into public.round_memberships(round_id,user_id,role) values
(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('gm'),'game_master'),
(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('second'),'player'),
(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('player'),'player');
select pg_temp.check_chat(
  has_function_privilege('authenticated','public.transfer_game_master(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.transfer_game_master(uuid,uuid)','EXECUTE'),
  'transfer execute grants preserved');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select pg_temp.chat_error($q$select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('gm'))$q$,
  'P0001','User is already game master');
select pg_temp.chat_error($q$select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('admin'))$q$,
  'P0001','New game master must be a player in the round');
select pg_temp.chat_error($q$select public.transfer_game_master(pg_temp.chat_id('transfer_round'),gen_random_uuid())$q$,
  'P0001','Transfer profile is not available');
select pg_temp.check_chat((select count(*)=0 from public.round_messages where round_id=pg_temp.chat_id('transfer_round')),
  'invalid transfer targets create no message');
select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('second'));
select pg_temp.check_chat(
  (select role='player' from public.round_memberships where round_id=pg_temp.chat_id('transfer_round') and user_id=auth.uid())
  and (select role='game_master' from public.round_memberships where round_id=pg_temp.chat_id('transfer_round') and user_id=pg_temp.chat_id('second')),
  'transfer demotes caller and promotes target');
select pg_temp.check_chat((select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('transfer_round'))
  and exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('transfer_round')
    and round_seq=1 and kind='system_message' and speaker_kind='system' and speaker_name_snapshot='System'
    and author_user_id is null and recipient_user_id is null and character_id is null
    and body='@chat31_'||pg_temp.chat_id('second')::text||' ist jetzt Spielleitung.'
    and client_request_id is not null and created_at is not null),
  'transfer creates exactly one public server snapshot with sequence one');
-- The old caller cannot repeat a successful transfer with stale GM authority.
select pg_temp.chat_error($q$select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('second'))$q$,
  'P0001','Not authorized');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select pg_temp.chat_error($q$select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('gm'))$q$,
  'P0001','Not authorized');
select pg_temp.check_chat((select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('transfer_round')),
  'old GM retry and unauthorized player create no second message');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('admin')::text,true);
select pg_temp.chat_error($q$select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('gm'))$q$,
  'P0001','Not authorized');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('super')::text,true);
select pg_temp.chat_error($q$select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('gm'))$q$,
  'P0001','Not authorized');
reset role;
select pg_temp.check_chat((select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('transfer_round')),
  'administrative accounts cannot transfer or create messages without GM membership');
update public.profiles set username='chat31_renamed_'||id::text where id=pg_temp.chat_id('second');
select pg_temp.check_chat((select body='@chat31_'||pg_temp.chat_id('second')::text||' ist jetzt Spielleitung.'
  from public.round_messages where round_id=pg_temp.chat_id('transfer_round') and round_seq=1),
  'transfer snapshot survives later username change');

-- Force failure AFTER both updates via the existing round_seq CHECK, not a trigger.
insert into public.round_messages(round_id,round_seq,speaker_kind,speaker_name_snapshot,body,client_request_id)
values(pg_temp.chat_id('transfer_round'),9007199254740991,'game_master','Spielleitung','Transfer sequence limit',gen_random_uuid());
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select pg_temp.chat_error($q$select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('gm'))$q$,'23514');
reset role;
select pg_temp.check_chat(
  (select role='game_master' from public.round_memberships where round_id=pg_temp.chat_id('transfer_round') and user_id=pg_temp.chat_id('second'))
  and (select role='player' from public.round_memberships where round_id=pg_temp.chat_id('transfer_round') and user_id=pg_temp.chat_id('gm'))
  and (select count(*)=1 from public.round_memberships where round_id=pg_temp.chat_id('transfer_round') and role='game_master')
  and (select count(*)=2 from public.round_messages where round_id=pg_temp.chat_id('transfer_round'))
  and (select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('transfer_round') and kind='system_message'),
  'transfer message failure rolls back both roles with no partial message');
delete from public.round_messages where round_id=pg_temp.chat_id('transfer_round') and round_seq=9007199254740991;

-- Transfer, unlike chat sending, remains allowed in paused AND archived rounds.
update public.rounds set status='paused' where id=pg_temp.chat_id('transfer_round');
set local role authenticated;
select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('gm'));
reset role;
update public.rounds set status='archived' where id=pg_temp.chat_id('transfer_round');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('second'));
reset role;
select pg_temp.check_chat((select array_agg(round_seq order by round_seq)=array[1,2,3]::bigint[]
  from public.round_messages where round_id=pg_temp.chat_id('transfer_round'))
  and (select count(*)=3 from public.round_messages where round_id=pg_temp.chat_id('transfer_round')
    and kind='system_message' and author_user_id is null and recipient_user_id is null and character_id is null)
  and exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('transfer_round') and round_seq=3
    and body='@chat31_renamed_'||pg_temp.chat_id('second')::text||' ist jetzt Spielleitung.'),
  'active paused archived transfers use unique ordered sequences and current snapshots');
update public.rounds set locked_at=now(),locked_reason='Transfer test' where id=pg_temp.chat_id('transfer_round');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select pg_temp.chat_error($q$select public.transfer_game_master(pg_temp.chat_id('transfer_round'),pg_temp.chat_id('gm'))$q$,
  'P0001','Round is locked');
reset role;
select pg_temp.check_chat((select count(*)=3 from public.round_messages where round_id=pg_temp.chat_id('transfer_round'))
  and (select role='game_master' from public.round_memberships where round_id=pg_temp.chat_id('transfer_round') and user_id=pg_temp.chat_id('second'))
  and (select role='player' from public.round_memberships where round_id=pg_temp.chat_id('transfer_round') and user_id=pg_temp.chat_id('gm'))
  and not exists(select 1 from public.round_memberships where round_id=pg_temp.chat_id('transfer_round') and active_character_id is not null),
  'locked transfer leaves roles messages and active selections unchanged');

-- Phase 3.3c2-1: isolated GM edits, using real message producers for seq 1..3.
insert into chat_test_ids(key) values ('edit_round'), ('edit_prepared');
insert into public.rounds(id,name) values (pg_temp.chat_id('edit_round'),'Edit fixture');
insert into public.round_memberships(round_id,user_id,role) values
(pg_temp.chat_id('edit_round'),pg_temp.chat_id('gm'),'game_master'),
(pg_temp.chat_id('edit_round'),pg_temp.chat_id('second'),'player'),
(pg_temp.chat_id('edit_round'),pg_temp.chat_id('player'),'player');
insert into public.characters(id,name,round_id,template_key,template_version)
values(pg_temp.chat_id('edit_prepared'),'Edit prepared',pg_temp.chat_id('edit_round'),'vaesen',1);
select pg_temp.check_chat(
  has_function_privilege('authenticated','public.update_round(uuid,text,text,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.update_round(uuid,text,text,text,text,text)','EXECUTE'),
  'round edit RPC execute restricted to authenticated');
select pg_temp.check_chat(
  not has_column_privilege('authenticated','public.rounds','status','UPDATE')
  and not has_column_privilege('anon','public.rounds','status','UPDATE')
  and has_column_privilege('authenticated','public.rounds','name','UPDATE')
  and has_column_privilege('authenticated','public.rounds','system','UPDATE')
  and has_column_privilege('authenticated','public.rounds','description','UPDATE')
  and has_column_privilege('authenticated','public.rounds','appointment','UPDATE'),
  'effective grants deny direct status but retain all four metadata columns');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select public.send_round_message(pg_temp.chat_id('edit_round'),'Edit history',gen_random_uuid(),null);
select public.assign_prepared_character(pg_temp.chat_id('edit_prepared'),pg_temp.chat_id('player'));
select public.transfer_game_master(pg_temp.chat_id('edit_round'),pg_temp.chat_id('second'));
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select pg_temp.check_chat((select name='Paused name' and system='vaesen' and description='Description'
  and appointment='Friday' and status='paused' and orphaned_at is null
  from public.update_round(pg_temp.chat_id('edit_round'),' Paused name ','vaesen','Description','Friday','paused')),
  'pause returns updated metadata and status in one row');
reset role;
-- Privileged observation includes the other recipient's private row.
select pg_temp.check_chat((select array_agg(round_seq order by round_seq)=array[1,2,3,4]::bigint[]
  from public.round_messages where round_id=pg_temp.chat_id('edit_round'))
  and exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('edit_round') and round_seq=1 and kind='character_message')
  and exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('edit_round') and round_seq=2 and recipient_user_id=pg_temp.chat_id('player'))
  and exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('edit_round') and round_seq=3 and kind='system_message' and recipient_user_id is null)
  and exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('edit_round') and round_seq=4
    and kind='system_message' and speaker_kind='system' and speaker_name_snapshot='System'
    and author_user_id is null and recipient_user_id is null and character_id is null
    and body='Die Runde wurde pausiert.' and client_request_id is not null),
  'pause shares sequence with character private assignment and public transfer messages');
set local role authenticated;
select public.update_round(pg_temp.chat_id('edit_round'),'Paused name','vaesen','Description','Friday','paused');
select pg_temp.check_chat((select count(*)=3 from public.round_messages where round_id=pg_temp.chat_id('edit_round')),
  'paused to paused creates no additional visible message');
select pg_temp.check_chat((public.update_round(pg_temp.chat_id('edit_round'),'Active name','vaesen','Description','Friday','active')).status='active',
  'resume returns active status');
select pg_temp.check_chat((select count(*)=1 from public.round_messages where round_id=pg_temp.chat_id('edit_round') and round_seq=5
  and kind='system_message' and speaker_kind='system' and speaker_name_snapshot='System'
  and author_user_id is null and recipient_user_id is null and character_id is null
  and body='Die Runde wurde fortgesetzt.' and client_request_id is not null),
  'resume creates exactly one public system message');
select public.update_round(pg_temp.chat_id('edit_round'),'Active name','vaesen','Description','Friday','active');
select pg_temp.check_chat((select count(*)=4 from public.round_messages where round_id=pg_temp.chat_id('edit_round')),
  'active to active creates no additional visible message');
select pg_temp.check_chat((select name='Metadata name' and system is null and description='New description' and appointment='Saturday' and status='active'
  from public.update_round(pg_temp.chat_id('edit_round'),'Metadata name','','New description','Saturday','active'))
  and (select count(*)=4 from public.round_messages where round_id=pg_temp.chat_id('edit_round')),
  'metadata-only RPC edit changes all fields without a message');

-- Even a current GM cannot bypass message production via a direct status write.
select pg_temp.chat_error($q$update public.rounds set status='paused' where id=pg_temp.chat_id('edit_round')$q$,'42501');
update public.rounds set name='Direct metadata',system='vaesen',description='Direct description',appointment='Sunday'
where id=pg_temp.chat_id('edit_round');
select pg_temp.check_chat((select name='Direct metadata' and system='vaesen' and description='Direct description'
  and appointment='Sunday' and status='active' from public.rounds where id=pg_temp.chat_id('edit_round'))
  and (select count(*)=4 from public.round_messages where round_id=pg_temp.chat_id('edit_round')),
  'direct status bypass denied while legitimate GM metadata update still works');

do $$
declare
  viewer text;
  before_round public.rounds;
begin
  select * into before_round from public.rounds where id=pg_temp.chat_id('edit_round');
  foreach viewer in array array['player','gm','admin','super'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id(viewer)::text,true);
    perform pg_temp.chat_error($q$select public.update_round(pg_temp.chat_id('edit_round'),'Unauthorized','bad','bad','bad','paused')$q$,'P0001','Not authorized');
  end loop;
  perform set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
  perform pg_temp.check_chat((select r is not distinct from before_round from public.rounds r where id=pg_temp.chat_id('edit_round'))
    and (select count(*)=4 from public.round_messages where round_id=pg_temp.chat_id('edit_round')),
    'player former GM admin and superadmin cannot edit without current GM membership');
end;
$$;

-- Round locking must reject the entire edit, including metadata.
reset role;
update public.rounds set locked_at=now(),locked_reason='Edit test' where id=pg_temp.chat_id('edit_round');
set local role authenticated;
do $$
declare before_round public.rounds;
begin
  select * into before_round from public.rounds where id=pg_temp.chat_id('edit_round');
  perform pg_temp.chat_error($q$select public.update_round(pg_temp.chat_id('edit_round'),'Locked edit','bad','bad','bad','paused')$q$,'P0001','Round is locked');
  perform pg_temp.check_chat((select r is not distinct from before_round from public.rounds r where id=pg_temp.chat_id('edit_round'))
    and (select count(*)=4 from public.round_messages where round_id=pg_temp.chat_id('edit_round')),
    'locked edit preserves complete round row and messages');
end;
$$;
reset role;
update public.rounds set locked_at=null,locked_reason=null where id=pg_temp.chat_id('edit_round');
insert into public.round_messages(round_id,round_seq,speaker_kind,speaker_name_snapshot,body,client_request_id)
values(pg_temp.chat_id('edit_round'),9007199254740991,'game_master','Spielleitung','Edit sequence limit',gen_random_uuid());
set local role authenticated;
do $$
declare before_round public.rounds;
begin
  select * into before_round from public.rounds where id=pg_temp.chat_id('edit_round');
  perform pg_temp.chat_error($q$select public.update_round(pg_temp.chat_id('edit_round'),'Rollback name','Rollback system','Rollback description','Rollback appointment','paused')$q$,'23514');
  perform pg_temp.check_chat((select r is not distinct from before_round from public.rounds r where id=pg_temp.chat_id('edit_round'))
    and (select count(*)=5 from public.round_messages where round_id=pg_temp.chat_id('edit_round')),
    'late edit message failure rolls back status all metadata and message');
end;
$$;
reset role;
select pg_temp.check_chat((select count(*)=6 from public.round_messages where round_id=pg_temp.chat_id('edit_round')),
  'edit failure and no-ops preserve hidden private history too');
delete from public.round_messages where round_id=pg_temp.chat_id('edit_round') and round_seq=9007199254740991;
set local role authenticated;
-- Preserve the existing form transitions; 3.3c2-2 adds one event per archive.
select pg_temp.check_chat((public.update_round(pg_temp.chat_id('edit_round'),'Archive name',null,null,null,'archived')).status='archived','form edit can archive');
select pg_temp.check_chat((public.update_round(pg_temp.chat_id('edit_round'),'Unarchive active',null,null,null,'active')).status='active','form edit can unarchive to active');
select public.update_round(pg_temp.chat_id('edit_round'),'Archive again',null,null,null,'archived');
select pg_temp.check_chat((public.update_round(pg_temp.chat_id('edit_round'),'Unarchive paused',null,null,null,'paused')).status='paused','form edit can unarchive to paused');
-- The old definer remains callable despite revoked direct table UPDATE.
select public.set_round_archived(pg_temp.chat_id('edit_round'),true);
select public.set_round_archived(pg_temp.chat_id('edit_round'),false);
reset role;
select pg_temp.check_chat((select count(*)=8 from public.round_messages where round_id=pg_temp.chat_id('edit_round'))
  and (select count(*)=3 from public.round_messages where round_id=pg_temp.chat_id('edit_round')
    and kind='system_message' and recipient_user_id is null and body='Die Runde wurde archiviert.')
  and (select status='paused' from public.rounds where id=pg_temp.chat_id('edit_round')),
  'existing form archive transitions emit three archive events while unarchive stays message-free');

-- Phase 3.3c2-2: both manual archive paths use the same public event contract.
insert into chat_test_ids(key) values
  ('archive_round'), ('archive_prepared'), ('archive_private_tail'), ('archive_orphan');
insert into public.rounds(id,name) values (pg_temp.chat_id('archive_round'),'Manual archive fixture');
insert into public.round_memberships(round_id,user_id,role) values
(pg_temp.chat_id('archive_round'),pg_temp.chat_id('gm'),'game_master'),
(pg_temp.chat_id('archive_round'),pg_temp.chat_id('second'),'player'),
(pg_temp.chat_id('archive_round'),pg_temp.chat_id('player'),'player');
insert into public.characters(id,name,round_id,template_key,template_version)
select id,'Archive prepared',pg_temp.chat_id('archive_round'),'vaesen',1
from chat_test_ids where key in ('archive_prepared','archive_private_tail');
select pg_temp.check_chat(
  has_function_privilege('authenticated','public.set_round_archived(uuid,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.set_round_archived(uuid,boolean)','EXECUTE'),
  'manual archive preserves RPC execute grants');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('gm')::text,true);
select public.send_round_message(pg_temp.chat_id('archive_round'),'Archive history',gen_random_uuid(),null);
select public.assign_prepared_character(pg_temp.chat_id('archive_prepared'),pg_temp.chat_id('player'));
select public.transfer_game_master(pg_temp.chat_id('archive_round'),pg_temp.chat_id('second'));
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select public.update_round(pg_temp.chat_id('archive_round'),'Manual archive fixture',null,null,null,'paused');
select public.update_round(pg_temp.chat_id('archive_round'),'Manual archive fixture',null,null,null,'active');
select public.assign_prepared_character(pg_temp.chat_id('archive_private_tail'),pg_temp.chat_id('player'));
reset role;
select pg_temp.check_chat((select array_agg(round_seq order by round_seq)=array[1,2,3,4,5,6]::bigint[]
  from public.round_messages where round_id=pg_temp.chat_id('archive_round'))
  and exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('archive_round')
    and round_seq=6 and kind='system_message' and recipient_user_id=pg_temp.chat_id('player')),
  'archive fixture includes chat private assignment transfer pause resume and a private sequence tail');
set local role authenticated;
-- Each iteration ends archived; the next setup unarchives without a message.
do $$
declare
  archive_path text;
  starting_status text;
  before_count bigint;
  expected_seq bigint := 6;
  archive_message public.round_messages;
begin
  perform pg_temp.check_chat((select max(round_seq)=5 and count(*)=4
    from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
    'GM cannot see the private highest sequence before manual archive');
  foreach archive_path in array array['update_round','set_round_archived'] loop
    foreach starting_status in array array['active','paused'] loop
      select count(*) into before_count from public.round_messages where round_id=pg_temp.chat_id('archive_round');
      perform public.update_round(pg_temp.chat_id('archive_round'),'Before archive','vaesen','Before description','Friday',starting_status);
      perform pg_temp.check_chat((select status=starting_status from public.rounds where id=pg_temp.chat_id('archive_round'))
        and (select count(*)=before_count from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
        archive_path || ' setup/unarchive to ' || starting_status || ' is message-free');
      if archive_path='update_round' then
        perform public.update_round(pg_temp.chat_id('archive_round'),'Archived edit','New system','New description','Saturday','archived');
        perform pg_temp.check_chat((select name='Archived edit' and system='New system'
          and description='New description' and appointment='Saturday' from public.rounds where id=pg_temp.chat_id('archive_round')),
          'archive through edit also saves all metadata');
      else
        perform public.set_round_archived(pg_temp.chat_id('archive_round'),true);
        perform pg_temp.check_chat((select name='Before archive' and system='vaesen'
          and description='Before description' and appointment='Friday' from public.rounds where id=pg_temp.chat_id('archive_round')),
          'archive-only RPC preserves metadata');
      end if;
      expected_seq := expected_seq+1;
      select * into archive_message from public.round_messages
      where round_id=pg_temp.chat_id('archive_round') and round_seq=expected_seq;
      perform pg_temp.check_chat(archive_message.id is not null
        and archive_message.kind='system_message' and archive_message.speaker_kind='system'
        and archive_message.speaker_name_snapshot='System' and archive_message.author_user_id is null
        and archive_message.recipient_user_id is null and archive_message.character_id is null
        and archive_message.body='Die Runde wurde archiviert.' and archive_message.client_request_id is not null
        and (select status='archived' from public.rounds where id=pg_temp.chat_id('archive_round'))
        and (select count(*)=before_count+1 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
        archive_path || ' from ' || starting_status || ' emits exactly one public archive at the shared sequence');
      -- Both directions of cross-path retry, including each path's own retry.
      perform public.set_round_archived(pg_temp.chat_id('archive_round'),true);
      perform public.update_round(pg_temp.chat_id('archive_round'),'Archived metadata',null,null,null,'archived');
      perform pg_temp.check_chat((select status='archived' and name='Archived metadata' from public.rounds where id=pg_temp.chat_id('archive_round'))
        and (select count(*)=before_count+1 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
        'same and opposite archive paths never duplicate the archive event');
      perform pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('archive_round'),'Archived GM send',gen_random_uuid(),null)$q$,
        '42501','CHAT_ROUND_ARCHIVED');
    end loop;
  end loop;
end;
$$;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
select pg_temp.check_chat((select count(*)=4 from public.round_messages
  where round_id=pg_temp.chat_id('archive_round') and body='Die Runde wurde archiviert.' and recipient_user_id is null),
  'ordinary member reads all archive events in archived history');
select pg_temp.chat_error($q$select public.send_round_message(pg_temp.chat_id('archive_round'),'Archived player send',gen_random_uuid(),pg_temp.chat_id('archive_prepared'))$q$,
  '42501','CHAT_ROUND_ARCHIVED');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select public.set_round_archived(pg_temp.chat_id('archive_round'),false);
select pg_temp.check_chat((select status='paused' from public.rounds where id=pg_temp.chat_id('archive_round'))
  and (select count(*)=8 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
  'archive RPC unarchives to paused without a message');
select pg_temp.chat_error($q$select public.set_round_archived(pg_temp.chat_id('archive_round'),false)$q$,
  'P0001','Round is not archived');

-- Admin and Bewahrer retain archive/unarchive rights without chat-content access.
do $$
declare
  administrator text;
  expected_seq bigint := 10;
begin
  foreach administrator in array array['admin','super'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id(administrator)::text,true);
    perform pg_temp.check_chat(not exists(select 1 from public.round_memberships
      where round_id=pg_temp.chat_id('archive_round') and user_id=auth.uid()),'admin archive fixture has no membership');
    perform pg_temp.chat_error($q$select public.update_round(pg_temp.chat_id('archive_round'),'Admin edit',null,null,null,'archived')$q$,
      'P0001','Not authorized');
    perform public.set_round_archived(pg_temp.chat_id('archive_round'),true);
    perform pg_temp.check_chat(not public.can_read_round_messages(pg_temp.chat_id('archive_round'))
      and not exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
      administrator || ' archive authority never grants chat access');
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
    expected_seq := expected_seq+1;
    perform pg_temp.check_chat((select status='archived' from public.rounds where id=pg_temp.chat_id('archive_round'))
      and (select count(*)=expected_seq-2 from public.round_messages where round_id=pg_temp.chat_id('archive_round'))
      and exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('archive_round') and round_seq=expected_seq
        and kind='system_message' and speaker_kind='system' and speaker_name_snapshot='System'
        and author_user_id is null and recipient_user_id is null and character_id is null
        and body='Die Runde wurde archiviert.' and client_request_id is not null),
      administrator || ' manual archive emits one public event');
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id(administrator)::text,true);
    perform public.set_round_archived(pg_temp.chat_id('archive_round'),false);
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
    perform pg_temp.check_chat((select status='paused' from public.rounds where id=pg_temp.chat_id('archive_round'))
      and (select count(*)=expected_seq-2 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
      administrator || ' unarchive remains paused and message-free');
  end loop;
end;
$$;
do $$
declare
  caller text;
  before_round public.rounds;
begin
  select * into before_round from public.rounds where id=pg_temp.chat_id('archive_round');
  foreach caller in array array['player','gm'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id(caller)::text,true);
    perform pg_temp.chat_error($q$select public.set_round_archived(pg_temp.chat_id('archive_round'),true)$q$,'P0001','Not authorized');
    perform pg_temp.chat_error($q$select public.set_round_archived(pg_temp.chat_id('archive_round'),false)$q$,'P0001','Not authorized');
  end loop;
  perform set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
  perform pg_temp.check_chat((select r is not distinct from before_round from public.rounds r where id=pg_temp.chat_id('archive_round'))
    and (select count(*)=10 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
    'player and former GM archive attempts change neither round nor messages');
end;
$$;
reset role;
update public.rounds set locked_at=now(),locked_reason='Archive test' where id=pg_temp.chat_id('archive_round');
set local role authenticated;
do $$
declare
  caller text;
  before_round public.rounds;
begin
  select * into before_round from public.rounds where id=pg_temp.chat_id('archive_round');
  foreach caller in array array['second','admin','super'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id(caller)::text,true);
    perform pg_temp.chat_error($q$select public.set_round_archived(pg_temp.chat_id('archive_round'),true)$q$,'P0001','Round is locked');
    perform pg_temp.chat_error($q$select public.set_round_archived(pg_temp.chat_id('archive_round'),false)$q$,'P0001','Round is locked');
  end loop;
  perform set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
  perform pg_temp.chat_error($q$select public.update_round(pg_temp.chat_id('archive_round'),'Locked archive',null,null,null,'archived')$q$,'P0001','Round is locked');
  perform pg_temp.check_chat((select r is not distinct from before_round from public.rounds r where id=pg_temp.chat_id('archive_round'))
    and (select count(*)=10 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
    'moderation lock blocks both archive paths including admin and Bewahrer');
end;
$$;
reset role;
update public.rounds set locked_at=null,locked_reason=null where id=pg_temp.chat_id('archive_round');
insert into public.round_messages(round_id,round_seq,speaker_kind,speaker_name_snapshot,body,client_request_id)
values(pg_temp.chat_id('archive_round'),9007199254740991,'game_master','Spielleitung','Archive sequence limit',gen_random_uuid());
set local role authenticated;
do $$
declare before_round public.rounds;
begin
  select * into before_round from public.rounds where id=pg_temp.chat_id('archive_round');
  perform pg_temp.chat_error($q$select public.update_round(pg_temp.chat_id('archive_round'),'Rollback archive','Rollback system','Rollback description','Rollback appointment','archived')$q$,'23514');
  perform pg_temp.check_chat((select r is not distinct from before_round from public.rounds r where id=pg_temp.chat_id('archive_round'))
    and (select count(*)=11 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
    'late archive insert failure rolls back edit status and every metadata field');
  perform pg_temp.chat_error($q$select public.set_round_archived(pg_temp.chat_id('archive_round'),true)$q$,'23514');
  perform pg_temp.check_chat((select r is not distinct from before_round from public.rounds r where id=pg_temp.chat_id('archive_round'))
    and (select count(*)=11 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
    'late archive insert failure rolls back archive-only RPC completely');
end;
$$;
reset role;
select pg_temp.check_chat((select count(*)=13 from public.round_messages where round_id=pg_temp.chat_id('archive_round')),
  'archive no-ops and failed writes preserve private history too');
delete from public.round_messages where round_id=pg_temp.chat_id('archive_round') and round_seq=9007199254740991;

-- Orphan fixture only; never call prepare_user_deletion or delete an account.
insert into public.rounds(id,name,status,orphaned_at)
values(pg_temp.chat_id('archive_orphan'),'Orphan archive fixture','archived',now());
set local role authenticated;
do $$
declare administrator text;
begin
  foreach administrator in array array['admin','super'] loop
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id(administrator)::text,true);
    perform public.set_round_archived(pg_temp.chat_id('archive_orphan'),true);
    perform pg_temp.chat_error($q$select public.set_round_archived(pg_temp.chat_id('archive_orphan'),false)$q$,
      'P0001','Round must be recovered before it can leave the archive');
  end loop;
end;
$$;
reset role;
select pg_temp.check_chat((select status='archived' and orphaned_at is not null from public.rounds where id=pg_temp.chat_id('archive_orphan'))
  and not exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('archive_orphan')),
  'orphan archive no-op and blocked unarchive preserve state without a message');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('super')::text,true);
select public.recover_orphaned_round(pg_temp.chat_id('archive_orphan'),pg_temp.chat_id('gm'));
reset role;
select pg_temp.check_chat((select status='archived' and orphaned_at is null from public.rounds where id=pg_temp.chat_id('archive_orphan'))
  and not exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('archive_orphan')),
  'recovery clears orphan marker but neither unarchives nor emits a message');
set local role authenticated;
select public.set_round_archived(pg_temp.chat_id('archive_orphan'),false);
reset role;
select pg_temp.check_chat((select status='paused' and orphaned_at is null from public.rounds where id=pg_temp.chat_id('archive_orphan'))
  and not exists(select 1 from public.round_messages where round_id=pg_temp.chat_id('archive_orphan')),
  'recovered round unarchives silently to paused');

-- Phase 3.3c2-3: deletion PREPARATION only; never delete auth.users/profiles.
-- All new accounts and rounds are transaction-local fixtures and roll back.
create temporary table deletion_targets (
  key text primary key, id uuid not null default gen_random_uuid(),
  account_role text not null default 'user', executor text not null default 'admin'
);
insert into deletion_targets(key,account_role,executor) values
('active','user','admin'),('paused','user','admin'),('archived','user','admin'),
('locked_active','user','admin'),('locked_paused','user','admin'),('player_only','user','admin'),
('multi','user','admin'),('rollback','user','admin'),
('super_user','user','super'),('admin_target','admin','super');
create temporary table deletion_cases (
  key text primary key, target_key text not null references deletion_targets(key),
  round_id uuid not null default gen_random_uuid(), original_status text not null,
  locked boolean not null default false, is_gm boolean not null default true,
  seed_seq bigint not null default 2,
  character_id uuid not null default gen_random_uuid(),
  survivor_character_id uuid not null default gen_random_uuid()
);
insert into deletion_cases(key,target_key,original_status,locked,is_gm,seed_seq) values
('active','active','active',false,true,2),
('paused','paused','paused',false,true,2),
('archived','archived','archived',false,true,2),
('locked_active','locked_active','active',true,true,2),
('locked_paused','locked_paused','paused',true,true,2),
('player_only','player_only','active',false,false,2),
('multi_active','multi','active',false,true,10),
('multi_paused','multi','paused',false,true,20),
('multi_archived','multi','archived',false,true,30),
('super_user','super_user','active',false,true,2),
('admin_target','admin_target','active',false,true,2);
-- The overflow belongs to the SECOND UUID-sorted round, after a successful insert.
insert into deletion_cases(key,target_key,round_id,original_status,seed_seq)
select 'rollback_'||position,'rollback',id,
  case when position=1 then 'active' else 'paused' end,
  case when position=1 then 2 else 9007199254740991 end
from (select id,row_number() over(order by id) as position
  from (values(gen_random_uuid()),(gen_random_uuid())) ids(id)) ordered;
grant select on deletion_targets,deletion_cases to authenticated;
insert into auth.users(id,raw_user_meta_data)
select id,jsonb_build_object('username','chat_delete_'||id::text,'display_name','Deletion Test')
from deletion_targets;
update public.profiles p set role=t.account_role from deletion_targets t where p.id=t.id;
insert into public.rounds(id,name)
select round_id,'Deletion '||key from deletion_cases;
insert into public.round_memberships(round_id,user_id,role)
select c.round_id,t.id,case when c.is_gm then 'game_master' else 'player' end
from deletion_cases c join deletion_targets t on t.key=c.target_key
union all
select round_id,pg_temp.chat_id('second'),case when is_gm then 'player' else 'game_master' end
from deletion_cases;
insert into public.characters(id,name,owner_user_id,round_id,template_key,template_version)
select c.character_id,'Deletion owned',t.id,c.round_id,'vaesen',1
from deletion_cases c join deletion_targets t on t.key=c.target_key
union all
select survivor_character_id,'Survivor owned',pg_temp.chat_id('second'),round_id,'vaesen',1
from deletion_cases;
-- Lifecycle triggers select both sole owned characters before status/lock fixtures.
select pg_temp.check_chat(not exists(
  select 1 from deletion_cases c join deletion_targets t on t.key=c.target_key
  join public.round_memberships m on m.round_id=c.round_id and m.user_id=t.id
  where m.active_character_id is distinct from c.character_id),
  'deletion fixtures have valid active characters before cleanup');
update public.rounds r set status=c.original_status,
  locked_at=case when c.locked then now() else null end,
  locked_reason=case when c.locked then 'Deletion moderation fixture' else null end
from deletion_cases c where r.id=c.round_id;
insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,body,client_request_id)
select round_id,1,'system_message','system','System',
  case when original_status='archived' then 'Die Runde wurde archiviert.' else 'Existing public history' end,
  gen_random_uuid() from deletion_cases;
-- The highest sequence is private; new public events must still follow it.
insert into public.round_messages(round_id,round_seq,kind,speaker_kind,speaker_name_snapshot,recipient_user_id,character_id,body,client_request_id)
select round_id,seed_seq,'system_message','system','System',pg_temp.chat_id('second'),
  survivor_character_id,'Existing private history',gen_random_uuid() from deletion_cases;

-- Full-row snapshots catch partial marker, metadata, active-ID or cleanup changes.
-- Invoker-only helper is used as postgres before/after authenticated calls.
create function pg_temp.deletion_snapshot(p_key text default null)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p
      join deletion_targets t on t.id=p.id where p_key is null or t.key=p_key),
    'rounds',(select jsonb_agg(to_jsonb(r) order by r.id) from public.rounds r
      join deletion_cases c on c.round_id=r.id where p_key is null or c.target_key=p_key),
    'memberships',(select jsonb_agg(to_jsonb(m) order by m.id) from public.round_memberships m
      join deletion_cases c on c.round_id=m.round_id where p_key is null or c.target_key=p_key),
    'characters',(select jsonb_agg(to_jsonb(ch) order by ch.id) from public.characters ch
      join deletion_cases c on ch.id in (c.character_id,c.survivor_character_id)
      where p_key is null or c.target_key=p_key),
    'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.round_messages m
      join deletion_cases c on c.round_id=m.round_id where p_key is null or c.target_key=p_key)
  );
$$;
create temporary table deletion_snapshots(key text primary key, data jsonb not null);
insert into deletion_snapshots values ('permissions',pg_temp.deletion_snapshot());
select pg_temp.check_chat(
  has_function_privilege('authenticated','public.prepare_user_deletion(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.prepare_user_deletion(uuid)','EXECUTE'),
  'deletion preparation execute grants unchanged');
set local role authenticated;
do $$
declare target_id uuid;
begin
  select id into target_id from deletion_targets where key='active';
  perform set_config('request.jwt.claim.sub',pg_temp.chat_id('player')::text,true);
  perform pg_temp.chat_error(format('select public.prepare_user_deletion(%L::uuid)',target_id),
    'P0001','Not authorized');
  perform set_config('request.jwt.claim.sub',pg_temp.chat_id('admin')::text,true);
  perform pg_temp.chat_error($q$select public.prepare_user_deletion(pg_temp.chat_id('admin'))$q$,
    'P0001','You cannot delete your own account');
  perform pg_temp.chat_error($q$select public.prepare_user_deletion((select id from deletion_targets where key='admin_target'))$q$,
    'P0001','Admins can only delete users');
  perform pg_temp.chat_error($q$select public.prepare_user_deletion(pg_temp.chat_id('super'))$q$,
    'P0001','Superadmin cannot be deleted');
  perform pg_temp.chat_error($q$select public.prepare_user_deletion(gen_random_uuid())$q$,
    'P0001','User does not exist');
  perform pg_temp.chat_error($q$select public.prepare_user_deletion(null)$q$,
    'P0001','User does not exist');
  perform set_config('request.jwt.claim.sub',pg_temp.chat_id('super')::text,true);
  perform pg_temp.chat_error($q$select public.prepare_user_deletion(pg_temp.chat_id('super'))$q$,
    'P0001','You cannot delete your own account');
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.chat_error(format('select public.prepare_user_deletion(%L::uuid)',target_id),
    'P0001','Not authenticated');
end;
$$;
reset role;
select pg_temp.check_chat(pg_temp.deletion_snapshot()=(select data from deletion_snapshots where key='permissions'),
  'rejected deletion preparations preserve all profiles rounds memberships characters and messages');

set local role authenticated;
do $$
declare target record;
begin
  for target in select * from deletion_targets where key<>'rollback' order by key loop
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id(target.executor)::text,true);
    perform public.prepare_user_deletion(target.id);
  end loop;
end;
$$;
reset role;
do $$
declare
  fixture record;
  stored_round public.rounds;
  new_message public.round_messages;
  expected_new boolean;
begin
  for fixture in select c.*,t.id as target_id from deletion_cases c
    join deletion_targets t on t.key=c.target_key where c.target_key<>'rollback'
  loop
    expected_new := fixture.is_gm and fixture.original_status<>'archived';
    select * into stored_round from public.rounds where id=fixture.round_id;
    perform pg_temp.check_chat(stored_round.id is not null
      and stored_round.status=(case when fixture.is_gm then 'archived' else fixture.original_status end)
      and ((stored_round.orphaned_at is not null)=fixture.is_gm)
      and ((stored_round.locked_at is not null)=fixture.locked)
      and stored_round.locked_reason is not distinct from
        (case when fixture.locked then 'Deletion moderation fixture' else null end),
      fixture.key||' automatic archive preserves locked and player-only semantics');
    perform pg_temp.check_chat((select deletion_pending_at is not null from public.profiles where id=fixture.target_id)
      and not exists(select 1 from public.round_memberships where user_id=fixture.target_id)
      and exists(select 1 from public.characters where id=fixture.character_id
        and owner_user_id=fixture.target_id and round_id is null)
      and exists(select 1 from public.round_memberships where round_id=fixture.round_id
        and user_id=pg_temp.chat_id('second') and active_character_id=fixture.survivor_character_id
        and role=(case when fixture.is_gm then 'player' else 'game_master' end))
      and exists(select 1 from public.characters where id=fixture.survivor_character_id and round_id=fixture.round_id),
      fixture.key||' deletion marker membership cleanup and character lifecycle preserved');
    perform pg_temp.check_chat((select count(*)=2+(case when expected_new then 1 else 0 end)
      from public.round_messages where round_id=fixture.round_id)
      and (select count(*)=(case when fixture.is_gm then 1 else 0 end)
        from public.round_messages where round_id=fixture.round_id and body='Die Runde wurde archiviert.'),
      fixture.key||' exactly one new archive event or unchanged archived history');
    if expected_new then
      select * into new_message from public.round_messages
      where round_id=fixture.round_id and round_seq=fixture.seed_seq+1;
      perform pg_temp.check_chat(new_message.id is not null
        and new_message.kind='system_message' and new_message.speaker_kind='system'
        and new_message.speaker_name_snapshot='System' and new_message.author_user_id is null
        and new_message.recipient_user_id is null and new_message.character_id is null
        and new_message.body='Die Runde wurde archiviert.'
        and new_message.client_request_id is not null and new_message.created_at is not null,
        fixture.key||' public server archive event follows private highest sequence independently per round');
    end if;
  end loop;
end;
$$;
-- Admin and Bewahrer never gain chat access merely by preparing deletion.
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('admin')::text,true);
select pg_temp.check_chat(not exists(select 1 from public.round_messages
  where round_id in(select round_id from deletion_cases)),'deletion authority grants no chat-content access');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('super')::text,true);
select pg_temp.check_chat(not exists(select 1 from public.round_messages
  where round_id in(select round_id from deletion_cases)),'Bewahrer deletion authority grants no chat-content access');
select set_config('request.jwt.claim.sub',pg_temp.chat_id('second')::text,true);
select pg_temp.check_chat((select count(*)=3 from public.round_messages
  where round_id=(select round_id from deletion_cases where key='active')),
  'remaining member reads automatic archive event with existing RLS');
select pg_temp.check_chat(not exists(select 1 from public.round_messages
  where round_id=(select round_id from deletion_cases where key='locked_active')),
  'automatic archive does not bypass moderation lock for remaining player');
reset role;

insert into deletion_snapshots values ('completed',pg_temp.deletion_snapshot());
set local role authenticated;
do $$
declare target record;
begin
  for target in select * from deletion_targets where key<>'rollback' order by key loop
    perform set_config('request.jwt.claim.sub',pg_temp.chat_id(target.executor)::text,true);
    perform public.prepare_user_deletion(target.id);
  end loop;
end;
$$;
reset role;
select pg_temp.check_chat(pg_temp.deletion_snapshot()=(select data from deletion_snapshots where key='completed'),
  'repeated preparation preserves original marker orphan timestamps and message counts');

-- Later round overflows after the first UUID-sorted round has archived/inserted.
select pg_temp.check_chat(
  (select round_id from deletion_cases where key='rollback_1') <
  (select round_id from deletion_cases where key='rollback_2')
  and (select original_status='active' and seed_seq=2 from deletion_cases where key='rollback_1')
  and (select original_status='paused' and seed_seq=9007199254740991 from deletion_cases where key='rollback_2'),
  'rollback fixture fails in the later UUID-sorted GM round');
insert into deletion_snapshots values ('rollback',pg_temp.deletion_snapshot('rollback'));
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.chat_id('admin')::text,true);
select pg_temp.chat_error($q$select public.prepare_user_deletion((select id from deletion_targets where key='rollback'))$q$,'23514');
reset role;
select pg_temp.check_chat(pg_temp.deletion_snapshot('rollback')=(select data from deletion_snapshots where key='rollback')
  and (select deletion_pending_at is null from public.profiles
    where id=(select id from deletion_targets where key='rollback')),
  'late second-round insert failure rolls back marker every round orphan membership active ID character and message');
-- Removing only the overflow fixture makes the exact same preparation succeed.
delete from public.round_messages where round_id=(select round_id from deletion_cases where key='rollback_2')
  and round_seq=9007199254740991;
set local role authenticated;
select public.prepare_user_deletion((select id from deletion_targets where key='rollback'));
reset role;
select pg_temp.check_chat((select count(*)=2 from public.round_messages
  where round_id in(select round_id from deletion_cases where target_key='rollback')
    and body='Die Runde wurde archiviert.')
  and not exists(select 1 from public.rounds where id in(select round_id from deletion_cases where target_key='rollback')
    and (status<>'archived' or orphaned_at is null))
  and not exists(select 1 from public.round_memberships
    where user_id=(select id from deletion_targets where key='rollback'))
  and not exists(select 1 from public.characters where owner_user_id=(select id from deletion_targets where key='rollback')
    and round_id is not null),
  'retry after late rollback archives both rounds without partial earlier messages');

-- Phase 3.3b3: real parallel transfer/send/assignment/deletion and Realtime tests
-- remain required; this single-transaction script proves no concurrent behavior.

-- Phase 3.3a2-2 remains a SEPARATE step after static review and staging application:
-- independent connections for recipient/other-player sends, duplicate assignments,
-- duplicate keep_copy, active selection, membership removal, GM transfer,
-- round lock/archive and prepare_user_deletion. No parallel harness in 3.3a2-1.

-- MANUAL / SEPARATE TEST: use independent connections in a controlled disposable
-- environment; this single-transaction script does not test concurrency.
-- 1. Two users send simultaneously into the same round: distinct ordered seqs.
-- 2. Same author + identical client_request_id/body concurrently: one stored row,
--    both successful calls return that row (also verify request-conflict cases).
-- 3. Hold the first sender's transaction open; verify the waiting sender after
--    COMMIT and separately after ROLLBACK, including an identical-request retry.
-- 4. Send concurrently with character selection changes, membership removal,
--    round locking and account deletion: check authorization and lock completion.
--    Include GM character sends against active-character changes and GM transfer.
-- 5. Actual account deletion + chat history: message/snapshot survives with a
--    NULL author. The catalog assertion above does not replace this integration
--    test. Account deletion is deliberately not performed by this script.
rollback;
