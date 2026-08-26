create or replace function public.promote_user_to_admin(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if auth.uid() = p_user_id then
    raise exception 'You cannot change your own admin role';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
  ) then
    raise exception 'User does not exist';
  end if;

  if exists (
    select 1
    from public.profiles
    where id = p_user_id
      and is_superadmin = true
  ) then
    raise exception 'Superadmin cannot be modified';
  end if;

  if exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role = 'admin'
  ) then
    raise exception 'User is already admin';
  end if;

  update public.profiles
  set role = 'admin'
  where id = p_user_id;
end;
$$;

revoke all
on function public.promote_user_to_admin(uuid)
from public;

grant execute
on function public.promote_user_to_admin(uuid)
to authenticated;