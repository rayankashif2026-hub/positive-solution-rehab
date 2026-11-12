CREATE FUNCTION public.can_access_patient(p_patient_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.patients AS patient
     WHERE patient.id = p_patient_id
       AND (
         patient.created_by = auth.uid()
         OR public.has_permission('patients.read', patient.created_department_id)
         OR EXISTS (
           SELECT 1
             FROM public.appointments AS appointment
            WHERE appointment.patient_id = patient.id
              AND public.has_permission('appointments.read', appointment.department_id)
         )
         OR EXISTS (
           SELECT 1
             FROM public.physiotherapy_records AS record
            WHERE record.patient_id = patient.id
              AND public.has_permission('physiotherapy.read', record.department_id)
         )
         OR EXISTS (
           SELECT 1
             FROM public.psychology_records AS record
            WHERE record.patient_id = patient.id
              AND public.has_permission('psychology.read', record.department_id)
         )
         OR EXISTS (
           SELECT 1
             FROM public.hijama_records AS record
            WHERE record.patient_id = patient.id
              AND public.has_permission('hijama.read', record.department_id)
         )
         OR EXISTS (
           SELECT 1
             FROM public.nutrition_records AS record
            WHERE record.patient_id = patient.id
              AND public.has_permission('nutrition.read', record.department_id)
         )
         OR EXISTS (
           SELECT 1
             FROM public.exercise_participants AS participant
             JOIN public.exercise_batches AS batch ON batch.id = participant.batch_id
            WHERE participant.patient_id = patient.id
              AND public.has_permission('exercise.read', batch.department_id)
         )
         OR EXISTS (
           SELECT 1
             FROM public.invoices AS invoice
            WHERE invoice.patient_id = patient.id
              AND public.has_permission('finance.read', invoice.department_id)
         )
         OR EXISTS (
           SELECT 1
             FROM public.followups AS followup
            WHERE followup.patient_id = patient.id
              AND public.has_permission('followups.read', followup.department_id)
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_patient(uuid) TO authenticated;

DO $$
DECLARE
  table_name text;
  read_permission text;
  manage_permission text;
  department_column text;
  patient_column text;
  patient_check text;
BEGIN
  FOR table_name, read_permission, manage_permission, department_column, patient_column IN
    SELECT * FROM (VALUES
      ('staff', 'staff.read', 'staff.manage', 'department_id', NULL),
      ('appointments', 'appointments.read', 'appointments.manage', 'department_id', 'patient_id'),
      ('physiotherapy_records', 'physiotherapy.read', 'physiotherapy.manage', 'department_id', 'patient_id'),
      ('psychology_records', 'psychology.read', 'psychology.manage', 'department_id', 'patient_id'),
      ('hijama_records', 'hijama.read', 'hijama.manage', 'department_id', 'patient_id'),
      ('nutrition_records', 'nutrition.read', 'nutrition.manage', 'department_id', 'patient_id'),
      ('exercise_batches', 'exercise.read', 'exercise.manage', 'department_id', NULL),
      ('invoices', 'finance.read', 'finance.manage', 'department_id', 'patient_id'),
      ('followups', 'followups.read', 'followups.manage', 'department_id', 'patient_id'),
      ('inventory_items', 'inventory.read', 'inventory.manage', 'department_id', NULL),
      ('equipment', 'equipment.read', 'equipment.manage', 'department_id', NULL)
    ) AS policy_map(table_name, read_permission, manage_permission, department_column, patient_column)
  LOOP
    patient_check := '';
    IF patient_column IS NOT NULL THEN
      patient_check := format(' AND public.can_access_patient(%I)', patient_column);
    END IF;

    EXECUTE format(
      'CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (public.has_permission(%L, %I)%s)',
      table_name || '_authorized_read',
      table_name,
      read_permission,
      department_column,
      patient_check
    );
    EXECUTE format(
      'CREATE POLICY %I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_permission(%L, %I)%s)',
      table_name || '_authorized_insert',
      table_name,
      manage_permission,
      department_column,
      patient_check
    );
    EXECUTE format(
      'CREATE POLICY %I_update ON public.%I FOR UPDATE TO authenticated USING (public.has_permission(%L, %I)%s) WITH CHECK (public.has_permission(%L, %I)%s)',
      table_name || '_authorized_update',
      table_name,
      manage_permission,
      department_column,
      patient_check,
      manage_permission,
      department_column,
      patient_check
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END;
$$;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_general_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.physiotherapy_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.psychology_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY patients_authorized_read
  ON public.patients FOR SELECT TO authenticated
  USING (
    (
      archived_at IS NULL
      OR public.has_permission('patients.archive', created_department_id)
    )
    AND public.has_permission('patients.read', NULL)
    AND public.can_access_patient(id)
  );

CREATE POLICY patients_authorized_insert
  ON public.patients FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('patients.create', created_department_id)
    AND created_by = auth.uid()
  );

CREATE POLICY patients_authorized_update
  ON public.patients FOR UPDATE TO authenticated
  USING (
    archived_at IS NULL
    AND public.has_permission('patients.update', created_department_id)
    AND public.can_access_patient(id)
  )
  WITH CHECK (
    public.has_permission('patients.update', created_department_id)
    AND (
      archived_at IS NULL
      OR public.has_permission('patients.archive', created_department_id)
    )
    AND public.can_access_patient(id)
  );

CREATE POLICY patient_general_notes_authorized_read
  ON public.patient_general_notes FOR SELECT TO authenticated
  USING (
    public.has_permission('patients.notes.read', NULL)
    AND public.can_access_patient(patient_id)
  );

CREATE POLICY patient_general_notes_authorized_insert
  ON public.patient_general_notes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('patients.update', NULL)
    AND public.can_access_patient(patient_id)
    AND created_by = auth.uid()
  );

CREATE POLICY physiotherapy_sessions_authorized_read
  ON public.physiotherapy_sessions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.physiotherapy_records AS record
       WHERE record.id = record_id
         AND public.has_permission('physiotherapy.read', record.department_id)
         AND public.can_access_patient(record.patient_id)
    )
  );

CREATE POLICY physiotherapy_sessions_authorized_insert
  ON public.physiotherapy_sessions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.physiotherapy_records AS record
       WHERE record.id = record_id
         AND public.has_permission('physiotherapy.manage', record.department_id)
         AND public.can_access_patient(record.patient_id)
    )
  );

CREATE POLICY physiotherapy_sessions_authorized_update
  ON public.physiotherapy_sessions FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.physiotherapy_records AS record
       WHERE record.id = record_id
         AND public.has_permission('physiotherapy.manage', record.department_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.physiotherapy_records AS record
       WHERE record.id = record_id
         AND public.has_permission('physiotherapy.manage', record.department_id)
    )
  );

CREATE POLICY psychology_notes_authorized_read
  ON public.psychology_notes FOR SELECT TO authenticated
  USING (
    public.has_permission('psychology.notes.read', NULL)
    AND EXISTS (
      SELECT 1
        FROM public.psychology_records AS record
       WHERE record.id = record_id
         AND public.has_permission('psychology.read', record.department_id)
    )
  );

CREATE POLICY psychology_notes_authorized_insert
  ON public.psychology_notes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('psychology.notes.read', NULL)
    AND EXISTS (
      SELECT 1
        FROM public.psychology_records AS record
       WHERE record.id = record_id
         AND public.has_permission('psychology.manage', record.department_id)
    )
    AND authored_by = auth.uid()
  );

CREATE POLICY exercise_participants_authorized_read
  ON public.exercise_participants FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.exercise_batches AS batch
       WHERE batch.id = batch_id
         AND public.has_permission('exercise.read', batch.department_id)
         AND public.can_access_patient(patient_id)
    )
  );

CREATE POLICY exercise_participants_authorized_insert
  ON public.exercise_participants FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.exercise_batches AS batch
       WHERE batch.id = batch_id
         AND public.has_permission('exercise.manage', batch.department_id)
         AND public.can_access_patient(patient_id)
    )
  );

CREATE POLICY exercise_participants_authorized_update
  ON public.exercise_participants FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.exercise_batches AS batch
       WHERE batch.id = batch_id
         AND public.has_permission('exercise.manage', batch.department_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.exercise_batches AS batch
       WHERE batch.id = batch_id
         AND public.has_permission('exercise.manage', batch.department_id)
    )
  );

CREATE POLICY exercise_attendance_authorized_read
  ON public.exercise_attendance FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.exercise_participants AS participant
        JOIN public.exercise_batches AS batch ON batch.id = participant.batch_id
       WHERE participant.id = participant_id
         AND public.has_permission('exercise.read', batch.department_id)
    )
  );

CREATE POLICY exercise_attendance_authorized_insert
  ON public.exercise_attendance FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.exercise_participants AS participant
        JOIN public.exercise_batches AS batch ON batch.id = participant.batch_id
       WHERE participant.id = participant_id
         AND public.has_permission('exercise.manage', batch.department_id)
    )
    AND recorded_by = auth.uid()
  );

CREATE POLICY exercise_attendance_authorized_update
  ON public.exercise_attendance FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.exercise_participants AS participant
        JOIN public.exercise_batches AS batch ON batch.id = participant.batch_id
       WHERE participant.id = participant_id
         AND public.has_permission('exercise.manage', batch.department_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.exercise_participants AS participant
        JOIN public.exercise_batches AS batch ON batch.id = participant.batch_id
       WHERE participant.id = participant_id
         AND public.has_permission('exercise.manage', batch.department_id)
    )
  );

CREATE POLICY staff_attendance_authorized_read
  ON public.staff_attendance FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.staff AS staff_member
       WHERE staff_member.id = staff_id
         AND public.has_permission('attendance.read', staff_member.department_id)
    )
  );

CREATE POLICY staff_attendance_authorized_insert
  ON public.staff_attendance FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.staff AS staff_member
       WHERE staff_member.id = staff_id
         AND public.has_permission('attendance.manage', staff_member.department_id)
    )
    AND recorded_by = auth.uid()
  );

CREATE POLICY staff_attendance_authorized_update
  ON public.staff_attendance FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.staff AS staff_member
       WHERE staff_member.id = staff_id
         AND public.has_permission('attendance.manage', staff_member.department_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.staff AS staff_member
       WHERE staff_member.id = staff_id
         AND public.has_permission('attendance.manage', staff_member.department_id)
    )
  );

CREATE POLICY payments_authorized_read
  ON public.payments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices AS invoice
       WHERE invoice.id = invoice_id
         AND public.has_permission('finance.read', invoice.department_id)
    )
  );

CREATE POLICY payments_authorized_insert
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices AS invoice
       WHERE invoice.id = invoice_id
         AND public.has_permission('finance.manage', invoice.department_id)
    )
    AND received_by = auth.uid()
  );

CREATE POLICY inventory_transactions_authorized_read
  ON public.inventory_transactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_items AS item
       WHERE item.id = item_id
         AND public.has_permission('inventory.read', item.department_id)
    )
  );

CREATE POLICY inventory_transactions_authorized_insert
  ON public.inventory_transactions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.inventory_items AS item
       WHERE item.id = item_id
         AND public.has_permission('inventory.manage', item.department_id)
    )
    AND recorded_by = auth.uid()
  );

CREATE POLICY equipment_requests_authorized_read
  ON public.equipment_requests FOR SELECT TO authenticated
  USING (public.has_permission('equipment.read', department_id));

CREATE POLICY equipment_requests_authorized_insert
  ON public.equipment_requests FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('equipment.requests.create', department_id)
    AND requested_by = auth.uid()
  );

CREATE POLICY equipment_requests_approval_update
  ON public.equipment_requests FOR UPDATE TO authenticated
  USING (public.has_permission('equipment.requests.approve', department_id))
  WITH CHECK (public.has_permission('equipment.requests.approve', department_id));

CREATE POLICY equipment_maintenance_authorized_read
  ON public.equipment_maintenance FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.equipment AS equipment_item
       WHERE equipment_item.id = equipment_id
         AND public.has_permission('equipment.read', equipment_item.department_id)
    )
  );

CREATE POLICY equipment_maintenance_authorized_insert
  ON public.equipment_maintenance FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.equipment AS equipment_item
       WHERE equipment_item.id = equipment_id
         AND public.has_permission('equipment.manage', equipment_item.department_id)
    )
    AND recorded_by = auth.uid()
  );

CREATE POLICY audit_logs_authorized_read
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_permission('audit.read', department_id));

CREATE POLICY login_events_authorized_read
  ON public.login_events FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_permission('audit.read', NULL)
  );

CREATE POLICY login_attempts_developer_read
  ON public.login_attempts FOR SELECT TO authenticated
  USING (public.has_permission('system.manage', NULL));

CREATE POLICY email_notifications_developer_read
  ON public.email_notifications FOR SELECT TO authenticated
  USING (public.has_permission('audit.read', NULL));

CREATE POLICY system_settings_developer_read
  ON public.system_settings FOR SELECT TO authenticated
  USING (public.has_permission('system.manage', NULL));

CREATE POLICY system_settings_developer_update
  ON public.system_settings FOR UPDATE TO authenticated
  USING (public.has_permission('system.manage', NULL))
  WITH CHECK (public.has_permission('system.manage', NULL));

GRANT SELECT ON public.invoice_balances TO authenticated;
