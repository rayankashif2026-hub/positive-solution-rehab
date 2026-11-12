BEGIN;

DELETE FROM public.role_permissions AS role_permission
 USING public.roles AS role,
       public.permissions AS permission
 WHERE role_permission.role_id = role.id
   AND role_permission.permission_id = permission.id
   AND role.name = 'head_admin'
   AND permission.permission_key IN ('users.read', 'users.manage', 'users.deactivate');

COMMIT;
