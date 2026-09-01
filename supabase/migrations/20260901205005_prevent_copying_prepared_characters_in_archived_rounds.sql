create or replace function public.copy_character(
  p_character_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  original_name text;
  original_owner_id uuid;
  original_round_id uuid;
  original_template_key text;
  original_template_version integer;
  original_data jsonb;
  copy_owner_id uuid;
  copy_round_id uuid;
  copy_name text;
  copy_suffix constant text := ' – Kopie';
  new_character_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select
    name,
    owner_user_id,
    round_id,
    template_key,
    template_version,
    data
  into
    original_name,
    original_owner_id,
    original_round_id,
    original_template_key,
    original_template_version,
    original_data
  from public.characters
  where id = p_character_id
    and deleted_at is null
  for share;

  if not found then
    raise exception 'Character is not available';
  end if;

  if original_owner_id is not distinct from current_user_id then
    copy_owner_id := current_user_id;
    copy_round_id := null;
  elsif original_owner_id is null
    and original_round_id is not null
    and public.is_round_game_master(original_round_id) then
    if exists (
      select 1
      from public.rounds
      where id = original_round_id
        and status = 'archived'
    ) then
      raise exception 'Cannot copy prepared character in archived round';
    end if;

    copy_owner_id := null;
    copy_round_id := original_round_id;
  else
    raise exception 'Character is not available';
  end if;

  copy_name := pg_catalog.left(
    original_name,
    100 - pg_catalog.char_length(copy_suffix)
  ) || copy_suffix;

  insert into public.characters (
    name,
    owner_user_id,
    round_id,
    template_key,
    template_version,
    data,
    created_by_user_id,
    deleted_at
  )
  values (
    copy_name,
    copy_owner_id,
    copy_round_id,
    original_template_key,
    original_template_version,
    original_data,
    current_user_id,
    null
  )
  returning id into new_character_id;

  return new_character_id;
end;
$$;

revoke all
on function public.copy_character(uuid)
from public;

revoke all
on function public.copy_character(uuid)
from anon;

grant execute
on function public.copy_character(uuid)
to authenticated;
