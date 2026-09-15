-- Run only after the Phase 3.1, Phase 3.2b and Phase 3.3a1 migrations
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
  ('private_round'), ('private_character'), ('private_message'), ('private_gm_message');
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

-- H/I/J/K: each candidate otherwise has valid fields, unique IDs and a valid FK.
-- Check failures must be CHECK violations, not access/NOT NULL/FK/uniqueness errors.
do $$
declare
  candidate record;
begin
  for candidate in select * from (values
    ('public system forbidden','system_message','system','System',null::uuid,null::uuid,null::uuid),
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
