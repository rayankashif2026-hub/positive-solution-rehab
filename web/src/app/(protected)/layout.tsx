import WorkspaceShell from "@/components/workspace-shell";
import { requireUser } from "@/lib/auth";
import { getDueFollowupCount } from "@/lib/dashboard-data";
import { NAVIGATION } from "@/lib/navigation";
import { pakistanDateISO } from "@/lib/time";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { profile, permissions, roles } = await requireUser();
  const visibleLinks = NAVIGATION.filter((item) =>
    item.role ? roles.has(item.role) : permissions.has(item.permission),
  );
  const canViewFollowups = visibleLinks.some((item) => item.href === "/modules/followups");
  const dueFollowupCount = canViewFollowups
    ? getDueFollowupCount(pakistanDateISO())
    : null;

  return (
    <WorkspaceShell
      dueFollowupCount={dueFollowupCount}
      fullName={profile.full_name}
      navItems={visibleLinks}
      username={profile.username}
    >
      {children}
    </WorkspaceShell>
  );
}
