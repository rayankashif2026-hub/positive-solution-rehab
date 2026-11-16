"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  LoaderCircle,
  MessageCircle,
  Minimize2,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import {
  assistantContinueDraft,
  assistantEditRecord,
  assistantTurn,
} from "@/app/(protected)/assistant/actions";
import {
  archiveRecordWithAssistant,
  deleteRecordWithAssistant,
  saveRecordWithAssistant,
} from "@/app/(protected)/modules/actions";
import type {
  AssistantForm,
  AssistantResponse,
  AssistantSearchResult,
} from "@/lib/assistant/contracts";

type ChatMessage = AssistantResponse & {
  id: number;
  role: "assistant" | "user";
};

function initialValues(form: AssistantForm): Record<string, string | boolean> {
  return Object.fromEntries(form.fields.map((field) => [field.name, inputValue(field)]));
}

function inputType(type: AssistantForm["fields"][number]["type"]): string {
  if (type === "email") return "email";
  if (type === "number" || type === "money") return "number";
  if (type === "date") return "date";
  if (type === "time") return "time";
  if (type === "datetime-local") return "datetime-local";
  return "text";
}

function inputValue(field: AssistantForm["fields"][number]): string | boolean {
  if (
    field.type === "datetime-local" &&
    typeof field.value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(field.value)
  ) {
    const date = new Date(field.value);
    if (Number.isFinite(date.getTime())) {
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Karachi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date).replace(" ", "T");
    }
  }
  return field.value;
}

function valueForReview(
  form: AssistantForm,
  name: string,
  values: Record<string, string | boolean>,
): string {
  const field = form.fields.find((item) => item.name === name);
  const value = values[name];
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (field?.type === "select") {
    return field.choices.find((choice) => choice.id === value)?.label ?? "Not selected";
  }
  return value?.toString().trim() || "Not set";
}

function SearchResultCard({
  result,
  onEdit,
  onArchive,
  onDelete,
  busy,
}: {
  result: AssistantSearchResult;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <article className="assistant-result-card">
      <dl>
        {result.summary.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <div className="assistant-result-actions">
        {result.canEdit && (
          <button className="assistant-result-edit" disabled={busy} onClick={onEdit} type="button">
            Edit with assistant <ArrowUpRight aria-hidden="true" size={14} />
          </button>
        )}
        {result.canArchive && (
          <button className="assistant-result-edit" disabled={busy} onClick={onArchive} type="button">
            Archive
          </button>
        )}
        {result.canDelete && (
          <button
            className="assistant-result-edit assistant-result-delete"
            disabled={busy}
            onClick={onDelete}
            type="button"
          >
            Delete permanently
          </button>
        )}
      </div>
    </article>
  );
}

export default function AssistantChat() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      message: "Hello. I can use your local Ollama model to prepare or edit clinic records, search records you can access, archive or permanently delete records when your permissions allow, check follow-ups, and open existing reports. Every change still needs your confirmation.",
    },
  ]);
  const [draft, setDraft] = useState<AssistantForm | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [reviewValues, setReviewValues] = useState<Record<string, string | boolean> | null>(null);
  const [duplicateConfirmation, setDuplicateConfirmation] = useState(false);
  const [notice, setNotice] = useState("");
  const [input, setInput] = useState("");
  const sequence = useRef(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, working]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  function appendMessage(role: ChatMessage["role"], response: AssistantResponse) {
    const id = sequence.current;
    sequence.current += 1;
    setMessages((current) => [...current, { ...response, id, role }]);
  }

  function applyResponse(response: AssistantResponse) {
    appendMessage("assistant", response);
    if (response.clearDraft) {
      setDraft(null);
      setValues({});
      setReviewValues(null);
      setDuplicateConfirmation(false);
      setNotice("");
    }
    if (response.form) {
      setDraft(response.form);
      setValues(initialValues(response.form));
      setReviewValues(null);
      setDuplicateConfirmation(false);
      setNotice("");
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || working) return;
    setInput("");
    appendMessage("user", { message: text });
    setWorking(true);
    try {
      const response = draft
        ? await assistantContinueDraft(draft.moduleId, draft.recordId, text, values)
        : await assistantTurn(text);
      applyResponse(response);
    } catch (error) {
      console.error("Assistant request failed:", error);
      appendMessage("assistant", {
        message: "I couldn't complete that request. Your manual clinic workflows are still available, and no record was changed.",
      });
    } finally {
      setWorking(false);
    }
  }

  async function editResult(moduleId: string, recordId: string) {
    setWorking(true);
    try {
      applyResponse(await assistantEditRecord(moduleId, recordId));
    } catch (error) {
      console.error("Assistant could not open the record:", error);
      appendMessage("assistant", {
        message: "I couldn't open that record. Your manual clinic workflows are still available.",
      });
    } finally {
      setWorking(false);
    }
  }

  async function actOnResult(result: AssistantSearchResult, action: "archive" | "delete") {
    if (working) return;
    const message = action === "archive"
      ? `Archive this ${result.title.toLowerCase()} record? It will be retained but removed from active records.`
      : `Permanently delete this ${result.title.toLowerCase()} record? This cannot be undone.`;
    if (!window.confirm(message)) return;

    setWorking(true);
    try {
      const outcome = action === "archive"
        ? await archiveRecordWithAssistant(result.moduleId, result.id, true)
        : await deleteRecordWithAssistant(result.moduleId, result.id, true);
      if (!outcome.success) {
        appendMessage("assistant", { message: outcome.message });
        return;
      }

      setMessages((current) => current.map((item) => {
        if (!item.results) return item;
        const results = item.results
          .filter((entry) => action !== "delete" || entry.id !== result.id || entry.moduleId !== result.moduleId)
          .map((entry) => entry.id === result.id && entry.moduleId === result.moduleId
            ? { ...entry, canEdit: false, canArchive: false }
            : entry);
        return { ...item, results };
      }));
      appendMessage("assistant", {
        message: outcome.message,
        links: [{ label: `Open ${result.title.toLowerCase()}`, href: `/modules/${result.moduleId}` }],
      });
    } catch (error) {
      console.error(`Assistant could not ${action} the record:`, error);
      appendMessage("assistant", {
        message: `I couldn't ${action} that record. No success was reported; verify its status in the module.`,
      });
    } finally {
      setWorking(false);
    }
  }

  function reviewForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const formData = new FormData(event.currentTarget);
    const submitted = Object.fromEntries(
      draft.fields.map((field) => {
        if (field.type === "checkbox") {
          return [field.name, formData.get(field.name) === "on"];
        }
        const value = formData.get(field.name);
        return [field.name, typeof value === "string" ? value : ""];
      }),
    ) as Record<string, string | boolean>;
    setValues(submitted);
    setReviewValues(submitted);
    setNotice("");
  }

  async function confirmSave() {
    if (!draft || !reviewValues || working) return;
    setWorking(true);
    setNotice("");
    try {
      const result = await saveRecordWithAssistant(
        draft.moduleId,
        draft.recordId,
        reviewValues,
        true,
        duplicateConfirmation,
      );
      if (!result.success) {
        setNotice(result.message);
        setDuplicateConfirmation(Boolean(result.needsDuplicateConfirmation));
        return;
      }
      appendMessage("assistant", {
        message: `${result.message}${result.recordId ? ` Record ID: ${result.recordId}.` : ""}`,
        links: [{ label: `Open ${draft.title.toLowerCase()}`, href: `/modules/${draft.moduleId}` }],
      });
      setDraft(null);
      setReviewValues(null);
      setValues({});
      setDuplicateConfirmation(false);
    } catch (error) {
      console.error("Assistant could not save the reviewed record:", error);
      setNotice("The save could not be completed. No success was reported; verify the record before trying again.");
    } finally {
      setWorking(false);
    }
  }

  function cancelDraft() {
    setDraft(null);
    setReviewValues(null);
    setValues({});
    setDuplicateConfirmation(false);
    setNotice("");
    appendMessage("assistant", { message: "Draft cancelled. Nothing was saved." });
  }

  const widget = (
    <div className="assistant-widget">
      {open && (
        <section aria-label="Clinic AI Assistant" className="assistant-panel">
          <header className="assistant-header">
            <div className="assistant-brand">
              <span className="assistant-avatar"><Sparkles aria-hidden="true" size={18} /></span>
              <span>
                <strong>Clinic Assistant</strong>
                <small>Private · uses your clinic access</small>
              </span>
            </div>
            <button
              aria-label="Minimize assistant"
              className="assistant-icon-button"
              onClick={() => setOpen(false)}
              type="button"
            >
              <Minimize2 aria-hidden="true" size={17} />
            </button>
          </header>

          <div aria-live="polite" className="assistant-messages" role="log">
            {messages.map((message) => (
              <div className={`assistant-message assistant-message-${message.role}`} key={message.id}>
                {message.role === "assistant" && (
                  <span className="assistant-message-icon"><Bot aria-hidden="true" size={15} /></span>
                )}
                <div className="assistant-message-content">
                  <p>{message.message}</p>
                  {message.results?.map((result) => (
                    <SearchResultCard
                      busy={working}
                      key={result.id}
                      onEdit={() => void editResult(result.moduleId, result.id)}
                      onArchive={() => void actOnResult(result, "archive")}
                      onDelete={() => void actOnResult(result, "delete")}
                      result={result}
                    />
                  ))}
                  {message.links?.map((link) => (
                    <Link className="assistant-link" href={link.href} key={link.href}>
                      {link.label} <ArrowUpRight aria-hidden="true" size={14} />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {working && (
              <div className="assistant-working">
                <LoaderCircle aria-hidden="true" className="assistant-spinner" size={15} />
                <span>Working with authorized records…</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {draft && (
            <section className="assistant-draft" aria-label={`${draft.title} draft`}>
              <div className="assistant-draft-heading">
                <div>
                  <span className="assistant-draft-kicker">
                    {draft.recordId ? "REVIEW CHANGES" : "NEW RECORD"}
                  </span>
                  <h3>{draft.recordId ? "Edit" : "Prepare"} {draft.title}</h3>
                </div>
                <button aria-label="Cancel draft" className="assistant-icon-button" onClick={cancelDraft} type="button">
                  <X aria-hidden="true" size={16} />
                </button>
              </div>
              {draft.warning && <p className="assistant-warning">{draft.warning}</p>}
              {notice && <p className="assistant-warning" role="alert">{notice}</p>}
              {reviewValues ? (
                <>
                  <dl className="assistant-review">
                    {draft.fields.map((field) => (
                      <div key={field.name}>
                        <dt>{field.label}{field.required ? " *" : ""}</dt>
                        <dd>{valueForReview(draft, field.name, reviewValues)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="assistant-confirm-copy">
                    {duplicateConfirmation
                      ? "A matching patient exists. Confirm only if you verified this is a separate person."
                      : "Confirm to save this record using the clinic’s existing secure workflow."}
                  </p>
                  <div className="assistant-draft-actions">
                    <button className="assistant-secondary-button" onClick={() => setReviewValues(null)} type="button">
                      Back to form
                    </button>
                    <button className="assistant-confirm-button" disabled={working} onClick={() => void confirmSave()} type="button">
                      <Check aria-hidden="true" size={15} />
                      {duplicateConfirmation ? "Confirm separate patient" : "Confirm & save"}
                    </button>
                  </div>
                </>
              ) : (
                <form className="assistant-form" onSubmit={reviewForm}>
                  {draft.fields.map((field) => (
                    field.type === "checkbox" ? (
                      <label className="assistant-check-field" key={field.name}>
                        <input
                          checked={values[field.name] === true}
                          name={field.name}
                          onChange={(event) => setValues((current) => ({
                            ...current,
                            [field.name]: event.target.checked,
                          }))}
                          type="checkbox"
                        />
                        <span>{field.label}</span>
                      </label>
                    ) : (
                      <label className="assistant-field" key={field.name}>
                        <span>{field.label}{field.required ? " *" : ""}</span>
                        {field.type === "select" ? (
                          <select
                            defaultValue={String(values[field.name] ?? "")}
                            name={field.name}
                            onChange={(event) => setValues((current) => ({
                              ...current,
                              [field.name]: event.target.value,
                            }))}
                            required={field.required}
                          >
                            <option value="">{field.required ? "Select an option" : "Not specified"}</option>
                            {field.choices.map((choice) => (
                              <option key={choice.id} value={choice.id}>{choice.label}</option>
                            ))}
                          </select>
                        ) : field.type === "textarea" || field.type === "json" ? (
                          <textarea
                            defaultValue={String(values[field.name] ?? "")}
                            name={field.name}
                            onChange={(event) => setValues((current) => ({
                              ...current,
                              [field.name]: event.target.value,
                            }))}
                            required={field.required}
                            rows={3}
                          />
                        ) : (
                          <input
                            defaultValue={String(values[field.name] ?? "")}
                            name={field.name}
                            onChange={(event) => setValues((current) => ({
                              ...current,
                              [field.name]: event.target.value,
                            }))}
                            required={field.required}
                            step={field.step}
                            type={inputType(field.type)}
                          />
                        )}
                        {field.helpText && <small>{field.helpText}</small>}
                      </label>
                    )
                  ))}
                  <div className="assistant-draft-actions">
                    <button className="assistant-secondary-button" onClick={cancelDraft} type="button">Cancel</button>
                    <button className="assistant-confirm-button" disabled={working} type="submit">
                      Review details <ChevronDown aria-hidden="true" size={15} />
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          <form className="assistant-composer" onSubmit={sendMessage}>
            <input
              maxLength={2000}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask or give a clinic task…"
              ref={inputRef}
              value={input}
            />
            <button aria-label="Send message" disabled={working || !input.trim()} type="submit">
              {working ? <LoaderCircle aria-hidden="true" className="assistant-spinner" size={17} /> : <Send aria-hidden="true" size={17} />}
            </button>
          </form>
          <footer className="assistant-disclosure">
            <span>Local Ollama model · no external AI/API</span>
            <span>Review and confirm every change</span>
          </footer>
        </section>
      )}
      <button
        aria-expanded={open}
        aria-label={open ? "Close Clinic Assistant" : "Open Clinic Assistant"}
        className={`assistant-launcher${open ? " assistant-launcher-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? <X aria-hidden="true" size={21} /> : <MessageCircle aria-hidden="true" size={21} />}
        {!open && <span>AI Assistant</span>}
      </button>
    </div>
  );

  return mounted ? createPortal(widget, document.body) : widget;
}
