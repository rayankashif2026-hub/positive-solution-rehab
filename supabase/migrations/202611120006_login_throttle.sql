CREATE FUNCTION public.record_login_attempt(
  p_normalized_email text,
  p_ip_hash text
)
RETURNS TABLE(attempt_id uuid, allowed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  email_lock bigint;
  ip_lock bigint;
  email_attempt_count integer;
  ip_attempt_count integer;
  new_attempt_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the login service can record authentication attempts';
  END IF;
  IF p_normalized_email IS NULL OR length(p_normalized_email) NOT BETWEEN 1 AND 254 THEN
    RAISE EXCEPTION 'Invalid normalized email';
  END IF;

  email_lock := pg_catalog.hashtextextended('email:' || p_normalized_email, 0);
  ip_lock := pg_catalog.hashtextextended('ip:' || COALESCE(p_ip_hash, 'unavailable'), 0);
  IF email_lock < ip_lock THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(email_lock);
    PERFORM pg_catalog.pg_advisory_xact_lock(ip_lock);
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(ip_lock);
    PERFORM pg_catalog.pg_advisory_xact_lock(email_lock);
  END IF;

  SELECT count(*)::integer
    INTO email_attempt_count
    FROM public.login_attempts AS attempt
   WHERE attempt.normalized_email = p_normalized_email
     AND NOT attempt.succeeded
     AND attempt.attempted_at >= now() - interval '15 minutes';

  IF p_ip_hash IS NOT NULL THEN
    SELECT count(*)::integer
      INTO ip_attempt_count
      FROM public.login_attempts AS attempt
     WHERE attempt.ip_hash = p_ip_hash
       AND NOT attempt.succeeded
       AND attempt.attempted_at >= now() - interval '15 minutes';
  ELSE
    ip_attempt_count := 0;
  END IF;

  IF email_attempt_count >= 5 OR ip_attempt_count >= 5 THEN
    RETURN QUERY SELECT NULL::uuid, false;
    RETURN;
  END IF;

  INSERT INTO public.login_attempts (normalized_email, ip_hash, succeeded)
  VALUES (p_normalized_email, COALESCE(p_ip_hash, 'unavailable'), false)
  RETURNING id INTO new_attempt_id;

  RETURN QUERY SELECT new_attempt_id, true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_login_attempt(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_attempt(text, text) TO service_role;
