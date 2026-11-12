"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { MODULES } from "@/lib/modules";

const actorColumns: Record<string, string> = {
  patients: "created_by",
  appointments: "created_by",
  physiotherapy_records: "created_by",
  physiotherapy_sessions: "created_by",
  psychology_records: "created_by",
  psychology_notes: "authored_by",
  patient_general_notes: "created_by",
  hijama_records: "created_by",
  nutrition_records: "created_by",
  exercise_attendance: "recorded_by",
  staff_attendance: "recorded_by",
  invoices: "created_by",
  payments: "received_by",
  followups: "created_by",
  inventory_items: "created_by",
  inventory_transactions: "recorded_by",
  equipment_requests: "requested_by",
  equipment_maintenance: "recorded_by",
};

function redirectWithError(moduleId: string, recordId: string | null, error: string): never {
  const path = recordId
    ? `/modules/${moduleId}/${recordId}/edit`
    : `/modules/${moduleId}/new`;
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

function parseFieldValue(
  field: (typeof MODULES)[string]["fields"][number],
  formData: FormData,
): { value: unknown } | { error: string } {
  const formValue = formData.get(field.name);

  if (field.type === "checkbox") {
    return { value: formValue === "on" };
  }

  const value = typeof formValue === "string" ? formValue.trim() : "";
  if (!value) {
    if (field.required) {
      return { error: "required" };
    }
    return { value: field.type === "json" ? {} : null };
  }

  if (value.length > 10_000) {
    return { error: "too-long" };
  }

  if (field.type === "number" || field.type === "money") {
    const numberValue = Number(value);
    if (
      !Number.isFinite(numberValue) ||
      (field.type === "number" && !Number.isInteger(numberValue))
    ) {
      return { error: "invalid-number" };
    }
    return { value: numberValue };
  }

  if (field.type === "datetime-local") {
    const date = new Date(`${value}:00+05:00`);
    if (!Number.isFinite(date.getTime())) {
      return { error: "invalid-date" };
    }
    return { value: date.toISOString() };
  }

  if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { error: "invalid-date" };
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      return { error: "invalid-date" };
    }
  }

  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { error: "invalid-email" };
  }

  if (field.type === "select" && field.options && !field.options.some((option) => option.value === value)) {
    return { error: "invalid-choice" };
  }

  if (field.type === "json") {
    try {
      return { value: JSON.parse(value) as unknown };
    } catch {
      return { error: "invalid-json" };
    }
  }

  return { value };
}

async function checkPermission(
  client: Awaited<ReturnType<typeof requireUser>>["client"],
  permission: string,
  departmentId?: string | null,
): Promise<void> {
  const { data, error } = await client.rpc("has_permission", {
    p_permission_key: permission,
    p_department_id: departmentId ?? null,
  });
  if (error) {
    throw new Error(`Could not verify ${permission}: ${error.message}`);
  }
  if (!data) {
    redirect("/dashboard?error=forbidden");
  }
}

async function getModuleDepartmentId(
  client: Awaited<ReturnType<typeof requireUser>>["client"],
  moduleId: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const definition = MODULES[moduleId];
  if (definition.departmentSlug) {
    const { data, error } = await client
      .from("departments")
      .select("id")
      .eq("slug", definition.departmentSlug)
      .single();
    if (error) {
      throw new Error(`Could not resolve the module department: ${error.message}`);
    }
    payload.department_id = data.id;
    return data.id;
  }

  const departmentId = payload.department_id ?? payload.created_department_id;
  return typeof departmentId === "string" ? departmentId : null;
}

export async function saveRecord(
  moduleId: string,
  recordId: string | null,
  formData: FormData,
): Promise<void> {
  const definition = MODULES[moduleId];
  if (!definition || (recordId && definition.updateable === false)) {
    redirect("/dashboard?error=forbidden");
  }

  const { client, profile } = await requireUser();
  const payload: Record<string, unknown> = {};

  const fields = recordId && definition.updateFields
    ? definition.fields.filter((field) => definition.updateFields?.includes(field.name))
    : definition.fields;
  for (const field of fields) {
    const parsed = parseFieldValue(field, formData);
    if ("error" in parsed) {
      redirectWithError(moduleId, recordId, parsed.error);
    }
    payload[field.name] = parsed.value;
  }

  const departmentId = await getModuleDepartmentId(client, moduleId, payload);
  await checkPermission(
    client,
    recordId ? definition.updatePermission : definition.createPermission,
    departmentId,
  );
  if (!recordId && definition.additionalCreatePermission) {
    await checkPermission(client, definition.additionalCreatePermission, departmentId);
  }

  if (recordId && moduleId === "equipment-requests") {
    payload.reviewed_by = profile.id;
    payload.reviewed_at = new Date().toISOString();
  }

  if (!recordId) {
    const actorColumn = actorColumns[definition.table];
    if (actorColumn) {
      payload[actorColumn] = profile.id;
    }
  }

  const query = recordId
    ? client.from(definition.table).update(payload).eq("id", recordId)
    : client.from(definition.table).insert(payload);
  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    console.error(`Could not save ${definition.table}:`, error.message);
    redirectWithError(moduleId, recordId, "save-failed");
  }
  if (!data) {
    redirectWithError(moduleId, recordId, "not-found-or-forbidden");
  }

  revalidatePath(`/modules/${moduleId}`);
  redirect(`/modules/${moduleId}?saved=1`);
}

export async function archiveRecord(moduleId: string, formData: FormData): Promise<void> {
  const definition = MODULES[moduleId];
  const recordId = formData.get("recordId");
  if (
    !definition ||
    !definition.archiveField ||
    typeof recordId !== "string" ||
    !recordId
  ) {
    redirect("/dashboard?error=forbidden");
  }

  const { client } = await requireUser();
  const permission =
    moduleId === "patients" ? "patients.archive" : definition.updatePermission;
  await checkPermission(client, permission);

  const archivedValue =
    definition.archiveField === "archived_at" ? new Date().toISOString() : false;
  const { data, error } = await client
    .from(definition.table)
    .update({ [definition.archiveField]: archivedValue })
    .eq("id", recordId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`Could not archive ${definition.table}:`, error.message);
    redirect(`/modules/${moduleId}?error=archive-failed`);
  }
  if (!data) {
    redirect(`/modules/${moduleId}?error=not-found-or-forbidden`);
  }

  revalidatePath(`/modules/${moduleId}`);
  redirect(`/modules/${moduleId}?archived=1`);
}
