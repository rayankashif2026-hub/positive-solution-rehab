import { notFound } from "next/navigation";

import { saveRecord } from "@/app/(protected)/modules/actions";
import RecordForm from "@/components/record-form";
import { requirePermission } from "@/lib/auth";
import { MODULES } from "@/lib/modules";
import { requireRecord } from "@/lib/response-data";

type EditRecordPageProps = {
  params: Promise<{ moduleId: string; recordId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditRecordPage({
  params,
  searchParams,
}: EditRecordPageProps) {
  const { moduleId, recordId } = await params;
  const definition = MODULES[moduleId];
  if (!definition || definition.updateable === false) {
    notFound();
  }

  const { client } = await requirePermission(definition.updatePermission);
  const fields = definition.fields
    .filter(
      (field) =>
        !(definition.departmentSlug && field.name === "department_id") &&
        (!definition.updateFields || definition.updateFields.includes(field.name)),
    )
    .map((field) => field.name);
  const { data: record, error: recordError } = await client
    .from(definition.table)
    .select(["id", ...fields].join(","))
    .eq("id", recordId)
    .maybeSingle();
  if (recordError) {
    throw new Error(`Could not load ${definition.title} record: ${recordError.message}`);
  }
  if (!record) {
    notFound();
  }
  const recordValues = requireRecord(record, `${definition.title} record`);

  const { error } = await searchParams;
  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">EDIT CLINIC RECORD</div>
          <h1>Edit {definition.title.toLowerCase()}</h1>
          <p>Changes are recorded in the clinic system audit trail.</p>
        </div>
      </header>
      <RecordForm
        action={saveRecord.bind(null, moduleId, recordId)}
        cancelHref={`/modules/${moduleId}`}
        definition={definition}
        error={error}
        record={recordValues}
      />
    </>
  );
}
