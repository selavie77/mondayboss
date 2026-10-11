"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isCashLike } from "@/lib/paidFrom";
import { computeSale, factsFromRows } from "@/lib/propertySale";
import { toCents } from "@/lib/money";
import { getSession } from "@/lib/workspace";

const money = z.string().max(40);
const schema = z.object({
  propertyId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the sale date."),
  price: money,
  costs: money,
  payoff: money,
  deposits: money,
  escrow: money,
  /** "recorded": the net proceeds are already in your books as a Sale Proceeds deposit. Otherwise a bank account id. */
  proceeds: z.string().max(60),
});

export type SaleResult = { error?: string; ok?: { gainCents: number; netCents: number } };

function cents(text: string, label: string): number | { error: string } {
  if (text.trim() === "") return 0;
  try {
    return toCents(text);
  } catch {
    return { error: `Enter ${label} as a number, like 12,500.00.` };
  }
}

function refresh() {
  for (const p of ["/properties", "/transactions", "/monday", "/categories", "/opening-balances"]) revalidatePath(p);
  revalidatePath("/reports", "layout");
}

/** Record the sale of a property as one balanced entry, and mark the property sold. */
export async function recordPropertySale(input: unknown): Promise<SaleResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something is wrong with the form." };
  const d = parsed.data;

  const amounts = {
    priceCents: cents(d.price, "the sale price"),
    costsCents: cents(d.costs, "the selling costs"),
    payoffCents: cents(d.payoff, "the loan payoff"),
    depositsCents: cents(d.deposits, "the deposits"),
    escrowCents: cents(d.escrow, "the escrow refund"),
  };
  for (const v of Object.values(amounts)) if (typeof v === "object") return { error: v.error };
  const input2 = amounts as { priceCents: number; costsCents: number; payoffCents: number; depositsCents: number; escrowCents: number };

  const { supabase } = await getSession();
  const { data: property } = await supabase.from("properties").select("id, name, entity_id, sold_on").eq("id", d.propertyId).maybeSingle();
  if (!property) return { error: "That property was not found." };
  if (property.sold_on) return { error: "This property is already marked as sold. Undo that sale first to record it again." };

  const { data: accts } = await supabase.from("accounts").select("id, code, name, type, subtype, parent_id, is_bank").eq("entity_id", property.entity_id).eq("is_active", true).order("code");
  const accounts = accts ?? [];
  const top = (type: string, subtype: string) => accounts.find((a) => a.type === type && a.subtype === subtype && !a.parent_id)?.id as string | undefined;

  const { data: rows, error: factsError } = await supabase.rpc("property_sale_facts", { p_property_id: property.id, p_through: d.date });
  if (factsError) return { error: factsError.message };
  const facts = factsFromRows((rows ?? []) as { kind: string; account_id: string; cents: number | string }[]);

  // Where the net proceeds go.
  let proceeds: string;
  if (d.proceeds === "recorded") {
    const existing = accounts.find((a) => a.name === "Sale Proceeds" && a.type === "equity");
    if (existing) proceeds = existing.id as string;
    else {
      const transfers = await supabase.rpc("ensure_transfers_account", { p_entity_id: property.entity_id });
      if (transfers.error) return { error: transfers.error.message };
      const made = await supabase.rpc("ensure_subaccount", {
        p_parent_id: transfers.data as string,
        p_name: "Sale Proceeds",
        p_description: "Money received from selling a property. The sale itself is recorded with Record sale on the property.",
      });
      if (made.error) return { error: made.error.message };
      proceeds = made.data as string;
    }
  } else {
    const bank = accounts.find((a) => a.id === d.proceeds);
    if (!bank || !isCashLike({ isBank: bank.is_bank as boolean, subtype: bank.subtype as string | null })) return { error: "Choose a bank account for the net proceeds." };
    proceeds = bank.id as string;
  }

  const gain = await supabase.rpc("ensure_sale_gain_account", { p_entity_id: property.entity_id });
  if (gain.error) return { error: gain.error.message };

  const result = computeSale(facts, input2, {
    proceeds,
    loan: top("liability", "loan") ?? null,
    deposits: top("liability", "deposits") ?? null,
    escrow: top("asset", "escrow") ?? null,
    accumDepr: facts.accumDeprAccountId,
    gain: gain.data as string,
  });
  if (result.problems.length > 0) return { error: result.problems[0] };

  const entry = await supabase.rpc("post_entry", {
    p_entity_id: property.entity_id,
    p_entry_date: d.date,
    p_memo: `Sale of ${property.name}`,
    p_lines: result.lines.map((l) => ({ account_id: l.accountId, property_id: property.id, debit_cents: l.debitCents, credit_cents: l.creditCents, memo: l.label })),
    p_source: "manual",
  });
  if (entry.error) return { error: entry.error.message };

  const marked = await supabase.from("properties").update({ sold_on: d.date, sale_entry_id: entry.data as string }).eq("id", property.id);
  if (marked.error) return { error: marked.error.message };

  refresh();
  return { ok: { gainCents: result.gainCents, netCents: result.netProceedsCents } };
}

/** Undo a recorded sale: reverse its entry and mark the property as owned again. */
export async function undoPropertySale(propertyId: string): Promise<{ error?: string }> {
  if (!z.uuid().safeParse(propertyId).success) return { error: "That property was not found." };
  const { supabase } = await getSession();
  const { data: p } = await supabase.from("properties").select("id, name, sold_on, sale_entry_id").eq("id", propertyId).maybeSingle();
  if (!p?.sale_entry_id || !p.sold_on) return { error: "This property has no recorded sale." };

  const rev = await supabase.rpc("reverse_entry", { p_entry_id: p.sale_entry_id, p_entry_date: p.sold_on, p_memo: `Reversal of sale of ${p.name}` });
  if (rev.error) return { error: rev.error.message };
  const cleared = await supabase.from("properties").update({ sold_on: null, sale_entry_id: null }).eq("id", propertyId);
  if (cleared.error) return { error: cleared.error.message };

  refresh();
  return {};
}
