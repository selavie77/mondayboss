"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
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

// ---------------------------------------------------------------------------
// Bank accounts, credit cards and opening balances
// ---------------------------------------------------------------------------

export type AccountResult = { error?: string; ok?: string };

/** "all" | "p:<propertyId>" | "pf:<portfolioId>" -> the ids to store on the account. */
function parseScope(scope: string | undefined): { propertyId: string | null; portfolioId: string | null } | null {
  if (!scope || scope === "all") return { propertyId: null, portfolioId: null };
  if (scope.startsWith("p:") && z.uuid().safeParse(scope.slice(2)).success) return { propertyId: scope.slice(2), portfolioId: null };
  if (scope.startsWith("pf:") && z.uuid().safeParse(scope.slice(3)).success) return { propertyId: null, portfolioId: scope.slice(3) };
  return null;
}

const cashSchema = z.object({
  entity_id: z.uuid(),
  kind: z.enum(["bank", "credit_card"]),
  name: z.string().trim().min(1, "Give the account a name.").max(60, "Keep the name under 60 characters."),
  last4: z.string().trim().regex(/^\d{0,4}$/, "Use up to 4 digits for the account number.").optional(),
  scope: z.string().optional(),
  opening: z.string().trim().optional(),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

/** Create a bank account or credit card, tie it to a property or portfolio, and post its opening balance. */
export async function createCashAccount(_prev: AccountResult | undefined, formData: FormData): Promise<AccountResult> {
  const parsed = cashSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const scope = parseScope(d.scope);
  if (!scope) return { error: "Choose where this account is used." };

  let openingCents: number | null = null;
  if (d.opening) {
    try {
      openingCents = toCents(d.opening);
    } catch {
      return { error: "Enter the opening balance as a number, like 12,500.00." };
    }
    if (openingCents !== 0 && !d.as_of) return { error: "Enter the date of the opening balance." };
  }

  const { supabase } = await getSession();
  const { error } = await supabase.rpc("create_cash_account", {
    p_entity_id: d.entity_id,
    p_kind: d.kind,
    p_name: d.name,
    p_last4: d.last4 || null,
    p_property_id: scope.propertyId,
    p_portfolio_id: scope.portfolioId,
    p_opening_cents: openingCents && openingCents !== 0 ? openingCents : null,
    p_as_of: d.as_of || null,
  });
  if (error) {
    return { error: error.code === "23505" ? `You already have an account named “${d.name}”.` : error.message };
  }

  revalidateAccounts();
  return { ok: `Added “${d.name}”.` };
}

function revalidateAccounts() {
  revalidatePath("/categories");
  revalidatePath("/review");
  revalidatePath("/monday");
  revalidatePath("/reports", "layout");
}

/** Post an opening balance on an existing asset or liability account. */
export async function setOpeningBalance(input: { accountId: string; asOf: string; amount: string }): Promise<AccountResult> {
  const parsed = z
    .object({ accountId: z.uuid(), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date."), amount: z.string().trim().min(1, "Enter the balance.") })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let cents: number;
  try {
    cents = toCents(parsed.data.amount);
  } catch {
    return { error: "Enter the balance as a number, like 12,500.00." };
  }
  if (cents === 0) return { error: "Enter a balance other than zero." };

  const { supabase } = await getSession();
  const { error } = await supabase.rpc("set_account_opening_balance", {
    p_account_id: parsed.data.accountId,
    p_as_of: parsed.data.asOf,
    p_amount_cents: cents,
  });
  if (error) return { error: error.message };

  revalidateAccounts();
  return { ok: "Opening balance posted." };
}

/** Undo an account's opening balance so it can be entered again. The reversal stays in the history. */
export async function reverseOpeningBalance(entryId: string): Promise<AccountResult> {
  if (!z.uuid().safeParse(entryId).success) return { error: "Unknown entry." };
  const { supabase } = await getSession();

  const { data: entry } = await supabase.from("journal_entries").select("entry_date, source, memo").eq("id", entryId).single();
  if (!entry || entry.source !== "system" || !String(entry.memo).startsWith("Opening balance:")) {
    return { error: "That is not an opening balance." };
  }
  const { error } = await supabase.rpc("reverse_entry", {
    p_entry_id: entryId,
    p_entry_date: entry.entry_date,
    p_memo: `Reversal of ${entry.memo}`,
  });
  if (error) return { error: error.message };

  revalidateAccounts();
  return { ok: "Opening balance reversed." };
}

/** Change which property or portfolio a bank account or credit card is used for. */
export async function updateAccountScope(accountId: string, scopeValue: string): Promise<AccountResult> {
  if (!z.uuid().safeParse(accountId).success) return { error: "Unknown account." };
  const scope = parseScope(scopeValue);
  if (!scope) return { error: "Choose where this account is used." };

  const { supabase } = await getSession();
  const { error } = await supabase
    .from("accounts")
    .update({ property_id: scope.propertyId, portfolio_id: scope.portfolioId })
    .eq("id", accountId);
  if (error) return { error: error.message };

  revalidateAccounts();
  return { ok: "Saved." };
}
