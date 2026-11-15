import { cache } from "react";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ClinicProfile = {
  id: string;
  username: string;
  full_name: string;
  email: string;
  account_status: "active" | "inactive" | "locked";
};

type ClinicSession = {
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  profile: ClinicProfile;
  permissions: Set<string>;
  roles: Set<string>;
};

function isPermissionRow(value: unknown): value is { permission_key: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "permission_key" in value &&
    typeof value.permission_key === "string"
  );
}

function getRoleName(value: unknown): string {
  const relation = Array.isArray(value) ? value[0] : value;
  if (
    typeof relation !== "object" ||
    relation === null ||
    !("name" in relation) ||
    typeof relation.name !== "string"
  ) {
    throw new Error("The current user role response had an unexpected format.");
  }
  return relation.name;
}

const loadClinicSession = cache(async (): Promise<ClinicSession> => {
  const client = await createSupabaseServerClient();
  const { data, error: authError } = await client.auth.getClaims();

  if (authError && authError.name !== "AuthSessionMissingError") {
    throw new Error(`Could not validate the current session: ${authError.message}`);
  }
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) {
    redirect("/login");
  }

  const [profileResult, permissionsResult, rolesResult] = await Promise.all([
    client
      .from("profiles")
      .select("id, username, full_name, email, account_status")
      .eq("id", userId)
      .maybeSingle(),
    client.rpc("current_user_permissions"),
    client.from("user_roles").select("role:roles(name)").eq("user_id", userId),
  ]);

  if (profileResult.error) {
    throw new Error(`Could not load the current profile: ${profileResult.error.message}`);
  }
  if (permissionsResult.error) {
    throw new Error(`Could not load current permissions: ${permissionsResult.error.message}`);
  }
  if (!Array.isArray(permissionsResult.data) || !permissionsResult.data.every(isPermissionRow)) {
    throw new Error("The current permissions response had an unexpected format.");
  }
  if (rolesResult.error) {
    throw new Error(`Could not load current roles: ${rolesResult.error.message}`);
  }

  const profile = profileResult.data;
  if (!profile || profile.account_status !== "active") {
    await client.auth.signOut();
    redirect("/login?error=inactive");
  }

  return {
    client,
    profile: profile as ClinicProfile,
    permissions: new Set(permissionsResult.data.map((row) => row.permission_key)),
    roles: new Set((rolesResult.data ?? []).map((row) => getRoleName(row.role))),
  };
});

export async function requireUser(): Promise<ClinicSession> {
  return loadClinicSession();
}

const checkPermission = cache(
  async (permissionKey: string, departmentId: string | null): Promise<boolean> => {
    if (departmentId === null) {
      return (await loadClinicSession()).permissions.has(permissionKey);
    }

    const { client } = await loadClinicSession();
    const { data: allowed, error } = await client.rpc("has_permission", {
      p_permission_key: permissionKey,
      p_department_id: departmentId,
    });

    if (error) {
      throw new Error(`Could not verify permission ${permissionKey}: ${error.message}`);
    }
    return Boolean(allowed);
  },
);

const checkRole = cache(async (roleName: string): Promise<boolean> =>
  (await loadClinicSession()).roles.has(roleName),
);

export async function hasPermission(
  permissionKey: string,
  departmentId?: string | null,
): Promise<boolean> {
  return checkPermission(permissionKey, departmentId ?? null);
}

export async function hasRole(roleName: string): Promise<boolean> {
  return checkRole(roleName);
}

export async function requireRole(roleName: string): Promise<ClinicSession> {
  const session = await requireUser();
  if (!(await hasRole(roleName))) {
    redirect("/dashboard?error=forbidden");
  }
  return session;
}

export async function requirePermission(
  permissionKey: string,
  departmentId?: string | null,
): Promise<{ client: Awaited<ReturnType<typeof createSupabaseServerClient>>; profile: ClinicProfile }> {
  const session = await requireUser();
  if (!(await hasPermission(permissionKey, departmentId))) {
    redirect("/dashboard?error=forbidden");
  }
  return session;
}
