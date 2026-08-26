-- Alle angemeldeten Nutzer dürfen Profile sehen.
-- Das brauchen wir später z. B. für die Auswahl registrierter Nutzer
-- beim Hinzufügen zu einer Runde.
create policy "Authenticated users can view profiles"
on public.profiles
for select
to authenticated
using (true);

-- Ein Nutzer darf nur sein eigenes Profil verändern.
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Normale Nutzer dürfen nicht beliebige Profilfelder verändern.
revoke update on public.profiles from authenticated;

-- Vorerst darf ein Nutzer nur seinen Anzeigenamen selbst ändern.
grant update (display_name)
on public.profiles
to authenticated;