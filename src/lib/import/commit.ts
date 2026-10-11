import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportPlan, DraftEntry, UnresolvedRow } from "./stessaEntries";
import { CODES, SUB_DESCRIPTIONS, SUB_SEP } from "./stessaMapping";

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
  /** The account a property's transactions are paid from by default (see resolvePaidFrom). */
  cashAccountFor?: (propertyName: string) => string | null;
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

  // The general Transfers account is created the first time a plan needs it.
  const needsTransfers = [...plan.entries, ...plan.review].some((d) => d.debitCode === CODES.transfers || d.creditCode === CODES.transfers);
  if (needsTransfers && !o.accountIds.has(CODES.transfers)) {
    const made = await supabase.rpc("ensure_transfers_account", { p_entity_id: o.entityId });
    if (made.error) throw made.error;
    o.accountIds.set(CODES.transfers, made.data as string);
  }

  // The cash side of a transaction goes to the property's own bank account or card when it has one,
  // otherwise to the general account.
  const cashCode = o.bankCode ?? "1000";
  const cashFor = (propertyName: string) => o.cashAccountFor?.(propertyName) ?? o.accountIds.get(cashCode) ?? null;
  const resolve = (code: string | undefined, propertyName: string) =>
    code === undefined ? null : code === cashCode ? cashFor(propertyName) : (o.accountIds.get(code) ?? null);

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
      account_id: cashFor(row.property),
      property_id: o.propertyIds.get(row.property) ?? null,
      txn_date: row.date,
      description: [row.name, row.notes].filter(Boolean).join(" - ") || "(no description)",
      amount_cents: row.amountCents,
      raw: { category: row.category, subCategory: row.subCategory, source: row.source, account: row.account, details: row.details },
      dedupe_hash: row.dedupeHash,
      review_reason: s.held ? s.held.warnings.join("; ") : (s.unresolved?.reason ?? null),
      proposed_debit_account_id: s.held ? resolve(s.held.debitCode, row.property) : null,
      proposed_credit_account_id: s.held ? resolve(s.held.creditCode, row.property) : null,
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

    // Post the clean rows of this chunk in one database call. If the call is rejected, none of the chunk
    // was posted, so retry one by one to say exactly which row is the problem.
    const items: { line_id: string; lines: object[]; label: string }[] = [];
    for (const s of slice) {
      if (!s.entry) continue;
      const id = idByHash.get(s.entry.dedupeHash);
      if (!id) continue; // already imported earlier
      items.push({
        line_id: id,
        label: `${s.entry.date} ${s.entry.memo}`,
        lines: s.entry.lines.map((l) => ({
          account_id: resolve(l.accountCode, l.property),
          property_id: o.propertyIds.get(l.property) ?? null,
          debit_cents: l.debitCents,
          credit_cents: l.creditCents,
        })),
      });
    }
    if (items.length === 0) continue;

    const batchResult = await supabase.rpc("post_statement_lines_batch", {
      p_items: items.map(({ line_id, lines }) => ({ line_id, lines })),
    });
    if (!batchResult.error) {
      posted += items.length;
      continue;
    }
    for (const item of items) {
      const r = await supabase.rpc("post_statement_line", { p_line_id: item.line_id, p_lines: item.lines });
      if (r.error) throw new Error(`${item.label}: ${r.error.message}`);
      posted += 1;
    }
  }

  return { imported, posted, pending: imported - posted, duplicates: total - imported };
}
