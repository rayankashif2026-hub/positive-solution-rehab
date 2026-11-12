"use server";

import { isIP } from "node:net";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
  next: z.string().optional(),
});

function safeNextPath(path: string | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return "/dashboard";
  }
  return path;
}

function relationLabel(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value[0] as { label?: string; name?: string } | undefined;
    return first?.label ?? first?.name ?? "";
  }
  if (value && typeof value === "object") {
    const item = value as { label?: string; name?: string };
    return item.label ?? item.name ?? "";
  }
  return "";
}

function getClientIp(requestHeaders: Headers): string | null {
  const forwardedIp =
    requestHeaders.get("x-vercel-forwarded-for") ?? requestHeaders.get("x-real-ip");
  const candidateIp = forwardedIp?.split(",")[0]?.trim();
  return candidateIp && isIP(candidateIp) ? candidateIp : null;
}

async function recordFailedLogin(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<void> {
  const { error } = await admin.from("login_events").insert({
    username: email,
    success: false,
    ip_address: ipAddress,
    user_agent: userAgent,
    occurred_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Could not record the failed login: ${error.message}`);
  }
}

export async function login(formData: FormData): Promise<void> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    redirect("/login?error=credentials");
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const requestHeaders = await headers();
  const ipAddress = getClientIp(requestHeaders);
  const userAgent = requestHeaders.get("user-agent");
  const ipHashSecret =
    process.env.LOGIN_IP_HASH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ipHashSecret) {
    throw new Error("Set LOGIN_IP_HASH_SECRET or SUPABASE_SERVICE_ROLE_KEY for login throttling.");
  }
  const ipHash = ipAddress
    ? createHmac("sha256", ipHashSecret).update(ipAddress).digest("hex")
    : null;
  const admin = createSupabaseAdminClient();
  const { data: attempts, error: attemptError } = await admin.rpc("record_login_attempt", {
    p_normalized_email: normalizedEmail,
    p_ip_hash: ipHash,
  });
  if (attemptError) {
    throw new Error(`Could not check the login rate limit: ${attemptError.message}`);
  }
  const loginAttempt = attempts?.[0] as
    | { attempt_id: string | null; allowed: boolean }
    | undefined;
  if (!loginAttempt?.allowed || !loginAttempt.attempt_id) {
    await recordFailedLogin(admin, normalizedEmail, ipAddress, userAgent);
    redirect("/login?error=throttled");
  }

  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizedEmail,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    if (error) {
      console.warn("Supabase sign-in failed.", {
        status: error.status ?? null,
        code: error.code ?? null,
      });
    } else {
      console.warn("Supabase sign-in returned no user.");
    }
    await recordFailedLogin(admin, normalizedEmail, ipAddress, userAgent);
    redirect("/login?error=credentials");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, username, full_name, email, account_status")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    await client.auth.signOut();
    throw new Error(`Could not load the signed-in profile: ${profileError.message}`);
  }
  if (!profile || profile.account_status !== "active") {
    await client.auth.signOut();
    await recordFailedLogin(admin, normalizedEmail, ipAddress, userAgent);
    redirect("/login?error=inactive");
  }

  const { data: grants, error: grantsError } = await admin
    .from("user_roles")
    .select("role:roles(label,name), department:departments(name)")
    .eq("user_id", data.user.id);

  if (grantsError) {
    await client.auth.signOut();
    throw new Error(`Could not load the signed-in user's role: ${grantsError.message}`);
  }
  if (!grants?.length) {
    await client.auth.signOut();
    await recordFailedLogin(admin, normalizedEmail, ipAddress, userAgent);
    redirect("/login?error=inactive");
  }

  const primaryGrant = grants[0] as {
    role?: unknown;
    department?: unknown;
  };
  const roleName = relationLabel(primaryGrant.role) || "Admin";
  const departmentName = relationLabel(primaryGrant.department) || "All departments";
  const occurredAt = new Date();
  const pakistanTime = new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    dateStyle: "medium",
    timeStyle: "long",
  }).format(occurredAt);

  const { error: attemptUpdateError } = await admin
    .from("login_attempts")
    .update({ succeeded: true })
    .eq("id", loginAttempt.attempt_id);
  if (attemptUpdateError) {
    await client.auth.signOut();
    throw new Error(`Could not mark the successful login attempt: ${attemptUpdateError.message}`);
  }

  const { data: event, error: eventError } = await admin
    .from("login_events")
    .insert({
      user_id: data.user.id,
      username: profile.username,
      success: true,
      ip_address: ipAddress,
      user_agent: userAgent,
      occurred_at: occurredAt.toISOString(),
    })
    .select("id")
    .single();

  if (eventError) {
    await client.auth.signOut();
    throw new Error(`Could not record the successful login: ${eventError.message}`);
  }

  const { data: ownerSetting, error: settingError } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", "owner_notification_email")
    .maybeSingle();

  if (settingError) {
    console.error("Could not read the login notification recipient:", settingError.message);
  }

  const configuredRecipient =
    typeof ownerSetting?.setting_value === "string" ? ownerSetting.setting_value : null;
  const recipientEmail =
    configuredRecipient || process.env.OWNER_NOTIFICATION_EMAIL || null;
  const gmailConfigured = Boolean(
    process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN &&
      process.env.GMAIL_USER,
  );
  const notificationErrorMessage = !recipientEmail
    ? "Owner notification email is not configured."
    : !gmailConfigured
      ? "Gmail API delivery is not configured."
      : null;

  const { error: notificationError } = await admin.from("email_notifications").insert({
    login_event_id: event.id,
    recipient_email: recipientEmail,
    subject: "Positive Solutions Rehab Center – New Admin Login Alert",
    delivery_status: notificationErrorMessage ? "failed" : "pending",
    last_error: notificationErrorMessage,
    payload: {
      fullName: profile.full_name,
      username: profile.username,
      email: profile.email,
      role: roleName,
      department: departmentName,
      loginTimePakistan: pakistanTime,
      ipAddress,
      userAgent,
      loginStatus: "success",
    },
  });

  if (notificationError) {
    console.error("Could not enqueue the login notification:", notificationError.message);
  }

  const { error: profileUpdateError } = await admin
    .from("profiles")
    .update({ last_login_at: occurredAt.toISOString() })
    .eq("id", data.user.id);

  if (profileUpdateError) {
    console.error("Could not update the profile's last login:", profileUpdateError.message);
  }

  redirect(safeNextPath(parsed.data.next));
}

export async function logout(): Promise<void> {
  const client = await createSupabaseServerClient();
  const { error } = await client.auth.signOut();
  if (error) {
    throw new Error(`Could not sign out: ${error.message}`);
  }
  redirect("/login");
}
