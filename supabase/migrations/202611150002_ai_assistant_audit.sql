CREATE FUNCTION public.log_assistant_action(
  p_entity_type text,
  p_entity_id uuid,
  p_operation text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  required_permission text;
  audit_action text;
  entity_department_id uuid;
  entity_exists boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Invalid assistant audit request';
  END IF;
  IF p_operation = 'prepare' THEN
    RETURN;
  END IF;
  IF p_operation NOT IN ('create', 'update') THEN
    RAISE EXCEPTION 'Invalid assistant audit request';
  END IF;
  audit_action := CASE p_operation WHEN 'create' THEN 'insert' ELSE 'update' END;

  CASE p_entity_type
    WHEN 'patients' THEN
      required_permission := CASE p_operation WHEN 'create' THEN 'patients.create' ELSE 'patients.update' END;
      SELECT created_department_id INTO entity_department_id FROM public.patients WHERE id = p_entity_id;
    WHEN 'appointments' THEN
      required_permission := 'appointments.manage';
      SELECT department_id INTO entity_department_id FROM public.appointments WHERE id = p_entity_id;
    WHEN 'physiotherapy_records' THEN
      required_permission := 'physiotherapy.manage';
      SELECT department_id INTO entity_department_id FROM public.physiotherapy_records WHERE id = p_entity_id;
    WHEN 'psychology_records' THEN
      required_permission := 'psychology.manage';
      SELECT department_id INTO entity_department_id FROM public.psychology_records WHERE id = p_entity_id;
    WHEN 'psychology_notes' THEN
      required_permission := 'psychology.manage';
      SELECT record.department_id INTO entity_department_id
        FROM public.psychology_notes AS note
        JOIN public.psychology_records AS record ON record.id = note.record_id
       WHERE note.id = p_entity_id;
      IF NOT public.has_permission('psychology.notes.read', entity_department_id) THEN
        RAISE EXCEPTION 'Not authorized to audit this assistant action';
      END IF;
    WHEN 'patient_general_notes' THEN
      required_permission := 'patients.update';
      SELECT patient.created_department_id INTO entity_department_id
        FROM public.patient_general_notes AS note
        JOIN public.patients AS patient ON patient.id = note.patient_id
       WHERE note.id = p_entity_id;
    WHEN 'hijama_records' THEN
      required_permission := 'hijama.manage';
      SELECT department_id INTO entity_department_id FROM public.hijama_records WHERE id = p_entity_id;
    WHEN 'nutrition_records' THEN
      required_permission := 'nutrition.manage';
      SELECT department_id INTO entity_department_id FROM public.nutrition_records WHERE id = p_entity_id;
    WHEN 'exercise_batches' THEN
      required_permission := 'exercise.manage';
      SELECT department_id INTO entity_department_id FROM public.exercise_batches WHERE id = p_entity_id;
    WHEN 'exercise_participants' THEN
      required_permission := 'exercise.manage';
      SELECT batch.department_id INTO entity_department_id
        FROM public.exercise_participants AS participant
        JOIN public.exercise_batches AS batch ON batch.id = participant.batch_id
       WHERE participant.id = p_entity_id;
    WHEN 'exercise_attendance' THEN
      required_permission := 'exercise.manage';
      SELECT batch.department_id INTO entity_department_id
        FROM public.exercise_attendance AS attendance
        JOIN public.exercise_participants AS participant ON participant.id = attendance.participant_id
        JOIN public.exercise_batches AS batch ON batch.id = participant.batch_id
       WHERE attendance.id = p_entity_id;
    WHEN 'staff' THEN
      required_permission := 'staff.manage';
      SELECT department_id INTO entity_department_id FROM public.staff WHERE id = p_entity_id;
    WHEN 'staff_attendance' THEN
      required_permission := 'attendance.manage';
      SELECT staff_member.department_id INTO entity_department_id
        FROM public.staff_attendance AS attendance
        JOIN public.staff AS staff_member ON staff_member.id = attendance.staff_id
       WHERE attendance.id = p_entity_id;
    WHEN 'invoices' THEN
      required_permission := 'finance.manage';
      SELECT department_id INTO entity_department_id FROM public.invoices WHERE id = p_entity_id;
    WHEN 'payments' THEN
      required_permission := 'finance.manage';
      SELECT invoice.department_id INTO entity_department_id
        FROM public.payments AS payment
        JOIN public.invoices AS invoice ON invoice.id = payment.invoice_id
       WHERE payment.id = p_entity_id;
    WHEN 'followups' THEN
      required_permission := 'followups.manage';
      SELECT department_id INTO entity_department_id FROM public.followups WHERE id = p_entity_id;
    WHEN 'inventory_items' THEN
      required_permission := 'inventory.manage';
      SELECT department_id INTO entity_department_id FROM public.inventory_items WHERE id = p_entity_id;
    WHEN 'inventory_transactions' THEN
      required_permission := 'inventory.manage';
      SELECT item.department_id INTO entity_department_id
        FROM public.inventory_transactions AS stock_entry
        JOIN public.inventory_items AS item ON item.id = stock_entry.item_id
       WHERE stock_entry.id = p_entity_id;
    WHEN 'equipment' THEN
      required_permission := 'equipment.manage';
      SELECT department_id INTO entity_department_id FROM public.equipment WHERE id = p_entity_id;
    WHEN 'equipment_requests' THEN
      required_permission := CASE p_operation
        WHEN 'create' THEN 'equipment.requests.create'
        ELSE 'equipment.requests.approve'
      END;
      SELECT department_id INTO entity_department_id FROM public.equipment_requests WHERE id = p_entity_id;
    WHEN 'equipment_maintenance' THEN
      required_permission := 'equipment.manage';
      SELECT equipment_item.department_id INTO entity_department_id
        FROM public.equipment_maintenance AS maintenance
        JOIN public.equipment AS equipment_item ON equipment_item.id = maintenance.equipment_id
       WHERE maintenance.id = p_entity_id;
    ELSE
      RAISE EXCEPTION 'Unsupported assistant audit entity';
  END CASE;

  entity_exists := entity_department_id IS NOT NULL;
  IF NOT entity_exists OR NOT public.has_permission(required_permission, entity_department_id) THEN
    RAISE EXCEPTION 'Not authorized to audit this assistant action';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.audit_logs AS audit_log
     WHERE audit_log.actor_id = auth.uid()
       AND audit_log.entity_type = p_entity_type
       AND audit_log.entity_id = p_entity_id
       AND audit_log.action = audit_action
       AND audit_log.created_at > now() - interval '1 minute'
  ) THEN
    RAISE EXCEPTION 'The assistant action is missing its database audit event';
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
    'assistant_' || p_operation,
    p_entity_type,
    p_entity_id,
    entity_department_id,
    '{"source":"ai_assistant"}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_assistant_action(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_assistant_action(text, uuid, text) TO authenticated;

CREATE TRIGGER patient_general_notes_write_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.patient_general_notes
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

CREATE TRIGGER psychology_notes_write_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.psychology_notes
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
