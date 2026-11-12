"use server";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  branch: z.string().trim().min(2).max(120),
  requestedRole: z.string().trim().min(2).max(80),
  reason: z.string().trim().min(10).max(1000),
  password: z.string().min(12).max(1024),
  confirmPassword: z.string().min(12).max(1024),
  website: z.string().optional(),
}).refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});

function getClientIp(requestHeaders: Headers): string | null {
  const forwardedIp =
    requestHeaders.get("x-vercel-forwarded-for") ??
    requestHeaders.get("x-real-ip") ??
    requestHeaders.get("x-forwarded-for");
  const candidateIp = forwardedIp?.split(",")[0]?.trim();
  return candidateIp && isIP(candidateIp) ? candidateIp : null;
}

async function removeProvisioningRequest(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  requestId: string,
  userId?: string,
): Promise<void> {
  if (userId) {
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      throw new Error(`Could not remove the incomplete access account: ${deleteUserError.message}`);
    }
  }

  const { error: deleteRequestError } = await admin
    .from("access_requests")
    .delete()
    .eq("id", requestId)
    .eq("status", "provisioning");
  if (deleteRequestError) {
    throw new Error(`Could not remove the incomplete access request: ${deleteRequestError.message}`);
  }
}

export async function submitAccessRequest(formData: FormData): Promise<void> {
  const parsed = requestSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    branch: formData.get("branch"),
    requestedRole: formData.get("requestedRole"),
    reason: formData.get("reason"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    website: formData.get("website"),
  });

  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path.includes("password") || issue.path.includes("confirmPassword"))) {
      redirect("/request-access?error=password");
    }
    redirect("/request-access?error=invalid");
  }
  if (parsed.data.website) {
    redirect("/request-access?submitted=1");
  }

  const requestHeaders = await headers();
  const ipAddress = getClientIp(requestHeaders);
  const ipHashSecret =
    process.env.LOGIN_IP_HASH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ipHashSecret) {
    throw new Error("Set LOGIN_IP_HASH_SECRET or SUPABASE_SERVICE_ROLE_KEY for request throttling.");
  }
  const ipHash = ipAddress
    ? createHmac("sha256", ipHashSecret).update(ipAddress).digest("hex")
    : null;

  const admin = createSupabaseAdminClient();
  const { data: requestId, error: beginError } = await admin.rpc("begin_access_request", {
    p_full_name: parsed.data.fullName,
    p_email: parsed.data.email.toLowerCase(),
    p_branch: parsed.data.branch,
    p_requested_role: parsed.data.requestedRole,
    p_reason: parsed.data.reason,
    p_ip_hash: ipHash,
  });
  if (beginError) {
    if (beginError.code === "PGRST202") {
      console.error("Access request database function is missing or not loaded:", {
        code: beginError.code,
        message: beginError.message,
      });
      redirect("/request-access?error=migration-required");
    }
    if (beginError.message.includes("access_request_rate_limited")) {
      redirect("/request-access?error=rate-limited");
    }
    if (beginError.message.includes("access_request_already_pending")) {
      redirect("/request-access?error=already-pending");
    }
    if (beginError.message.includes("access_request_invalid")) {
      redirect("/request-access?error=invalid");
    }
    console.error("Could not start an access request:", {
      code: beginError.code,
      message: beginError.message,
      details: beginError.details,
      hint: beginError.hint,
    });
    redirect("/request-access?error=failed");
  }
  if (typeof requestId !== "string") {
    throw new Error("The access request reservation returned an invalid identifier.");
  }

  const { data: createdAccount, error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
    email_confirm: false,
    user_metadata: { full_name: parsed.data.fullName },
  });
  if (createError || !createdAccount.user) {
    await removeProvisioningRequest(admin, requestId);
    if (createError?.code === "user_already_exists" || createError?.code === "email_exists") {
      redirect("/request-access?error=account-exists");
    }
    console.error("Could not create the pending clinic account:", createError?.message ?? "No user returned.");
    redirect("/request-access?error=account-create");
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ account_status: "inactive" })
    .eq("id", createdAccount.user.id);
  if (profileError) {
    await removeProvisioningRequest(admin, requestId, createdAccount.user.id);
    throw new Error(`Could not disable the unapproved account: ${profileError.message}`);
  }

  const { data: activated, error: activateError } = await admin.rpc("activate_access_request", {
    p_request_id: requestId,
    p_user_id: createdAccount.user.id,
  });
  if (activateError || !activated) {
    console.error(
      "Could not activate an access request:",
      activateError
        ? {
            code: activateError.code,
            message: activateError.message,
            details: activateError.details,
            hint: activateError.hint,
          }
        : "The registration function returned false.",
    );
    await removeProvisioningRequest(admin, requestId, createdAccount.user.id);
    redirect("/request-access?error=registration-failed");
  }

  const { data: ownerSetting, error: settingError } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "owner_notification_email")
    .maybeSingle();
  if (settingError) {
    console.error("Could not read the access request recipient:", settingError.message);
  }

  const candidates = [
    typeof ownerSetting?.setting_value === "string" ? ownerSetting.setting_value : null,
    process.env.OWNER_NOTIFICATION_EMAIL,
    process.env.INITIAL_DEVELOPER_EMAIL,
  ];
  let recipientEmail: string | null = null;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const recipient = z.string().trim().email().max(254).safeParse(candidate);
    if (recipient.success) {
      recipientEmail = recipient.data.toLowerCase();
      break;
    }
  }

  let notificationQueued = false;
  if (recipientEmail) {
    const { error: notificationError } = await admin.from("email_notifications").insert({
      recipient_email: recipientEmail,
      subject: "New clinic access request",
      payload: {
        notificationType: "access_request",
        requestId,
        fullName: parsed.data.fullName,
        email: parsed.data.email.toLowerCase(),
        branch: parsed.data.branch,
        requestedRole: parsed.data.requestedRole,
        reason: parsed.data.reason,
        submittedAt: new Date().toISOString(),
      },
    });
    if (notificationError) {
      console.error("Could not queue the access request email:", notificationError.message);
    } else {
      notificationQueued = true;
    }
  }

  const emailDeliveryConfigured = Boolean(
    notificationQueued &&
    process.env.CRON_SECRET &&
      process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN &&
      process.env.GMAIL_USER,
  );
  redirect(
    emailDeliveryConfigured
      ? "/request-access?submitted=1"
      : "/request-access?submitted=1&delivery=unavailable",
  );
}
