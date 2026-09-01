create function public.recalculate_active_character_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.owner_user_id is not null and new.round_id is not null then
      perform public.recalculate_active_character(
        new.round_id,
        new.owner_user_id
      );
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.owner_user_id is not null and old.round_id is not null then
      perform public.recalculate_active_character(
        old.round_id,
        old.owner_user_id
      );
    end if;

    return old;
  end if;

  if old.owner_user_id is not null and old.round_id is not null then
    perform public.recalculate_active_character(
      old.round_id,
      old.owner_user_id
    );
  end if;

  if new.owner_user_id is not null
    and new.round_id is not null
    and (
      old.owner_user_id is distinct from new.owner_user_id
      or old.round_id is distinct from new.round_id
    ) then
    perform public.recalculate_active_character(
      new.round_id,
      new.owner_user_id
    );
  end if;

  return new;
end;
$$;

revoke all
on function public.recalculate_active_character_after_change()
from public;

revoke all
on function public.recalculate_active_character_after_change()
from anon;

revoke all
on function public.recalculate_active_character_after_change()
from authenticated;


create trigger recalculate_active_character_after_character_change
after insert or delete or update of owner_user_id, round_id, deleted_at
on public.characters
for each row
execute function public.recalculate_active_character_after_change();


do $$
declare
  membership record;
begin
  for membership in
    select round_id, user_id
    from public.round_memberships
  loop
    perform public.recalculate_active_character(
      membership.round_id,
      membership.user_id
    );
  end loop;
end;
$$;
