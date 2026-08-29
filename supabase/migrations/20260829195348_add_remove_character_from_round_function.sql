create function public.remove_character_from_round(
  p_character_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  character_round_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select round_id
  into character_round_id
  from public.characters
  where id = p_character_id
    and owner_user_id = current_user_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Character is not available';
  end if;

  if character_round_id is null then
    raise exception 'Character is not assigned to a round';
  end if;

  update public.characters
  set round_id = null
  where id = p_character_id;
end;
$$;

revoke all
on function public.remove_character_from_round(uuid)
from public;

revoke all
on function public.remove_character_from_round(uuid)
from anon;

grant execute
on function public.remove_character_from_round(uuid)
to authenticated;
