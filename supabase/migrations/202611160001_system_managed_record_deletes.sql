DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'patients',
    'patient_general_notes',
    'appointments',
    'physiotherapy_records',
    'psychology_records',
    'psychology_notes',
    'hijama_records',
    'nutrition_records',
    'exercise_batches',
    'exercise_participants',
    'exercise_attendance',
    'staff',
    'staff_attendance',
    'invoices',
    'payments',
    'followups',
    'inventory_items',
    'inventory_transactions',
    'equipment',
    'equipment_requests',
    'equipment_maintenance'
  ]
  LOOP
    EXECUTE format(
      'GRANT DELETE ON TABLE public.%I TO authenticated',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_permission(''system.manage'', NULL))',
      table_name || '_system_manage_delete',
      table_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION public.log_assistant_delete_action(
  p_entity_type text,
  p_entity_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  entity_department_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('system.manage', NULL) THEN
    RAISE EXCEPTION 'Not authorized to audit this assistant action';
  END IF;
  IF p_entity_type NOT IN (
    'patients',
    'patient_general_notes',
    'appointments',
    'physiotherapy_records',
    'psychology_records',
    'psychology_notes',
    'hijama_records',
    'nutrition_records',
    'exercise_batches',
    'exercise_participants',
    'exercise_attendance',
    'staff',
    'staff_attendance',
    'invoices',
    'payments',
    'followups',
    'inventory_items',
    'inventory_transactions',
    'equipment',
    'equipment_requests',
    'equipment_maintenance'
  ) THEN
    RAISE EXCEPTION 'Unsupported assistant delete audit entity';
  END IF;

  SELECT audit_log.department_id
    INTO entity_department_id
    FROM public.audit_logs AS audit_log
   WHERE audit_log.actor_id = auth.uid()
     AND audit_log.entity_type = p_entity_type
     AND audit_log.entity_id = p_entity_id
     AND audit_log.action = 'delete'
     AND audit_log.created_at > now() - interval '1 minute'
   ORDER BY audit_log.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The assistant delete is missing its database audit event';
  END IF;

  INSERT INTO public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    department_id,
    metadata
  )
  VALUES (
    auth.uid(),
    'assistant_delete',
    p_entity_type,
    p_entity_id,
    entity_department_id,
    '{"source":"ai_assistant"}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_assistant_delete_action(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_assistant_delete_action(text, uuid) TO authenticated;
