drop policy if exists "Game masters can delete rounds"
on public.rounds;

revoke delete on table public.rounds from authenticated;
revoke delete on table public.rounds from anon;
revoke delete on table public.rounds from public;
