CREATE FUNCTION public.claim_email_notifications(p_limit integer DEFAULT 20)
RETURNS SETOF public.email_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the notification worker can claim email notifications';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT notification.id
      FROM public.email_notifications AS notification
     WHERE notification.recipient_email IS NOT NULL
       AND notification.attempt_count < 5
       AND (
         notification.delivery_status IN ('pending', 'failed')
         OR (
           notification.delivery_status = 'processing'
           AND notification.updated_at < now() - interval '10 minutes'
         )
       )
     ORDER BY notification.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  )
  UPDATE public.email_notifications AS notification
     SET delivery_status = 'processing',
         attempt_count = notification.attempt_count + 1,
         last_error = NULL,
         updated_at = now()
    FROM eligible
   WHERE notification.id = eligible.id
  RETURNING notification.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_email_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_notifications(integer) TO service_role;

CREATE FUNCTION public.bootstrap_developer(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  developer_role_id uuid;
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
  IF developer_role_id IS NULL THEN
    RAISE EXCEPTION 'The Developer role is not configured';
  END IF;

  INSERT INTO public.user_roles (user_id, role_id, department_id, granted_by)
  VALUES (p_user_id, developer_role_id, NULL, p_user_id);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, department_id, metadata)
  VALUES (p_user_id, 'bootstrap', 'user_roles', NULL, '{"role_name":"developer"}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_developer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_developer(uuid) TO service_role;
