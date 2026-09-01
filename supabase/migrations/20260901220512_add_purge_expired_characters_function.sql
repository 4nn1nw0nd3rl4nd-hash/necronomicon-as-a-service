create function public.purge_expired_characters()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged_character_count integer;
begin
  delete from public.characters
  where deleted_at is not null
    and deleted_at < pg_catalog.now() - interval '14 days';

  get diagnostics purged_character_count = row_count;

  return purged_character_count;
end;
$$;

revoke all
on function public.purge_expired_characters()
from public;

revoke all
on function public.purge_expired_characters()
from anon;

revoke all
on function public.purge_expired_characters()
from authenticated;
