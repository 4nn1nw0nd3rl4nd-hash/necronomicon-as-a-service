create table public.character_template_versions (
  template_key text not null,
  template_version integer not null,
  is_available_for_creation boolean not null default true,
  created_at timestamptz not null default now(),

  primary key (template_key, template_version),

  constraint character_template_versions_key_trimmed
    check (template_key = btrim(template_key)),

  constraint character_template_versions_key_not_blank
    check (char_length(template_key) > 0),

  constraint character_template_versions_version_positive
    check (template_version > 0)
);


insert into public.character_template_versions (
  template_key,
  template_version,
  is_available_for_creation
)
values ('vaesen', 1, true);


alter table public.characters
add constraint characters_template_version_fk
foreign key (template_key, template_version)
references public.character_template_versions (template_key, template_version)
on update restrict
on delete restrict;


alter table public.character_template_versions enable row level security;

revoke all on table public.character_template_versions from public;
revoke all on table public.character_template_versions from anon;
revoke all on table public.character_template_versions from authenticated;
