CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.departments (slug, name) VALUES
  ('physiotherapy', 'Physiotherapy'),
  ('psychology', 'Psychology'),
  ('hijama', 'Hijama'),
  ('nutrition', 'Nutrition'),
  ('female-exercise', 'Female Exercise'),
  ('attendance', 'Attendance'),
  ('inventory', 'Inventory'),
  ('finance', 'Finance'),
  ('general', 'General');

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  label text NOT NULL,
  is_system_role boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.roles (name, label) VALUES
  ('developer', 'Developer'),
  ('head_admin', 'Head Admin / Super Admin'),
  ('physiotherapy_admin', 'Physiotherapy Admin'),
  ('psychology_admin', 'Psychology Admin'),
  ('hijama_admin', 'Hijama Admin'),
  ('nutrition_admin', 'Nutrition Admin'),
  ('female_exercise_admin', 'Female Exercise Admin'),
  ('attendance_admin', 'Attendance Admin'),
  ('inventory_admin', 'Inventory Admin');

CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key text NOT NULL UNIQUE,
  description text NOT NULL
);

INSERT INTO public.permissions (permission_key, description) VALUES
  ('dashboard.read', 'View authorized dashboard statistics'),
  ('patients.read', 'View authorized central patient profiles'),
  ('patients.create', 'Register patients in an authorized department'),
  ('patients.update', 'Update authorized patient demographics'),
  ('patients.archive', 'Archive patient profiles'),
  ('patients.notes.read', 'Read general patient notes'),
  ('appointments.read', 'View appointments in authorized departments'),
  ('appointments.manage', 'Create and manage authorized appointments'),
  ('physiotherapy.read', 'View physiotherapy records'),
  ('physiotherapy.manage', 'Manage physiotherapy records and sessions'),
  ('psychology.read', 'View authorized psychology records'),
  ('psychology.manage', 'Manage authorized psychology records'),
  ('psychology.notes.read', 'Read confidential psychology clinical notes'),
  ('hijama.read', 'View Hijama records'),
  ('hijama.manage', 'Manage Hijama records'),
  ('nutrition.read', 'View nutrition records'),
  ('nutrition.manage', 'Manage nutrition records'),
  ('exercise.read', 'View female exercise records'),
  ('exercise.manage', 'Manage female exercise batches and attendance'),
  ('staff.read', 'View staff records'),
  ('staff.manage', 'Manage staff records'),
  ('attendance.read', 'View attendance records'),
  ('attendance.manage', 'Manage staff attendance'),
  ('inventory.read', 'View inventory records'),
  ('inventory.manage', 'Manage inventory and stock transactions'),
  ('equipment.read', 'View equipment records'),
  ('equipment.manage', 'Manage equipment records'),
  ('equipment.requests.create', 'Request equipment for an authorized department'),
  ('equipment.requests.approve', 'Approve or reject equipment requests'),
  ('finance.read', 'View financial information and reports'),
  ('finance.manage', 'Manage invoices, payments, and concessions'),
  ('followups.read', 'View authorized follow-ups'),
  ('followups.manage', 'Manage authorized follow-ups'),
  ('reports.export', 'Export reports permitted by row-level security'),
  ('users.read', 'View admin accounts and role assignments'),
  ('users.manage', 'Create and manage admin accounts'),
  ('audit.read', 'View system audit and login notification history'),
  ('system.manage', 'Manage system settings and Developer functions');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'inactive', 'locked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.departments(id) ON DELETE RESTRICT,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_roles_scope_unique
  ON public.user_roles (user_id, role_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_permissions_active_scope_unique
  ON public.user_permissions (user_id, permission_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_number bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  external_patient_id text UNIQUE,
  created_department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL CHECK (length(trim(full_name)) > 0),
  contact_number text,
  date_of_birth date,
  age integer CHECK (age IS NULL OR age BETWEEN 0 AND 125),
  gender text CHECK (gender IS NULL OR gender IN ('female', 'male', 'other', 'unspecified')),
  address text,
  emergency_contact text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patients_name_search_idx ON public.patients USING gin (to_tsvector('simple', full_name));
CREATE INDEX patients_contact_idx ON public.patients (contact_number) WHERE archived_at IS NULL;
CREATE INDEX patients_department_idx ON public.patients (created_department_id) WHERE archived_at IS NULL;

CREATE TABLE public.patient_general_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  staff_number text UNIQUE,
  full_name text NOT NULL CHECK (length(trim(full_name)) > 0),
  contact_number text,
  email text,
  designation text NOT NULL,
  joining_date date,
  employment_status text NOT NULL DEFAULT 'active'
    CHECK (employment_status IN ('active', 'inactive', 'on_leave')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX staff_department_name_idx ON public.staff (department_id, full_name)
  WHERE archived_at IS NULL;

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  practitioner_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'missed')),
  followup_required boolean NOT NULL DEFAULT false,
  general_notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (ends_at > starts_at)
);

CREATE INDEX appointments_department_start_idx ON public.appointments (department_id, starts_at)
  WHERE archived_at IS NULL;
CREATE INDEX appointments_patient_start_idx ON public.appointments (patient_id, starts_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX appointments_practitioner_start_idx ON public.appointments (practitioner_id, starts_at)
  WHERE archived_at IS NULL;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_practitioner_no_overlap
  EXCLUDE USING gist (
    practitioner_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (
    practitioner_id IS NOT NULL
    AND status = 'scheduled'
    AND archived_at IS NULL
  );

CREATE TABLE public.physiotherapy_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  practitioner_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  diagnosis text NOT NULL,
  treatment_details text,
  prescribed_sessions integer NOT NULL DEFAULT 0 CHECK (prescribed_sessions >= 0),
  completed_sessions integer NOT NULL DEFAULT 0 CHECK (completed_sessions >= 0),
  followup_required boolean NOT NULL DEFAULT false,
  followup_date date,
  clinical_notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (completed_sessions <= prescribed_sessions)
);

CREATE INDEX physiotherapy_patient_idx ON public.physiotherapy_records (patient_id, created_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX physiotherapy_department_idx ON public.physiotherapy_records (department_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE public.physiotherapy_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.physiotherapy_records(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  session_date timestamptz NOT NULL,
  treatment text NOT NULL,
  practitioner_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  completed boolean NOT NULL DEFAULT true,
  clinical_notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX physiotherapy_sessions_record_date_idx
  ON public.physiotherapy_sessions (record_id, session_date DESC);

CREATE FUNCTION public.refresh_physiotherapy_session_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_record_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_record_id := OLD.record_id;
    UPDATE public.physiotherapy_records AS record
       SET completed_sessions = (
         SELECT count(*)::integer
           FROM public.physiotherapy_sessions AS session
          WHERE session.record_id = target_record_id
            AND session.completed
       )
     WHERE record.id = target_record_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.record_id IS DISTINCT FROM NEW.record_id THEN
    target_record_id := OLD.record_id;
    UPDATE public.physiotherapy_records AS record
       SET completed_sessions = (
         SELECT count(*)::integer
           FROM public.physiotherapy_sessions AS session
          WHERE session.record_id = target_record_id
            AND session.completed
       )
     WHERE record.id = target_record_id;
  END IF;

  target_record_id := NEW.record_id;
  UPDATE public.physiotherapy_records AS record
     SET completed_sessions = (
       SELECT count(*)::integer
         FROM public.physiotherapy_sessions AS session
        WHERE session.record_id = target_record_id
          AND session.completed
     )
   WHERE record.id = target_record_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_physiotherapy_session_count() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER physiotherapy_sessions_refresh_count
  AFTER INSERT OR UPDATE OR DELETE ON public.physiotherapy_sessions
  FOR EACH ROW EXECUTE FUNCTION public.refresh_physiotherapy_session_count();

CREATE TABLE public.psychology_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  psychologist_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  presenting_concern text NOT NULL,
  diagnosis text,
  followup_date date,
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'partial', 'assistance')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX psychology_patient_date_idx ON public.psychology_records (patient_id, created_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX psychology_department_date_idx ON public.psychology_records (department_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE public.psychology_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.psychology_records(id) ON DELETE CASCADE,
  note text NOT NULL,
  authored_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX psychology_notes_record_date_idx
  ON public.psychology_notes (record_id, created_at DESC);

CREATE TABLE public.hijama_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  practitioner_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  treatment_details text,
  followup_date date,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE public.nutrition_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  nutritionist_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  concern text,
  diet_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  treatment_notes text,
  followup_date date,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE public.exercise_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  batch_name text NOT NULL CHECK (batch_name IN ('morning', 'evening')),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  trainer_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (department_id, batch_name)
);

CREATE TABLE public.exercise_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.exercise_batches(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  joined_on date NOT NULL DEFAULT current_date,
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, patient_id)
);

CREATE TABLE public.exercise_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.exercise_participants(id) ON DELETE RESTRICT,
  attendance_date date NOT NULL,
  present boolean NOT NULL DEFAULT true,
  session_notes text,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, attendance_date)
);

CREATE TABLE public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  attendance_date date NOT NULL,
  status text NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'absent', 'late', 'leave')),
  check_in time,
  check_out time,
  notes text,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, attendance_date)
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  total_amount numeric(12, 2) NOT NULL CHECK (total_amount >= 0),
  concession_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (concession_amount >= 0),
  assistance_reason text,
  currency char(3) NOT NULL DEFAULT 'PKR',
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at date,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (concession_amount <= total_amount)
);

CREATE INDEX invoices_department_date_idx ON public.invoices (department_id, issued_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX invoices_patient_date_idx ON public.invoices (patient_id, issued_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'card', 'other')),
  paid_at timestamptz NOT NULL DEFAULT now(),
  reference text,
  received_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_invoice_paid_at_idx ON public.payments (invoice_id, paid_at DESC);

CREATE TABLE public.followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  practitioner_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  due_at date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'completed', 'cancelled')),
  notes text,
  completed_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX followups_department_due_idx ON public.followups (department_id, due_at, status)
  WHERE archived_at IS NULL;

CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  item_name text NOT NULL CHECK (length(trim(item_name)) > 0),
  category text,
  description text,
  unit text NOT NULL DEFAULT 'units',
  quantity_on_hand integer NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  minimum_stock_level integer NOT NULL DEFAULT 0 CHECK (minimum_stock_level >= 0),
  purchase_date date,
  expiry_date date,
  supplier text,
  purchase_cost numeric(12, 2) CHECK (purchase_cost IS NULL OR purchase_cost >= 0),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX inventory_department_name_idx ON public.inventory_items (department_id, item_name)
  WHERE archived_at IS NULL;
CREATE INDEX inventory_low_stock_idx ON public.inventory_items (department_id, quantity_on_hand)
  WHERE archived_at IS NULL;
CREATE INDEX inventory_expiry_idx ON public.inventory_items (expiry_date)
  WHERE expiry_date IS NOT NULL AND archived_at IS NULL;

CREATE TABLE public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity_change integer NOT NULL CHECK (quantity_change <> 0),
  transaction_type text NOT NULL
    CHECK (transaction_type IN ('purchase', 'consumption', 'adjustment', 'reversal')),
  reason text NOT NULL,
  reference text,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_transactions_item_date_idx
  ON public.inventory_transactions (item_id, created_at DESC);

CREATE TABLE public.equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  equipment_name text NOT NULL,
  category text,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  condition text NOT NULL DEFAULT 'working'
    CHECK (condition IN ('working', 'damaged', 'under_maintenance')),
  purchase_date date,
  availability_status text NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'unavailable', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE public.equipment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  equipment_name text NOT NULL,
  category text,
  required_quantity integer NOT NULL CHECK (required_quantity > 0),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  estimated_cost numeric(12, 2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  request_status text NOT NULL DEFAULT 'requested'
    CHECK (request_status IN ('requested', 'approved', 'rejected', 'purchased')),
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.equipment_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  performed_at date NOT NULL DEFAULT current_date,
  description text NOT NULL,
  cost numeric(12, 2) CHECK (cost IS NULL OR cost >= 0),
  performed_by text,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_actor_date_idx ON public.audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON public.audit_logs (entity_type, entity_id, created_at DESC);

CREATE TABLE public.login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  username text,
  success boolean NOT NULL,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_events_user_date_idx ON public.login_events (user_id, occurred_at DESC);
CREATE INDEX login_events_failed_date_idx ON public.login_events (occurred_at DESC)
  WHERE success = false;

CREATE TABLE public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL,
  ip_hash text NOT NULL,
  succeeded boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_email_time_idx ON public.login_attempts (normalized_email, attempted_at DESC);
CREATE INDEX login_attempts_ip_time_idx ON public.login_attempts (ip_hash, attempted_at DESC);

CREATE TABLE public.email_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_event_id uuid UNIQUE REFERENCES public.login_events(id) ON DELETE SET NULL,
  recipient_email text,
  subject text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_notifications_queue_idx
  ON public.email_notifications (delivery_status, created_at)
  WHERE delivery_status IN ('pending', 'failed');

CREATE TABLE public.system_settings (
  setting_key text PRIMARY KEY,
  setting_value jsonb NOT NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles', 'patients', 'staff', 'appointments', 'physiotherapy_records',
    'psychology_records', 'hijama_records', 'nutrition_records', 'exercise_batches',
    'staff_attendance', 'invoices', 'followups', 'inventory_items', 'equipment',
    'equipment_requests', 'email_notifications', 'system_settings'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION public.apply_inventory_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_quantity integer;
BEGIN
  UPDATE public.inventory_items
     SET quantity_on_hand = quantity_on_hand + NEW.quantity_change
   WHERE id = NEW.item_id
   RETURNING quantity_on_hand INTO updated_quantity;

  IF updated_quantity IS NULL THEN
    RAISE EXCEPTION 'Inventory item % does not exist', NEW.item_id;
  END IF;
  IF updated_quantity < 0 THEN
    RAISE EXCEPTION 'Inventory quantity cannot be negative';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_inventory_transaction() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER inventory_transaction_apply
  AFTER INSERT ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_transaction();

CREATE VIEW public.invoice_balances
WITH (security_invoker = true)
AS
SELECT
  invoice.id,
  invoice.patient_id,
  invoice.department_id,
  invoice.total_amount,
  invoice.concession_amount,
  COALESCE(sum(payment.amount), 0)::numeric(12, 2) AS amount_paid,
  GREATEST(invoice.total_amount - invoice.concession_amount - COALESCE(sum(payment.amount), 0), 0)::numeric(12, 2) AS balance_due,
  CASE
    WHEN invoice.total_amount = invoice.concession_amount THEN 'assistance'
    WHEN COALESCE(sum(payment.amount), 0) = 0 THEN 'unpaid'
    WHEN COALESCE(sum(payment.amount), 0) < invoice.total_amount - invoice.concession_amount THEN 'partial'
    ELSE 'paid'
  END AS payment_status,
  invoice.issued_at,
  invoice.due_at
FROM public.invoices AS invoice
LEFT JOIN public.payments AS payment ON payment.invoice_id = invoice.id
WHERE invoice.archived_at IS NULL
GROUP BY invoice.id;
