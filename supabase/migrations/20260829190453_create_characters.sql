create table public.characters (
  id uuid primary key default gen_random_uuid(),

  name text not null,

  owner_user_id uuid
    references public.profiles(id)
    on delete cascade,

  round_id uuid
    references public.rounds(id)
    on delete restrict,

  template_key text not null,
  template_version integer not null,

  data jsonb not null default '{}'::jsonb,

  created_by_user_id uuid
    references public.profiles(id)
    on delete set null,

  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint characters_name_trimmed
    check (name = btrim(name)),

  constraint characters_name_length
    check (char_length(name) between 1 and 100),

  constraint characters_template_key_not_blank
    check (
      template_key = btrim(template_key)
      and char_length(template_key) > 0
    ),

  constraint characters_template_version_positive
    check (template_version > 0),

  constraint characters_data_is_object
    check (jsonb_typeof(data) = 'object'),

  constraint characters_owner_or_round_required
    check (
      owner_user_id is not null
      or round_id is not null
    ),

  constraint characters_owner_round_membership_fk
    foreign key (round_id, owner_user_id)
    references public.round_memberships (round_id, user_id)
    on delete set null (round_id)
);


create index characters_owner_user_id_idx
on public.characters (owner_user_id);

create index characters_round_id_idx
on public.characters (round_id);

create index characters_created_by_user_id_idx
on public.characters (created_by_user_id);

create index characters_deleted_at_idx
on public.characters (deleted_at)
where deleted_at is not null;


create function public.protect_character_immutable_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.template_key is distinct from old.template_key then
    raise exception 'Character template key cannot be changed';
  end if;

  if new.template_version is distinct from old.template_version then
    raise exception 'Character template version cannot be changed';
  end if;

  if new.created_by_user_id is distinct from old.created_by_user_id then
    if not (
      old.created_by_user_id is not null
      and new.created_by_user_id is null
      and not exists (
        select 1
        from public.profiles
        where id = old.created_by_user_id
      )
    ) then
      raise exception 'Character creator cannot be changed';
    end if;
  end if;

  if old.owner_user_id is not null
    and new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'Character owner cannot be changed';
  end if;

  return new;
end;
$$;


create trigger protect_character_immutable_fields_before_update
before update on public.characters
for each row
execute function public.protect_character_immutable_fields();

create trigger set_characters_updated_at
before update on public.characters
for each row
execute function public.set_updated_at();


alter table public.characters enable row level security;

revoke all on table public.characters from public;
revoke all on table public.characters from anon;
revoke all on table public.characters from authenticated;
