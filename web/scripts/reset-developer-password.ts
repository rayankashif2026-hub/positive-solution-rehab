import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline/promises";

import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

loadEnvConfig(process.cwd());

function requiredEmail(): string {
  const email = process.env.INITIAL_DEVELOPER_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error("Missing required environment variable: INITIAL_DEVELOPER_EMAIL");
  }
  return email;
}

function getRoleName(value: unknown): string | null {
  const role = Array.isArray(value) ? value[0] : value;
  if (!role || typeof role !== "object") {
    return null;
  }
  const name = (role as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

async function main(): Promise<void> {
  const email = requiredEmail();
  const password = process.env.INITIAL_DEVELOPER_PASSWORD;
  if (!password || password.length < 12 || password.length > 1024) {
    throw new Error("Set a new INITIAL_DEVELOPER_PASSWORD between 12 and 1024 characters.");
  }

  const confirmation = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await confirmation.question(
      "This replaces the Head Developer password in the configured Supabase project. Type RESET to continue: ",
    );
  } finally {
    confirmation.close();
  }
  if (answer.trim() !== "RESET") {
    throw new Error("Password reset cancelled.");
  }

  const admin = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (profileError) {
    throw new Error(`Could not find the Developer profile: ${profileError.message}`);
  }
  if (!profile) {
    throw new Error("No profile exists for INITIAL_DEVELOPER_EMAIL in the configured project.");
  }

  const { data: grants, error: grantsError } = await admin
    .from("user_roles")
    .select("role:roles(name)")
    .eq("user_id", profile.id);
  if (grantsError) {
    throw new Error(`Could not verify the account role: ${grantsError.message}`);
  }
  if (!(grants ?? []).some((grant) => getRoleName(grant.role) === "developer")) {
    throw new Error("The configured account does not have the Developer role.");
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, {
    password,
  });
  if (updateError) {
    throw new Error(`Could not update the Developer password: ${updateError.message}`);
  }

  console.log("The Head Developer password was updated.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Developer password reset failed.");
  process.exitCode = 1;
});
