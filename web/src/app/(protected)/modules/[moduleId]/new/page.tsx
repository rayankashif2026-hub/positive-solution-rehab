import { notFound } from "next/navigation";

import RecordForm from "@/components/record-form";
import { saveRecord } from "@/app/(protected)/modules/actions";
import { hasPermission, requirePermission } from "@/lib/auth";
import { MODULES } from "@/lib/modules";

type NewRecordPageProps = {
  params: Promise<{ moduleId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function NewRecordPage({ params, searchParams }: NewRecordPageProps) {
  const { moduleId } = await params;
  const definition = MODULES[moduleId];
  if (!definition) {
    notFound();
  }
  await requirePermission(definition.createPermission);
  if (definition.additionalCreatePermission) {
    if (!(await hasPermission(definition.additionalCreatePermission))) {
      notFound();
    }
  }

  const { error } = await searchParams;
  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">NEW CLINIC RECORD</div>
          <h1>Add {definition.title.toLowerCase()}</h1>
          <p>Only enter information needed for this clinic workflow.</p>
        </div>
      </header>
      <RecordForm
        action={saveRecord.bind(null, moduleId, null)}
        cancelHref={`/modules/${moduleId}`}
        definition={definition}
        error={error}
      />
    </>
  );
}
