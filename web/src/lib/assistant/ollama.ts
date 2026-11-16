import { MODULES } from "@/lib/modules";
import { isRecord } from "@/lib/response-data";

import type { AssistantFormField } from "./contracts";
import type { AssistantIntent } from "./intent";

export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

export type OllamaInterpretation = {
  intent: AssistantIntent;
  values: Record<string, string | boolean>;
};

const outputSchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["search", "followups", "report", "create", "help"],
    },
    moduleId: {
      anyOf: [
        { type: "string", enum: Object.keys(MODULES) },
        { type: "null" },
      ],
    },
    query: { type: "string" },
    dataset: {
      anyOf: [
        { type: "string", enum: ["appointments", "invoices", "followups", "attendance"] },
        { type: "null" },
      ],
    },
    values: {
      type: "object",
      additionalProperties: {
        anyOf: [{ type: "string" }, { type: "boolean" }],
      },
    },
  },
  required: ["kind", "moduleId", "query", "dataset", "values"],
  additionalProperties: false,
};

const valuesSchema = {
  type: "object",
  properties: {
    values: {
      type: "object",
      additionalProperties: {
        anyOf: [{ type: "string" }, { type: "boolean" }],
      },
    },
  },
  required: ["values"],
  additionalProperties: false,
};

function ollamaConfig(): { endpoint: string; model: string } {
  const rawUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OllamaUnavailableError("OLLAMA_BASE_URL must be a valid local URL.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new OllamaUnavailableError("The assistant only accepts a loopback Ollama URL.");
  }
  const model = process.env.OLLAMA_MODEL?.trim() || "qwen2.5:1.5b";
  if (model.length > 120 || /[\u0000-\u001f]/.test(model)) {
    throw new OllamaUnavailableError("OLLAMA_MODEL is not a valid model name.");
  }
  return { endpoint: new URL("/api/chat", url).toString(), model };
}

async function requestStructuredOutput(
  system: string,
  user: string,
  schema: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { endpoint, model } = ollamaConfig();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "5m",
        format: schema,
        options: { temperature: 0, num_predict: 384 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    ) {
      throw new OllamaUnavailableError(
        "Ollama is not responding. Start Ollama and ensure the configured model is installed.",
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new OllamaUnavailableError(
      response.status === 404
        ? `The Ollama model "${model}" is not installed. Pull it with "ollama pull ${model}".`
        : `Ollama returned HTTP ${response.status}. Check the local Ollama server and model.`,
    );
  }
  const payload: unknown = await response.json();
  const content = isRecord(payload) && isRecord(payload.message) &&
      typeof payload.message.content === "string"
    ? payload.message.content
    : null;
  if (!content) {
    throw new OllamaUnavailableError("Ollama returned an invalid structured response.");
  }
  let result: unknown;
  try {
    result = JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new OllamaUnavailableError("Ollama returned invalid JSON. Try again or use a smaller model.");
    }
    throw error;
  }
  if (!isRecord(result)) {
    throw new OllamaUnavailableError("Ollama returned an invalid structured response.");
  }
  return result;
}

function cleanValues(
  rawValues: unknown,
  allowedFields: ReadonlySet<string>,
): Record<string, string | boolean> {
  if (!isRecord(rawValues)) {
    return {};
  }
  const values: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(rawValues)) {
    if (!allowedFields.has(name)) {
      continue;
    }
    if (typeof value === "boolean") {
      values[name] = value;
    } else if (typeof value === "string") {
      values[name] = value.trim().slice(0, 2000);
    }
  }
  return values;
}

function moduleGuide(): string {
  return Object.entries(MODULES)
    .map(([id, definition]) => {
      const fields = definition.fields
        .map((field) => `${field.name} (${field.label}, ${field.type})`)
        .join(", ");
      return `${id}: ${definition.title}; fields: ${fields}`;
    })
    .join("\n");
}

export async function interpretWithOllama(message: string): Promise<OllamaInterpretation> {
  const allowedFields = new Set(
    Object.values(MODULES).flatMap((definition) => definition.fields.map((field) => field.name)),
  );
  const result = await requestStructuredOutput(
    `Interpret a clinic administrator's request. Return only the required JSON.
Choose only the requested intent: search for existing records, prepare a create form, list follow-ups, open a report, or help.
Never claim to have saved, searched, or changed data; the application performs authorized operations separately.
For changes to existing records, choose search so the administrator can review the existing form. For archive or permanent-delete requests, also choose search and return only the identifying query; the application offers the action only when authorized and requires explicit confirmation.
For a new patient registration that mentions a department, use moduleId "patients" and put the department choice label in values.created_department_id.
Extract only details explicitly present in the request. Do not infer clinical facts, dates, amounts, or consent.
For search, query should contain only the identifying term or record detail, not command words.
The application modules and form field names are:
${moduleGuide()}`,
    message.slice(0, 2000),
    outputSchema,
  );
  const kind = result.kind;
  if (
    kind !== "search" &&
    kind !== "followups" &&
    kind !== "report" &&
    kind !== "create" &&
    kind !== "help"
  ) {
    throw new OllamaUnavailableError("Ollama returned an unknown assistant intent.");
  }
  const moduleId = typeof result.moduleId === "string" && Object.hasOwn(MODULES, result.moduleId)
    ? result.moduleId
    : null;
  const dataset = result.dataset === "appointments" ||
      result.dataset === "invoices" ||
      result.dataset === "followups" ||
      result.dataset === "attendance"
    ? result.dataset
    : null;
  const intent: AssistantIntent = kind === "search"
    ? {
        kind,
        moduleId,
        query: typeof result.query === "string" ? result.query.trim().slice(0, 80) : "",
      }
    : kind === "create"
      ? moduleId
        ? { kind, moduleId }
        : { kind: "help" }
      : kind === "report"
        ? { kind, dataset }
        : { kind };
  const moduleFields = moduleId
    ? new Set(MODULES[moduleId].fields.map((field) => field.name))
    : allowedFields;
  return { intent, values: cleanValues(result.values, moduleFields) };
}

export async function extractValuesWithOllama(
  message: string,
  fields: AssistantFormField[],
): Promise<Record<string, string | boolean>> {
  const fieldGuide = fields
    .map((field) => {
      const choices = field.choices.length
        ? `; choices: ${field.choices.map((choice) => `${choice.id}=${choice.label}`).join(", ")}`
        : "";
      return `${field.name} (${field.label}, ${field.type}${field.required ? ", required" : ""})${choices}`;
    })
    .join("\n");
  const result = await requestStructuredOutput(
    `Extract only explicitly stated values for the listed form fields. Return only the required JSON.
Use exact choice IDs when a choice is specified. Do not infer or invent missing values.
Do not include fields that the user did not provide.
Available fields:
${fieldGuide}`,
    message.slice(0, 2000),
    valuesSchema,
  );
  return cleanValues(result.values, new Set(fields.map((field) => field.name)));
}
