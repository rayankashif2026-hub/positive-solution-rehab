CREATE FUNCTION public.set_authenticated_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(TG_ARGV[0], auth.uid())
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_authenticated_actor() FROM PUBLIC, anon;

DO $$
DECLARE
  table_name text;
  actor_column text;
BEGIN
  FOR table_name, actor_column IN
    SELECT * FROM (VALUES
      ('patients', 'created_by'),
      ('appointments', 'created_by'),
      ('physiotherapy_records', 'created_by'),
      ('physiotherapy_sessions', 'created_by'),
      ('psychology_records', 'created_by'),
      ('patient_general_notes', 'created_by'),
      ('psychology_notes', 'authored_by'),
      ('hijama_records', 'created_by'),
      ('nutrition_records', 'created_by'),
      ('exercise_attendance', 'recorded_by'),
      ('staff_attendance', 'recorded_by'),
      ('invoices', 'created_by'),
      ('payments', 'received_by'),
      ('followups', 'created_by'),
      ('inventory_items', 'created_by'),
      ('inventory_transactions', 'recorded_by'),
      ('equipment_requests', 'requested_by'),
      ('equipment_maintenance', 'recorded_by')
    ) AS actor_map(table_name, actor_column)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_actor BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_authenticated_actor(%L)',
      table_name,
      table_name,
      actor_column
    );
  END LOOP;
END;
$$;

CREATE FUNCTION public.validate_staff_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row_data jsonb;
  record_department_id uuid;
  referenced_staff_id uuid;
  staff_department_id uuid;
BEGIN
  row_data := to_jsonb(NEW);
  IF TG_ARGV[0] = 'record_id' THEN
    SELECT record.department_id
      INTO record_department_id
      FROM public.physiotherapy_records AS record
     WHERE record.id = NULLIF(row_data ->> 'record_id', '')::uuid;
  ELSE
    record_department_id := NULLIF(row_data ->> TG_ARGV[0], '')::uuid;
  END IF;
  referenced_staff_id := NULLIF(row_data ->> TG_ARGV[1], '')::uuid;

  IF referenced_staff_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT staff_member.department_id
    INTO staff_department_id
    FROM public.staff AS staff_member
   WHERE staff_member.id = referenced_staff_id;

  IF staff_department_id IS DISTINCT FROM record_department_id THEN
    RAISE EXCEPTION 'The assigned staff member must belong to the record department';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_staff_department() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  table_name text;
  department_column text;
  staff_column text;
BEGIN
  FOR table_name, department_column, staff_column IN
    SELECT * FROM (VALUES
      ('appointments', 'department_id', 'practitioner_id'),
      ('physiotherapy_records', 'department_id', 'practitioner_id'),
      ('physiotherapy_sessions', 'record_id', 'practitioner_id'),
      ('psychology_records', 'department_id', 'psychologist_id'),
      ('hijama_records', 'department_id', 'practitioner_id'),
      ('nutrition_records', 'department_id', 'nutritionist_id'),
      ('followups', 'department_id', 'practitioner_id'),
      ('exercise_batches', 'department_id', 'trainer_id')
    ) AS staff_map(table_name, department_column, staff_column)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_validate_staff_department BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.validate_staff_department(%L, %L)',
      table_name,
      table_name,
      department_column,
      staff_column
    );
  END LOOP;
END;
$$;

CREATE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row_data jsonb;
  row_id uuid;
  department_id uuid;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  row_id := NULLIF(row_data ->> 'id', '')::uuid;
  department_id := COALESCE(
    NULLIF(row_data ->> 'department_id', '')::uuid,
    NULLIF(row_data ->> 'created_department_id', '')::uuid
  );

  INSERT INTO public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    department_id
  )
  VALUES (
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    row_id,
    department_id
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'patients', 'staff', 'appointments', 'physiotherapy_records',
    'physiotherapy_sessions', 'psychology_records', 'hijama_records',
    'nutrition_records', 'exercise_batches', 'exercise_participants',
    'exercise_attendance', 'staff_attendance', 'invoices', 'payments',
    'followups', 'inventory_items', 'inventory_transactions', 'equipment',
    'equipment_requests', 'equipment_maintenance'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_write_audit_log AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.write_audit_log()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;

REVOKE INSERT, UPDATE ON public.inventory_items FROM authenticated;
GRANT INSERT (
  department_id,
  item_name,
  category,
  description,
  unit,
  minimum_stock_level,
  purchase_date,
  expiry_date,
  supplier,
  purchase_cost,
  created_by
) ON public.inventory_items TO authenticated;
GRANT UPDATE (
  item_name,
  category,
  description,
  unit,
  minimum_stock_level,
  purchase_date,
  expiry_date,
  supplier,
  purchase_cost,
  archived_at
) ON public.inventory_items TO authenticated;

INSERT INTO public.system_settings (setting_key, setting_value)
VALUES
  ('owner_notification_email', 'null'::jsonb),
  ('login_notifications_enabled', 'true'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
