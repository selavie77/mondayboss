"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { getSession } from "@/lib/workspace";

const schema = z.object({
  accountId: z.uuid(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the statement date."),
  statement: z.string().trim().min(1, "Enter the statement's ending balance.").max(40),
  lineIds: z.array(z.uuid()).min(1, "Tick at least one transaction.").max(20000),
});

function refresh() {
  revalidatePath("/reconcile");
}

/** Mark the ticked transactions as reconciled. The database refuses unless they add up to the statement exactly. */
export async function finishReconciliation(input: unknown): Promise<{ error?: string; ok?: true }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something is wrong with the form." };
  const d = parsed.data;

  let statementCents: number;
  try {
    statementCents = toCents(d.statement);
  } catch {
    return { error: "Enter the ending balance as a number, like 12,500.00." };
  }

  const { supabase } = await getSession();
  const { error } = await supabase.rpc("complete_reconciliation", {
    p_account_id: d.accountId,
    p_period_end: d.periodEnd,
    p_statement_cents: statementCents,
    p_line_ids: d.lineIds,
  });
  if (error) return { error: error.message };

  refresh();
  return { ok: true };
}

/** Undo the latest reconciliation for an account, so its transactions can be reconciled again. */
export async function undoReconciliation(id: string): Promise<{ error?: string }> {
  if (!z.uuid().safeParse(id).success) return { error: "That reconciliation was not found." };
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("undo_reconciliation", { p_id: id });
  if (error) return { error: error.message };
  refresh();
  return {};
}
