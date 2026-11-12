export type FieldType =
  | "text"
  | "email"
  | "number"
  | "money"
  | "date"
  | "time"
  | "datetime-local"
  | "textarea"
  | "checkbox"
  | "select"
  | "json";

export type FieldOption = {
  label: string;
  value: string;
};

export type FormField = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  step?: string;
  options?: readonly FieldOption[];
  optionTable?: string;
  optionSelect?: string;
  optionLabel?: string;
  optionDetail?: string;
  helpText?: string;
};

export type TableColumn = {
  key: string;
  label: string;
};

export type ModuleDefinition = {
  title: string;
  table: string;
  readPermission: string;
  createPermission: string;
  updatePermission: string;
  departmentSlug?: string;
  select: string;
  orderBy: string;
  columns: readonly TableColumn[];
  fields: readonly FormField[];
  searchColumns?: readonly string[];
  archiveField?: "archived_at" | "active";
  updateable?: boolean;
  additionalCreatePermission?: string;
  updateFields?: readonly string[];
};

const departmentField: FormField = {
  name: "department_id",
  label: "Department",
  type: "select",
  required: true,
  optionTable: "departments",
  optionLabel: "name",
};

const patientField: FormField = {
  name: "patient_id",
  label: "Patient",
  type: "select",
  required: true,
  optionTable: "patients",
  optionSelect: "id,patient_number,full_name",
  optionLabel: "full_name",
  optionDetail: "patient_number",
};

const staffField: FormField = {
  name: "practitioner_id",
  label: "Practitioner",
  type: "select",
  optionTable: "staff",
  optionSelect: "id,staff_number,full_name",
  optionLabel: "full_name",
  optionDetail: "staff_number",
};

const statusOptions = (...values: string[]): readonly FieldOption[] =>
  values.map((value) => ({ value, label: value.replaceAll("_", " ") }));

export const MODULES: Record<string, ModuleDefinition> = {
  patients: {
    title: "Patients",
    table: "patients",
    readPermission: "patients.read",
    createPermission: "patients.create",
    updatePermission: "patients.update",
    select: "id,patient_number,external_patient_id,full_name,contact_number,age,gender,registered_at,created_department_id,department:departments(name)",
    orderBy: "registered_at",
    columns: [
      { key: "patient_number", label: "Patient ID" },
      { key: "full_name", label: "Full name" },
      { key: "contact_number", label: "Contact" },
      { key: "age", label: "Age" },
      { key: "gender", label: "Gender" },
      { key: "department.name", label: "Registered by" },
      { key: "registered_at", label: "Registered" },
    ],
    searchColumns: ["full_name", "contact_number", "external_patient_id"],
    fields: [
      { name: "full_name", label: "Full name", type: "text", required: true },
      { name: "external_patient_id", label: "External patient ID", type: "text" },
      { name: "created_department_id", label: "Registration department", type: "select", required: true, optionTable: "departments", optionLabel: "name" },
      { name: "contact_number", label: "Contact number", type: "text" },
      { name: "date_of_birth", label: "Date of birth", type: "date" },
      { name: "age", label: "Age", type: "number", step: "1" },
      { name: "gender", label: "Gender", type: "select", options: statusOptions("female", "male", "other", "unspecified") },
      { name: "address", label: "Address", type: "textarea" },
      { name: "emergency_contact", label: "Emergency contact", type: "text" },
    ],
    archiveField: "archived_at",
  },
  "patient-notes": {
    title: "General patient notes",
    table: "patient_general_notes",
    readPermission: "patients.notes.read",
    createPermission: "patients.update",
    updatePermission: "patients.notes.read",
    select: "id,patient_id,note,created_at,patient:patients(full_name)",
    orderBy: "created_at",
    columns: [
      { key: "patient.full_name", label: "Patient" },
      { key: "note", label: "Note" },
      { key: "created_at", label: "Added" },
    ],
    fields: [
      patientField,
      { name: "note", label: "Note", type: "textarea", required: true },
    ],
    updateable: false,
  },
  appointments: {
    title: "Appointments",
    table: "appointments",
    readPermission: "appointments.read",
    createPermission: "appointments.manage",
    updatePermission: "appointments.manage",
    select: "id,starts_at,ends_at,status,followup_required,department_id,patient:patients(full_name),practitioner:staff(full_name),department:departments(name)",
    orderBy: "starts_at",
    columns: [
      { key: "starts_at", label: "Starts" },
      { key: "ends_at", label: "Ends" },
      { key: "patient.full_name", label: "Patient" },
      { key: "practitioner.full_name", label: "Practitioner" },
      { key: "department.name", label: "Department" },
      { key: "status", label: "Status" },
    ],
    searchColumns: ["status"],
    fields: [
      patientField,
      departmentField,
      staffField,
      { name: "starts_at", label: "Start time", type: "datetime-local", required: true },
      { name: "ends_at", label: "End time", type: "datetime-local", required: true },
      { name: "status", label: "Status", type: "select", required: true, options: statusOptions("scheduled", "completed", "cancelled", "missed") },
      { name: "followup_required", label: "Follow-up required", type: "checkbox" },
      { name: "general_notes", label: "General notes", type: "textarea" },
    ],
  },
  physiotherapy: {
    title: "Physiotherapy",
    table: "physiotherapy_records",
    readPermission: "physiotherapy.read",
    createPermission: "physiotherapy.manage",
    updatePermission: "physiotherapy.manage",
    departmentSlug: "physiotherapy",
    select: "id,diagnosis,prescribed_sessions,completed_sessions,followup_date,created_at,patient:patients(full_name),practitioner:staff(full_name)",
    orderBy: "created_at",
    columns: [
      { key: "patient.full_name", label: "Patient" },
      { key: "diagnosis", label: "Diagnosis" },
      { key: "practitioner.full_name", label: "Practitioner" },
      { key: "prescribed_sessions", label: "Planned" },
      { key: "completed_sessions", label: "Completed" },
      { key: "remaining_sessions", label: "Remaining" },
      { key: "followup_date", label: "Follow-up" },
    ],
    searchColumns: ["diagnosis"],
    fields: [
      patientField,
      staffField,
      { name: "diagnosis", label: "Diagnosis", type: "textarea", required: true },
      { name: "treatment_details", label: "Treatment details", type: "textarea" },
      { name: "prescribed_sessions", label: "Prescribed sessions", type: "number", step: "1", required: true },
      { name: "followup_required", label: "Follow-up required", type: "checkbox" },
      { name: "followup_date", label: "Follow-up date", type: "date" },
      { name: "clinical_notes", label: "Clinical notes", type: "textarea" },
    ],
    archiveField: "archived_at",
  },
  "physiotherapy-sessions": {
    title: "Physiotherapy sessions",
    table: "physiotherapy_sessions",
    readPermission: "physiotherapy.read",
    createPermission: "physiotherapy.manage",
    updatePermission: "physiotherapy.manage",
    select: "id,session_date,treatment,completed,record:physiotherapy_records(patient:patients(full_name)),practitioner:staff(full_name)",
    orderBy: "session_date",
    columns: [
      { key: "session_date", label: "Session date" },
      { key: "record.patient.full_name", label: "Patient" },
      { key: "treatment", label: "Treatment" },
      { key: "practitioner.full_name", label: "Practitioner" },
      { key: "completed", label: "Completed" },
    ],
    fields: [
      { name: "record_id", label: "Physiotherapy record", type: "select", required: true, optionTable: "physiotherapy_records", optionLabel: "diagnosis" },
      { name: "session_date", label: "Session date", type: "datetime-local", required: true },
      { name: "treatment", label: "Treatment", type: "textarea", required: true },
      staffField,
      { name: "completed", label: "Completed", type: "checkbox" },
      { name: "clinical_notes", label: "Clinical notes", type: "textarea" },
    ],
  },
  psychology: {
    title: "Psychology",
    table: "psychology_records",
    readPermission: "psychology.read",
    createPermission: "psychology.manage",
    updatePermission: "psychology.manage",
    departmentSlug: "psychology",
    select: "id,presenting_concern,diagnosis,followup_date,payment_status,created_at,patient:patients(full_name),psychologist:staff(full_name)",
    orderBy: "created_at",
    columns: [
      { key: "patient.full_name", label: "Patient" },
      { key: "presenting_concern", label: "Presenting concern" },
      { key: "diagnosis", label: "Diagnosis" },
      { key: "psychologist.full_name", label: "Psychologist" },
      { key: "followup_date", label: "Follow-up" },
    ],
    searchColumns: ["presenting_concern", "diagnosis"],
    fields: [
      patientField,
      { name: "psychologist_id", label: "Psychologist", type: "select", optionTable: "staff", optionLabel: "full_name" },
      { name: "presenting_concern", label: "Presenting concern", type: "textarea", required: true },
      { name: "diagnosis", label: "Diagnosis", type: "textarea" },
      { name: "followup_date", label: "Follow-up date", type: "date" },
      { name: "payment_status", label: "Payment status", type: "select", required: true, options: statusOptions("pending", "paid", "partial", "assistance") },
    ],
    archiveField: "archived_at",
  },
  "psychology-notes": {
    title: "Confidential psychology notes",
    table: "psychology_notes",
    readPermission: "psychology.notes.read",
    createPermission: "psychology.notes.read",
    updatePermission: "psychology.notes.read",
    select: "id,note,created_at,record:psychology_records(patient:patients(full_name))",
    orderBy: "created_at",
    columns: [
      { key: "record.patient.full_name", label: "Patient" },
      { key: "note", label: "Clinical note" },
      { key: "created_at", label: "Added" },
    ],
    fields: [
      { name: "record_id", label: "Psychology record", type: "select", required: true, optionTable: "psychology_records", optionLabel: "presenting_concern" },
      { name: "note", label: "Clinical note", type: "textarea", required: true },
    ],
    additionalCreatePermission: "psychology.manage",
    updateable: false,
  },
  hijama: {
    title: "Hijama",
    table: "hijama_records",
    readPermission: "hijama.read",
    createPermission: "hijama.manage",
    updatePermission: "hijama.manage",
    departmentSlug: "hijama",
    select: "id,treatment_details,followup_date,created_at,patient:patients(full_name),practitioner:staff(full_name)",
    orderBy: "created_at",
    columns: [
      { key: "patient.full_name", label: "Patient" },
      { key: "practitioner.full_name", label: "Practitioner" },
      { key: "treatment_details", label: "Treatment" },
      { key: "followup_date", label: "Follow-up" },
      { key: "created_at", label: "Created" },
    ],
    fields: [
      patientField,
      staffField,
      { name: "appointment_id", label: "Appointment", type: "select", optionTable: "appointments", optionSelect: "id,starts_at,patient:patients(full_name)", optionLabel: "starts_at", optionDetail: "patient.full_name" },
      { name: "treatment_details", label: "Treatment details", type: "textarea" },
      { name: "followup_date", label: "Follow-up date", type: "date" },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
    archiveField: "archived_at",
  },
  nutrition: {
    title: "Nutrition",
    table: "nutrition_records",
    readPermission: "nutrition.read",
    createPermission: "nutrition.manage",
    updatePermission: "nutrition.manage",
    departmentSlug: "nutrition",
    select: "id,concern,followup_date,created_at,patient:patients(full_name),nutritionist:staff(full_name)",
    orderBy: "created_at",
    columns: [
      { key: "patient.full_name", label: "Patient" },
      { key: "concern", label: "Concern" },
      { key: "nutritionist.full_name", label: "Nutritionist" },
      { key: "followup_date", label: "Follow-up" },
      { key: "created_at", label: "Created" },
    ],
    fields: [
      patientField,
      { name: "nutritionist_id", label: "Nutritionist", type: "select", optionTable: "staff", optionLabel: "full_name" },
      { name: "concern", label: "Nutrition concern", type: "textarea" },
      { name: "diet_plan", label: "Diet plan (JSON)", type: "json", helpText: "Enter a JSON object; do not include unrelated sensitive notes." },
      { name: "treatment_notes", label: "Treatment notes", type: "textarea" },
      { name: "followup_date", label: "Follow-up date", type: "date" },
    ],
    archiveField: "archived_at",
  },
  "exercise-batches": {
    title: "Exercise batches",
    table: "exercise_batches",
    readPermission: "exercise.read",
    createPermission: "exercise.manage",
    updatePermission: "exercise.manage",
    departmentSlug: "female-exercise",
    select: "id,batch_name,starts_at,ends_at,is_active,department:departments(name),trainer:staff(full_name)",
    orderBy: "batch_name",
    columns: [
      { key: "batch_name", label: "Batch" },
      { key: "starts_at", label: "Starts" },
      { key: "ends_at", label: "Ends" },
      { key: "trainer.full_name", label: "Trainer" },
      { key: "is_active", label: "Active" },
    ],
    fields: [
      departmentField,
      { name: "batch_name", label: "Batch", type: "select", required: true, options: statusOptions("morning", "evening") },
      { name: "starts_at", label: "Start time", type: "time", required: true },
      { name: "ends_at", label: "End time", type: "time", required: true },
      { name: "trainer_id", label: "Trainer", type: "select", optionTable: "staff", optionLabel: "full_name" },
      { name: "is_active", label: "Active", type: "checkbox" },
    ],
  },
  "exercise-participants": {
    title: "Exercise participants",
    table: "exercise_participants",
    readPermission: "exercise.read",
    createPermission: "exercise.manage",
    updatePermission: "exercise.manage",
    departmentSlug: "female-exercise",
    select: "id,joined_on,active,patient:patients(full_name),batch:exercise_batches(batch_name)",
    orderBy: "joined_on",
    columns: [
      { key: "patient.full_name", label: "Patient" },
      { key: "batch.batch_name", label: "Batch" },
      { key: "joined_on", label: "Joined" },
      { key: "active", label: "Active" },
    ],
    fields: [
      { name: "batch_id", label: "Batch", type: "select", required: true, optionTable: "exercise_batches", optionLabel: "batch_name" },
      patientField,
      { name: "joined_on", label: "Joined on", type: "date", required: true },
      { name: "active", label: "Active", type: "checkbox" },
    ],
    archiveField: "active",
  },
  "exercise-attendance": {
    title: "Exercise attendance",
    table: "exercise_attendance",
    readPermission: "exercise.read",
    createPermission: "exercise.manage",
    updatePermission: "exercise.manage",
    departmentSlug: "female-exercise",
    select: "id,attendance_date,present,participant:exercise_participants(patient:patients(full_name),batch:exercise_batches(batch_name))",
    orderBy: "attendance_date",
    columns: [
      { key: "attendance_date", label: "Date" },
      { key: "participant.patient.full_name", label: "Patient" },
      { key: "participant.batch.batch_name", label: "Batch" },
      { key: "present", label: "Present" },
    ],
    fields: [
      { name: "participant_id", label: "Participant", type: "select", required: true, optionTable: "exercise_participants", optionSelect: "id,patient:patients(full_name),batch:exercise_batches(batch_name)", optionLabel: "patient.full_name", optionDetail: "batch.batch_name" },
      { name: "attendance_date", label: "Attendance date", type: "date", required: true },
      { name: "present", label: "Present", type: "checkbox" },
      { name: "session_notes", label: "Session notes", type: "textarea" },
    ],
  },
  staff: {
    title: "Staff",
    table: "staff",
    readPermission: "staff.read",
    createPermission: "staff.manage",
    updatePermission: "staff.manage",
    select: "id,staff_number,full_name,designation,contact_number,employment_status,department:departments(name)",
    orderBy: "full_name",
    columns: [
      { key: "staff_number", label: "Staff ID" },
      { key: "full_name", label: "Name" },
      { key: "designation", label: "Designation" },
      { key: "department.name", label: "Department" },
      { key: "contact_number", label: "Contact" },
      { key: "employment_status", label: "Status" },
    ],
    searchColumns: ["full_name", "designation", "contact_number"],
    fields: [
      departmentField,
      { name: "staff_number", label: "Staff ID", type: "text" },
      { name: "full_name", label: "Name", type: "text", required: true },
      { name: "contact_number", label: "Contact", type: "text" },
      { name: "email", label: "Email", type: "email" },
      { name: "designation", label: "Designation", type: "text", required: true },
      { name: "joining_date", label: "Joining date", type: "date" },
      { name: "employment_status", label: "Employment status", type: "select", required: true, options: statusOptions("active", "inactive", "on_leave") },
    ],
    archiveField: "archived_at",
  },
  attendance: {
    title: "Staff attendance",
    table: "staff_attendance",
    readPermission: "attendance.read",
    createPermission: "attendance.manage",
    updatePermission: "attendance.manage",
    select: "id,attendance_date,status,check_in,check_out,staff:staff(full_name,department:departments(name))",
    orderBy: "attendance_date",
    columns: [
      { key: "attendance_date", label: "Date" },
      { key: "staff.full_name", label: "Staff member" },
      { key: "staff.department.name", label: "Department" },
      { key: "status", label: "Status" },
      { key: "check_in", label: "Check in" },
      { key: "check_out", label: "Check out" },
    ],
    fields: [
      { name: "staff_id", label: "Staff member", type: "select", required: true, optionTable: "staff", optionLabel: "full_name" },
      { name: "attendance_date", label: "Date", type: "date", required: true },
      { name: "status", label: "Status", type: "select", required: true, options: statusOptions("present", "absent", "late", "leave") },
      { name: "check_in", label: "Check in", type: "time" },
      { name: "check_out", label: "Check out", type: "time" },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  invoices: {
    title: "Invoices",
    table: "invoices",
    readPermission: "finance.read",
    createPermission: "finance.manage",
    updatePermission: "finance.manage",
    select: "id,total_amount,concession_amount,currency,issued_at,due_at,patient:patients(full_name),department:departments(name)",
    orderBy: "issued_at",
    columns: [
      { key: "issued_at", label: "Issued" },
      { key: "patient.full_name", label: "Patient" },
      { key: "department.name", label: "Department" },
      { key: "total_amount", label: "Total (PKR)" },
      { key: "concession_amount", label: "Concession" },
      { key: "due_at", label: "Due" },
    ],
    fields: [
      patientField,
      departmentField,
      { name: "appointment_id", label: "Appointment", type: "select", optionTable: "appointments", optionLabel: "starts_at" },
      { name: "total_amount", label: "Total amount", type: "money", required: true, step: "0.01" },
      { name: "concession_amount", label: "Concession", type: "money", required: true, step: "0.01" },
      { name: "assistance_reason", label: "Assistance reason", type: "textarea" },
      { name: "due_at", label: "Due date", type: "date" },
    ],
    archiveField: "archived_at",
  },
  payments: {
    title: "Payments",
    table: "payments",
    readPermission: "finance.read",
    createPermission: "finance.manage",
    updatePermission: "finance.manage",
    select: "id,amount,method,paid_at,reference,invoice:invoices(patient:patients(full_name),department:departments(name))",
    orderBy: "paid_at",
    columns: [
      { key: "paid_at", label: "Paid at" },
      { key: "invoice.patient.full_name", label: "Patient" },
      { key: "invoice.department.name", label: "Department" },
      { key: "amount", label: "Amount (PKR)" },
      { key: "method", label: "Method" },
      { key: "reference", label: "Reference" },
    ],
    fields: [
      { name: "invoice_id", label: "Invoice", type: "select", required: true, optionTable: "invoices", optionSelect: "id,total_amount,patient:patients(full_name)", optionLabel: "patient.full_name", optionDetail: "total_amount" },
      { name: "amount", label: "Amount", type: "money", required: true, step: "0.01" },
      { name: "method", label: "Method", type: "select", required: true, options: statusOptions("cash", "bank_transfer", "card", "other") },
      { name: "paid_at", label: "Paid at", type: "datetime-local", required: true },
      { name: "reference", label: "Reference", type: "text" },
    ],
    updateable: false,
  },
  followups: {
    title: "Follow-ups",
    table: "followups",
    readPermission: "followups.read",
    createPermission: "followups.manage",
    updatePermission: "followups.manage",
    select: "id,due_at,reason,status,completed_at,patient:patients(full_name),department:departments(name),practitioner:staff(full_name)",
    orderBy: "due_at",
    columns: [
      { key: "due_at", label: "Due" },
      { key: "patient.full_name", label: "Patient" },
      { key: "department.name", label: "Department" },
      { key: "practitioner.full_name", label: "Practitioner" },
      { key: "reason", label: "Reason" },
      { key: "status", label: "Status" },
    ],
    fields: [
      patientField,
      departmentField,
      staffField,
      { name: "due_at", label: "Follow-up date", type: "date", required: true },
      { name: "reason", label: "Reason", type: "textarea", required: true },
      { name: "status", label: "Status", type: "select", required: true, options: statusOptions("upcoming", "completed", "cancelled") },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
    archiveField: "archived_at",
  },
  inventory: {
    title: "Inventory",
    table: "inventory_items",
    readPermission: "inventory.read",
    createPermission: "inventory.manage",
    updatePermission: "inventory.manage",
    select: "id,item_name,category,unit,quantity_on_hand,minimum_stock_level,expiry_date,department:departments(name)",
    orderBy: "item_name",
    columns: [
      { key: "item_name", label: "Item" },
      { key: "category", label: "Category" },
      { key: "department.name", label: "Department" },
      { key: "quantity_on_hand", label: "Available" },
      { key: "minimum_stock_level", label: "Reorder at" },
      { key: "expiry_date", label: "Expiry" },
    ],
    searchColumns: ["item_name", "category"],
    fields: [
      departmentField,
      { name: "item_name", label: "Item name", type: "text", required: true },
      { name: "category", label: "Category", type: "text" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "unit", label: "Unit", type: "text", required: true },
      { name: "minimum_stock_level", label: "Minimum stock", type: "number", required: true, step: "1" },
      { name: "purchase_date", label: "Purchase date", type: "date" },
      { name: "expiry_date", label: "Expiry date", type: "date" },
      { name: "supplier", label: "Supplier", type: "text" },
      { name: "purchase_cost", label: "Purchase cost", type: "money", step: "0.01" },
    ],
    updateFields: [
      "item_name",
      "category",
      "description",
      "unit",
      "minimum_stock_level",
      "purchase_date",
      "expiry_date",
      "supplier",
      "purchase_cost",
    ],
    archiveField: "archived_at",
  },
  "inventory-transactions": {
    title: "Stock transactions",
    table: "inventory_transactions",
    readPermission: "inventory.read",
    createPermission: "inventory.manage",
    updatePermission: "inventory.manage",
    select: "id,quantity_change,transaction_type,reason,reference,created_at,item:inventory_items(item_name)",
    orderBy: "created_at",
    columns: [
      { key: "created_at", label: "Date" },
      { key: "item.item_name", label: "Item" },
      { key: "transaction_type", label: "Type" },
      { key: "quantity_change", label: "Change" },
      { key: "reason", label: "Reason" },
      { key: "reference", label: "Reference" },
    ],
    fields: [
      { name: "item_id", label: "Inventory item", type: "select", required: true, optionTable: "inventory_items", optionLabel: "item_name" },
      { name: "quantity_change", label: "Quantity change (+ or -)", type: "number", required: true, step: "1" },
      { name: "transaction_type", label: "Transaction type", type: "select", required: true, options: statusOptions("purchase", "consumption", "adjustment", "reversal") },
      { name: "reason", label: "Reason", type: "text", required: true },
      { name: "reference", label: "Reference", type: "text" },
    ],
    updateable: false,
  },
  equipment: {
    title: "Equipment present",
    table: "equipment",
    readPermission: "equipment.read",
    createPermission: "equipment.manage",
    updatePermission: "equipment.manage",
    select: "id,equipment_name,category,quantity,condition,availability_status,purchase_date,department:departments(name)",
    orderBy: "equipment_name",
    columns: [
      { key: "equipment_name", label: "Equipment" },
      { key: "category", label: "Category" },
      { key: "department.name", label: "Department" },
      { key: "quantity", label: "Quantity" },
      { key: "condition", label: "Condition" },
      { key: "availability_status", label: "Availability" },
    ],
    fields: [
      departmentField,
      { name: "equipment_name", label: "Equipment name", type: "text", required: true },
      { name: "category", label: "Category", type: "text" },
      { name: "quantity", label: "Quantity", type: "number", required: true, step: "1" },
      { name: "condition", label: "Condition", type: "select", required: true, options: statusOptions("working", "damaged", "under_maintenance") },
      { name: "purchase_date", label: "Purchase date", type: "date" },
      { name: "availability_status", label: "Availability", type: "select", required: true, options: statusOptions("available", "unavailable", "retired") },
    ],
    archiveField: "archived_at",
  },
  "equipment-requests": {
    title: "Equipment required",
    table: "equipment_requests",
    readPermission: "equipment.read",
    createPermission: "equipment.requests.create",
    updatePermission: "equipment.requests.approve",
    select: "id,equipment_name,required_quantity,priority,estimated_cost,request_status,requested_at,department:departments(name)",
    orderBy: "requested_at",
    columns: [
      { key: "equipment_name", label: "Equipment" },
      { key: "department.name", label: "Department" },
      { key: "required_quantity", label: "Quantity" },
      { key: "priority", label: "Priority" },
      { key: "estimated_cost", label: "Estimated cost" },
      { key: "request_status", label: "Status" },
    ],
    fields: [
      departmentField,
      { name: "equipment_name", label: "Equipment name", type: "text", required: true },
      { name: "category", label: "Category", type: "text" },
      { name: "required_quantity", label: "Required quantity", type: "number", required: true, step: "1" },
      { name: "priority", label: "Priority", type: "select", required: true, options: statusOptions("low", "normal", "high", "urgent") },
      { name: "estimated_cost", label: "Estimated cost", type: "money", step: "0.01" },
      { name: "request_status", label: "Request status", type: "select", required: true, options: statusOptions("requested", "approved", "rejected", "purchased") },
      { name: "review_notes", label: "Review notes", type: "textarea" },
    ],
  },
  "equipment-maintenance": {
    title: "Equipment maintenance",
    table: "equipment_maintenance",
    readPermission: "equipment.read",
    createPermission: "equipment.manage",
    updatePermission: "equipment.manage",
    select: "id,performed_at,description,cost,performed_by,equipment:equipment(equipment_name)",
    orderBy: "performed_at",
    columns: [
      { key: "performed_at", label: "Date" },
      { key: "equipment.equipment_name", label: "Equipment" },
      { key: "description", label: "Work performed" },
      { key: "cost", label: "Cost" },
      { key: "performed_by", label: "Performed by" },
    ],
    fields: [
      { name: "equipment_id", label: "Equipment", type: "select", required: true, optionTable: "equipment", optionLabel: "equipment_name" },
      { name: "performed_at", label: "Date", type: "date", required: true },
      { name: "description", label: "Description", type: "textarea", required: true },
      { name: "cost", label: "Cost", type: "money", step: "0.01" },
      { name: "performed_by", label: "Performed by", type: "text" },
    ],
    updateable: false,
  },
};

export function getModuleDefinition(moduleId: string): ModuleDefinition {
  const definition = MODULES[moduleId];
  if (!definition) {
    throw new Error("Unknown clinic module.");
  }
  return definition;
}
