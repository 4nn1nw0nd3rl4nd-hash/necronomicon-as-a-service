-- Bestehende leere Anzeigenamen reparieren.
-- Falls display_name NULL oder nur Leerzeichen ist,
-- wird vorübergehend der username als Anzeigename verwendet.
update public.profiles
set display_name = username
where display_name is null
   or btrim(display_name) = '';


-- display_name darf nicht mehr NULL sein.
alter table public.profiles
alter column display_name set not null;


-- display_name darf auch nicht nur aus Leerzeichen bestehen.
alter table public.profiles
add constraint profiles_display_name_not_blank
check (btrim(display_name) <> '');


-- Profilerstellung beim Signup robust halten:
-- Falls aus irgendeinem Grund kein Anzeigename geliefert wird,
-- wird der username als Fallback verwendet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    username,
    display_name
  )
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    coalesce(
      nullif(
        btrim(new.raw_user_meta_data ->> 'display_name'),
        ''
      ),
      new.raw_user_meta_data ->> 'username'
    )
  );

  return new;
end;
$$;