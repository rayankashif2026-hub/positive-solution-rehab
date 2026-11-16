"use server";

import { hasPermission, requireUser } from "@/lib/auth";
import type {
  AssistantChoice,
  AssistantForm,
  AssistantFormField,
  AssistantResponse,
  AssistantSearchResult,
} from "@/lib/assistant/contracts";
import {
  classifyAssistantIntent,
  extractAssistantFormValues,
  interpretAssistantMessage,
  normalizeAssistantSearchQuery,
} from "@/lib/assistant/intent";
import { MODULES, type FormField, type ModuleDefinition } from "@/lib/modules";
import { pakistanDateISO } from "@/lib/time";
import { isRecord, requireRecord, requireRecordArray } from "@/lib/response-data";

type ClinicClient = Awaited<ReturnType<typeof requireUser>>["client"];

function nestedValue(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) {
      current = current[0];
    }
    if (!isRecord(current)) {
      return null;
    }
    current = current[part];
  }
  return current;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Not set";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

async function permissionFor(
  client: ClinicClient,
  permission: string,
  definition: ModuleDefinition,
): Promise<boolean> {
  let departmentId: string | null = null;
  if (definition.departmentSlug) {
    const { data, error } = await client
      .from("departments")
      .select("id")
      .eq("slug", definition.departmentSlug)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not check assistant access: ${error.message}`);
    }
    departmentId = data?.id ?? null;
  }
  const { data, error } = await client.rpc("has_permission", {
    p_permission_key: permission,
    p_department_id: departmentId,
  });
  if (error) {
    throw new Error(`Could not check assistant access: ${error.message}`);
  }
  return Boolean(data);
}

async function loadChoices(
  client: ClinicClient,
  field: FormField,
  departmentPermission: string,
): Promise<AssistantChoice[]> {
  if (field.options) {
    return field.options.map((option) => ({ id: option.value, label: option.label }));
  }
  if (!field.optionTable || !field.optionLabel) {
    return [];
  }
  const { data, error } = await client
    .from(field.optionTable)
    .select(field.optionSelect ?? `id,${field.optionLabel}`)
    .limit(200);
  if (error) {
    throw new Error(`Could not load choices for ${field.label}: ${error.message}`);
  }
  let records = requireRecordArray(data ?? [], `Choices for ${field.label}`);
  if (field.optionTable === "departments") {
    const permitted = await Promise.all(
      records.map(async (record) => {
        const { data: allowed, error: permissionError } = await client.rpc("has_permission", {
          p_permission_key: departmentPermission,
          p_department_id: record.id,
        });
        if (permissionError) {
          throw new Error(`Could not check department access: ${permissionError.message}`);
        }
        return allowed ? record : null;
      }),
    );
    records = permitted.filter((record): record is Record<string, unknown> => record !== null);
  }
  return records.map((item) => {
    const primary = displayValue(nestedValue(item, field.optionLabel!));
    const detail = field.optionDetail
      ? nestedValue(item, field.optionDetail)
      : null;
    return {
      id: String(item.id),
      label: detail && displayValue(detail) !== "Not set"
        ? `${primary} · ${displayValue(detail)}`
        : primary,
    };
  });
}

function extractInitialValues(
  message: string,
  fields: AssistantFormField[],
): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  const dateMatch = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const fullNameMatch = message.match(/\b(?:named|called|name\s+is)\s+([^,.;]+)/i);
  const phoneMatch = message.match(/\b(?:phone|contact|mobile|number)\D{0,8}(\+?[\d][\d ()-]{6,20})/i);
  const emailMatch = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const ageMatch = message.match(/\bage\s*(?:is|:)?\s*(\d{1,3})\b/i);

  for (const field of fields) {
    if (
      (field.name === "full_name" || field.name === "item_name" || field.name === "equipment_name") &&
      fullNameMatch
    ) {
      values[field.name] = fullNameMatch[1]
        .split(/\s+(?:in|for|on|with|phone|contact|mobile|age|email|department|practitioner)\b/i)[0]
        .trim()
        .slice(0, 120);
    } else if (
      field.name === "full_name" &&
      !fullNameMatch &&
      /\bpatient\b/i.test(message)
    ) {
      const nameAfterPatient = message.match(/\bpatient\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3})/u);
      if (nameAfterPatient) {
        values[field.name] = nameAfterPatient[1];
      }
    } else if (field.name === "contact_number" && phoneMatch) {
      values[field.name] = phoneMatch[1].trim().slice(0, 30);
    } else if (field.name === "age" && ageMatch) {
      values[field.name] = ageMatch[1];
    } else if (field.name === "email" && emailMatch) {
      values[field.name] = emailMatch[0];
    } else if (field.type === "date" && dateMatch) {
      values[field.name] = dateMatch[1];
    } else if (field.type === "datetime-local") {
      const dateTime = message.match(/\b(20\d{2}-\d{2}-\d{2})[ T]+(\d{1,2}:\d{2})\b/);
      if (dateTime) {
        values[field.name] = `${dateTime[1]}T${dateTime[2].padStart(5, "0")}`;
      }
    } else if (field.type === "number" || field.type === "money") {
      const label = field.label.split(/[ (]/)[0];
      const numberMatch = message.match(new RegExp(`\\b${label}\\D{0,12}(\\d+(?:\\.\\d{1,2})?)`, "i"));
      if (numberMatch) {
        values[field.name] = numberMatch[1];
      }
    } else if (field.type === "select" && field.choices.length) {
      const choice = field.choices.find((candidate) =>
        message.toLowerCase().includes(candidate.label.split(" · ")[0].toLowerCase()),
      );
      if (choice) {
        values[field.name] = choice.id;
      }
    }
  }
  return values;
}

function mergeModelValues(
  fields: AssistantFormField[],
  modelValues: Record<string, string | boolean>,
): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};
  for (const field of fields) {
    const candidate = modelValues[field.name];
    if (typeof candidate === "boolean") {
      if (field.type === "checkbox") {
        values[field.name] = candidate;
      }
      continue;
    }
    if (typeof candidate !== "string" || !candidate.trim()) {
      continue;
    }
    const normalized = candidate.trim().toLowerCase();
    if (field.type === "checkbox") {
      if (["true", "yes", "present", "checked"].includes(normalized)) {
        values[field.name] = true;
      } else if (["false", "no", "absent", "unchecked"].includes(normalized)) {
        values[field.name] = false;
      }
    } else if (field.type === "select") {
      const choice = field.choices.find((item) =>
        item.id === candidate ||
        item.label.split(" · ")[0].trim().toLowerCase() === normalized,
      );
      if (choice) {
        values[field.name] = choice.id;
      }
    } else {
      values[field.name] = candidate.trim().slice(0, 2000);
    }
  }
  return values;
}

function withModelNotice(response: AssistantResponse, notice?: string): AssistantResponse {
  return notice
    ? { ...response, message: `${notice}\n\n${response.message}` }
    : response;
}

async function buildForm(
  client: ClinicClient,
  moduleId: string,
  recordId: string | null,
  initialValues: Record<string, unknown> = {},
): Promise<AssistantForm> {
  const definition = MODULES[moduleId];
  const fields = definition.fields.filter(
    (field) =>
      !(definition.departmentSlug && field.name === "department_id") &&
      (!recordId || !definition.updateFields || definition.updateFields.includes(field.name)),
  );
  const departmentPermission = recordId
    ? definition.updatePermission
    : definition.createPermission;
  const choices = await Promise.all(
    fields.map((field) => loadChoices(client, field, departmentPermission)),
  );
  const formFields: AssistantFormField[] = fields.map((field, index) => {
    const storedValue = initialValues[field.name];
    const value = field.type === "checkbox"
      ? storedValue === true
      : storedValue === null || storedValue === undefined
        ? ""
        : typeof storedValue === "object"
          ? JSON.stringify(storedValue, null, 2)
          : String(storedValue);
    return {
      name: field.name,
      label: field.label,
      type: field.type,
      required: Boolean(field.required),
      step: field.step,
      helpText: field.helpText,
      choices: choices[index],
      value,
    };
  });
  return { moduleId, title: definition.title, recordId, fields: formFields };
}

function moduleForSearch(preferredModuleId: string | null): string {
  if (preferredModuleId && MODULES[preferredModuleId]) {
    return preferredModuleId;
  }
  return "patients";
}

async function searchModuleRows(
  client: ClinicClient,
  moduleId: string,
  definition: ModuleDefinition,
  searchTerm: string,
): Promise<unknown> {
  const patientRelatedModules: Record<string, "patient_id" | "exercise-attendance" | "payments"> = {
    appointments: "patient_id",
    physiotherapy: "patient_id",
    psychology: "patient_id",
    hijama: "patient_id",
    nutrition: "patient_id",
    followups: "patient_id",
    invoices: "patient_id",
    payments: "payments",
    "exercise-participants": "patient_id",
    "exercise-attendance": "exercise-attendance",
    "patient-notes": "patient_id",
  };
  const relation = patientRelatedModules[moduleId];

  if (relation) {
    const { data: patients, error: patientError } = await client
      .from("patients")
      .select("id")
      .ilike("full_name", `%${searchTerm}%`)
      .limit(50);
    if (patientError) {
      throw new Error(`Could not search patients: ${patientError.message}`);
    }
    const patientIds = requireRecordArray(patients ?? [], "Patient matches")
      .map((patient) => String(patient.id));
    if (patientIds.length) {
      let relatedIds = patientIds;
      let relationColumn: string = relation === "payments" ? "invoice_id" : "patient_id";
      if (relation === "exercise-attendance") {
        const { data: participants, error } = await client
          .from("exercise_participants")
          .select("id")
          .in("patient_id", patientIds)
          .limit(50);
        if (error) {
          throw new Error(`Could not search exercise participants: ${error.message}`);
        }
        relatedIds = requireRecordArray(participants ?? [], "Exercise participants")
          .map((participant) => String(participant.id));
        relationColumn = "participant_id";
      } else if (relation === "payments") {
        const { data: invoices, error } = await client
          .from("invoices")
          .select("id")
          .in("patient_id", patientIds)
          .limit(50);
        if (error) {
          throw new Error(`Could not search invoices: ${error.message}`);
        }
        relatedIds = requireRecordArray(invoices ?? [], "Patient invoices")
          .map((invoice) => String(invoice.id));
      }
      if (relatedIds.length) {
        const { data, error } = await client
          .from(definition.table)
          .select(definition.select)
          .in(relationColumn, relatedIds)
          .limit(10);
        if (error) {
          throw new Error(`Could not search ${definition.title}: ${error.message}`);
        }
        return data ?? [];
      }
    }
  }

  if (moduleId === "attendance") {
    const { data: staff, error: staffError } = await client
      .from("staff")
      .select("id")
      .ilike("full_name", `%${searchTerm}%`)
      .limit(50);
    if (staffError) {
      throw new Error(`Could not search staff: ${staffError.message}`);
    }
    const staffIds = requireRecordArray(staff ?? [], "Staff matches")
      .map((member) => String(member.id));
    if (staffIds.length) {
      const { data, error } = await client
        .from(definition.table)
        .select(definition.select)
        .in("staff_id", staffIds)
        .limit(10);
      if (error) {
        throw new Error(`Could not search ${definition.title}: ${error.message}`);
      }
      return data ?? [];
    }
  }

  if (moduleId === "psychology-notes") {
    const { data: patients, error: patientError } = await client
      .from("patients")
      .select("id")
      .ilike("full_name", `%${searchTerm}%`)
      .limit(50);
    if (patientError) {
      throw new Error(`Could not search patients: ${patientError.message}`);
    }
    const patientIds = requireRecordArray(patients ?? [], "Patient matches")
      .map((patient) => String(patient.id));
    if (patientIds.length) {
      const { data: records, error: recordError } = await client
        .from("psychology_records")
        .select("id")
        .in("patient_id", patientIds)
        .limit(50);
      if (recordError) {
        throw new Error(`Could not search psychology records: ${recordError.message}`);
      }
      const recordIds = requireRecordArray(records ?? [], "Psychology records")
        .map((record) => String(record.id));
      if (recordIds.length) {
        const { data, error } = await client
          .from(definition.table)
          .select(definition.select)
          .in("record_id", recordIds)
          .limit(10);
        if (error) {
          throw new Error(`Could not search ${definition.title}: ${error.message}`);
        }
        return data ?? [];
      }
    }
  }

  if (definition.searchColumns?.length) {
    const { data, error } = await client
      .from(definition.table)
      .select(definition.select)
      .or(definition.searchColumns.map((column) => `${column}.ilike.%${searchTerm}%`).join(","))
      .limit(10);
    if (error) {
      throw new Error(`Could not search ${definition.title}: ${error.message}`);
    }
    return data ?? [];
  }

  return null;
}

async function searchRecords(
  message: string,
  moduleId: string | null,
): Promise<AssistantResponse> {
  const query = message.trim().slice(0, 80);
  if (!query) {
    return { message: "What name or record detail should I search for?" };
  }
  const selectedModuleId = moduleForSearch(moduleId);
  const definition = MODULES[selectedModuleId];

  const { client } = await requireUser();
  if (!(await permissionFor(client, definition.readPermission, definition))) {
    return { message: `You do not have permission to search ${definition.title}.` };
  }

  const searchTerm = query.replace(/[%_]/g, "\\$&");
  const data = await searchModuleRows(client, selectedModuleId, definition, searchTerm);
  if (data === null) {
    return { message: `Search is not configured for ${definition.title}. Open that module to use its existing controls.` };
  }
  const rows = requireRecordArray(data, `${definition.title} search results`);
  const canEdit = definition.updateable !== false &&
    await permissionFor(client, definition.updatePermission, definition);
  const canArchive = Boolean(definition.archiveField) &&
    canEdit &&
    await permissionFor(
      client,
      selectedModuleId === "patients" ? "patients.archive" : definition.updatePermission,
      definition,
    );
  const canDelete = await hasPermission("system.manage");
  const results: AssistantSearchResult[] = rows.map((row) => ({
    id: String(row.id),
    moduleId: selectedModuleId,
    title: definition.title,
    summary: definition.columns.slice(0, 4).map((column) => ({
      label: column.label,
      value: displayValue(nestedValue(row, column.key)),
    })),
    canEdit,
    canArchive,
    canDelete,
  }));
  return {
    message: results.length
      ? `I found ${results.length} ${definition.title.toLowerCase()} record${results.length === 1 ? "" : "s"}. Results use your current database access.`
      : `No matching ${definition.title.toLowerCase()} records were found.`,
    results,
  };
}

export async function assistantContinueDraft(
  moduleId: string,
  recordId: string | null,
  message: string,
  currentValues: Record<string, string | boolean>,
): Promise<AssistantResponse> {
  if (classifyAssistantIntent(message).kind !== "help") {
    return { ...(await assistantTurn(message)), clearDraft: true };
  }
  const definition = MODULES[moduleId];
  if (!definition || (recordId && definition.updateable === false)) {
    return { message: "This draft is no longer available." };
  }
  const { client } = await requireUser();
  const permission = recordId ? definition.updatePermission : definition.createPermission;
  if (!(await permissionFor(client, permission, definition))) {
    return { message: "You no longer have permission to change this draft." };
  }

  const form = await buildForm(client, moduleId, recordId, currentValues);
  const modelExtraction = await extractAssistantFormValues(message, form.fields);
  const extracted = {
    ...extractInitialValues(message, form.fields),
    ...mergeModelValues(form.fields, modelExtraction.values),
  };
  let updates = 0;
  form.fields = form.fields.map((field) => {
    if (!Object.hasOwn(extracted, field.name)) {
      return field;
    }
    updates += 1;
    return { ...field, value: extracted[field.name] };
  });
  return {
    message: `${modelExtraction.notice ? `${modelExtraction.notice} ` : ""}${
      updates
        ? "I added the details I could recognize. Please verify them in the draft before reviewing."
        : "I couldn't safely match that detail to a form field. You can enter it directly in the draft below."
    }`,
    form,
  };
}

async function pendingFollowups(): Promise<AssistantResponse> {
  const { client } = await requireUser();
  if (!(await hasPermission("followups.read"))) {
    return { message: "You do not have permission to view follow-ups." };
  }
  const { data, error } = await client
    .from("followups")
    .select("id,due_at,reason,status,patient:patients(full_name),department:departments(name)")
    .eq("status", "upcoming")
    .is("archived_at", null)
    .order("due_at", { ascending: true })
    .limit(20);
  if (error) {
    throw new Error(`Could not load pending follow-ups: ${error.message}`);
  }
  const records = requireRecordArray(data ?? [], "Pending follow-ups");
  const definition = MODULES.followups;
  const canEdit = definition.updateable !== false &&
    await permissionFor(client, definition.updatePermission, definition);
  const canArchive = Boolean(definition.archiveField) &&
    canEdit &&
    await permissionFor(client, definition.updatePermission, definition);
  const canDelete = await hasPermission("system.manage");
  const results = records.map((record) => ({
    id: String(record.id),
    moduleId: "followups",
    title: definition.title,
    summary: [
      { label: "Patient", value: displayValue(nestedValue(record, "patient.full_name")) },
      { label: "Department", value: displayValue(nestedValue(record, "department.name")) },
      { label: "Due", value: displayValue(record.due_at) },
      { label: "Reason", value: displayValue(record.reason) },
    ],
    canEdit,
    canArchive,
    canDelete,
  }));
  return {
    message: results.length
      ? `There are ${results.length} upcoming follow-ups in your authorized records.`
      : "There are no upcoming follow-ups in your authorized records.",
    results,
    links: [{ label: "Open follow-ups", href: "/modules/followups" }],
  };
}

async function reportLinks(dataset: string | null): Promise<AssistantResponse> {
  await requireUser();
  if (!(await hasPermission("reports.export"))) {
    return { message: "You do not have permission to generate reports." };
  }
  const reports = {
    appointments: { permission: "appointments.read", label: "Appointment report" },
    invoices: { permission: "finance.read", label: "Invoice report" },
    followups: { permission: "followups.read", label: "Follow-up report" },
    attendance: { permission: "attendance.read", label: "Staff attendance report" },
  } as const;
  const date = pakistanDateISO();
  const links: AssistantResponse["links"] = [
    { label: "Open report workspace", href: "/reports" },
  ];
  if (dataset && dataset in reports) {
    const report = reports[dataset as keyof typeof reports];
    if (await hasPermission(report.permission)) {
      const params = new URLSearchParams({
        dataset,
        start: date,
        end: date,
        format: "xlsx",
      });
      links.unshift({
        label: `Download today's ${report.label.toLowerCase()}`,
        href: `/api/reports/export?${params.toString()}`,
      });
    }
  }
  return {
    message: "Reports are generated by the clinic's existing authorized export service. Choose a link below; no records were changed.",
    links,
  };
}

async function duplicatePatientWarning(
  client: ClinicClient,
  values: Record<string, string | boolean>,
): Promise<string | undefined> {
  const name = values.full_name;
  if (typeof name !== "string" || name.trim().length < 2) {
    return undefined;
  }
  const { data, error } = await client
    .from("patients")
    .select("id,patient_number,full_name")
    .ilike("full_name", `%${name.replace(/[%_]/g, "\\$&")}%`)
    .limit(5);
  if (error) {
    throw new Error(`Could not check for existing patients: ${error.message}`);
  }
  const matches = requireRecordArray(data ?? [], "Patient matches");
  if (!matches.length) {
    return undefined;
  }
  return `Possible existing patient match${matches.length === 1 ? "" : "es"}: ${matches
    .map((match) => `${String(match.full_name)} (#${String(match.patient_number)})`)
    .join(", ")}. Please check before registering another record.`;
}

export async function assistantTurn(message: string): Promise<AssistantResponse> {
  const text = message.trim().slice(0, 2000);
  if (!text) {
    return { message: "Tell me what you need help with." };
  }
  await requireUser();
  const interpretation = await interpretAssistantMessage(text);
  const intent = interpretation.intent;
  const respond = (response: AssistantResponse) =>
    withModelNotice(response, interpretation.notice);

  if (intent.kind === "search") {
    return respond(await searchRecords(normalizeAssistantSearchQuery(intent.query), intent.moduleId));
  }
  if (intent.kind === "followups") {
    return respond(await pendingFollowups());
  }
  if (intent.kind === "report") {
    return respond(await reportLinks(intent.dataset));
  }
  if (intent.kind !== "create") {
    return respond({
      message: "I can prepare and edit clinic records, search authorized records, archive or permanently delete records when your permissions allow, check follow-ups, and open existing reports. Changes always require your review and confirmation. Try “register patient named Ali”, “find patient Ali”, “archive patient Ali”, “show pending follow-ups”, or “generate today's attendance report”.",
    });
  }

  const { client } = await requireUser();
  const definition = MODULES[intent.moduleId];
  if (!definition || !(await permissionFor(client, definition.createPermission, definition))) {
    return respond({ message: "You do not have permission to create that type of record." });
  }
  if (
    definition.additionalCreatePermission &&
    !(await permissionFor(client, definition.additionalCreatePermission, definition))
  ) {
    return respond({ message: "You do not have permission to create that type of record." });
  }

  const form = await buildForm(client, intent.moduleId, null);
  const prefilled = {
    ...extractInitialValues(text, form.fields),
    ...mergeModelValues(form.fields, interpretation.values),
  };
  form.fields = form.fields.map((field) =>
    Object.hasOwn(prefilled, field.name)
      ? { ...field, value: prefilled[field.name] }
      : field,
  );
  if (definition.departmentSlug) {
    const { data, error } = await client
      .from("departments")
      .select("name")
      .eq("slug", definition.departmentSlug)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not prepare ${definition.title}: ${error.message}`);
    }
    form.warning = data ? `This record will be assigned to ${data.name}.` : undefined;
  }
  if (intent.moduleId === "patients") {
    const warning = await duplicatePatientWarning(client, prefilled);
    if (warning) {
      form.warning = warning;
    }
  }

  return respond({
    message: `I prepared the existing ${definition.title.toLowerCase()} form. Complete or correct the fields, review the summary, then confirm before anything is saved.`,
    form,
  });
}

export async function assistantEditRecord(
  moduleId: string,
  recordId: string,
): Promise<AssistantResponse> {
  const definition = MODULES[moduleId];
  if (!definition || definition.updateable === false || !recordId) {
    return { message: "This record cannot be edited from the assistant." };
  }
  const { client } = await requireUser();
  if (!(await permissionFor(client, definition.updatePermission, definition))) {
    return { message: `You do not have permission to edit ${definition.title.toLowerCase()}.` };
  }
  const fields = definition.fields
    .filter(
      (field) =>
        !(definition.departmentSlug && field.name === "department_id") &&
        (!definition.updateFields || definition.updateFields.includes(field.name)),
    )
    .map((field) => field.name);
  const { data, error } = await client
    .from(definition.table)
    .select(["id", ...fields].join(","))
    .eq("id", recordId)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not load ${definition.title} for editing: ${error.message}`);
  }
  if (!data) {
    return { message: "That record is unavailable or outside your authorized access." };
  }
  const recordValues = requireRecord(data, `${definition.title} record`);

  return {
    message: `I opened the existing ${definition.title.toLowerCase()} record. Review any changes before confirming; nothing is saved yet.`,
    form: await buildForm(client, moduleId, recordId, recordValues),
  };
}
