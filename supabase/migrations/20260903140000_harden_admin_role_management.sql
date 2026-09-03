create or replace function public.promote_user_to_admin(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  target_role text;
  target_is_superadmin boolean;
  target_deletion_pending_at timestamptz;
begin
  if caller_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = caller_user_id
      and is_superadmin = true
  ) then
    raise exception 'Not authorized';
  end if;

  if caller_user_id = p_user_id then
    raise exception 'You cannot change your own admin role';
  end if;

  select role, is_superadmin, deletion_pending_at
  into target_role, target_is_superadmin, target_deletion_pending_at
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User does not exist';
  end if;

  if target_is_superadmin then
    raise exception 'Superadmin cannot be modified';
  end if;

  if target_deletion_pending_at is not null then
    raise exception 'User is pending deletion';
  end if;

  if target_role <> 'user' then
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


create or replace function public.demote_admin_to_user(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  target_role text;
  target_is_superadmin boolean;
  target_deletion_pending_at timestamptz;
begin
  if caller_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = caller_user_id
      and is_superadmin = true
  ) then
    raise exception 'Not authorized';
  end if;

  if caller_user_id = p_user_id then
    raise exception 'You cannot change your own admin role';
  end if;

  select role, is_superadmin, deletion_pending_at
  into target_role, target_is_superadmin, target_deletion_pending_at
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User does not exist';
  end if;

  if target_is_superadmin then
    raise exception 'Superadmin cannot be modified';
  end if;

  if target_deletion_pending_at is not null then
    raise exception 'Admin is pending deletion';
  end if;

  if target_role <> 'admin' then
    raise exception 'User is not admin';
  end if;

  update public.profiles
  set role = 'user'
  where id = p_user_id;
end;
$$;

revoke all
on function public.demote_admin_to_user(uuid)
from public;

grant execute
on function public.demote_admin_to_user(uuid)
to authenticated;


create or replace function public.prepare_user_deletion(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  caller_role text;
  caller_is_superadmin boolean;
  target_role text;
  target_is_superadmin boolean;
  gm_membership record;
  gm_round_ids uuid[] := array[]::uuid[];
begin
  if caller_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select role, is_superadmin
  into caller_role, caller_is_superadmin
  from public.profiles
  where id = caller_user_id
  for share;

  if not found then
    raise exception 'Not authorized';
  end if;

  if not caller_is_superadmin and caller_role <> 'admin' then
    raise exception 'Not authorized';
  end if;

  if caller_user_id = p_user_id then
    raise exception 'You cannot delete your own account';
  end if;

  select role, is_superadmin
  into target_role, target_is_superadmin
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User does not exist';
  end if;

  if target_is_superadmin then
    raise exception 'Superadmin cannot be deleted';
  end if;

  if caller_is_superadmin then
    if target_role not in ('user', 'admin') then
      raise exception 'Target user cannot be deleted';
    end if;
  elsif caller_role = 'admin' then
    if target_role <> 'user' then
      raise exception 'Admins can only delete users';
    end if;
  end if;

  update public.profiles
  set deletion_pending_at = coalesce(
    deletion_pending_at,
    pg_catalog.now()
  )
  where id = p_user_id;

  for gm_membership in
    select membership.id, membership.round_id
    from public.round_memberships as membership
    join public.rounds as round_to_lock
      on round_to_lock.id = membership.round_id
    where membership.user_id = p_user_id
      and membership.role = 'game_master'
    order by membership.round_id
    for update of round_to_lock, membership
  loop
    gm_round_ids := pg_catalog.array_append(
      gm_round_ids,
      gm_membership.round_id
    );
  end loop;

  update public.characters
  set round_id = null
  where owner_user_id = p_user_id
    and round_id is not null;

  update public.rounds
  set
    status = 'archived',
    orphaned_at = pg_catalog.now()
  where id = any(gm_round_ids);

  delete from public.round_memberships
  where user_id = p_user_id;
end;
$$;

revoke all
on function public.prepare_user_deletion(uuid)
from public;

grant execute
on function public.prepare_user_deletion(uuid)
to authenticated;
