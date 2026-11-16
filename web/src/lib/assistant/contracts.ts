import type { FieldType } from "@/lib/modules";

export type AssistantChoice = {
  id: string;
  label: string;
};

export type AssistantFormField = {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  step?: string;
  helpText?: string;
  choices: AssistantChoice[];
  value: string | boolean;
};

export type AssistantForm = {
  moduleId: string;
  title: string;
  recordId: string | null;
  fields: AssistantFormField[];
  warning?: string;
};

export type AssistantSearchResult = {
  id: string;
  moduleId: string;
  title: string;
  summary: Array<{ label: string; value: string }>;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
};

export type AssistantLink = {
  label: string;
  href: string;
};

export type AssistantResponse = {
  message: string;
  form?: AssistantForm;
  results?: AssistantSearchResult[];
  links?: AssistantLink[];
  clearDraft?: boolean;
};
