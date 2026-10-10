"use server";

import { revalidatePath } from "next/cache";
import { findReport } from "@/lib/reports/catalog";
import { getSession } from "@/lib/workspace";

/** Star or unstar a report for the signed-in user. Returns the new state. */
export async function toggleFavorite(key: string): Promise<boolean> {
  if (!findReport(key)) throw new Error("Unknown report");
  const { supabase, user } = await getSession();

  const { data: current } = await supabase
    .from("report_prefs")
    .select("is_favorite")
    .eq("report_key", key)
    .maybeSingle();
  const next = !current?.is_favorite;

  const { error } = await supabase
    .from("report_prefs")
    .upsert({ user_id: user.id, report_key: key, is_favorite: next }, { onConflict: "user_id,report_key" });
  if (error) throw new Error(error.message);

  revalidatePath("/reports");
  return next;
}

/** Remember that the user just opened a report. */
export async function recordVisit(key: string): Promise<void> {
  if (!findReport(key)) return;
  const { supabase, user } = await getSession();
  await supabase
    .from("report_prefs")
    .upsert({ user_id: user.id, report_key: key, last_visited_at: new Date().toISOString() }, { onConflict: "user_id,report_key" });
  revalidatePath("/reports");
}
