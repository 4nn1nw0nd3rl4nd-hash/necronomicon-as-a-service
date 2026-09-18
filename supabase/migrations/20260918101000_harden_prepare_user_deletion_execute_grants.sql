-- PUBLIC revocation does not remove a separately granted anon privilege.
REVOKE ALL ON FUNCTION public.prepare_user_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_user_deletion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.prepare_user_deletion(uuid) TO authenticated;
