create or replace function public.prepare_user_deletion(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  superadmin_id uuid;
  gm_membership record;
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

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
  ) then
    raise exception 'User does not exist';
  end if;

  select id
  into superadmin_id
  from public.profiles
  where is_superadmin = true;

  if superadmin_id is null then
    raise exception 'Superadmin does not exist';
  end if;

  if p_user_id = superadmin_id then
    raise exception 'Superadmin cannot be deleted';
  end if;

  update public.characters
  set round_id = null
  where owner_user_id = p_user_id
    and round_id is not null;

  -- Alle Runden, in denen der Nutzer Spielleiter ist,
  -- werden an den Superadmin übertragen.
  for gm_membership in
    select id, round_id
    from public.round_memberships
    where user_id = p_user_id
      and role = 'game_master'
    for update
  loop

    -- Falls der Superadmin bereits normaler Spieler
    -- dieser Runde ist, wird diese Membership zuerst entfernt.
    delete from public.round_memberships
    where round_id = gm_membership.round_id
      and user_id = superadmin_id
      and role = 'player';

    -- Die bestehende GM-Membership wird direkt
    -- auf den Superadmin übertragen.
    update public.round_memberships
    set user_id = superadmin_id
    where id = gm_membership.id;

  end loop;

  -- Alle übrigen normalen Spieler-Memberships
  -- des zu löschenden Nutzers entfernen.
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
