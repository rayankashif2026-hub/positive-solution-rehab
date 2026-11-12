CREATE FUNCTION public.current_user_permissions()
RETURNS TABLE (permission_key text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT permission.permission_key
    FROM public.user_roles AS user_role
    JOIN public.role_permissions AS role_permission
      ON role_permission.role_id = user_role.role_id
    JOIN public.permissions AS permission
      ON permission.id = role_permission.permission_id
    JOIN public.profiles AS profile
      ON profile.id = user_role.user_id
   WHERE user_role.user_id = auth.uid()
     AND profile.account_status = 'active'
  UNION
  SELECT permission.permission_key
    FROM public.user_permissions AS user_permission
    JOIN public.permissions AS permission
      ON permission.id = user_permission.permission_id
    JOIN public.profiles AS profile
      ON profile.id = user_permission.user_id
   WHERE user_permission.user_id = auth.uid()
     AND user_permission.revoked_at IS NULL
     AND profile.account_status = 'active';
$$;

REVOKE ALL ON FUNCTION public.current_user_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_permissions() TO authenticated;
