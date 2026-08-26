create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text,
  role text not null default 'user'
    check (role in ('user', 'admin')),
  is_superadmin boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index profiles_username_unique_ci
  on public.profiles (lower(username));

alter table public.profiles enable row level security;