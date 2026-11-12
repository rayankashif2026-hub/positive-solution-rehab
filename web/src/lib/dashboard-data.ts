import { cache } from "react";

import { requireUser } from "@/lib/auth";

export const getDueFollowupCount = cache(async (today: string): Promise<number> => {
  const { client } = await requireUser();
  const { count, error } = await client
    .from("followups")
    .select("id", { count: "exact", head: true })
    .eq("due_at", today)
    .eq("status", "upcoming")
    .is("archived_at", null);

  if (error) {
    throw new Error(`Could not load follow-up notifications: ${error.message}`);
  }
  return count ?? 0;
});
