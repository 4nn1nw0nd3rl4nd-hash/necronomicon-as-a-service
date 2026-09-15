-- Phase 3.3a1: schema/RLS only. Assignment RPCs do not emit messages yet.
-- Existing rows receive NULL recipients and retain their public chat semantics.
alter table public.round_messages
  add column recipient_user_id uuid
    constraint round_messages_recipient_user_id_fkey
    references public.profiles(id) on delete cascade,
  -- These names come from the inline column CHECKs in the Phase 3.1 CREATE TABLE.
  drop constraint round_messages_kind_check,
  drop constraint round_messages_speaker_kind_check,
  add constraint round_messages_kind_check
    check (kind in ('character_message', 'system_message')),
  add constraint round_messages_speaker_kind_check
    check (speaker_kind in ('character', 'game_master', 'system')),
  add constraint round_messages_message_identity check (
    (
      kind = 'character_message'
      and recipient_user_id is null
      and speaker_kind in ('character', 'game_master')
    )
    or (
      kind = 'system_message'
      and speaker_kind = 'system'
      and recipient_user_id is not null
      and author_user_id is null
      and speaker_name_snapshot = 'System'
    )
  );

-- Keep round_messages_gm_identity and the existing author/character SET NULL
-- FKs unchanged. In particular, deleting a character must preserve its history.
-- Alter the existing policy: another permissive SELECT policy would widen access.
alter policy "Current members can read round chat"
on public.round_messages
using (
  public.can_read_round_messages(round_id)
  and (recipient_user_id is null or recipient_user_id = (select auth.uid()))
);
