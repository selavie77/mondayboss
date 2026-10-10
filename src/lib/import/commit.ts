import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportPlan, DraftEntry, UnresolvedRow } from "./stessaEntries";
import { SUB_DESCRIPTIONS, SUB_SEP } from "./stessaMapping";

export interface CommitOptions {
  workspaceId: string;
  entityId: string;
  source: string;
  filename?: string;
  plan: ImportPlan;
  accountIds: Map<string, string>; // account code -> id
  propertyIds: Map<string, string>; // property name -> id
  /** Bank account the statement rows belong to, by code. */
  bankCode?: string;
}

export interface CommitResult {
  imported: number;
  posted: number;
  pending: number;
  duplicates: number;
}

const CHUNK = 400;

/**
 * Store every planned row in statement_lines (skipping rows already imported), post the clean
 * ones to the ledger, and leave flagged / unresolved rows pending for the review screen.
 */
export async function commitImportPlan(supabase: SupabaseClient, o: CommitOptions): Promise<CommitResult> {
  const { plan } = o;
  const total = plan.entries.length + plan.review.length + plan.unresolved.length;

  const batch = await supabase
    .from("import_batches")
    .insert({ workspace_id: o.workspaceId, entity_id: o.entityId, source: o.source, filename: o.filename ?? null, row_count: total })
    .select("id")
    .single();
  if (batch.error) throw batch.error;
  const batchId = batch.data.id as string;

  // Create any subcategories the plan refers to (e.g. "5090::Plumbing Repairs") and register their ids.
  const keys = new Set(
    [...plan.entries, ...plan.review].flatMap((d) => [d.debitCode, d.creditCode]).filter((k) => k.includes(SUB_SEP)),
  );
  for (const key of keys) {
    const [code, name] = key.split(SUB_SEP);
    const parentId = o.accountIds.get(code);
    if (!parentId) throw new Error(`No account ${code} for subcategory "${name}"`);
    const made = await supabase.rpc("ensure_subaccount", {
      p_parent_id: parentId,
      p_name: name,
      p_description: SUB_DESCRIPTIONS[name] ?? null,
    });
    if (made.error) throw made.error;
    o.accountIds.set(key, made.data as string);
  }

  const bankId = o.accountIds.get(o.bankCode ?? "1000") ?? null;
  const acct = (code?: string) => (code ? (o.accountIds.get(code) ?? null) : null);

  type Staged = { entry?: DraftEntry; held?: DraftEntry; unresolved?: UnresolvedRow };
  const staged: Staged[] = [
    ...plan.entries.map((entry) => ({ entry })),
    ...plan.review.map((held) => ({ held })),
    ...plan.unresolved.map((unresolved) => ({ unresolved })),
  ];

  const toRow = (s: Staged) => {
    const d = s.entry ?? s.held;
    const row = d?.row ?? s.unresolved!.row;
    return {
      workspace_id: o.workspaceId,
      entity_id: o.entityId,
      batch_id: batchId,
      account_id: bankId,
      property_id: o.propertyIds.get(row.property) ?? null,
      txn_date: row.date,
      description: [row.name, row.notes].filter(Boolean).join(" - ") || "(no description)",
      amount_cents: row.amountCents,
      raw: { category: row.category, subCategory: row.subCategory, source: row.source, account: row.account, details: row.details },
      dedupe_hash: row.dedupeHash,
      review_reason: s.held ? s.held.warnings.join("; ") : (s.unresolved?.reason ?? null),
      proposed_debit_account_id: s.held ? acct(s.held.debitCode) : null,
      proposed_credit_account_id: s.held ? acct(s.held.creditCode) : null,
    };
  };

  let imported = 0;
  let posted = 0;
  for (let i = 0; i < staged.length; i += CHUNK) {
    const slice = staged.slice(i, i + CHUNK);
    const rows = slice.map(toRow);
    const ins = await supabase
      .from("statement_lines")
      .upsert(rows, { onConflict: "entity_id,dedupe_hash", ignoreDuplicates: true })
      .select("id, dedupe_hash");
    if (ins.error) throw ins.error;

    const idByHash = new Map((ins.data ?? []).map((r) => [r.dedupe_hash as string, r.id as string]));
    imported += idByHash.size;

    for (const s of slice) {
      if (!s.entry) continue;
      const id = idByHash.get(s.entry.dedupeHash);
      if (!id) continue; // already imported earlier
      const lines = s.entry.lines.map((l) => ({
        account_id: o.accountIds.get(l.accountCode),
        property_id: o.propertyIds.get(l.property) ?? null,
        debit_cents: l.debitCents,
        credit_cents: l.creditCents,
      }));
      const r = await supabase.rpc("post_statement_line", { p_line_id: id, p_lines: lines });
      if (r.error) throw new Error(`${s.entry.date} ${s.entry.memo}: ${r.error.message}`);
      posted += 1;
    }
  }

  return { imported, posted, pending: imported - posted, duplicates: total - imported };
}
