-- Restricted candidate search; existing profile policies and add RPC stay unchanged.
create or replace function public.search_round_player_candidates(
  p_round_id uuid,
  p_prefix text
)
returns table (id uuid, username text, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  prefix text := pg_catalog.lower(pg_catalog.btrim(p_prefix));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_round_game_master(p_round_id) then
    raise exception 'Not authorized';
  end if;
  if prefix is null or prefix = '' then
    return;
  end if;

  return query
  select p.id, p.username, p.display_name
  from public.profiles p
  where pg_catalog.starts_with(pg_catalog.lower(p.username), prefix)
    and not exists (
      select 1 from public.round_memberships m
      where m.round_id = p_round_id and m.user_id = p.id
    )
  order by pg_catalog.lower(p.username), p.username, p.id
  limit 10;
end;
$$;

revoke all on function public.search_round_player_candidates(uuid, text) from public;
grant execute on function public.search_round_player_candidates(uuid, text) to authenticated;
