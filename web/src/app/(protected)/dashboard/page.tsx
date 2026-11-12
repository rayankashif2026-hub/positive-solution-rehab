import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Package,
  Users,
  Wallet,
} from "lucide-react";

import { hasPermission, hasRole, requirePermission } from "@/lib/auth";
import { getDueFollowupCount } from "@/lib/dashboard-data";
import { NAVIGATION } from "@/lib/navigation";
import { pakistanDateISO } from "@/lib/time";

type DashboardClient = Awaited<ReturnType<typeof requirePermission>>["client"];

async function countRows(
  client: DashboardClient,
  table: string,
  filters: Record<string, string> = {},
  activeOnly = false,
): Promise<number> {
  let query = client.from(table).select("id", { count: "exact", head: true });
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  if (activeOnly) {
    query = query.is("archived_at", null);
  }
  const { count, error } = await query;
  if (error) {
    throw new Error(`Could not load dashboard statistics: ${error.message}`);
  }
  return count ?? 0;
}

async function countOpenInvoices(client: DashboardClient): Promise<number> {
  const { count, error } = await client
    .from("invoice_balances")
    .select("id", { count: "exact", head: true })
    .gt("balance_due", 0);
  if (error) {
    throw new Error(`Could not load open invoice statistics: ${error.message}`);
  }
  return count ?? 0;
}

async function loadUpcomingAppointments(client: DashboardClient, now: Date) {
  const { data, count, error } = await client
    .from("appointments")
    .select(
      "id,starts_at,status,patient:patients(full_name,patient_number),practitioner:staff(full_name),department:departments(name)",
      { count: "exact" },
    )
    .eq("status", "scheduled")
    .is("archived_at", null)
    .gte("starts_at", now.toISOString())
    .order("starts_at", { ascending: true })
    .limit(6);
  if (error) {
    throw new Error(`Could not load upcoming appointments: ${error.message}`);
  }
  return { rows: data ?? [], count: count ?? 0 };
}

async function loadRecentPatients(client: DashboardClient) {
  const { data, count, error } = await client
    .from("patients")
    .select("id,patient_number,full_name,registered_at", { count: "exact" })
    .is("archived_at", null)
    .order("registered_at", { ascending: false })
    .limit(5);
  if (error) {
    throw new Error(`Could not load recent patient activity: ${error.message}`);
  }
  return { rows: data ?? [], count: count ?? 0 };
}

async function loadAttendance(client: DashboardClient, today: string) {
  const { data, count, error } = await client
    .from("staff_attendance")
    .select("status", { count: "exact" })
    .eq("attendance_date", today)
    .range(0, 999);
  if (error) {
    throw new Error(`Could not load today's attendance: ${error.message}`);
  }

  const total = count ?? 0;
  const statusLabels = ["Present", "Late", "Absent", "On leave"] as const;
  return {
    total,
    statuses:
      total > 1000
        ? null
        : (["present", "late", "absent", "leave"] as const).map((status, index) => ({
            label: statusLabels[index],
            count: (data ?? []).filter((row) => row.status === status).length,
          })),
  };
}

async function loadMonthlyRevenue(client: DashboardClient, today: string) {
  const [yearText, monthText] = today.slice(0, 7).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const start = new Date(`${yearText}-${monthText}-01T00:00:00+05:00`).toISOString();
  const end = new Date(
    `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+05:00`,
  ).toISOString();

  const { data, count, error } = await client
    .from("invoices")
    .select("total_amount,concession_amount", { count: "exact" })
    .eq("currency", "PKR")
    .is("archived_at", null)
    .gte("issued_at", start)
    .lt("issued_at", end)
    .range(0, 999);
  if (error) {
    throw new Error(`Could not load this month's billed revenue: ${error.message}`);
  }
  const invoiceCount = count ?? 0;
  if (invoiceCount > 1000) {
    return { amount: null, invoiceCount };
  }
  const amount = (data ?? []).reduce(
    (total, invoice) => total + Number(invoice.total_amount) - Number(invoice.concession_amount),
    0,
  );
  return { amount, invoiceCount };
}

async function loadDepartmentAppointments(
  client: DashboardClient,
  now: Date,
  end: Date,
) {
  const [departmentResult, appointmentsResult] = await Promise.all([
    client.from("departments").select("id,name").order("name"),
    client
      .from("appointments")
      .select("department_id", { count: "exact" })
      .eq("status", "scheduled")
      .is("archived_at", null)
      .gte("starts_at", now.toISOString())
      .lt("starts_at", end.toISOString())
      .range(0, 999),
  ]);
  if (departmentResult.error || appointmentsResult.error) {
    throw new Error(
      `Could not summarize department appointments: ${departmentResult.error?.message ?? appointmentsResult.error?.message}`,
    );
  }

  const visibleDepartments = (await Promise.all(
    (departmentResult.data ?? []).map(async (department) =>
      (await hasPermission("appointments.read", department.id)) ? department : null,
    ),
  )).filter((department) => department !== null);
  if ((appointmentsResult.count ?? 0) > 1000) {
    return Promise.all(
      visibleDepartments.map(async (department) => {
        const { count, error } = await client
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("department_id", department.id)
          .eq("status", "scheduled")
          .is("archived_at", null)
          .gte("starts_at", now.toISOString())
          .lt("starts_at", end.toISOString());
        if (error) {
          throw new Error(`Could not summarize department appointments: ${error.message}`);
        }
        return { id: department.id, name: department.name, count: count ?? 0 };
      }),
    );
  }

  const counts = new Map<string, number>();
  for (const appointment of appointmentsResult.data ?? []) {
    if (appointment.department_id) {
      counts.set(
        appointment.department_id,
        (counts.get(appointment.department_id) ?? 0) + 1,
      );
    }
  }
  return visibleDepartments.map((department) => ({
    id: department.id,
    name: department.name,
    count: counts.get(department.id) ?? 0,
  }));
}

function relationText(value: unknown, key: string): string {
  const relation = Array.isArray(value) ? value[0] : value;
  if (!relation || typeof relation !== "object") {
    return "";
  }
  const text = (relation as Record<string, unknown>)[key];
  return typeof text === "string" || typeof text === "number" ? String(text) : "";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-PK", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-PK", {
    timeZone: "Asia/Karachi",
    day: "numeric",
    month: "short",
  });
}

export default async function DashboardPage() {
  const { client, profile } = await requirePermission("dashboard.read");
  const today = pakistanDateISO();
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    canReadPatients,
    canCreatePatients,
    canReadStaff,
    canReadAppointments,
    canManageAppointments,
    canReadFollowups,
    canReadInventory,
    canReadAttendance,
    canReadFinance,
  ] = await Promise.all([
    hasPermission("patients.read"),
    hasPermission("patients.create"),
    hasPermission("staff.read"),
    hasPermission("appointments.read"),
    hasPermission("appointments.manage"),
    hasPermission("followups.read"),
    hasPermission("inventory.read"),
    hasPermission("attendance.read"),
    hasPermission("finance.read"),
  ]);

  const [
    staffCount,
    appointmentSummary,
    followupCount,
    inventoryCount,
    invoiceCount,
    patientActivity,
    attendance,
    monthlyRevenue,
    departmentSummaries,
  ] = await Promise.all([
    canReadStaff
      ? countRows(client, "staff", { employment_status: "active" }, true)
      : Promise.resolve(null),
    canReadAppointments
      ? loadUpcomingAppointments(client, now)
      : Promise.resolve({ rows: [], count: null }),
    canReadFollowups
      ? getDueFollowupCount(today)
      : Promise.resolve(null),
    canReadInventory ? countRows(client, "inventory_items", {}, true) : Promise.resolve(null),
    canReadFinance ? countOpenInvoices(client) : Promise.resolve(null),
    canReadPatients ? loadRecentPatients(client) : Promise.resolve(null),
    canReadAttendance ? loadAttendance(client, today) : Promise.resolve(null),
    canReadFinance ? loadMonthlyRevenue(client, today) : Promise.resolve(null),
    canReadAppointments
      ? loadDepartmentAppointments(client, now, weekEnd)
      : Promise.resolve([]),
  ]);

  const patientCount = patientActivity?.count ?? null;
  const recentPatients = patientActivity?.rows ?? [];
  const appointmentCount = appointmentSummary.count;
  const upcomingAppointments = appointmentSummary.rows;
  const stats = [
    { label: "Registered patients", value: patientCount, icon: Users, tone: "mint" },
    { label: "Active staff", value: staffCount, icon: ClipboardCheck, tone: "blue" },
    { label: "Scheduled appointments", value: appointmentCount, icon: CalendarDays, tone: "violet" },
    { label: "Today's follow-ups", value: followupCount, icon: FileText, tone: "amber" },
    { label: "Inventory items", value: inventoryCount, icon: Package, tone: "teal" },
    { label: "Open invoices", value: invoiceCount, icon: Wallet, tone: "rose" },
  ].filter((stat) => stat.value !== null);

  const visibleModules = await Promise.all(
    NAVIGATION.map(async (item) => {
      const allowed = item.role
        ? await hasRole(item.role)
        : await hasPermission(item.permission);
      return allowed ? item : null;
    }),
  );
  const modules = visibleModules.filter((item) => item !== null);
  const maximumDepartmentCount = Math.max(
    1,
    ...departmentSummaries.map((department) => department.count),
  );
  const attendanceTotal = attendance?.total ?? 0;
  const welcome = new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  return (
    <>
      <header className="page-header dashboard-header">
        <div>
          <div className="eyebrow">{welcome.toUpperCase()}</div>
          <h1>Welcome back, {profile.full_name.split(" ")[0]}</h1>
          <p>Your clinic at a glance. Each view is scoped to your assigned access.</p>
        </div>
        <div className="dashboard-actions">
          {canCreatePatients && (
            <Link className="button button-primary" href="/modules/patients/new">
              <Users aria-hidden="true" size={16} />
              Register patient
            </Link>
          )}
          {canManageAppointments && (
            <Link className="button" href="/modules/appointments/new">
              <CalendarDays aria-hidden="true" size={16} />
              New appointment
            </Link>
          )}
        </div>
      </header>

      <section aria-label="Clinic statistics" className="card-grid dashboard-stats">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className={`stat-card stat-${stat.tone}`} key={stat.label}>
              <div className="stat-topline">
                <span className="stat-icon"><Icon aria-hidden="true" size={19} /></span>
                <span className="stat-indicator">Live data</span>
              </div>
              <div className="eyebrow">{stat.label}</div>
              <div className="stat-value">{stat.value?.toLocaleString("en-PK")}</div>
            </article>
          );
        })}
      </section>

      <div className="dashboard-grid">
        {canReadAppointments && (
          <section aria-labelledby="appointments-title" className="panel dashboard-panel appointments-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">YOUR UPCOMING SCHEDULE</div>
                <h2 id="appointments-title">Appointments</h2>
              </div>
              <Link className="panel-link" href="/modules/appointments">
                View schedule <ArrowUpRight aria-hidden="true" size={16} />
              </Link>
            </div>
            {upcomingAppointments.length ? (
              <div className="appointment-list">
                {upcomingAppointments.map((appointment) => {
                  const patientName = relationText(appointment.patient, "full_name") || "Patient";
                  const departmentName = relationText(appointment.department, "name");
                  const practitionerName = relationText(appointment.practitioner, "full_name");
                  return (
                    <Link
                      className="appointment-row"
                      href="/modules/appointments"
                      key={appointment.id}
                    >
                      <span className="appointment-time">
                        <strong>{formatTime(appointment.starts_at)}</strong>
                        <small>{formatDate(appointment.starts_at)}</small>
                      </span>
                      <span className="appointment-details">
                        <strong>{patientName}</strong>
                        <small>{[departmentName, practitionerName].filter(Boolean).join(" · ") || "Clinic appointment"}</small>
                      </span>
                      <span className="status-pill status-scheduled">Scheduled</span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="empty-panel">
                <CalendarDays aria-hidden="true" size={24} />
                <strong>No upcoming appointments</strong>
                <span>Newly scheduled visits will appear here.</span>
              </div>
            )}
          </section>
        )}

        {canReadFinance && (
          <section aria-labelledby="revenue-title" className="panel dashboard-panel revenue-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">FINANCE · THIS MONTH</div>
                <h2 id="revenue-title">Billed revenue</h2>
              </div>
              <span className="stat-icon stat-icon-green"><Wallet aria-hidden="true" size={19} /></span>
            </div>
            <div className="revenue-value">
              {monthlyRevenue?.amount === null
                ? "—"
                : formatCurrency(monthlyRevenue?.amount ?? 0)}
            </div>
            <p className="muted">
              {monthlyRevenue?.amount === null
                ? "More than 1,000 invoices this month. Open Finance for the complete total."
                : `${monthlyRevenue?.invoiceCount ?? 0} PKR invoices issued this month, after concessions.`}
            </p>
            <Link className="panel-link" href="/modules/invoices">
              Open invoices <ArrowUpRight aria-hidden="true" size={16} />
            </Link>
          </section>
        )}

        {canReadAttendance && attendance && (
          <section aria-labelledby="attendance-title" className="panel dashboard-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">STAFF OPERATIONS · TODAY</div>
                <h2 id="attendance-title">Attendance</h2>
              </div>
              <Link className="panel-link" href="/modules/attendance">
                View records <ArrowUpRight aria-hidden="true" size={16} />
              </Link>
            </div>
            <div className="attendance-summary">
              <strong>{attendanceTotal.toLocaleString("en-PK")}</strong>
              <span>records for today</span>
            </div>
            {attendance.statuses ? (
              <div className="attendance-statuses">
                {attendance.statuses.map((status) => (
                  <div className="attendance-status" key={status.label}>
                    <span>{status.label}</span>
                    <strong>{status.count.toLocaleString("en-PK")}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Attendance status details are available in the records view.</p>
            )}
          </section>
        )}

        {canReadAppointments && (
          <section aria-labelledby="departments-title" className="panel dashboard-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">NEXT 7 DAYS</div>
                <h2 id="departments-title">Department schedule</h2>
              </div>
            </div>
            {departmentSummaries.length ? (
              <div className="department-summary-list">
                {departmentSummaries.map((department) => (
                  <div className="department-summary" key={department.id}>
                    <div className="department-summary-label">
                      <span>{department.name}</span>
                      <strong>{department.count}</strong>
                    </div>
                    <div className="department-track">
                      <span
                        className="department-fill"
                        style={{
                          width: `${(department.count / maximumDepartmentCount) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No department schedules are available for your permissions.</p>
            )}
          </section>
        )}

        {canReadPatients && (
          <section aria-labelledby="activity-title" className="panel dashboard-panel patient-activity-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">RECENT REGISTRATIONS</div>
                <h2 id="activity-title">Patient activity</h2>
              </div>
              <Link className="panel-link" href="/modules/patients">
                Patient records <ArrowUpRight aria-hidden="true" size={16} />
              </Link>
            </div>
            {recentPatients.length ? (
              <div className="patient-activity-list">
                {recentPatients.map((patient) => (
                  <div className="patient-activity-row" key={patient.id}>
                    <span aria-hidden="true" className="patient-avatar">
                      {patient.full_name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="patient-activity-details">
                      <strong>{patient.full_name}</strong>
                      <small>Patient #{patient.patient_number} · Registered {formatDate(patient.registered_at)}</small>
                    </span>
                    <span className="activity-dot" aria-hidden="true" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-panel">
                <Users aria-hidden="true" size={24} />
                <strong>No recent patient registrations</strong>
                <span>New registrations will appear here.</span>
              </div>
            )}
          </section>
        )}
      </div>

      <section className="panel workspace-panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">YOUR PERMISSIONED MODULES</div>
            <h2>Clinic workspace</h2>
          </div>
        </div>
        {modules.length ? (
          <div className="quick-grid">
            {modules.map((item) => (
              <Link className="quick-link" href={item.href} key={item.href}>
                <span>{item.label}</span>
                <ArrowUpRight aria-hidden="true" size={16} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">No additional modules are available for your assigned permissions.</p>
        )}
      </section>
    </>
  );
}
