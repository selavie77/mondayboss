"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/workspace";

export interface CreatedAccount {
  id: string;
  entityId: string;
  parentId: string | null;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  subtype: string | null;
  isBank: boolean;
  last4: string | null;
}

type Result<T> = { error: string } | { created: T };

function refresh() {
  for (const p of ["/categories", "/review", "/import", "/properties", "/monday"]) revalidatePath(p);
}

/** Create a portfolio from a "Create new…" dropdown option. */
export async function createPortfolio(name: string): Promise<Result<{ id: string; name: string }>> {
  const parsed = z.string().trim().min(1, "Give the portfolio a name.").max(60, "Keep the name under 60 characters.").safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supabase, workspaceId } = await getSession();
  const { data, error } = await supabase.from("portfolios").insert({ workspace_id: workspaceId, name: parsed.data }).select("id, name").single();
  if (error) return { error: error.code === "23505" ? "You already have a portfolio with that name." : error.message };

  refresh();
  return { created: { id: data.id as string, name: data.name as string } };
}

const accountColumns = "id, entity_id, parent_id, code, name, type, subtype, is_bank, last4";
type AccountRow = {
  id: string;
  entity_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  type: CreatedAccount["type"];
  subtype: string | null;
  is_bank: boolean;
  last4: string | null;
};
const toCreated = (a: AccountRow): CreatedAccount => ({
  id: a.id,
  entityId: a.entity_id,
  parentId: a.parent_id,
  code: a.code,
  name: a.name,
  type: a.type,
  subtype: a.subtype,
  isBank: a.is_bank,
  last4: a.last4,
});

const categorySchema = z.object({
  entityId: z.uuid(),
  name: z.string().trim().min(1, "Give it a name.").max(60, "Keep the name under 60 characters."),
  type: z.enum(["asset", "liability", "equity", "income", "expense"]),
  parentId: z.uuid().nullable(),
});

/** Create a category (or a subcategory when parentId is given) from a "Create new…" dropdown option. */
export async function createCategoryQuick(input: unknown): Promise<Result<CreatedAccount>> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { entityId, name, type, parentId } = parsed.data;

  const { supabase } = await getSession();
  const made = await supabase.rpc("create_account", { p_entity_id: entityId, p_parent_id: parentId, p_type: type, p_name: name });
  if (made.error) return { error: made.error.code === "23505" ? `“${name}” already exists here.` : made.error.message };

  const { data } = await supabase.from("accounts").select(accountColumns).eq("id", made.data as string).single();
  refresh();
  return { created: toCreated(data as AccountRow) };
}

const cashSchema = z.object({
  entityId: z.uuid(),
  kind: z.enum(["bank", "credit_card"]),
  name: z.string().trim().min(1, "Give the account a name.").max(60, "Keep the name under 60 characters."),
  last4: z.string().trim().regex(/^\d{0,4}$/, "Use up to 4 digits for the account number.").optional(),
});

/** Create a bank account or credit card from a "Create new…" dropdown option. Tie it to a property on the Categories page. */
export async function createCashAccountQuick(input: unknown): Promise<Result<CreatedAccount>> {
  const parsed = cashSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { entityId, kind, name, last4 } = parsed.data;

  const { supabase } = await getSession();
  const made = await supabase.rpc("create_cash_account", { p_entity_id: entityId, p_kind: kind, p_name: name, p_last4: last4 || null });
  if (made.error) return { error: made.error.code === "23505" ? `You already have an account named “${name}”.` : made.error.message };

  const { data } = await supabase.from("accounts").select(accountColumns).eq("id", made.data as string).single();
  refresh();
  return { created: toCreated(data as AccountRow) };
}
