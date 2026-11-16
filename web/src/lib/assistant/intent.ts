import { extractValuesWithOllama, interpretWithOllama, OllamaUnavailableError } from "./ollama";
import type { AssistantFormField } from "./contracts";

export type AssistantIntent =
  | { kind: "search"; query: string; moduleId: string | null }
  | { kind: "followups" }
  | { kind: "report"; dataset: string | null }
  | { kind: "create"; moduleId: string }
  | { kind: "help" };

export type AssistantInterpretation = {
  intent: AssistantIntent;
  values: Record<string, string | boolean>;
  provider: "ollama" | "rules";
  notice?: string;
};

export interface AssistantIntentProvider {
  interpret(message: string): Promise<AssistantInterpretation>;
}

function moduleFromMessage(message: string): string | null {
  if (/\bpsychology\s+notes?\b/i.test(message)) return "psychology-notes";
  if (/\b(?:patient|general)\s+notes?\b/i.test(message)) return "patient-notes";
  if (/\bpsychology\b/i.test(message)) return "psychology";
  if (/\bphysio(?:therapy)?\b/i.test(message)) return "physiotherapy";
  if (/\bhijama\b/i.test(message)) return "hijama";
  if (/\bnutrition\b/i.test(message)) return "nutrition";
  if (/\bexercise\s+(?:batch|batches)\b/i.test(message)) return "exercise-batches";
  if (/\bexercise\s+(?:participant|participants)\b/i.test(message)) return "exercise-participants";
  if (/\bexercise\s+attendance\b/i.test(message)) return "exercise-attendance";
  if (/\b(?:staff\s+)?attendance\b/i.test(message)) return "attendance";
  if (/\bappointment|booking|schedule\b/i.test(message)) return "appointments";
  if (/\bpayment\b/i.test(message)) return "payments";
  if (/\binvoice\b/i.test(message)) return "invoices";
  if (/\bfollow[ -]?ups?\b/i.test(message)) return "followups";
  if (/\bstock|inventory transaction\b/i.test(message)) return "inventory-transactions";
  if (/\binventory\b/i.test(message)) return "inventory";
  if (/\bequipment maintenance\b/i.test(message)) return "equipment-maintenance";
  if (/\bequipment request\b/i.test(message)) return "equipment-requests";
  if (/\bequipment\b/i.test(message)) return "equipment";
  if (/\bstaff\b/i.test(message)) return "staff";
  if (/\bpatient\b/i.test(message)) return "patients";
  return null;
}

export function normalizeAssistantSearchQuery(message: string): string {
  return message
    .replace(/\b(search|find|look\s+up|lookup|show|list|edit|update|change|mark|archive|archived|delete|remove|permanently|the|a|an|record|records|named|called|for|of|please)\b/gi, " ")
    .replace(/\b(patients?|appointments?|bookings?|schedules?|physiotherap(?:y)?|physio|psychology|notes?|hijama|nutrition|exercise|batches?|participants?|attendance|staff|payments?|invoices?|follow[ -]?ups?|inventory|stock|items?|equipment|maintenance|requests?)\b/gi, " ")
    .replace(/[^\p{L}\p{N}@.+\- ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function classifyWithRules(message: string): AssistantIntent {
  const text = message.trim();
  const lower = text.toLowerCase();
  const registeringPatient = /\b(register|create|add|new)\b/.test(lower) &&
    /\bpatient\b/.test(lower);

  if (registeringPatient) {
    return { kind: "create", moduleId: "patients" };
  }

  if (/\bfollow[ -]?ups?\b/.test(lower) && /\b(pending|due|overdue|show|list|check)\b/.test(lower)) {
    return { kind: "followups" };
  }

  if (/\b(report|export|spreadsheet|excel)\b/.test(lower)) {
    const dataset = /\b(invoice|payment|finance|revenue)\b/.test(lower)
      ? "invoices"
      : /\b(follow[ -]?up)\b/.test(lower)
        ? "followups"
        : /\b(attendance)\b/.test(lower)
          ? "attendance"
          : /\b(appointment|schedule)\b/.test(lower)
            ? "appointments"
            : null;
    return { kind: "report", dataset };
  }

  const moduleId = moduleFromMessage(text);
  if (/\b(search|find|look\s+up|lookup|show|list|edit|update|change|mark|archive|delete|remove)\b/.test(lower)) {
    return { kind: "search", query: normalizeAssistantSearchQuery(text), moduleId };
  }

  if (/\b(register|create|add|new|book|schedule|record|assign|log|enter)\b/.test(lower) && moduleId) {
    return { kind: "create", moduleId };
  }

  if (moduleId === "followups") {
    return { kind: "followups" };
  }
  return { kind: "help" };
}

const ruleBasedProvider: AssistantIntentProvider = {
  async interpret(message) {
    return {
      intent: classifyWithRules(message),
      values: {},
      provider: "rules",
    };
  },
};

const ollamaProvider: AssistantIntentProvider = {
  async interpret(message) {
    const result = await interpretWithOllama(message);
    return { ...result, provider: "ollama" };
  },
};

export async function interpretAssistantMessage(message: string): Promise<AssistantInterpretation> {
  try {
    return await ollamaProvider.interpret(message);
  } catch (error) {
    if (!(error instanceof OllamaUnavailableError)) {
      throw error;
    }
    return {
      ...(await ruleBasedProvider.interpret(message)),
      notice: error.message,
    };
  }
}

export function classifyAssistantIntent(
  message: string,
): AssistantIntent {
  return classifyWithRules(message);
}

export async function extractAssistantFormValues(
  message: string,
  fields: AssistantFormField[],
): Promise<{ values: Record<string, string | boolean>; notice?: string }> {
  try {
    return { values: await extractValuesWithOllama(message, fields) };
  } catch (error) {
    if (!(error instanceof OllamaUnavailableError)) {
      throw error;
    }
    return { values: {}, notice: error.message };
  }
}
