"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/workspace";

export type ReviewResult = { error?: string };

const uuid = z.uuid();
const partsSchema = z
  .array(z.object({ accountId: uuid, cents: z.number().int().positive() }))
  .min(1, "Add at least one account.");

function refresh() {
  revalidatePath("/review");
  revalidatePath("/monday");
  revalidatePath("/", "layout");
}

/** Accept the proposed categorization for one or many lines. */
export async function acceptLines(ids: string[]): Promise<ReviewResult> {
  const parsed = z.array(uuid).min(1).safeParse(ids);
  if (!parsed.success) return { error: "Nothing to accept." };
  const { supabase } = await getSession();

  const { error } = await supabase.rpc("accept_statement_lines", { p_ids: parsed.data });
  if (error) return { error: error.message };
  refresh();
  return {};
}

/** Post a pending line using one or more accounts on the non-bank side (a split when there are several). */
export async function postLine(id: string, parts: { accountId: string; cents: number }[]): Promise<ReviewResult> {
  const idOk = uuid.safeParse(id);
  const partsOk = partsSchema.safeParse(parts);
  if (!idOk.success) return { error: "Unknown transaction." };
  if (!partsOk.success) return { error: partsOk.error.issues[0].message };
  const { supabase } = await getSession();

  const { data: line } = await supabase
    .from("statement_lines")
    .select("entity_id, amount_cents, property_id, status")
    .eq("id", id)
    .single();
  if (!line || line.status !== "pending") return { error: "That transaction was already handled." };

  const abs = Math.abs(Number(line.amount_cents));
  const total = partsOk.data.reduce((s, p) => s + p.cents, 0);
  if (total !== abs) return { error: "The amounts must add up to the transaction total." };

  const { data: cash } = await supabase
    .from("accounts")
    .select("id")
    .eq("entity_id", line.entity_id)
    .eq("code", "1000")
    .single();
  if (!cash) return { error: "This entity has no operating checking account (1000)." };

  // Money out: Dr the chosen accounts, Cr cash. Money in: Dr cash, Cr the chosen accounts.
  const inflow = Number(line.amount_cents) > 0;
  const side = inflow ? "credit_cents" : "debit_cents";
  const otherSide = inflow ? "debit_cents" : "credit_cents";
  const lines = [
    ...partsOk.data.map((p) => ({ account_id: p.accountId, property_id: line.property_id, [side]: p.cents })),
    { account_id: cash.id, property_id: line.property_id, [otherSide]: abs },
  ];

  const { error } = await supabase.rpc("post_statement_line", { p_line_id: id, p_lines: lines });
  if (error) return { error: error.message };
  refresh();
  return {};
}

/** Leave a line out of the books. It stays in the import history. */
export async function ignoreLine(id: string): Promise<ReviewResult> {
  if (!uuid.safeParse(id).success) return { error: "Unknown transaction." };
  const { supabase } = await getSession();
  const { error } = await supabase.from("statement_lines").update({ status: "ignored" }).eq("id", id).eq("status", "pending");
  if (error) return { error: error.message };
  refresh();
  return {};
}
