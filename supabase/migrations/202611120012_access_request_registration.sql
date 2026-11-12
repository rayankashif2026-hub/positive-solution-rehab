BEGIN;

ALTER TABLE public.access_requests
  ADD COLUMN requested_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.access_requests
  DROP CONSTRAINT access_requests_status_check;

ALTER TABLE public.access_requests
  ADD CONSTRAINT access_requests_status_check
  CHECK (status IN ('provisioning', 'pending', 'invited', 'rejected'));

DROP INDEX public.access_requests_one_pending_per_email_idx;

CREATE UNIQUE INDEX access_requests_one_active_per_email_idx
  ON public.access_requests (lower(email))
  WHERE status IN ('provisioning', 'pending');

CREATE UNIQUE INDEX access_requests_requested_user_unique_idx
  ON public.access_requests (requested_user_id)
  WHERE requested_user_id IS NOT NULL;

DROP FUNCTION public.submit_access_request(text, text, text, text, text, text, text);

CREATE FUNCTION public.begin_access_request(
  p_full_name text,
  p_email text,
  p_branch text,
  p_requested_role text,
  p_reason text,
  p_ip_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_email text;
  email_lock bigint;
  ip_lock bigint;
  recent_request_count integer;
  request_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the access request service can submit requests';
  END IF;

  normalized_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  IF p_full_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_full_name)) NOT BETWEEN 2 AND 120
    OR normalized_email IS NULL
    OR pg_catalog.length(normalized_email) > 254
    OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_branch IS NULL OR pg_catalog.length(pg_catalog.btrim(p_branch)) NOT BETWEEN 2 AND 120
    OR p_requested_role IS NULL OR pg_catalog.length(pg_catalog.btrim(p_requested_role)) NOT BETWEEN 2 AND 80
    OR p_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 1000
    OR (p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'access_request_invalid';
  END IF;

  email_lock := pg_catalog.hashtextextended('access-email:' || normalized_email, 0);
  IF p_ip_hash IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(email_lock);
  ELSE
    ip_lock := pg_catalog.hashtextextended('access-ip:' || p_ip_hash, 0);
    IF email_lock < ip_lock THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(email_lock);
      PERFORM pg_catalog.pg_advisory_xact_lock(ip_lock);
    ELSE
      PERFORM pg_catalog.pg_advisory_xact_lock(ip_lock);
      PERFORM pg_catalog.pg_advisory_xact_lock(email_lock);
    END IF;

    SELECT count(*)::integer
      INTO recent_request_count
      FROM public.access_requests AS request
     WHERE request.ip_hash = p_ip_hash
       AND request.created_at >= now() - interval '1 hour';

    IF recent_request_count >= 10 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'access_request_rate_limited';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.access_requests AS request
     WHERE request.email = normalized_email
       AND request.status IN ('provisioning', 'pending')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'access_request_already_pending';
  END IF;

  SELECT count(*)::integer
    INTO recent_request_count
    FROM public.access_requests AS request
   WHERE request.email = normalized_email
     AND request.created_at >= now() - interval '24 hours';

  IF recent_request_count >= 3 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'access_request_rate_limited';
  END IF;

  INSERT INTO public.access_requests (
    full_name,
    email,
    branch,
    requested_role,
    reason,
    ip_hash,
    status
  )
  VALUES (
    pg_catalog.btrim(p_full_name),
    normalized_email,
    pg_catalog.btrim(p_branch),
    pg_catalog.btrim(p_requested_role),
    pg_catalog.btrim(p_reason),
    p_ip_hash,
    'provisioning'
  )
  RETURNING id INTO request_id;

  RETURN request_id;
END;
$$;

CREATE FUNCTION public.activate_access_request(
  p_request_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  activated_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the access request service can activate registrations';
  END IF;

  UPDATE public.access_requests AS request
     SET status = 'pending',
         requested_user_id = p_user_id
   WHERE request.id = p_request_id
     AND request.status = 'provisioning'
     AND EXISTS (
       SELECT 1
         FROM public.profiles AS profile
        WHERE profile.id = p_user_id
          AND pg_catalog.lower(profile.email) = request.email
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.user_roles AS user_role
        WHERE user_role.user_id = p_user_id
     )
  RETURNING request.id INTO activated_id;

  RETURN activated_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_access_request(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_access_request(text, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.activate_access_request(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_access_request(uuid, uuid)
  TO service_role;

COMMIT;
