do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'round_messages'
  ) then
    alter publication supabase_realtime add table public.round_messages;
  end if;
end;
$$;
