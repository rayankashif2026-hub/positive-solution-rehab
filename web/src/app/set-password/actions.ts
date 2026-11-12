"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const passwordSchema = z
  .object({
    password: z.string().min(12).max(1024),
    confirmPassword: z.string().min(12).max(1024),
  })
  .refine((values) => values.password === values.confirmPassword);

export async function setInitialPassword(formData: FormData): Promise<void> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    redirect("/set-password?error=password");
  }

  const client = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError && authError.name !== "AuthSessionMissingError") {
    throw new Error(`Could not validate the invitation session: ${authError.message}`);
  }
  if (!user) {
    redirect("/login?error=invite");
  }

  const admin = createSupabaseAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,account_status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    throw new Error(`Could not load the invited account: ${profileError.message}`);
  }
  if (!profile || profile.account_status !== "active") {
    await client.auth.signOut();
    redirect("/login?error=inactive");
  }

  const { data: grants, error: grantsError } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);
  if (grantsError) {
    throw new Error(`Could not verify the invited account role: ${grantsError.message}`);
  }
  if (!grants?.length) {
    await client.auth.signOut();
    redirect("/login?error=invite");
  }

  const { error: updateError } = await client.auth.updateUser({
    password: parsed.data.password,
  });
  if (updateError) {
    redirect("/set-password?error=update");
  }

  redirect("/dashboard?welcome=1");
}
