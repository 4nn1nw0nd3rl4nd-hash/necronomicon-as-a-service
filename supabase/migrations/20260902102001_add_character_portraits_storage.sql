insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'character-portraits',
  'character-portraits',
  false,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


create policy "Character portrait readers can select"
on storage.objects
for select
to authenticated
using (
  storage.objects.bucket_id = 'character-portraits'
  and storage.objects.name ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/portrait$'
  and exists (
    select 1
    from public.characters as c
    where c.id::text = pg_catalog.lower(
        pg_catalog.split_part(storage.objects.name, '/', 1)
      )
      and (
        c.owner_user_id = (select auth.uid())
        or (
          c.round_id is not null
          and public.is_round_game_master(c.round_id)
        )
      )
  )
);


create policy "Character portrait editors can insert"
on storage.objects
for insert
to authenticated
with check (
  storage.objects.bucket_id = 'character-portraits'
  and storage.objects.name ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/portrait$'
  and exists (
    select 1
    from public.characters as c
    where c.id::text = pg_catalog.lower(
        pg_catalog.split_part(storage.objects.name, '/', 1)
      )
      and c.deleted_at is null
      and (
        c.owner_user_id = (select auth.uid())
        or (
          c.round_id is not null
          and public.is_round_game_master(c.round_id)
        )
      )
  )
);


create policy "Character portrait editors can update"
on storage.objects
for update
to authenticated
using (
  storage.objects.bucket_id = 'character-portraits'
  and storage.objects.name ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/portrait$'
  and exists (
    select 1
    from public.characters as c
    where c.id::text = pg_catalog.lower(
        pg_catalog.split_part(storage.objects.name, '/', 1)
      )
      and c.deleted_at is null
      and (
        c.owner_user_id = (select auth.uid())
        or (
          c.round_id is not null
          and public.is_round_game_master(c.round_id)
        )
      )
  )
)
with check (
  storage.objects.bucket_id = 'character-portraits'
  and storage.objects.name ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/portrait$'
  and exists (
    select 1
    from public.characters as c
    where c.id::text = pg_catalog.lower(
        pg_catalog.split_part(storage.objects.name, '/', 1)
      )
      and c.deleted_at is null
      and (
        c.owner_user_id = (select auth.uid())
        or (
          c.round_id is not null
          and public.is_round_game_master(c.round_id)
        )
      )
  )
);


create policy "Character portrait editors can delete"
on storage.objects
for delete
to authenticated
using (
  storage.objects.bucket_id = 'character-portraits'
  and storage.objects.name ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/portrait$'
  and exists (
    select 1
    from public.characters as c
    where c.id::text = pg_catalog.lower(
        pg_catalog.split_part(storage.objects.name, '/', 1)
      )
      and c.deleted_at is null
      and (
        c.owner_user_id = (select auth.uid())
        or (
          c.round_id is not null
          and public.is_round_game_master(c.round_id)
        )
      )
  )
);
