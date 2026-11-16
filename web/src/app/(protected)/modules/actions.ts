"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { MODULES } from "@/lib/modules";

const actorColumns: Record<string, string> = {
  patients: "created_by",
  appointments: "created_by",
  physiotherapy_records: "created_by",
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

async function hasServerPermission(
  client: Awaited<ReturnType<typeof requireUser>>["client"],
  permission: string,
  departmentId?: string | null,
): Promise<boolean> {
  const { data, error } = await client.rpc("has_permission", {
    p_permission_key: permission,
    p_department_id: departmentId ?? null,
  });
  if (error) {
    throw new Error(`Could not verify ${permission}: ${error.message}`);
  }
  return Boolean(data);
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

type SaveRecordResult =
  | {
      success: true;
      recordId: string;
      departmentId: string | null;
      operation: "create" | "update";
      table: string;
      client: Awaited<ReturnType<typeof requireUser>>["client"];
    }
  | { success: false; error: string };

async function persistRecord(
  moduleId: string,
  recordId: string | null,
  formData: FormData,
  requireAssistantAudit = false,
): Promise<SaveRecordResult> {
  const definition = MODULES[moduleId];
  if (!definition || (recordId && definition.updateable === false)) {
    return { success: false, error: "not-found-or-forbidden" };
  }

  const { client, profile } = await requireUser();
  const payload: Record<string, unknown> = {};

  const fields = recordId && definition.updateFields
    ? definition.fields.filter((field) => definition.updateFields?.includes(field.name))
    : definition.fields;
  for (const field of fields) {
    const parsed = parseFieldValue(field, formData);
    if ("error" in parsed) {
      return { success: false, error: parsed.error };
    }
    payload[field.name] = parsed.value;
  }

  const departmentId = await getModuleDepartmentId(client, moduleId, payload);
  const hasPermission = await hasServerPermission(
    client,
    recordId ? definition.updatePermission : definition.createPermission,
    departmentId,
  );
  if (!hasPermission) {
    return { success: false, error: "not-found-or-forbidden" };
  }
  if (!recordId && definition.additionalCreatePermission) {
    if (!(await hasServerPermission(client, definition.additionalCreatePermission, departmentId))) {
      return { success: false, error: "not-found-or-forbidden" };
    }
  }

  if (requireAssistantAudit) {
    const { error } = await client.rpc("log_assistant_action", {
      p_entity_type: definition.table,
      p_entity_id: null,
      p_operation: "prepare",
    });
    if (error) {
      console.error("Could not verify assistant audit support:", error.message);
      return { success: false, error: "assistant-audit-unavailable" };
    }
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

  const savedRecordId = recordId ?? randomUUID();
  if (recordId) {
    const { data, error } = await client
      .from(definition.table)
      .update(payload)
      .eq("id", recordId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error(`Could not save ${definition.table}:`, error.message);
      return { success: false, error: "save-failed" };
    }
    if (!data) {
      return { success: false, error: "not-found-or-forbidden" };
    }
  } else {
    // Avoid requiring SELECT access just to retrieve the ID of an inserted row.
    payload.id = savedRecordId;
    const { error } = await client.from(definition.table).insert(payload);
    if (error) {
      console.error(`Could not save ${definition.table}:`, error.message);
      return { success: false, error: "save-failed" };
    }
  }

  return {
    success: true,
    recordId: savedRecordId,
    departmentId,
    operation: recordId ? "update" : "create",
    table: definition.table,
    client,
  };
}

export async function saveRecord(
  moduleId: string,
  recordId: string | null,
  formData: FormData,
): Promise<void> {
  const result = await persistRecord(moduleId, recordId, formData);
  if (!result.success) {
    redirectWithError(moduleId, recordId, result.error);
  }

  revalidatePath(`/modules/${moduleId}`);
  redirect(`/modules/${moduleId}?saved=1`);
}

export async function saveRecordWithAssistant(
  moduleId: string,
  recordId: string | null,
  values: Record<string, string | boolean>,
  confirmed: boolean,
  allowDuplicatePatient = false,
): Promise<{
  success: boolean;
  message: string;
  recordId?: string;
  needsDuplicateConfirmation?: boolean;
}> {
  if (!confirmed) {
    return { success: false, message: "Confirm the reviewed form before saving." };
  }

  const definition = MODULES[moduleId];
  if (!definition || (recordId && definition.updateable === false)) {
    return { success: false, message: "This action is not available." };
  }

  const formData = new FormData();
  for (const field of definition.fields) {
    const value = values[field.name];
    if (field.type === "checkbox") {
      if (value === true) {
        formData.set(field.name, "on");
      }
    } else if (typeof value === "string") {
      formData.set(field.name, value);
    }
  }

  if (!recordId && moduleId === "patients") {
    const name = values.full_name;
    const { client } = await requireUser();
    if (typeof name !== "string" || name.trim().length < 2) {
      return { success: false, message: "Enter the patient's full name before continuing." };
    }
    if (!(await hasServerPermission(client, "patients.read"))) {
      return {
        success: false,
        message: "Patient registration through the assistant requires permission to check existing patient records. Use the manual registration form if that permission is unavailable.",
      };
    }
    const { data: matches, error: duplicateError } = await client
      .from("patients")
      .select("patient_number,full_name")
      .ilike("full_name", name.replace(/[%_]/g, "\\$&"))
      .limit(5);
    if (duplicateError) {
      throw new Error(`Could not check for existing patients: ${duplicateError.message}`);
    }
    if (matches?.length && !allowDuplicatePatient) {
      return {
        success: false,
        needsDuplicateConfirmation: true,
        message: `Possible existing match${matches.length === 1 ? "" : "es"}: ${matches
          .map((patient) => `${patient.full_name} (#${patient.patient_number})`)
          .join(", ")}. Verify the record before confirming a separate registration.`,
      };
    }
  }

  const result = await persistRecord(moduleId, recordId, formData, true);
  if (!result.success) {
    return {
      success: false,
      message: result.error === "save-failed"
        ? "The record could not be saved. Check the values and try again."
        : result.error === "required"
          ? "Complete every required field before confirming."
          : result.error === "invalid-choice"
            ? "Choose a valid option before confirming."
            : result.error === "invalid-date"
              ? "Enter a valid date or time before confirming."
              : result.error === "invalid-number"
                ? "Enter a valid number before confirming."
                  : result.error === "assistant-audit-unavailable"
                    ? "Assistant auditing is not ready in the database, so nothing was saved. Apply the latest Supabase migration, or use the manual form."
                : "This record is unavailable or you do not have permission to change it.",
    };
  }

  const { error: auditError } = await result.client.rpc("log_assistant_action", {
    p_entity_type: result.table,
    p_entity_id: result.recordId,
    p_operation: result.operation,
  });
  revalidatePath(`/modules/${moduleId}`);

  if (auditError) {
    console.error("Could not write assistant audit marker:", auditError.message);
    return {
      success: true,
      recordId: result.recordId,
      message: "Saved successfully, but the AI audit marker could not be written. Contact an administrator.",
    };
  }

  return {
    success: true,
    recordId: result.recordId,
    message: "Saved and verified in the clinic system audit trail.",
  };
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

export async function permanentlyDeleteRecord(
  moduleId: string,
  formData: FormData,
): Promise<void> {
  const definition = MODULES[moduleId];
  const recordId = formData.get("recordId");
  if (
    !definition ||
    typeof recordId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)
  ) {
    redirect("/dashboard?error=forbidden");
  }

  const { client } = await requireUser();
  if (!(await hasServerPermission(client, "system.manage"))) {
    redirect("/dashboard?error=forbidden");
  }

  const { count, error } = await client
    .from(definition.table)
    .delete({ count: "exact" })
    .eq("id", recordId);

  if (error) {
    console.error(`Could not permanently delete ${definition.table}:`, error.message);
    redirect(
      `/modules/${moduleId}?error=${
        error.code === "23503"
          ? "delete-linked-records"
          : error.code === "42501"
            ? "delete-forbidden"
            : "delete-failed"
      }`,
    );
  }
  if (count !== 1) {
    redirect(`/modules/${moduleId}?error=not-found-or-forbidden`);
  }

  revalidatePath(`/modules/${moduleId}`);
  redirect(`/modules/${moduleId}?deleted=1`);
}

export async function archiveRecordWithAssistant(
  moduleId: string,
  recordId: string,
  confirmed: boolean,
): Promise<{ success: boolean; message: string }> {
  if (!confirmed) {
    return { success: false, message: "Confirm the archive action before continuing." };
  }
  const definition = MODULES[moduleId];
  if (
    !definition ||
    !definition.archiveField ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)
  ) {
    return { success: false, message: "This archive action is not available." };
  }

  const { client } = await requireUser();
  const departmentId = await getModuleDepartmentId(client, moduleId, {});
  const permissions = [definition.updatePermission];
  if (moduleId === "patients") {
    permissions.push("patients.archive");
  }
  for (const permission of permissions) {
    if (!(await hasServerPermission(client, permission, departmentId))) {
      return { success: false, message: `You do not have permission to archive ${definition.title.toLowerCase()}.` };
    }
  }

  const archivedValue =
    definition.archiveField === "archived_at" ? new Date().toISOString() : false;
  const { data, error } = await client
    .from(definition.table)
    .update({ [definition.archiveField]: archivedValue })
    .eq("id", recordId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error(`Could not archive ${definition.table} through assistant:`, error.message);
    return { success: false, message: "The record could not be archived. Check access and try again." };
  }
  if (!data) {
    return { success: false, message: "That record is unavailable or outside your authorized access." };
  }

  const { error: auditError } = await client.rpc("log_assistant_action", {
    p_entity_type: definition.table,
    p_entity_id: recordId,
    p_operation: "update",
  });
  revalidatePath(`/modules/${moduleId}`);
  if (auditError) {
    console.error("Could not write assistant archive audit marker:", auditError.message);
    return {
      success: true,
      message: `Archived successfully, but the AI audit marker could not be written. Contact an administrator.`,
    };
  }
  return { success: true, message: `${definition.title} record archived and recorded in the audit trail.` };
}

export async function deleteRecordWithAssistant(
  moduleId: string,
  recordId: string,
  confirmed: boolean,
): Promise<{ success: boolean; message: string }> {
  if (!confirmed) {
    return { success: false, message: "Confirm permanent deletion before continuing." };
  }
  const definition = MODULES[moduleId];
  if (
    !definition ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)
  ) {
    return { success: false, message: "This delete action is not available." };
  }

  const { client } = await requireUser();
  if (!(await hasServerPermission(client, "system.manage"))) {
    return { success: false, message: "Permanent deletion requires system management permission." };
  }

  const { count, error } = await client
    .from(definition.table)
    .delete({ count: "exact" })
    .eq("id", recordId);
  if (error) {
    console.error(`Could not permanently delete ${definition.table} through assistant:`, error.message);
    return {
      success: false,
      message: error.code === "23503"
        ? "This record has linked records and cannot be deleted until those are handled."
        : error.code === "42501"
          ? "The app permission check passed, but database delete access is not enabled. Apply the latest system-managed record deletion migration and try again."
          : "The record could not be permanently deleted. Check access and try again.",
    };
  }
  if (count !== 1) {
    return { success: false, message: "That record is unavailable or outside your authorized access." };
  }

  const { error: auditError } = await client.rpc("log_assistant_delete_action", {
    p_entity_type: definition.table,
    p_entity_id: recordId,
  });
  revalidatePath(`/modules/${moduleId}`);
  if (auditError) {
    console.error("Could not write assistant delete audit marker:", auditError.message);
    return {
      success: true,
      message: "The record was deleted and the database deletion event was audited, but the AI audit marker could not be written. Contact an administrator.",
    };
  }
  return { success: true, message: `${definition.title} record permanently deleted and recorded in the audit trail.` };
}
