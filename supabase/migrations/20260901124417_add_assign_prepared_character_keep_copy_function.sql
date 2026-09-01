create function public.assign_prepared_character_keep_copy(
  p_character_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  copied_character_id uuid;
begin
  copied_character_id := public.copy_character(p_character_id);

  perform public.assign_prepared_character(p_character_id, p_user_id);

  return copied_character_id;
end;
$$;

revoke all
on function public.assign_prepared_character_keep_copy(uuid, uuid)
from public;

revoke all
on function public.assign_prepared_character_keep_copy(uuid, uuid)
from anon;

grant execute
on function public.assign_prepared_character_keep_copy(uuid, uuid)
to authenticated;
