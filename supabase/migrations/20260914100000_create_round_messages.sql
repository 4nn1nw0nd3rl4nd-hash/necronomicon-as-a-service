-- Phase 3.1: immutable, public IC history. No account/character cascade deletes.
create table public.round_messages (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete restrict,
  round_seq bigint not null,
  author_user_id uuid references public.profiles(id) on delete set null,
  character_id uuid references public.characters(id) on delete set null,
  speaker_kind text not null check (speaker_kind in ('character', 'game_master')),
  speaker_name_snapshot text not null,
  kind text not null default 'character_message' check (kind = 'character_message'),
  body text not null,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  -- Keep PostgREST JSON numbers exact in JavaScript, even at the type boundary.
  constraint round_messages_seq_range check (round_seq between 1 and 9007199254740991),
  constraint round_messages_round_seq_key unique (round_id, round_seq),
  constraint round_messages_request_key unique (author_user_id, client_request_id),
  constraint round_messages_speaker_name_length check (char_length(speaker_name_snapshot) between 1 and 100),
  -- character_id may become NULL after physical character deletion.
  constraint round_messages_gm_identity check (
    speaker_kind <> 'game_master'
    or (character_id is null and speaker_name_snapshot = 'Spielleitung')
  ),
  constraint round_messages_body_length check (char_length(body) between 1 and 4000),
  -- Same whitespace set as ECMAScript String.trim(); preserve the actual body.
  constraint round_messages_body_not_blank check (
    pg_catalog.btrim(body, E' \t\n\r\f' || pg_catalog.chr(11) ||
      U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> ''
  )
);

-- The unique (round_id, round_seq) index also serves both cursor directions.
create index round_messages_character_id_idx on public.round_messages (character_id)
where character_id is not null;

alter table public.round_messages enable row level security;
revoke all on table public.round_messages from public, anon, authenticated;
