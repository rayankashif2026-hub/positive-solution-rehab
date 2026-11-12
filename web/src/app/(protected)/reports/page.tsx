import Link from "next/link";

import { hasPermission, requirePermission } from "@/lib/auth";
import { pakistanDateISO } from "@/lib/time";

const datasets = [
  { id: "appointments", label: "Appointments", permission: "appointments.read" },
  { id: "invoices", label: "Invoices", permission: "finance.read" },
  { id: "followups", label: "Follow-ups", permission: "followups.read" },
  { id: "attendance", label: "Staff attendance", permission: "attendance.read" },
] as const;

type ReportsPageProps = {
  searchParams: Promise<{
    dataset?: string;
    start?: string;
    end?: string;
    department?: string;
  }>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const { client } = await requirePermission("reports.export");
  const params = await searchParams;
  const today = pakistanDateISO();
  const start = params.start ?? today;
  const end = params.end ?? today;

  const [reportableDatasets, departmentResult] = await Promise.all([
    Promise.all(
      datasets.map(async (dataset) => {
        return (await hasPermission(dataset.permission)) ? dataset : null;
      }),
    ),
    client.from("departments").select("id,name").order("name"),
  ]);

  if (departmentResult.error) {
    throw new Error(`Could not load report departments: ${departmentResult.error.message}`);
  }
  const availableDatasets = reportableDatasets.filter(
    (dataset): dataset is (typeof datasets)[number] => dataset !== null,
  );
  const departments = departmentResult.data;

  const selectedDataset = availableDatasets.some(
    (dataset) => dataset.id === params.dataset,
  )
    ? params.dataset!
    : availableDatasets[0]?.id ?? "";
  const query = new URLSearchParams({
    dataset: selectedDataset,
    start,
    end,
    format: "xlsx",
  });
  if (params.department) {
    query.set("department", params.department);
  }

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">REPORTING</div>
          <h1>Reports and exports</h1>
          <p>Exports follow the same role and department access rules as the workspace.</p>
        </div>
      </header>
      <section className="panel">
        <h2>Choose report scope</h2>
        {availableDatasets.length ? (
          <>
            <form action="/reports" className="form-grid" method="get">
              <label className="field">
                Report
                <select defaultValue={selectedDataset} name="dataset" required>
                  {availableDatasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>{dataset.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Department
                <select defaultValue={params.department ?? ""} name="department">
                  <option value="">All authorized departments</option>
                  {(departments ?? []).map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Start date
                <input defaultValue={start} name="start" required type="date" />
              </label>
              <label className="field">
                End date
                <input defaultValue={end} name="end" required type="date" />
              </label>
              <div className="form-actions">
                <button className="button" type="submit">Update scope</button>
                <Link className="button button-primary" href={`/api/reports/export?${query}`}>
                  Download Excel
                </Link>
              </div>
            </form>
            <p className="muted">
              Exports include up to 5,000 rows. Psychology clinical notes are not included.
            </p>
          </>
        ) : (
          <p className="muted">No report datasets are available for your assigned permissions.</p>
        )}
      </section>
    </>
  );
}
