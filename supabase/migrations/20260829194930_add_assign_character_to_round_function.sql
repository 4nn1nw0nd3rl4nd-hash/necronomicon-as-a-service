create function public.assign_character_to_round(
  p_character_id uuid,
  p_round_id uuid
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

  if character_round_id is not null then
    raise exception 'Character is already assigned to a round';
  end if;

  if p_round_id is null
    or not public.is_round_member(p_round_id) then
    raise exception 'You must be a member of the target round';
  end if;

  update public.characters
  set round_id = p_round_id
  where id = p_character_id;
end;
$$;

revoke all
on function public.assign_character_to_round(uuid, uuid)
from public;

revoke all
on function public.assign_character_to_round(uuid, uuid)
from anon;

grant execute
on function public.assign_character_to_round(uuid, uuid)
to authenticated;
