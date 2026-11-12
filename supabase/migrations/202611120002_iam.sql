CREATE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  safe_username text;
  safe_full_name text;
BEGIN
  safe_username := COALESCE(
    NULLIF(NEW.raw_user_meta_data ->> 'username', ''),
    split_part(COALESCE(NEW.email, NEW.id::text), '@', 1) || '_' || left(NEW.id::text, 6)
  );
  safe_full_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.email, safe_username)
  );

  INSERT INTO public.profiles (id, username, full_name, email)
  VALUES (NEW.id, safe_username, safe_full_name, COALESCE(NEW.email, ''));

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE FUNCTION public.current_user_has_role(p_role_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles AS user_role
      JOIN public.roles AS role ON role.id = user_role.role_id
      JOIN public.profiles AS profile ON profile.id = user_role.user_id
     WHERE user_role.user_id = auth.uid()
       AND role.name = p_role_name
       AND profile.account_status = 'active'
  );
$$;

CREATE FUNCTION public.has_permission(
  p_permission_key text,
  p_department_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
        FROM public.user_roles AS user_role
        JOIN public.role_permissions AS role_permission
          ON role_permission.role_id = user_role.role_id
        JOIN public.permissions AS permission
          ON permission.id = role_permission.permission_id
        JOIN public.profiles AS profile
          ON profile.id = user_role.user_id
       WHERE user_role.user_id = auth.uid()
         AND profile.account_status = 'active'
         AND permission.permission_key = p_permission_key
         AND (
           p_department_id IS NULL
           OR user_role.department_id IS NULL
           OR user_role.department_id = p_department_id
         )
    )
    OR EXISTS (
      SELECT 1
        FROM public.user_permissions AS user_permission
        JOIN public.permissions AS permission
          ON permission.id = user_permission.permission_id
        JOIN public.profiles AS profile
          ON profile.id = user_permission.user_id
       WHERE user_permission.user_id = auth.uid()
         AND user_permission.revoked_at IS NULL
         AND profile.account_status = 'active'
         AND permission.permission_key = p_permission_key
         AND (
           user_permission.department_id IS NULL
           OR p_department_id IS NULL
           OR user_permission.department_id = p_department_id
         )
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_role(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_permission(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text, uuid) TO authenticated;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
  FROM public.roles AS role
 CROSS JOIN public.permissions AS permission
 WHERE role.name = 'developer'
   AND permission.permission_key NOT IN ('psychology.notes.read', 'patients.notes.read');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
  FROM public.roles AS role
 CROSS JOIN public.permissions AS permission
 WHERE role.name = 'head_admin'
   AND permission.permission_key NOT IN (
     'system.manage',
     'psychology.notes.read',
     'patients.notes.read'
   );

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
  FROM (
    VALUES
      ('physiotherapy_admin', 'dashboard.read'),
      ('physiotherapy_admin', 'patients.read'),
      ('physiotherapy_admin', 'patients.create'),
      ('physiotherapy_admin', 'patients.update'),
      ('physiotherapy_admin', 'staff.read'),
      ('physiotherapy_admin', 'appointments.read'),
      ('physiotherapy_admin', 'appointments.manage'),
      ('physiotherapy_admin', 'physiotherapy.read'),
      ('physiotherapy_admin', 'physiotherapy.manage'),
      ('physiotherapy_admin', 'followups.read'),
      ('physiotherapy_admin', 'followups.manage'),
      ('physiotherapy_admin', 'equipment.requests.create'),
      ('physiotherapy_admin', 'reports.export'),
      ('psychology_admin', 'dashboard.read'),
      ('psychology_admin', 'patients.read'),
      ('psychology_admin', 'patients.create'),
      ('psychology_admin', 'patients.update'),
      ('psychology_admin', 'staff.read'),
      ('psychology_admin', 'appointments.read'),
      ('psychology_admin', 'appointments.manage'),
      ('psychology_admin', 'psychology.read'),
      ('psychology_admin', 'psychology.manage'),
      ('psychology_admin', 'psychology.notes.read'),
      ('psychology_admin', 'followups.read'),
      ('psychology_admin', 'followups.manage'),
      ('psychology_admin', 'equipment.requests.create'),
      ('psychology_admin', 'reports.export'),
      ('hijama_admin', 'dashboard.read'),
      ('hijama_admin', 'patients.read'),
      ('hijama_admin', 'patients.create'),
      ('hijama_admin', 'patients.update'),
      ('hijama_admin', 'staff.read'),
      ('hijama_admin', 'appointments.read'),
      ('hijama_admin', 'appointments.manage'),
      ('hijama_admin', 'hijama.read'),
      ('hijama_admin', 'hijama.manage'),
      ('hijama_admin', 'followups.read'),
      ('hijama_admin', 'followups.manage'),
      ('hijama_admin', 'equipment.requests.create'),
      ('hijama_admin', 'reports.export'),
      ('nutrition_admin', 'dashboard.read'),
      ('nutrition_admin', 'patients.read'),
      ('nutrition_admin', 'patients.create'),
      ('nutrition_admin', 'patients.update'),
      ('nutrition_admin', 'staff.read'),
      ('nutrition_admin', 'appointments.read'),
      ('nutrition_admin', 'appointments.manage'),
      ('nutrition_admin', 'nutrition.read'),
      ('nutrition_admin', 'nutrition.manage'),
      ('nutrition_admin', 'followups.read'),
      ('nutrition_admin', 'followups.manage'),
      ('nutrition_admin', 'equipment.requests.create'),
      ('nutrition_admin', 'reports.export'),
      ('female_exercise_admin', 'dashboard.read'),
      ('female_exercise_admin', 'patients.read'),
      ('female_exercise_admin', 'patients.create'),
      ('female_exercise_admin', 'patients.update'),
      ('female_exercise_admin', 'staff.read'),
      ('female_exercise_admin', 'exercise.read'),
      ('female_exercise_admin', 'exercise.manage'),
      ('female_exercise_admin', 'equipment.requests.create'),
      ('female_exercise_admin', 'reports.export'),
      ('attendance_admin', 'dashboard.read'),
      ('attendance_admin', 'staff.read'),
      ('attendance_admin', 'attendance.read'),
      ('attendance_admin', 'attendance.manage'),
      ('attendance_admin', 'reports.export'),
      ('inventory_admin', 'dashboard.read'),
      ('inventory_admin', 'inventory.read'),
      ('inventory_admin', 'inventory.manage'),
      ('inventory_admin', 'equipment.read'),
      ('inventory_admin', 'reports.export')
  ) AS grant_list(role_name, permission_key)
  JOIN public.roles AS role ON role.name = grant_list.role_name
  JOIN public.permissions AS permission ON permission.permission_key = grant_list.permission_key;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON public.departments, public.roles, public.permissions,
  public.role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE POLICY departments_authenticated_read
  ON public.departments FOR SELECT TO authenticated
  USING (true);

CREATE POLICY roles_authenticated_read
  ON public.roles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY permissions_authenticated_read
  ON public.permissions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY role_permissions_authenticated_read
  ON public.role_permissions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY profiles_self_or_admin_read
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.has_permission('users.read', NULL)
  );

CREATE POLICY user_roles_self_or_admin_read
  ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_permission('users.read', department_id)
  );

CREATE POLICY user_permissions_self_or_admin_read
  ON public.user_permissions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_permission('users.manage', department_id)
  );
