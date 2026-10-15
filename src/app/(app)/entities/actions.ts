"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/workspace";

export type EntityResult = { error?: string; ok?: true };

const schema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Give the entity a name.").max(120, "Keep the name under 120 characters."),
  type: z.enum(["individual", "llc", "s_corp", "c_corp", "partnership", "trust"]),
});

/** Rename a legal entity or change its type. Its books and chart stay as they are. */
export async function updateEntity(input: unknown): Promise<EntityResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something is wrong with the form." };
  const { id, ...fields } = parsed.data;

  const { supabase } = await getSession();
  const { data, error } = await supabase.from("entities").update(fields).eq("id", id).select("id");
  if (error) return { error: error.code === "23505" ? "You already have an entity with that name." : error.message };
  if (!data?.length) return { error: "That entity was not found." };

  revalidatePath("/", "layout");
  return { ok: true };
}
