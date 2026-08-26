create table public.rounds (
  id uuid primary key default gen_random_uuid(),

  name text not null,

  system text,
  description text,
  appointment text,

  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),

  created_at timestamptz not null default now()
);

alter table public.rounds enable row level security;