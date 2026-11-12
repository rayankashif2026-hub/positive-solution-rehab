import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";

const reportDefinitions = {
  appointments: {
    permission: "appointments.read",
    columns: [
      ["starts_at", "Start"],
      ["ends_at", "End"],
      ["patient.full_name", "Patient"],
      ["department.name", "Department"],
      ["practitioner.full_name", "Practitioner"],
      ["status", "Status"],
      ["followup_required", "Follow-up required"],
    ],
  },
  invoices: {
    permission: "finance.read",
    columns: [
      ["issued_at", "Issued"],
      ["patient.full_name", "Patient"],
      ["department.name", "Department"],
      ["total_amount", "Total amount"],
      ["concession_amount", "Concession"],
      ["amount_paid", "Amount paid"],
      ["balance_due", "Balance due"],
      ["payment_status", "Payment status"],
      ["currency", "Currency"],
    ],
  },
  followups: {
    permission: "followups.read",
    columns: [
      ["due_at", "Due date"],
      ["patient.full_name", "Patient"],
      ["department.name", "Department"],
      ["practitioner.full_name", "Practitioner"],
      ["reason", "Reason"],
      ["status", "Status"],
    ],
  },
  attendance: {
    permission: "attendance.read",
    columns: [
      ["attendance_date", "Date"],
      ["staff.full_name", "Staff member"],
      ["staff.department.name", "Department"],
      ["status", "Status"],
      ["check_in", "Check in"],
      ["check_out", "Check out"],
    ],
  },
} as const;

type ReportName = keyof typeof reportDefinitions;

function isReportName(value: string | null): value is ReportName {
  return value !== null && Object.hasOwn(reportDefinitions, value);
}

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

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

function paidAmount(row: Record<string, unknown>): number {
  if (!Array.isArray(row.payments)) {
    return 0;
  }
  const cents = row.payments.reduce((total, payment) => {
    if (!payment || typeof payment !== "object") {
      return total;
    }
    const amount = Number((payment as Record<string, unknown>).amount);
    return Number.isFinite(amount) ? total + Math.round(amount * 100) : total;
  }, 0);
  return cents / 100;
}

function moneyCents(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function reportValue(row: Record<string, unknown>, key: string): unknown {
  if (key === "amount_paid") {
    return paidAmount(row);
  }
  if (key === "balance_due") {
    return Math.max(
      moneyCents(row.total_amount) -
        moneyCents(row.concession_amount) -
        moneyCents(paidAmount(row)),
      0,
    ) / 100;
  }
  if (key === "payment_status") {
    const total = Number(row.total_amount);
    const concession = Number(row.concession_amount);
    const paid = paidAmount(row);
    if (total === concession) {
      return "assistance";
    }
    if (paid === 0) {
      return "unpaid";
    }
    return paid < total - concession ? "partial" : "paid";
  }
  return nestedValue(row, key);
}

export async function GET(request: Request) {
  const { client } = await requireUser();
  const params = new URL(request.url).searchParams;
  const reportName = params.get("dataset");
  const start = params.get("start");
  const end = params.get("end");
  const departmentId = params.get("department");

  if (
    !isReportName(reportName) ||
    params.get("format") !== "xlsx" ||
    !validDate(start) ||
    !validDate(end) ||
    start > end ||
    (departmentId !== null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(departmentId))
  ) {
    return NextResponse.json({ error: "Invalid report filters." }, { status: 400 });
  }

  for (const permission of ["reports.export", reportDefinitions[reportName].permission]) {
    const { data: allowed, error } = await client.rpc("has_permission", {
      p_permission_key: permission,
      p_department_id: departmentId,
    });
    if (error) {
      console.error(`Could not verify report access: ${error.message}`);
      return NextResponse.json({ error: "Could not verify report access." }, { status: 500 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "You cannot export this report." }, { status: 403 });
    }
  }

  const startAt = `${start}T00:00:00.000+05:00`;
  const endAt = `${end}T23:59:59.999+05:00`;
  let rows: Record<string, unknown>[] | null = null;
  let queryError: { message: string } | null = null;

  if (reportName === "appointments") {
    let query = client
      .from("appointments")
      .select("starts_at,ends_at,status,followup_required,patient:patients(full_name),department:departments(name),practitioner:staff(full_name)")
      .gte("starts_at", startAt)
      .lte("starts_at", endAt)
      .order("starts_at")
      .limit(5000);
    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }
    const result = await query;
    rows = result.data;
    queryError = result.error;
  } else if (reportName === "invoices") {
    let query = client
      .from("invoices")
      .select("issued_at,total_amount,concession_amount,currency,payments(amount),patient:patients(full_name),department:departments(name)")
      .gte("issued_at", startAt)
      .lte("issued_at", endAt)
      .order("issued_at")
      .limit(5000);
    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }
    const result = await query;
    rows = result.data;
    queryError = result.error;
  } else if (reportName === "followups") {
    let query = client
      .from("followups")
      .select("due_at,reason,status,patient:patients(full_name),department:departments(name),practitioner:staff(full_name)")
      .gte("due_at", start)
      .lte("due_at", end)
      .order("due_at")
      .limit(5000);
    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }
    const result = await query;
    rows = result.data;
    queryError = result.error;
  } else {
    let query = client
      .from("staff_attendance")
      .select("attendance_date,status,check_in,check_out,staff:staff!inner(full_name,department_id,department:departments(name))")
      .gte("attendance_date", start)
      .lte("attendance_date", end)
      .order("attendance_date")
      .limit(5000);
    if (departmentId) {
      query = query.eq("staff.department_id", departmentId);
    }
    const result = await query;
    rows = result.data;
    queryError = result.error;
  }

  if (queryError) {
    console.error(`Could not build ${reportName} report: ${queryError.message}`);
    return NextResponse.json({ error: "Could not build the requested report." }, { status: 500 });
  }

  const definition = reportDefinitions[reportName];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Positive Solutions Rehab Center";
  workbook.created = new Date();
  if (reportName === "invoices") {
    const invoices = rows ?? [];
    const totals = invoices.reduce<{
      total: number;
      concession: number;
      paid: number;
      balance: number;
    }>(
      (summary, row) => {
        summary.total += moneyCents(row.total_amount);
        summary.concession += moneyCents(row.concession_amount);
        summary.paid += moneyCents(paidAmount(row));
        summary.balance += Math.max(
          moneyCents(row.total_amount) -
            moneyCents(row.concession_amount) -
            moneyCents(paidAmount(row)),
          0,
        );
        return summary;
      },
      { total: 0, concession: 0, paid: 0, balance: 0 },
    );
    const summarySheet = workbook.addWorksheet("Financial summary");
    summarySheet.addRows([
      ["Financial summary", "PKR"],
      ["Period", `${start} to ${end}`],
      ["Invoice count", invoices.length],
      ["Total billed", totals.total / 100],
      ["Concessions", totals.concession / 100],
      ["Payments received", totals.paid / 100],
      ["Balance due", totals.balance / 100],
    ]);
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.columns = [{ width: 24 }, { width: 28 }];
  }
  const worksheet = workbook.addWorksheet(reportName);
  worksheet.columns = definition.columns.map(([key, header]) => ({
    header,
    key,
    width: Math.min(Math.max(header.length + 4, 16), 32),
  }));
  worksheet.addRows(
    (rows ?? []).map((row) =>
      definition.columns.map(([key]) => {
        const value = reportValue(row, key);
        if (typeof value === "boolean" || typeof value === "number" || value == null) {
          return value;
        }
        return String(value);
      }),
    ),
  );
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: (rows?.length ?? 0) + 1, column: definition.columns.length },
  };

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${reportName}-${start}-${end}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
