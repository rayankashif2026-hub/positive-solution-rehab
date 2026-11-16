import Link from "next/link";
import { notFound } from "next/navigation";

import {
  archiveRecord,
  permanentlyDeleteRecord,
} from "@/app/(protected)/modules/actions";
import ArchiveButton from "@/components/archive-button";
import DeleteRecordButton from "@/components/delete-record-button";
import { hasPermission, requirePermission } from "@/lib/auth";
import { MODULES } from "@/lib/modules";
import { requireRecordArray } from "@/lib/response-data";

type ModulePageProps = {
  params: Promise<{ moduleId: string }>;
  searchParams: Promise<{
    q?: string;
    saved?: string;
    archived?: string;
    deleted?: string;
    error?: string;
  }>;
};

function nestedValue(row: Record<string, unknown>, path: string): unknown {
  let value: unknown = row;
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

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return value.toLocaleString("en-PK");
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return new Date(value).toLocaleString("en-PK", {
        timeZone: "Asia/Karachi",
        dateStyle: "medium",
        timeStyle: "short",
      });
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    return value.replaceAll("_", " ");
  }
  return JSON.stringify(value);
}

export default async function ModulePage({ params, searchParams }: ModulePageProps) {
  const { moduleId } = await params;
  const definition = MODULES[moduleId];
  if (!definition) {
    notFound();
  }

  const queryParams = await searchParams;
  const search = queryParams.q?.trim().slice(0, 80) ?? "";
  const { client } = await requirePermission(definition.readPermission);
  let query = client
    .from(definition.table)
    .select(definition.select)
    .order(definition.orderBy, { ascending: false })
    .range(0, 49);

  if (definition.archiveField === "archived_at") {
    query = query.is("archived_at", null);
  } else if (definition.archiveField === "active") {
    query = query.eq("active", true);
  }
  if (search && definition.searchColumns?.[0]) {
    query = query.ilike(definition.searchColumns[0], `%${search}%`);
  }

  const archivePermission =
    moduleId === "patients" ? "patients.archive" : definition.updatePermission;
  const [queryResult, [canCreate, canUpdate, canArchive, canDelete]] = await Promise.all([
    query,
    Promise.all([
      hasPermission(definition.createPermission),
      hasPermission(definition.updatePermission),
      hasPermission(archivePermission),
      hasPermission("system.manage"),
    ]),
  ]);
  const { data, error } = queryResult;
  if (error) {
    throw new Error(`Could not load ${definition.title}: ${error.message}`);
  }
  const rows = requireRecordArray(data ?? [], `${definition.title} records`);

  const mayArchive = canArchive && canUpdate;

  const archiveAction = archiveRecord.bind(null, moduleId);
  const deleteAction = permanentlyDeleteRecord.bind(null, moduleId);
  const canEdit = canUpdate && definition.updateable !== false;
  const hasActions = canEdit || (mayArchive && Boolean(definition.archiveField)) || canDelete;
  const notice = queryParams.saved
    ? "Record saved."
    : queryParams.archived
      ? "Record archived."
      : queryParams.deleted
        ? "Record permanently deleted. The audit history was retained."
        : queryParams.error === "delete-linked-records"
          ? "This record has linked records and cannot be deleted. Archive it instead."
          : queryParams.error === "delete-forbidden"
            ? "The app permission check passed, but database delete access is not enabled. Apply the latest system-managed record deletion migration and try again."
            : queryParams.error === "delete-failed"
              ? "The record could not be permanently deleted."
      : queryParams.error
        ? "The requested action could not be completed."
        : null;

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">CLINIC RECORDS</div>
          <h1>{definition.title}</h1>
          <p>Records shown here are limited to your assigned access.</p>
        </div>
        {canCreate && (
          <Link className="button button-primary" href={`/modules/${moduleId}/new`}>
            Add record
          </Link>
        )}
      </header>
      {notice && <div className={queryParams.error ? "alert" : "notice"} role="status">{notice}</div>}
      <section className="panel">
        {definition.searchColumns?.length ? (
          <form action={`/modules/${moduleId}`} className="toolbar" method="get">
            <label className="search-field">
              <span className="sr-only">Search {definition.title}</span>
              <input defaultValue={search} maxLength={80} name="q" placeholder="Search records" />
            </label>
            <button className="button" type="submit">Search</button>
          </form>
        ) : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {definition.columns.map((column) => <th key={column.key}>{column.label}</th>)}
                {hasActions
                  ? <th>Actions</th>
                  : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)}>
                  {definition.columns.map((column) => (
                    <td key={column.key}>
                      {column.key === "remaining_sessions"
                        ? displayValue(
                            Number(row.prescribed_sessions) - Number(row.completed_sessions),
                          )
                        : displayValue(nestedValue(row, column.key))}
                    </td>
                  ))}
                  {hasActions
                    ? (
                      <td className="table-actions">
                        {canEdit && (
                          <Link
                            className="button"
                            href={`/modules/${moduleId}/${row.id}/edit`}
                          >
                            Edit
                          </Link>
                        )}
                        {mayArchive && definition.archiveField && (
                          <ArchiveButton action={archiveAction} recordId={String(row.id)} />
                        )}
                        {canDelete && (
                          <DeleteRecordButton
                            action={deleteAction}
                            moduleTitle={definition.title}
                            recordId={String(row.id)}
                          />
                        )}
                      </td>
                    )
                    : null}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="empty-state" colSpan={definition.columns.length + (hasActions ? 1 : 0)}>
                    No records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted">Showing up to 50 records. Use search to narrow results.</p>
      </section>
    </>
  );
}
