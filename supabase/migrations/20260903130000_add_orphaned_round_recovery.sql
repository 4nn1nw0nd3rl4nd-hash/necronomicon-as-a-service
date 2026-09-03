alter table public.rounds
add column orphaned_at timestamptz;


update public.rounds as round_to_orphan
set
  status = 'archived',
  orphaned_at = pg_catalog.now()
where not exists (
  select 1
  from public.round_memberships as membership
  where membership.round_id = round_to_orphan.id
    and membership.role = 'game_master'
);


alter table public.rounds
add constraint rounds_orphaned_only_while_archived
check (
  orphaned_at is null
  or status = 'archived'
);


alter table public.profiles
add column deletion_pending_at timestamptz;


create or replace function public.prepare_user_deletion(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_is_superadmin boolean;
  gm_membership record;
  gm_round_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if auth.uid() = p_user_id then
    raise exception 'You cannot delete your own account';
  end if;

  select is_superadmin
  into target_is_superadmin
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User does not exist';
  end if;

  if target_is_superadmin then
    raise exception 'Superadmin cannot be deleted';
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


create function public.recover_orphaned_round(
  p_round_id uuid,
  p_new_game_master_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := auth.uid();
  target_is_superadmin boolean;
  target_deletion_pending_at timestamptz;
  current_status text;
  current_orphaned_at timestamptz;
  target_membership_role text;
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

  select is_superadmin, deletion_pending_at
  into target_is_superadmin, target_deletion_pending_at
  from public.profiles
  where id = p_new_game_master_user_id
  for update;

  if not found then
    raise exception 'New game master does not exist';
  end if;

  if p_new_game_master_user_id = caller_user_id then
    raise exception 'Superadmin cannot become game master';
  end if;

  if target_is_superadmin then
    raise exception 'A superadmin cannot become game master';
  end if;

  if target_deletion_pending_at is not null then
    raise exception 'New game master is pending deletion';
  end if;

  select status, orphaned_at
  into current_status, current_orphaned_at
  from public.rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'Round does not exist';
  end if;

  if current_orphaned_at is null then
    raise exception 'Round is not orphaned';
  end if;

  if current_status <> 'archived' then
    raise exception 'Orphaned round is not archived';
  end if;

  if exists (
    select 1
    from public.round_memberships
    where round_id = p_round_id
      and role = 'game_master'
  ) then
    raise exception 'Round already has a game master';
  end if;

  select role
  into target_membership_role
  from public.round_memberships
  where round_id = p_round_id
    and user_id = p_new_game_master_user_id
  for update;

  if found then
    if target_membership_role <> 'player' then
      raise exception 'Existing membership is not a player membership';
    end if;

    update public.round_memberships
    set role = 'game_master'
    where round_id = p_round_id
      and user_id = p_new_game_master_user_id;
  else
    insert into public.round_memberships (
      round_id,
      user_id,
      role,
      active_character_id
    )
    values (
      p_round_id,
      p_new_game_master_user_id,
      'game_master',
      null
    );
  end if;

  update public.rounds
  set orphaned_at = null
  where id = p_round_id;
end;
$$;

revoke all
on function public.recover_orphaned_round(uuid, uuid)
from public;

revoke all
on function public.recover_orphaned_round(uuid, uuid)
from anon;

grant execute
on function public.recover_orphaned_round(uuid, uuid)
to authenticated;


create or replace function public.set_round_archived(
  p_round_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  current_orphaned_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_archived is null then
    raise exception 'Archived state is required';
  end if;

  select status, orphaned_at
  into current_status, current_orphaned_at
  from public.rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'Round does not exist';
  end if;

  if not (
    public.is_round_game_master(p_round_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized';
  end if;

  if p_archived then
    if current_status = 'archived' then
      return;
    end if;

    update public.rounds
    set status = 'archived'
    where id = p_round_id;

    return;
  end if;

  if current_orphaned_at is not null then
    raise exception 'Round must be recovered before it can leave the archive';
  end if;

  if current_status <> 'archived' then
    raise exception 'Round is not archived';
  end if;

  update public.rounds
  set status = 'paused'
  where id = p_round_id;
end;
$$;

revoke all
on function public.set_round_archived(uuid, boolean)
from public;

grant execute
on function public.set_round_archived(uuid, boolean)
to authenticated;
