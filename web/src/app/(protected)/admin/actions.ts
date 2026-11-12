"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const inviteSchema = z.object({
  requestId: z.string().uuid().optional(),
  username: z.string().trim().min(3).max(32).regex(/^[a-z0-9][a-z0-9._-]+$/),
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  roleId: z.string().uuid(),
  departmentId: z.string().optional(),
});

const roleDepartments: Record<string, string> = {
  physiotherapy_admin: "physiotherapy",
  psychology_admin: "psychology",
  hijama_admin: "hijama",
  nutrition_admin: "nutrition",
  female_exercise_admin: "female-exercise",
  attendance_admin: "attendance",
  inventory_admin: "inventory",
};

export async function inviteAccount(formData: FormData): Promise<void> {
  const { profile } = await requireRole("developer");
  const requestId = formData.get("requestId");
  const submittedFullName = formData.get("fullName");
  const submittedEmail = formData.get("email");
  const parsed = inviteSchema.safeParse({
    requestId: typeof requestId === "string" && requestId ? requestId : undefined,
    username: formData.get("username"),
    fullName: typeof submittedFullName === "string" && submittedFullName ? submittedFullName : undefined,
    email: typeof submittedEmail === "string" && submittedEmail ? submittedEmail : undefined,
    roleId: formData.get("roleId"),
    departmentId: formData.get("departmentId"),
  });
  if (!parsed.success) {
    redirect("/admin?error=invalid-invite");
  }

  const admin = createSupabaseAdminClient();
  let invitedFullName = parsed.data.fullName;
  let invitedEmail = parsed.data.email;
  let requestedUserId: string | null = null;
  if (parsed.data.requestId) {
    const { data: accessRequest, error: requestError } = await admin
      .from("access_requests")
      .select("id,full_name,email,requested_user_id")
      .eq("id", parsed.data.requestId)
      .eq("status", "pending")
      .maybeSingle();
    if (requestError) {
      throw new Error(`Could not load the pending access request: ${requestError.message}`);
    }
    if (!accessRequest) {
      redirect("/admin?error=request-not-pending");
    }
    invitedFullName = accessRequest.full_name;
    invitedEmail = accessRequest.email;
    requestedUserId = accessRequest.requested_user_id;
  }
  if (!invitedFullName || !invitedEmail) {
    redirect("/admin?error=invalid-invite");
  }

  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id,name")
    .eq("id", parsed.data.roleId)
    .single();
  if (roleError) {
    throw new Error(`Could not validate the requested role: ${roleError.message}`);
  }
  if (role.name === "developer") {
    redirect("/admin?error=developer-role-restricted");
  }

  let departmentId: string | null = null;
  if (role.name !== "head_admin") {
    if (!parsed.data.departmentId) {
      redirect("/admin?error=department-required");
    }
    const expectedDepartment = roleDepartments[role.name];
    if (!expectedDepartment) {
      redirect("/admin?error=role-department-mismatch");
    }
    const { data: department, error: departmentError } = await admin
      .from("departments")
      .select("id,slug")
      .eq("id", parsed.data.departmentId)
      .single();
    if (departmentError) {
      throw new Error(`Could not validate the selected department: ${departmentError.message}`);
    }
    if (department.slug !== expectedDepartment) {
      redirect("/admin?error=role-department-mismatch");
    }
    departmentId = department.id;
  }

  let invitedUserId = requestedUserId;
  if (requestedUserId) {
    const { error: profileError } = await admin
      .from("profiles")
      .update({ account_status: "active", username: parsed.data.username })
      .eq("id", requestedUserId);
    if (profileError) {
      throw new Error(`Could not activate the approved account: ${profileError.message}`);
    }

    const { error: confirmError } = await admin.auth.admin.updateUserById(requestedUserId, {
      email_confirm: true,
    });
    if (confirmError) {
      const { error: deactivateError } = await admin
        .from("profiles")
        .update({ account_status: "inactive" })
        .eq("id", requestedUserId);
      if (deactivateError) {
        throw new Error(
          `Could not confirm the approved login email or restore its inactive status: ${confirmError.message}; ${deactivateError.message}`,
        );
      }
      throw new Error(`Could not activate the approved login email: ${confirmError.message}`);
    }
  } else {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const redirectTo = new URL("/auth/callback", siteUrl).toString();
    const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      invitedEmail,
      {
        data: {
          username: parsed.data.username,
          full_name: invitedFullName,
        },
        redirectTo,
      },
    );
    if (inviteError || !invitation.user) {
      console.error("Could not invite a clinic account:", inviteError?.message ?? "No user returned.");
      redirect("/admin?error=invite-failed");
    }
    invitedUserId = invitation.user.id;
  }

  if (!invitedUserId) {
    throw new Error("The approved clinic account has no user identifier.");
  }
  const { data: grant, error: grantError } = await admin
    .from("user_roles")
    .insert({
      user_id: invitedUserId,
      role_id: role.id,
      department_id: departmentId,
      granted_by: profile.id,
    })
    .select("id")
    .single();
  if (grantError) {
    throw new Error(`The account could not be assigned its approved role: ${grantError.message}`);
  }

  if (parsed.data.requestId) {
    const { data: reviewedRequest, error: reviewError } = await admin
      .from("access_requests")
      .update({
        status: "invited",
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        invited_user_id: invitedUserId,
      })
      .eq("id", parsed.data.requestId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (reviewError) {
      throw new Error(`The account was invited, but its request could not be updated: ${reviewError.message}`);
    }
    if (!reviewedRequest) {
      throw new Error("The account was invited, but its access request is no longer pending.");
    }
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "invite",
    entity_type: "user_roles",
    entity_id: grant.id,
    department_id: departmentId,
    metadata: {
      target_user_id: invitedUserId,
      role_name: role.name,
      ...(parsed.data.requestId ? { access_request_id: parsed.data.requestId } : {}),
    },
  });
  if (auditError) {
    throw new Error(`The account was invited, but the audit event could not be saved: ${auditError.message}`);
  }

  revalidatePath("/admin");
  redirect(parsed.data.requestId ? "/admin?requestInvited=1" : "/admin?invited=1");
}

export async function rejectAccessRequest(formData: FormData): Promise<void> {
  const { profile } = await requireRole("developer");
  const requestId = formData.get("requestId");
  if (
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
  ) {
    redirect("/admin?error=invalid-request");
  }

  const admin = createSupabaseAdminClient();
  const { data: rejectedRequest, error: rejectError } = await admin
    .from("access_requests")
    .update({
      status: "rejected",
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id,requested_user_id")
    .maybeSingle();
  if (rejectError) {
    throw new Error(`Could not reject the access request: ${rejectError.message}`);
  }
  if (!rejectedRequest) {
    redirect("/admin?error=request-not-pending");
  }
  if (rejectedRequest.requested_user_id) {
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(
      rejectedRequest.requested_user_id,
    );
    if (deleteUserError) {
      throw new Error(
        `The request was rejected, but its inactive login could not be removed: ${deleteUserError.message}`,
      );
    }
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "access_request_rejected",
    entity_type: "access_requests",
    entity_id: requestId,
  });
  if (auditError) {
    throw new Error(`The request was rejected, but its audit event could not be saved: ${auditError.message}`);
  }

  revalidatePath("/admin");
  redirect("/admin?requestRejected=1");
}

export async function setAccountStatus(formData: FormData): Promise<void> {
  const { client, profile } = await requireRole("developer");
  const userId = formData.get("userId");
  const status = formData.get("status");
  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
    (status !== "active" && status !== "inactive" && status !== "locked")
  ) {
    redirect("/admin?error=invalid-status");
  }
  if (userId === profile.id) {
    redirect("/admin?error=self-status-change");
  }

  const { data: systemAccess, error: permissionError } = await client.rpc("has_permission", {
    p_permission_key: "system.manage",
    p_department_id: null,
  });
  if (permissionError) {
    throw new Error(`Could not verify Developer access: ${permissionError.message}`);
  }

  const admin = createSupabaseAdminClient();
  const { data: targetRoles, error: targetRoleError } = await admin
    .from("user_roles")
    .select("role:roles(name)")
    .eq("user_id", userId);
  if (targetRoleError) {
    throw new Error(`Could not verify the account's role: ${targetRoleError.message}`);
  }
  const hasDeveloperRole = (targetRoles ?? []).some((grant) => {
    const role = Array.isArray(grant.role) ? grant.role[0] : grant.role;
    return role?.name === "developer";
  });
  if (hasDeveloperRole && !systemAccess) {
    redirect("/admin?error=developer-role-restricted");
  }

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("account_status")
    .eq("id", userId)
    .single();
  if (targetError) {
    throw new Error(`Could not load the target account: ${targetError.message}`);
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ account_status: status })
    .eq("id", userId);
  if (updateError) {
    throw new Error(`Could not update the account status: ${updateError.message}`);
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: `account_status_${target.account_status}_to_${status}`,
    entity_type: "profiles",
    entity_id: userId,
  });
  if (auditError) {
    throw new Error(`The account was updated, but the audit event could not be saved: ${auditError.message}`);
  }

  revalidatePath("/admin");
  redirect("/admin?updated=1");
}

export async function removeAccount(formData: FormData): Promise<void> {
  const { profile } = await requireRole("developer");
  const userId = formData.get("userId");
  if (
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
  ) {
    redirect("/admin?error=invalid-remove-target");
  }
  if (userId === profile.id) {
    redirect("/admin?error=self-remove-restricted");
  }

  const admin = createSupabaseAdminClient();
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (targetError) {
    throw new Error(`Could not load the account to remove: ${targetError.message}`);
  }
  if (!target) {
    redirect("/admin?error=account-not-found");
  }

  const { data: targetRoles, error: roleError } = await admin
    .from("user_roles")
    .select("role:roles(name)")
    .eq("user_id", userId);
  if (roleError) {
    throw new Error(`Could not verify the account's role before removal: ${roleError.message}`);
  }
  const hasDeveloperRole = (targetRoles ?? []).some((grant) => {
    const role = Array.isArray(grant.role) ? grant.role[0] : grant.role;
    return role?.name === "developer";
  });
  if (hasDeveloperRole) {
    redirect("/admin?error=developer-account-restricted");
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    throw new Error(`Could not remove the clinic account: ${deleteError.message}`);
  }

  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "account_removed",
    entity_type: "profiles",
    entity_id: userId,
    metadata: { target_user_id: userId },
  });
  if (auditError) {
    throw new Error(`The account was removed, but the audit event could not be saved: ${auditError.message}`);
  }

  revalidatePath("/admin");
  redirect("/admin?accountRemoved=1");
}
