"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { getSession } from "@/lib/workspace";

export type CapexState = { error?: string; ok?: string } | undefined;

const schema = z.object({
  property_id: z.uuid("Choose a property."),
  name: z.string().trim().min(1, "Give it a name.").max(120),
  sub_category: z.string().trim().min(1).max(60),
  amount: z.string().trim().min(1, "Enter the amount."),
  spent_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date."),
  placed_in_service_on: z.string().optional(),
  useful_life_years: z.coerce.number().positive("Useful life must be more than 0.").max(99),
  notes: z.string().trim().max(500).optional(),
});

export async function addCapitalExpense(_prev: CapexState, formData: FormData): Promise<CapexState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  let amountCents: number;
  try {
    amountCents = toCents(d.amount);
  } catch {
    return { error: "Enter the amount as a number, like 90000." };
  }
  if (amountCents <= 0) return { error: "The amount must be more than 0." };

  const { supabase, workspaceId } = await getSession();
  const { error } = await supabase.from("capital_expenses").insert({
    workspace_id: workspaceId,
    property_id: d.property_id,
    name: d.name,
    sub_category: d.sub_category,
    amount_cents: amountCents,
    spent_on: d.spent_on,
    placed_in_service_on: d.placed_in_service_on || d.spent_on,
    useful_life_years: d.useful_life_years,
    notes: d.notes || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/reports");
  return { ok: "Added." };
}
