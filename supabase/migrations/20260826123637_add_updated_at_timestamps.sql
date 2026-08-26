alter table public.profiles
add column updated_at timestamptz not null default now();

alter table public.rounds
add column updated_at timestamptz not null default now();


create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();


create trigger set_rounds_updated_at
before update on public.rounds
for each row
execute function public.set_updated_at();