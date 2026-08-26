-- Ein Superadmin muss immer auch Admin sein.
alter table public.profiles
add constraint profiles_superadmin_must_be_admin
check (
  is_superadmin = false
  or role = 'admin'
);


-- Es darf höchstens einen Superadmin geben.
create unique index profiles_only_one_superadmin
on public.profiles (is_superadmin)
where is_superadmin = true;


-- Bestehender Superadmin darf weder herabgestuft
-- noch seines Superadmin-Status beraubt werden.
create or replace function public.protect_superadmin_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_superadmin = true then
    if new.is_superadmin = false then
      raise exception 'Superadmin status cannot be removed';
    end if;

    if new.role <> 'admin' then
      raise exception 'Superadmin must remain admin';
    end if;
  end if;

  return new;
end;
$$;


create trigger protect_superadmin_before_update
before update on public.profiles
for each row
execute function public.protect_superadmin_update();


-- Superadmin darf nicht gelöscht werden.
create or replace function public.prevent_superadmin_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_superadmin = true then
    raise exception 'Superadmin cannot be deleted';
  end if;

  return old;
end;
$$;


create trigger prevent_superadmin_before_delete
before delete on public.profiles
for each row
execute function public.prevent_superadmin_delete();