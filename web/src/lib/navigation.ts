export type NavigationItem = {
  href: string;
  label: string;
  permission: string;
  role?: string;
};

const modules = [
  ["patients", "Patients", "patients.read"],
  ["patient-notes", "General patient notes", "patients.notes.read"],
  ["appointments", "Appointments", "appointments.read"],
  ["physiotherapy", "Physiotherapy", "physiotherapy.read"],
  ["physiotherapy-sessions", "Physiotherapy sessions", "physiotherapy.read"],
  ["psychology", "Psychology", "psychology.read"],
  ["psychology-notes", "Confidential psychology notes", "psychology.notes.read"],
  ["hijama", "Hijama", "hijama.read"],
  ["nutrition", "Nutrition", "nutrition.read"],
  ["exercise-batches", "Exercise batches", "exercise.read"],
  ["exercise-participants", "Exercise participants", "exercise.read"],
  ["exercise-attendance", "Exercise attendance", "exercise.read"],
  ["staff", "Staff", "staff.read"],
  ["attendance", "Staff attendance", "attendance.read"],
  ["followups", "Follow-ups", "followups.read"],
  ["invoices", "Invoices", "finance.read"],
  ["payments", "Payments", "finance.read"],
  ["inventory", "Inventory", "inventory.read"],
  ["inventory-transactions", "Stock transactions", "inventory.read"],
  ["equipment", "Equipment", "equipment.read"],
  ["equipment-requests", "Equipment requests", "equipment.read"],
  ["equipment-maintenance", "Equipment maintenance", "equipment.read"],
] as const;

export const NAVIGATION: NavigationItem[] = modules.map(([moduleId, label, permission]) => ({
  href: `/modules/${moduleId}`,
  label,
  permission,
}));

NAVIGATION.push({
  href: "/admin",
  label: "User administration",
  permission: "system.manage",
  role: "developer",
});
NAVIGATION.push({
  href: "/reports",
  label: "Reports and exports",
  permission: "reports.export",
});
