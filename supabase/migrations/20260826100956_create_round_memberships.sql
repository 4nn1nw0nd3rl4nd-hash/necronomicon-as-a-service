create table public.round_memberships (
  id uuid primary key default gen_random_uuid(),

  round_id uuid not null
    references public.rounds(id)
    on delete cascade,

  user_id uuid not null
    references public.profiles(id)
    on delete restrict,

  role text not null default 'player'
    check (role in ('player', 'game_master')),

  created_at timestamptz not null default now(),

  unique (round_id, user_id)
);

create unique index round_memberships_one_game_master_per_round
  on public.round_memberships (round_id)
  where role = 'game_master';

alter table public.round_memberships enable row level security;