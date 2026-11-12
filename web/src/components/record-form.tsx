import Link from "next/link";
import type { HTMLInputTypeAttribute } from "react";

import type { FormField, ModuleDefinition } from "@/lib/modules";
import { requireUser } from "@/lib/auth";
import { requireRecordArray } from "@/lib/response-data";

type RecordFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  definition: ModuleDefinition;
  error?: string;
  record?: Record<string, unknown> | null;
};

const errorMessages: Record<string, string> = {
  required: "Complete all required fields.",
  "too-long": "One or more fields exceed the allowed length.",
  "invalid-number": "Enter a valid whole number or amount.",
  "invalid-date": "Enter a valid date and time.",
  "invalid-email": "Enter a valid email address.",
  "invalid-choice": "Choose one of the available options.",
  "invalid-json": "Enter valid JSON.",
  "save-failed": "The record could not be saved. Check the values and try again.",
  "not-found-or-forbidden": "The record is unavailable or you do not have permission to change it.",
};

function inputValue(field: FormField, value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (field.type === "checkbox") {
    return value === true ? "true" : "";
  }
  if (field.type === "json") {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  if (field.type === "datetime-local" && typeof value === "string") {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return "";
    }
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(date)
      .replace(" ", "T");
  }
  if (typeof value === "object") {
    return "";
  }
  return String(value);
}

function optionValue(item: Record<string, unknown>, path: string): unknown {
  let value: unknown = item;
  for (const part of path.split(".")) {
    if (Array.isArray(value)) {
      value = value[0];
    }
    if (!value || typeof value !== "object") {
      return null;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function optionText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString("en-PK", {
      timeZone: "Asia/Karachi",
      dateStyle: "medium",
      timeStyle: "short",
    });
  }
  return String(value);
}

type SupabaseClient = Awaited<ReturnType<typeof requireUser>>["client"];

async function loadOptions(
  client: SupabaseClient,
  field: FormField,
): Promise<Array<{ id: string; label: string }>> {
  const labelPath = field.optionLabel;
  if (!field.optionTable || !labelPath) {
    return [];
  }
  const { data, error } = await client
    .from(field.optionTable)
    .select(field.optionSelect ?? `id,${field.optionLabel}`)
    .limit(500);
  if (error) {
    throw new Error(`Could not load choices for ${field.label}: ${error.message}`);
  }
  return requireRecordArray(data ?? [], `Choices for ${field.label}`).map((item) => {
    const primary = optionText(optionValue(item, labelPath)) || String(item.id);
    const detail = field.optionDetail
      ? optionText(optionValue(item, field.optionDetail))
      : "";
    return {
      id: String(item.id),
      label: detail ? `${primary} · ${detail}` : primary,
    };
  });
}

async function renderField(
  field: FormField,
  record: Record<string, unknown> | null,
  client: SupabaseClient | null,
) {
  const value = inputValue(field, record?.[field.name]);
  const id = `field-${field.name}`;

  if (field.type === "checkbox") {
    return (
      <label className="checkbox-field" htmlFor={id} key={field.name}>
        <input defaultChecked={value === "true"} id={id} name={field.name} type="checkbox" />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === "select") {
    let options: Array<{ id: string; label: string }>;
    if (field.options) {
      options = field.options.map((option) => ({ id: option.value, label: option.label }));
    } else if (client && field.optionTable) {
      options = await loadOptions(client, field);
    } else {
      throw new Error(`No choices are configured for ${field.label}.`);
    }
    return (
      <label className="field" htmlFor={id} key={field.name}>
        {field.label}
        <select
          defaultValue={value}
          id={id}
          name={field.name}
          required={field.required}
        >
          <option value="">
            {field.required ? "Select an option" : "Not specified"}
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
        {field.helpText && <span className="muted">{field.helpText}</span>}
      </label>
    );
  }

  const isTextarea = field.type === "textarea" || field.type === "json";
  const inputType: HTMLInputTypeAttribute =
    field.type === "email"
      ? "email"
      : field.type === "number" || field.type === "money"
        ? "number"
        : field.type === "date"
          ? "date"
          : field.type === "time"
            ? "time"
            : field.type === "datetime-local"
              ? "datetime-local"
              : "text";
  return (
    <label className="field" htmlFor={id} key={field.name}>
      {field.label}
      {isTextarea ? (
        <textarea
          defaultValue={value}
          id={id}
          name={field.name}
          required={field.required}
          rows={field.type === "json" ? 7 : undefined}
        />
      ) : (
        <input
          defaultValue={value}
          id={id}
          name={field.name}
          required={field.required}
          step={field.step}
          type={inputType}
        />
      )}
      {field.helpText && <span className="muted">{field.helpText}</span>}
    </label>
  );
}

export default async function RecordForm({
  action,
  cancelHref,
  definition,
  error,
  record = null,
}: RecordFormProps) {
  const visibleFields = definition.fields.filter((field) => {
    if (definition.departmentSlug && field.name === "department_id") {
      return false;
    }
    if (record && definition.updateFields) {
      return definition.updateFields.includes(field.name);
    }
    return true;
  });
  const client = visibleFields.some((field) => field.optionTable)
    ? (await requireUser()).client
    : null;
  const message = errorMessages[error ?? ""] ?? (error ? "The form could not be saved." : null);

  return (
    <section className="panel form-panel">
      {message && <div className="alert" role="alert">{message}</div>}
      <form action={action}>
        {await Promise.all(
          visibleFields.map((field) => renderField(field, record, client)),
        )}
        <div className="form-actions">
          <Link className="button" href={cancelHref}>Cancel</Link>
          <button className="button button-primary" type="submit">
            {record ? "Save changes" : "Create record"}
          </button>
        </div>
      </form>
    </section>
  );
}
