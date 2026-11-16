INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
  FROM public.roles AS role
  JOIN public.permissions AS permission
    ON permission.permission_key = 'system.manage'
 WHERE role.name = 'developer'
ON CONFLICT DO NOTHING;
