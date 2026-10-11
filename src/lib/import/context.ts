import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashAccount } from "@/lib/paidFrom";

export interface ImportContext {
  /** Account code -> id, for the entity. */
  accountIds: Map<string, string>;
  cashAccounts: CashAccount[];
  /** Lower-cased property name -> property. */
  properties: Map<string, { id: string; name: string; portfolioId: string | null }>;
}

/** Everything an import needs to know about an entity's accounts and properties. */
export async function loadImportContext(supabase: SupabaseClient, entityId: string): Promise<ImportContext> {
  const { data: accts } = await supabase
    .from("accounts")
    .select("id, code, is_bank, subtype, property_id, portfolio_id")
    .eq("entity_id", entityId);

  const accountIds = new Map<string, string>();
  const cashAccounts: CashAccount[] = [];
  for (const a of accts ?? []) {
    accountIds.set(a.code as string, a.id as string);
    cashAccounts.push({
      id: a.id as string,
      code: a.code as string,
      isBank: a.is_bank as boolean,
      subtype: a.subtype as string | null,
      propertyId: a.property_id as string | null,
      portfolioId: a.portfolio_id as string | null,
    });
  }

  const { data: props } = await supabase.from("properties").select("id, name, portfolio_id").eq("entity_id", entityId);
  const properties = new Map(
    (props ?? []).map((p) => [(p.name as string).toLowerCase(), { id: p.id as string, name: p.name as string, portfolioId: p.portfolio_id as string | null }]),
  );

  return { accountIds, cashAccounts, properties };
}
