CREATE TABLE public.access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 120),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  branch text NOT NULL CHECK (length(btrim(branch)) BETWEEN 2 AND 120),
  requested_role text NOT NULL CHECK (length(btrim(requested_role)) BETWEEN 2 AND 80),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
  ip_hash text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'invited', 'rejected')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  invited_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX access_requests_one_pending_per_email_idx
  ON public.access_requests (lower(email))
  WHERE status = 'pending';

CREATE INDEX access_requests_pending_created_idx
  ON public.access_requests (created_at DESC)
  WHERE status = 'pending';

CREATE TRIGGER access_requests_set_updated_at
  BEFORE UPDATE ON public.access_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.access_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.access_requests TO authenticated;
GRANT UPDATE (status, reviewed_by, reviewed_at, invited_user_id)
  ON public.access_requests TO authenticated;

CREATE POLICY access_requests_manage_read
  ON public.access_requests FOR SELECT TO authenticated
  USING (public.has_permission('users.manage', NULL));

CREATE POLICY access_requests_manage_update
  ON public.access_requests FOR UPDATE TO authenticated
  USING (public.has_permission('users.manage', NULL))
  WITH CHECK (public.has_permission('users.manage', NULL));

CREATE FUNCTION public.submit_access_request(
  p_full_name text,
  p_email text,
  p_branch text,
  p_requested_role text,
  p_reason text,
  p_ip_hash text,
  p_recipient_email text
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
  request_created_at timestamptz;
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
    OR p_recipient_email IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_recipient_email)) > 254
    OR pg_catalog.btrim(p_recipient_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
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
       AND request.status = 'pending'
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
    ip_hash
  )
  VALUES (
    pg_catalog.btrim(p_full_name),
    normalized_email,
    pg_catalog.btrim(p_branch),
    pg_catalog.btrim(p_requested_role),
    pg_catalog.btrim(p_reason),
    p_ip_hash
  )
  RETURNING id, created_at INTO request_id, request_created_at;

  INSERT INTO public.email_notifications (recipient_email, subject, payload)
  VALUES (
    pg_catalog.lower(pg_catalog.btrim(p_recipient_email)),
    'New clinic access request',
    pg_catalog.jsonb_build_object(
      'notificationType', 'access_request',
      'requestId', request_id,
      'fullName', pg_catalog.btrim(p_full_name),
      'email', normalized_email,
      'branch', pg_catalog.btrim(p_branch),
      'requestedRole', pg_catalog.btrim(p_requested_role),
      'reason', pg_catalog.btrim(p_reason),
      'submittedAt', request_created_at
    )
  );

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_access_request(text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_access_request(text, text, text, text, text, text, text)
  TO service_role;
