-- Phase 3.3b1: NULL recipients also allow public system messages.
-- Only relax recipient presence; keep both message identities otherwise intact.
alter table public.round_messages
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
  );
