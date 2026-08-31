create function public.set_character_check(
  p_character_id uuid,
  p_field_key text,
  p_checked boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  normalized_field_key text;
  updated_row_count integer;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  normalized_field_key := pg_catalog.btrim(p_field_key);

  if normalized_field_key is null
    or pg_catalog.char_length(normalized_field_key) = 0 then
    raise exception 'Character field key is required';
  end if;

  if pg_catalog.char_length(normalized_field_key) > 100 then
    raise exception 'Character field key must not exceed 100 characters';
  end if;

  if p_checked is null then
    raise exception 'Character check value is required';
  end if;

  update public.characters
  set data = pg_catalog.jsonb_set(
    data,
    array[normalized_field_key],
    pg_catalog.to_jsonb(p_checked),
    true
  )
  where id = p_character_id
    and deleted_at is null
    and (
      owner_user_id = current_user_id
      or (
        round_id is not null
        and public.is_round_game_master(round_id)
      )
    );

  get diagnostics updated_row_count = row_count;

  if updated_row_count = 0 then
    raise exception 'Character is not available';
  end if;
end;
$$;

revoke all
on function public.set_character_check(uuid, text, boolean)
from public;

revoke all
on function public.set_character_check(uuid, text, boolean)
from anon;

grant execute
on function public.set_character_check(uuid, text, boolean)
to authenticated;
