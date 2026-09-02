create extension if not exists pg_net
with schema extensions;


do $$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'character_purge_cron_secret'
  ) then
    raise exception 'Required Vault secret character_purge_cron_secret is missing';
  end if;

  if not exists (
    select 1
    from vault.secrets
    where name = 'project_url'
  ) then
    raise exception 'Required Vault secret project_url is missing';
  end if;
end;
$$;


select cron.schedule(
  'purge-expired-characters-daily',
  '0 3 * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'project_url'
      ) || '/functions/v1/purge-expired-characters',
      headers := pg_catalog.jsonb_build_object(
        'Content-Type',
        'application/json',
        'x-cron-secret',
        (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'character_purge_cron_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);


drop function public.purge_expired_characters();
