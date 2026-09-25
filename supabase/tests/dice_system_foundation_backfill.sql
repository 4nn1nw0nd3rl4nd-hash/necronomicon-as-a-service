-- LOCAL migration dry-run / backfill integration, psql -X -v ON_ERROR_STOP=1.
-- Requires an isolated database migrated THROUGH 20260919100000, BEFORE 3.5f1.
-- Runs the actual new migration inside this transaction, then rolls everything back.
begin;
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='rounds' and column_name='dice_system') then
    raise exception 'Run on the pre-3.5f1 schema; do not drop columns to run this test';
  end if;
end $$;
create temporary table backfill_ids as select gen_random_uuid() as actor,
  gen_random_uuid() as round_id,gen_random_uuid() as message_id;
insert into auth.users(id,raw_user_meta_data)
select actor,jsonb_build_object('username','dsbackfill_'||actor::text) from backfill_ids;
insert into public.rounds(id,name) select round_id,'Existing round' from backfill_ids;
insert into public.round_messages(id,round_id,round_seq,author_user_id,character_id,
  speaker_kind,speaker_name_snapshot,kind,body,client_request_id)
select message_id,round_id,1,actor,null,'game_master','Spielleitung','dice_roll',null,gen_random_uuid()
from backfill_ids;
insert into public.round_message_dice_rolls(message_id,dice_count,dice_sides,modifier,results,raw_total,total)
select message_id,3,6,2,array[2,6,4],12,14 from backfill_ids;
create temporary table before_backfill as
select to_jsonb(r) as round_row,to_jsonb(m) as message_row,to_jsonb(d) as detail_row
from backfill_ids b join public.rounds r on r.id=b.round_id
join public.round_messages m on m.id=b.message_id
join public.round_message_dice_rolls d on d.message_id=m.id;

\ir ../migrations/20260925100000_add_dice_system_foundation.sql

do $$ begin
  if not exists(
    select 1 from backfill_ids b join public.rounds r on r.id=b.round_id
    join public.round_messages m on m.id=b.message_id
    join public.round_message_dice_rolls d on d.message_id=m.id cross join before_backfill old
    where r.dice_system='generic' and d.dice_system='generic'
      and to_jsonb(r)-'dice_system'=old.round_row and to_jsonb(m)=old.message_row
      and to_jsonb(d)-'dice_system'=old.detail_row
  ) then raise exception 'Backfill must preserve all prior round/message/detail values'; end if;
end $$;
rollback;
