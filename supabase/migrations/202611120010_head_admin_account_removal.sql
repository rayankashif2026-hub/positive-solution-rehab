BEGIN;

INSERT INTO public.permissions (permission_key, description)
VALUES ('users.deactivate', 'Deactivate or lock clinic accounts')
ON CONFLICT (permission_key) DO UPDATE
  SET description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
  FROM public.roles AS role
  JOIN public.permissions AS permission
    ON permission.permission_key = 'users.deactivate'
 WHERE role.name = 'developer'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
  FROM public.roles AS role
  JOIN public.permissions AS permission
    ON permission.permission_key IN ('users.read', 'users.deactivate')
 WHERE role.name = 'head_admin'
ON CONFLICT DO NOTHING;

COMMIT;
