alter table public.round_memberships
add column active_character_id uuid;

alter table public.round_memberships
add constraint round_memberships_active_character_id_fkey
foreign key (active_character_id)
references public.characters (id)
on delete set null;


create function public.validate_round_membership_active_character()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active_character_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.characters
    where id = new.active_character_id
      and owner_user_id = new.user_id
      and round_id = new.round_id
      and deleted_at is null
  ) then
    raise exception 'Active character is not valid for this membership';
  end if;

  return new;
end;
$$;

revoke all
on function public.validate_round_membership_active_character()
from public;

revoke all
on function public.validate_round_membership_active_character()
from anon;

revoke all
on function public.validate_round_membership_active_character()
from authenticated;


create trigger validate_round_membership_active_character_before_write
before insert or update of active_character_id, round_id, user_id
on public.round_memberships
for each row
execute function public.validate_round_membership_active_character();


create function public.recalculate_active_character(
  p_round_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_id uuid;
  current_active_character_id uuid;
  valid_character_count bigint;
  valid_character_ids uuid[];
  calculated_active_character_id uuid;
begin
  select id, active_character_id
  into membership_id, current_active_character_id
  from public.round_memberships
  where round_id = p_round_id
    and user_id = p_user_id
  for update;

  if not found then
    return;
  end if;

  if current_active_character_id is not null
    and exists (
      select 1
      from public.characters
      where id = current_active_character_id
        and owner_user_id = p_user_id
        and round_id = p_round_id
        and deleted_at is null
    ) then
    return;
  end if;

  select pg_catalog.count(*), pg_catalog.array_agg(id)
  into valid_character_count, valid_character_ids
  from public.characters
  where owner_user_id = p_user_id
    and round_id = p_round_id
    and deleted_at is null;

  if valid_character_count = 1 then
    calculated_active_character_id := valid_character_ids[1];
  else
    calculated_active_character_id := null;
  end if;

  update public.round_memberships
  set active_character_id = calculated_active_character_id
  where id = membership_id
    and active_character_id is distinct from calculated_active_character_id;
end;
$$;

revoke all
on function public.recalculate_active_character(uuid, uuid)
from public;

revoke all
on function public.recalculate_active_character(uuid, uuid)
from anon;

revoke all
on function public.recalculate_active_character(uuid, uuid)
from authenticated;
