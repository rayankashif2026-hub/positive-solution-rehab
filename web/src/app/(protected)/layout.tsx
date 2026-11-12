import WorkspaceShell from "@/components/workspace-shell";
import { hasPermission, hasRole, requireUser } from "@/lib/auth";
import { getDueFollowupCount } from "@/lib/dashboard-data";
import { NAVIGATION } from "@/lib/navigation";
import { pakistanDateISO } from "@/lib/time";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { profile } = await requireUser();
  const visibleLinks = await Promise.all(
    NAVIGATION.map(async (item) => {
      const allowed = item.role
        ? await hasRole(item.role)
        : await hasPermission(item.permission);
      return allowed ? item : null;
    }),
  );
  const canViewFollowups = visibleLinks.some((item) => item?.href === "/modules/followups");
  let dueFollowupCount: number | null = null;
  if (canViewFollowups) {
    dueFollowupCount = await getDueFollowupCount(pakistanDateISO());
  }

  return (
    <WorkspaceShell
      dueFollowupCount={dueFollowupCount}
      fullName={profile.full_name}
      navItems={visibleLinks.filter((item): item is (typeof NAVIGATION)[number] => item !== null)}
      username={profile.username}
    >
      {children}
    </WorkspaceShell>
  );
}
