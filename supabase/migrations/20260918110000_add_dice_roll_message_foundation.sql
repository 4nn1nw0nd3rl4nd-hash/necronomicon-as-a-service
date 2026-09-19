-- Phase 3.4a: schema and access rules only; no client dice producer yet.
alter table public.round_messages
  drop constraint round_messages_kind_check,
  add constraint round_messages_kind_check
    check (kind in ('character_message', 'system_message', 'dice_roll')),
  alter column body drop not null,
  add constraint round_messages_body_kind check (
    (kind = 'dice_roll' and body is null)
    or (kind in ('character_message', 'system_message') and body is not null)
  ),
  drop constraint round_messages_message_identity,
  add constraint round_messages_message_identity check (
    (
      kind = 'character_message'
      and recipient_user_id is null
      and speaker_kind in ('character', 'game_master')
    )
    or (
      kind = 'system_message'
      and speaker_kind = 'system'
      and author_user_id is null
      and speaker_name_snapshot = 'System'
    )
    or (
      kind = 'dice_roll'
      and recipient_user_id is null
      and speaker_kind in ('character', 'game_master')
    )
  );
-- Existing body length/nonblank checks accept NULL only in the dice branch.
-- Speaker kinds, GM identity, history FKs, parent RLS/grants remain unchanged.

create table public.round_message_dice_rolls (
  message_id uuid primary key
    references public.round_messages(id) on delete cascade,
  dice_count integer not null,
  dice_sides integer not null,
  modifier integer not null default 0,
  results integer[] not null,
  raw_total integer not null,
  total integer not null,
  constraint round_message_dice_rolls_count_range check (dice_count between 1 and 50),
  constraint round_message_dice_rolls_sides_range check (dice_sides between 2 and 1000),
  constraint round_message_dice_rolls_modifier_range check (modifier between -9999 and 9999),
  constraint round_message_dice_rolls_results_shape check ((
    cardinality(results) > 0
    and array_ndims(results) = 1
    and array_lower(results, 1) = 1
    and cardinality(results) = dice_count
    and array_length(results, 1) = dice_count
  ) is true),
  -- IS TRUE rejects UNKNOWN from NULL elements; do not sort the stored array.
  constraint round_message_dice_rolls_results_values check ((
    1 <= all(results) and dice_sides >= all(results)
  ) is true),
  constraint round_message_dice_rolls_raw_total_range
    check (raw_total between dice_count and dice_count * dice_sides),
  constraint round_message_dice_rolls_total
    check (total = raw_total + modifier)
);

alter table public.round_message_dice_rolls enable row level security;
-- Remove inherited default table grants before granting the sole client right.
revoke all on table public.round_message_dice_rolls from public, anon, authenticated;
grant select on table public.round_message_dice_rolls to authenticated;

create policy "Readers of dice messages can read dice details"
on public.round_message_dice_rolls for select to authenticated
using (
  exists (
    select 1 from public.round_messages as message
    where message.id = round_message_dice_rolls.message_id
      and message.kind = 'dice_roll'
  )
);
-- The invoker's parent RLS (including recipients) applies to this subquery.
-- No cross-table completeness/sum trigger and no Realtime changes.
