-- Prüft, ob der aktuell eingeloggte Nutzer Admin oder Superadmin ist.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and (
        role = 'admin'
        or is_superadmin = true
      )
  );
$$;


-- Prüft, ob der aktuelle Nutzer Mitglied einer bestimmten Runde ist.
create or replace function public.is_round_member(_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.round_memberships
    where round_id = _round_id
      and user_id = (select auth.uid())
  );
$$;


-- Prüft, ob der aktuelle Nutzer Spielleiter einer bestimmten Runde ist.
create or replace function public.is_round_game_master(_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.round_memberships
    where round_id = _round_id
      and user_id = (select auth.uid())
      and role = 'game_master'
  );
$$;


-- Die Funktionen sollen nur eingeloggte Nutzer aufrufen dürfen.
revoke all on function public.is_admin() from public;
revoke all on function public.is_round_member(uuid) from public;
revoke all on function public.is_round_game_master(uuid) from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_round_member(uuid) to authenticated;
grant execute on function public.is_round_game_master(uuid) to authenticated;