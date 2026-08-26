create or replace function public.create_round(
  p_name text,
  p_system text default null,
  p_description text default null,
  p_appointment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_round_id uuid;
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Round name is required';
  end if;

  insert into public.rounds (
    name,
    system,
    description,
    appointment
  )
  values (
    trim(p_name),
    nullif(trim(p_system), ''),
    p_description,
    p_appointment
  )
  returning id into new_round_id;

  insert into public.round_memberships (
    round_id,
    user_id,
    role
  )
  values (
    new_round_id,
    current_user_id,
    'game_master'
  );

  return new_round_id;
end;
$$;

revoke all
on function public.create_round(text, text, text, text)
from public;

grant execute
on function public.create_round(text, text, text, text)
to authenticated;