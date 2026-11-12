BEGIN;

UPDATE public.roles
   SET label = CASE name
     WHEN 'developer' THEN 'Head Developer'
     WHEN 'head_admin' THEN 'Head Admin'
     ELSE label
   END
 WHERE name IN ('developer', 'head_admin');

DELETE FROM public.role_permissions AS role_permission
 USING public.roles AS role,
       public.permissions AS permission
 WHERE role_permission.role_id = role.id
   AND role_permission.permission_id = permission.id
   AND role.name = 'head_admin'
   AND permission.permission_key IN ('users.read', 'users.manage');

WITH developers AS (
  SELECT DISTINCT user_role.user_id
    FROM public.user_roles AS user_role
    JOIN public.roles AS role ON role.id = user_role.role_id
   WHERE role.name = 'developer'
), added_roles AS (
  INSERT INTO public.user_roles (user_id, role_id, department_id, granted_by)
  SELECT developer.user_id, head_admin.id, NULL, developer.user_id
    FROM developers AS developer
    JOIN public.roles AS head_admin ON head_admin.name = 'head_admin'
  ON CONFLICT DO NOTHING
  RETURNING id, user_id
)
INSERT INTO public.audit_logs (
  actor_id,
  action,
  entity_type,
  entity_id,
  department_id,
  metadata
)
SELECT NULL,
       'migration_role_grant',
       'user_roles',
       added_roles.id,
       NULL,
       jsonb_build_object('user_id', added_roles.user_id, 'role_name', 'head_admin')
  FROM added_roles;

CREATE OR REPLACE FUNCTION public.bootstrap_developer(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  developer_role_id uuid;
  head_admin_role_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the bootstrap process can create the initial Developer account';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(723091228451::bigint);

  IF EXISTS (
    SELECT 1
      FROM public.user_roles AS user_role
      JOIN public.roles AS role ON role.id = user_role.role_id
     WHERE role.name = 'developer'
  ) THEN
    RAISE EXCEPTION 'A Developer account already exists';
  END IF;

  SELECT role.id
    INTO developer_role_id
    FROM public.roles AS role
   WHERE role.name = 'developer';
  SELECT role.id
    INTO head_admin_role_id
    FROM public.roles AS role
   WHERE role.name = 'head_admin';

  IF developer_role_id IS NULL OR head_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'The Developer and Head Admin roles must be configured';
  END IF;

  INSERT INTO public.user_roles (user_id, role_id, department_id, granted_by)
  VALUES
    (p_user_id, developer_role_id, NULL, p_user_id),
    (p_user_id, head_admin_role_id, NULL, p_user_id);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, department_id, metadata)
  VALUES
    (p_user_id, 'bootstrap', 'user_roles', NULL, '{"role_name":"developer"}'::jsonb),
    (p_user_id, 'bootstrap', 'user_roles', NULL, '{"role_name":"head_admin"}'::jsonb);
END;
$$;

COMMIT;
