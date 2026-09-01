create extension if not exists pg_cron;

select cron.schedule(
  'purge-expired-characters-daily',
  '0 3 * * *',
  'select public.purge_expired_characters();'
);
