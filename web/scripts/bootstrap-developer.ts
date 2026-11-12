import { loadEnvConfig } from "@next/env";

import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

loadEnvConfig(process.cwd());

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const email = requiredEnvironmentValue("INITIAL_DEVELOPER_EMAIL");
  const password = requiredEnvironmentValue("INITIAL_DEVELOPER_PASSWORD");
  const username = requiredEnvironmentValue("INITIAL_DEVELOPER_USERNAME")
    .toLowerCase()
    .replace(/\s+/g, "_");
  const fullName = requiredEnvironmentValue("INITIAL_DEVELOPER_FULL_NAME");

  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error(
      "INITIAL_DEVELOPER_USERNAME must become 3-32 letters, numbers, dots, underscores or hyphens after spaces are replaced.",
    );
  }
  if (password.length < 12 || password.length > 1024) {
    throw new Error("INITIAL_DEVELOPER_PASSWORD must be between 12 and 1024 characters.");
  }

  const admin = createSupabaseAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, full_name: fullName },
  });
  if (createError || !created.user) {
    throw new Error(`Could not create the Developer account: ${createError?.message ?? "No user returned."}`);
  }

  const { error: bootstrapError } = await admin.rpc("bootstrap_developer", {
    p_user_id: created.user.id,
  });
  if (bootstrapError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
    if (cleanupError) {
      throw new Error(
        `Could not complete Developer bootstrap (${bootstrapError.message}); cleanup also failed (${cleanupError.message}).`,
      );
    }
    throw new Error(`Could not complete Developer bootstrap: ${bootstrapError.message}`);
  }

  console.log(`Created the initial Head Developer account with Head Admin access for ${username}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Developer bootstrap failed.");
  process.exitCode = 1;
});
