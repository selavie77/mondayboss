"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { resolveSides } from "@/lib/transaction";
import { getSession } from "@/lib/workspace";

export interface FormEntity {
  id: string;
  name: string;
}
export interface FormAccount {
  id: string;
  entityId: string;
  parentId: string | null;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  subtype: string | null;
  isBank: boolean;
  last4: string | null;
  propertyId: string | null;
  portfolioId: string | null;
}
export interface FormProperty {
  id: string;
  name: string;
  entityId: string;
  portfolioId: string | null;
}
export interface TransactionFormData {
  entities: FormEntity[];
  accounts: FormAccount[];
  properties: FormProperty[];
  /** Per entity, the account ids used most often for expenses and for income. */
  common: Record<string, { expense: string[]; income: string[] }>;
}

/** Everything the Add Transaction screen needs, loaded when it opens. */
export async function loadTransactionForm(): Promise<TransactionFormData> {
  const { supabase } = await getSession();
  const [{ data: entities }, { data: accts }, { data: props }] = await Promise.all([
    supabase.from("entities").select("id, name").order("name"),
    supabase
      .from("accounts")
      .select("id, entity_id, parent_id, code, name, type, subtype, is_bank, last4, property_id, portfolio_id")
      .eq("is_active", true)
      .order("code"),
    supabase.from("properties").select("id, name, entity_id, portfolio_id").order("name"),
  ]);

  const common: TransactionFormData["common"] = {};
  await Promise.all(
    (entities ?? []).map(async (e) => {
      const [exp, inc] = await Promise.all([
        supabase.rpc("common_accounts", { p_entity_id: e.id, p_type: "expense", p_limit: 6 }),
        supabase.rpc("common_accounts", { p_entity_id: e.id, p_type: "income", p_limit: 6 }),
      ]);
      common[e.id as string] = {
        expense: ((exp.data ?? []) as { account_id: string }[]).map((r) => r.account_id),
        income: ((inc.data ?? []) as { account_id: string }[]).map((r) => r.account_id),
      };
    }),
  );

  return {
    entities: (entities ?? []).map((e) => ({ id: e.id as string, name: e.name as string })),
    accounts: (accts ?? []).map((a) => ({
      id: a.id as string,
      entityId: a.entity_id as string,
      parentId: a.parent_id as string | null,
      code: a.code as string,
      name: a.name as string,
      type: a.type as FormAccount["type"],
      subtype: a.subtype as string | null,
      isBank: a.is_bank as boolean,
      last4: a.last4 as string | null,
      propertyId: a.property_id as string | null,
      portfolioId: a.portfolio_id as string | null,
    })),
    properties: (props ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      entityId: p.entity_id as string,
      portfolioId: p.portfolio_id as string | null,
    })),
    common,
  };
}

const schema = z.object({
  entityId: z.uuid(),
  type: z.enum(["expense", "income", "transfer", "other"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date."),
  amount: z.string().trim().min(1, "Enter the amount."),
  description: z.string().trim().min(1, "Give it a name.").max(200, "Keep the name under 200 characters."),
  notes: z.string().trim().max(1000).optional(),
  propertyId: z.uuid().nullable().optional(),
  category: z.uuid().optional(),
  account: z.uuid().optional(),
  from: z.uuid().optional(),
  to: z.uuid().optional(),
  debit: z.uuid().optional(),
  credit: z.uuid().optional(),
});

export type AddTransactionResult = { error: string } | { ok: true; description: string; amountCents: number };

/** Post one balanced entry for a transaction entered by hand. */
export async function addTransaction(input: unknown): Promise<AddTransactionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  let cents: number;
  try {
    cents = toCents(d.amount);
  } catch {
    return { error: "Enter the amount as a number, like 84.17." };
  }
  if (cents <= 0) return { error: "The amount must be more than zero." };

  const sides = resolveSides({ type: d.type, category: d.category, account: d.account, from: d.from, to: d.to, debit: d.debit, credit: d.credit });
  if ("error" in sides) return { error: sides.error };

  const { supabase } = await getSession();

  // Both accounts must belong to this entity (row level security already limits them to the signed-in workspace).
  const { data: accts } = await supabase.from("accounts").select("id").eq("entity_id", d.entityId).in("id", [sides.debit, sides.credit]);
  if ((accts ?? []).length !== 2) return { error: "Those accounts don't belong to the same business." };

  if (d.propertyId) {
    const { data: prop } = await supabase.from("properties").select("id").eq("id", d.propertyId).eq("entity_id", d.entityId).maybeSingle();
    if (!prop) return { error: "That property doesn't belong to this business." };
  }

  const property = d.propertyId ?? null;
  const { error } = await supabase.rpc("post_entry", {
    p_entity_id: d.entityId,
    p_entry_date: d.date,
    p_memo: d.description,
    p_lines: [
      { account_id: sides.debit, property_id: property, debit_cents: cents, credit_cents: 0, memo: d.notes || null },
      { account_id: sides.credit, property_id: property, debit_cents: 0, credit_cents: cents, memo: d.notes || null },
    ],
    p_source: "manual",
  });
  if (error) return { error: error.message };

  for (const p of ["/monday", "/categories", "/review"]) revalidatePath(p);
  revalidatePath("/reports", "layout");
  return { ok: true, description: d.description, amountCents: cents };
}
