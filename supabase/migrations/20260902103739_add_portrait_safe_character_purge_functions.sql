create function public.get_expired_character_ids_for_purge()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.characters
  where deleted_at is not null
    and deleted_at < pg_catalog.now() - interval '14 days';
$$;

revoke all
on function public.get_expired_character_ids_for_purge()
from public;

revoke all
on function public.get_expired_character_ids_for_purge()
from anon;

revoke all
on function public.get_expired_character_ids_for_purge()
from authenticated;

grant execute
on function public.get_expired_character_ids_for_purge()
to service_role;


create function public.purge_expired_character(
  p_character_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  character_deleted_at timestamptz;
begin
  select deleted_at
  into character_deleted_at
  from public.characters
  where id = p_character_id
  for update;

  if not found then
    return false;
  end if;

  if character_deleted_at is null then
    return false;
  end if;

  if not (
    character_deleted_at < pg_catalog.now() - interval '14 days'
  ) then
    return false;
  end if;

  delete from public.characters
  where id = p_character_id;

  return true;
end;
$$;

revoke all
on function public.purge_expired_character(uuid)
from public;

revoke all
on function public.purge_expired_character(uuid)
from anon;

revoke all
on function public.purge_expired_character(uuid)
from authenticated;

grant execute
on function public.purge_expired_character(uuid)
to service_role;
