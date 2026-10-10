"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/workspace";
import { SCHEDULE_E_LINES } from "@/lib/taxLines";

export type CategoryState = { error?: string; ok?: string } | undefined;

const schema = z.object({
  entity_id: z.uuid(),
  parent_id: z.string().optional(),
  type: z.enum(["asset", "liability", "equity", "income", "expense"]),
  name: z.string().trim().min(1, "Give it a name.").max(60, "Keep the name under 60 characters."),
  tax_line: z.string().optional(),
  description: z.string().trim().max(400, "Keep the description under 400 characters.").optional(),
});

export async function createCategory(_prev: CategoryState, formData: FormData): Promise<CategoryState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { entity_id, parent_id, type, name, tax_line, description } = parsed.data;

  if (tax_line && !SCHEDULE_E_LINES.some((l) => l.value === tax_line)) return { error: "Unknown tax line." };

  const { supabase } = await getSession();
  const { error } = await supabase.rpc("create_account", {
    p_entity_id: entity_id,
    p_parent_id: parent_id ? parent_id : null,
    p_type: type,
    p_name: name,
    p_tax_line: tax_line ? tax_line : null,
    p_description: description ? description : null,
  });
  if (error) {
    return { error: error.code === "23505" ? `“${name}” already exists here.` : error.message };
  }

  revalidatePath("/categories");
  revalidatePath("/review");
  return { ok: `Added “${name}”.` };
}

const descriptionSchema = z.object({
  id: z.uuid(),
  description: z.string().trim().max(400, "Keep the description under 400 characters."),
});

/** Change (or clear) a category's description. */
export async function updateDescription(id: string, description: string): Promise<CategoryState> {
  const parsed = descriptionSchema.safeParse({ id, description });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supabase } = await getSession();
  const { error } = await supabase
    .from("accounts")
    .update({ description: parsed.data.description || null })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };

  revalidatePath("/categories");
  return { ok: "Saved." };
}
