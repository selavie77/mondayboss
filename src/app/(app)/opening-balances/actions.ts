"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { openingDateProblem, openingFromAmount } from "@/lib/openingBalance";
import { getSession } from "@/lib/workspace";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");

const inputSchema = z.object({
  entityId: z.uuid(),
  mode: z.enum(["statement", "opening"]),
  asOf: date,
  statementDate: date.optional(),
  items: z
    .array(
      z.object({
        accountId: z.uuid(),
        /** "account": one balance for the whole account (a bank account or card). "property": a balance for one property. */
        scope: z.enum(["account", "property"]),
        propertyId: z.uuid().nullable(),
        amount: z.string().max(40),
      }),
    )
    .max(500),
});

export interface SaveOpeningResult {
  error?: string;
  saved: number;
  /** Rows left alone because the balance already matches the activity (the opening balance would be zero). */
  matched: number;
  problems: string[];
}

/** Post an opening balance for each filled-in row, working out the opening balance from a statement balance when asked. */
export async function saveOpeningBalances(input: unknown): Promise<SaveOpeningResult> {
  const none = { saved: 0, matched: 0, problems: [] as string[] };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ...none, error: parsed.error.issues[0]?.message ?? "Something is wrong with the form." };
  const { entityId, mode, asOf, statementDate, items } = parsed.data;
  if (mode === "statement" && !statementDate) return { ...none, error: "Enter the date of the statement balances." };

  const { supabase } = await getSession();

  // The opening date must come before your records start.
  const { data: firsts } = await supabase.from("journal_entries").select("entry_date, memo").eq("entity_id", entityId).order("entry_date").limit(50);
  const first = (firsts ?? []).find((e) => !/^(Reversal of )?Opening balance:/.test(e.memo ?? ""));
  const problem = openingDateProblem(asOf, first?.entry_date ?? null);
  if (problem) return { ...none, error: problem };

  const filled = items.filter((i) => i.amount.trim() !== "");
  if (filled.length === 0) return { ...none, error: "Enter at least one balance." };

  // How far the imported activity has already moved each balance, through the statement date.
  const movement = new Map<string, number>();
  const byAccount = new Map<string, number>();
  if (mode === "statement") {
    const { data: tree } = await supabase.from("accounts").select("id, parent_id").eq("entity_id", entityId);
    const topOf = new Map((tree ?? []).map((a) => [a.id as string, ((a.parent_id as string | null) ?? (a.id as string))]));
    const { data, error } = await supabase.rpc("opening_candidates", { p_entity_id: entityId, p_through: statementDate });
    if (error) return { ...none, error: error.message };
    for (const r of (data ?? []) as { account_id: string; property_id: string | null; movement_cents: number | string }[]) {
      const top = topOf.get(r.account_id) ?? r.account_id;
      const key = `${top}|${r.property_id ?? ""}`;
      movement.set(key, (movement.get(key) ?? 0) + Number(r.movement_cents));
      byAccount.set(top, (byAccount.get(top) ?? 0) + Number(r.movement_cents));
    }
  }

  const { data: accts } = await supabase.from("accounts").select("id, name").eq("entity_id", entityId).in("id", [...new Set(filled.map((i) => i.accountId))]);
  const names = new Map((accts ?? []).map((a) => [a.id as string, a.name as string]));

  let saved = 0;
  let matched = 0;
  const problems: string[] = [];
  for (const item of filled) {
    const name = names.get(item.accountId);
    if (!name) {
      problems.push("An account on this page was not found.");
      continue;
    }
    let amount: number;
    try {
      amount = toCents(item.amount);
    } catch {
      problems.push(`${name}: enter the balance as a number, like 12,500.00.`);
      continue;
    }
    const moved = item.scope === "account" ? (byAccount.get(item.accountId) ?? 0) : (movement.get(`${item.accountId}|${item.propertyId ?? ""}`) ?? 0);
    const opening = openingFromAmount(mode, amount, moved);
    if (opening === 0) {
      matched += 1;
      continue;
    }
    const { error } = await supabase.rpc("set_account_opening_balance", {
      p_account_id: item.accountId,
      p_as_of: asOf,
      p_amount_cents: opening,
      p_property_id: item.scope === "property" ? item.propertyId : null,
    });
    if (error) problems.push(`${name}: ${error.message}`);
    else saved += 1;
  }

  for (const p of ["/opening-balances", "/categories", "/monday", "/transactions"]) revalidatePath(p);
  revalidatePath("/reports", "layout");
  return { saved, matched, problems };
}
