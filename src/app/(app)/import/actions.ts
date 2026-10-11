"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { commitImportPlan } from "@/lib/import/commit";
import { loadImportContext } from "@/lib/import/context";
import { parseStessaBuffer, type StessaLedger } from "@/lib/import/stessa";
import { planStessaImport } from "@/lib/import/stessaEntries";
import { isCashLike, resolvePaidFrom } from "@/lib/paidFrom";
import { getSession } from "@/lib/workspace";

const MAX_FILES = 25;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_STATEMENT_ROWS = 20000;

export interface StessaPreview {
  files: { name: string; property: string; rows: number; isNew: boolean; propertyCount: number; newCount: number }[];
  unreadable: { name: string; error: string }[];
  totals: { rows: number; clean: number; review: number; unresolved: number; duplicates: number };
  reasons: { reason: string; count: number }[];
  /** Rules applied automatically so fewer rows need review, with how many rows each affected. */
  assumptions: { text: string; count: number }[];
  dateFrom: string | null;
  dateTo: string | null;
  newProperties: string[];
}

export interface ImportResult {
  imported: number;
  posted: number;
  pending: number;
  duplicates: number;
  createdProperties: string[];
}

type Failure = { error: string };

function refresh() {
  for (const p of ["/import", "/review", "/monday", "/properties", "/categories"]) revalidatePath(p);
  revalidatePath("/reports", "layout");
}

/** Read and parse the uploaded Stessa files. Files that fail come back with a message instead of stopping the rest. */
async function readStessaFiles(formData: FormData) {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Choose at least one Stessa General Ledger file." } as Failure;
  if (files.length > MAX_FILES) return { error: `Upload up to ${MAX_FILES} files at a time.` } as Failure;

  const ledgers: { name: string; ledger: StessaLedger }[] = [];
  const unreadable: { name: string; error: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      unreadable.push({ name: f.name, error: "This file is larger than 8 MB." });
      continue;
    }
    try {
      ledgers.push({ name: f.name, ledger: await parseStessaBuffer(Buffer.from(await f.arrayBuffer())) });
    } catch (e) {
      unreadable.push({ name: f.name, error: e instanceof Error ? e.message : "This file could not be read." });
    }
  }
  return { ledgers, unreadable };
}

const entityId = (formData: FormData) => z.uuid().safeParse(formData.get("entity_id"));

/** Show what importing these Stessa files would do, without changing anything. */
export async function previewStessa(formData: FormData): Promise<{ error?: string; preview?: StessaPreview }> {
  const entity = entityId(formData);
  if (!entity.success) return { error: "Choose which entity these belong to." };

  const read = await readStessaFiles(formData);
  if ("error" in read) return { error: read.error };
  if (read.ledgers.length === 0) return { error: read.unreadable[0]?.error ?? "No readable files." };

  const { supabase } = await getSession();
  const ctx = await loadImportContext(supabase, entity.data);
  const plan = planStessaImport(read.ledgers.map((l) => l.ledger));

  // Rows already imported for this entity (same fingerprint) will be skipped.
  const hashes = [...plan.entries, ...plan.review].map((d) => d.dedupeHash).concat(plan.unresolved.map((u) => u.row.dedupeHash));
  const { data: existing } = hashes.length ? await supabase.rpc("existing_import_hashes", { p_entity_id: entity.data, p_hashes: hashes }) : { data: [] };
  const duplicates = new Set((existing ?? []) as string[]).size;

  const reasons = new Map<string, number>();
  for (const d of plan.review) reasons.set(d.warnings[0], (reasons.get(d.warnings[0]) ?? 0) + 1);
  for (const u of plan.unresolved) reasons.set(u.reason, (reasons.get(u.reason) ?? 0) + 1);

  const assumed = new Map<string, number>();
  for (const d of [...plan.entries, ...plan.review]) for (const n of d.notes) assumed.set(n, (assumed.get(n) ?? 0) + 1);

  const dates = [...plan.entries, ...plan.review].map((d) => d.date).concat(plan.unresolved.map((u) => u.row.date)).sort();
  const files = read.ledgers.map((l) => {
    const fresh = l.ledger.properties.filter((p) => !ctx.properties.has(p.toLowerCase()));
    return {
      name: l.name,
      property: l.ledger.properties.length === 1 ? l.ledger.properties[0] : l.ledger.propertyName,
      rows: l.ledger.rows.length,
      isNew: fresh.length > 0,
      propertyCount: l.ledger.properties.length,
      newCount: fresh.length,
    };
  });

  return {
    preview: {
      files,
      unreadable: read.unreadable,
      totals: {
        rows: hashes.length,
        clean: plan.entries.length,
        review: plan.review.length,
        unresolved: plan.unresolved.length,
        duplicates,
      },
      reasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      assumptions: [...assumed].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count),
      dateFrom: dates[0] ?? null,
      dateTo: dates.at(-1) ?? null,
      newProperties: [...new Set(read.ledgers.flatMap((l) => l.ledger.properties).filter((p) => !ctx.properties.has(p.toLowerCase())))],
    },
  };
}

/** Import Stessa files: create any missing properties, post the clean rows, and queue the rest for review. */
export async function commitStessa(formData: FormData): Promise<{ error?: string; result?: ImportResult }> {
  const entity = entityId(formData);
  if (!entity.success) return { error: "Choose which entity these belong to." };
  const portfolioId = z.uuid().safeParse(formData.get("portfolio_id"));

  const read = await readStessaFiles(formData);
  if ("error" in read) return { error: read.error };
  if (read.ledgers.length === 0) return { error: read.unreadable[0]?.error ?? "No readable files." };

  const { supabase, workspaceId } = await getSession();
  const { data: ent } = await supabase.from("entities").select("id").eq("id", entity.data).maybeSingle();
  if (!ent) return { error: "That entity was not found." };

  let ctx = await loadImportContext(supabase, entity.data);
  const missing = [...new Set(read.ledgers.flatMap((l) => l.ledger.properties).filter((n) => !ctx.properties.has(n.toLowerCase())))];

  if (missing.length > 0) {
    let portfolio = portfolioId.success ? portfolioId.data : null;
    if (!portfolio) {
      const { data: first } = await supabase.from("portfolios").select("id").order("created_at").limit(1).maybeSingle();
      portfolio = first?.id ?? null;
    }
    if (!portfolio) return { error: "Choose a portfolio for the new properties." };
    const { error } = await supabase
      .from("properties")
      .insert(missing.map((name) => ({ workspace_id: workspaceId, portfolio_id: portfolio, entity_id: entity.data, name })));
    if (error) return { error: error.message };
    ctx = await loadImportContext(supabase, entity.data);
  }

  const plan = planStessaImport(read.ledgers.map((l) => l.ledger));
  const propertyIds = new Map([...ctx.properties.values()].map((p) => [p.name, p.id]));
  const byName = new Map([...ctx.properties.values()].map((p) => [p.name, { id: p.id, portfolioId: p.portfolioId }]));

  try {
    const result = await commitImportPlan(supabase, {
      workspaceId,
      entityId: entity.data,
      source: "Stessa general ledger",
      filename: read.ledgers.map((l) => l.name).join(", ").slice(0, 300),
      plan,
      accountIds: ctx.accountIds,
      propertyIds,
      cashAccountFor: (name) => resolvePaidFrom(byName.get(name) ?? null, ctx.cashAccounts),
    });
    refresh();
    return { result: { ...result, createdProperties: missing } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The import failed." };
  }
}

const statementSchema = z.object({
  accountId: z.uuid(),
  filename: z.string().max(300).optional(),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: z.string().max(500),
        amountCents: z.number().int().refine((n) => n !== 0, "Amounts cannot be zero."),
        ref: z.string().max(100).nullable(),
      }),
    )
    .min(1, "There are no transactions to import.")
    .max(MAX_STATEMENT_ROWS, `Import up to ${MAX_STATEMENT_ROWS.toLocaleString("en-US")} transactions at a time.`),
});

export interface StatementResult {
  imported: number;
  duplicates: number;
  accountName: string;
}

/**
 * Import statement transactions for a bank account or credit card. They wait in Review for a category.
 * Money in is positive and money out is negative, as the account holder sees it.
 */
export async function commitStatement(input: unknown): Promise<{ error?: string; result?: StatementResult }> {
  const parsed = statementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { accountId, filename, rows } = parsed.data;

  const { supabase, workspaceId } = await getSession();
  const { data: acct } = await supabase
    .from("accounts")
    .select("id, name, entity_id, property_id, is_bank, subtype")
    .eq("id", accountId)
    .maybeSingle();
  if (!acct || !isCashLike({ isBank: acct.is_bank, subtype: acct.subtype })) {
    return { error: "Choose a bank account or credit card to import into." };
  }

  const batch = await supabase
    .from("import_batches")
    .insert({ workspace_id: workspaceId, entity_id: acct.entity_id, source: "Bank statement", filename: filename ?? null, row_count: rows.length })
    .select("id")
    .single();
  if (batch.error) return { error: batch.error.message };

  // A bank's own id (OFX) identifies a transaction exactly. Otherwise identical rows are numbered so
  // two real $5.00 coffees on the same day both import, while re-uploading the file adds nothing.
  const seen = new Map<string, number>();
  const staged = rows.map((r) => {
    let key: string;
    if (r.ref) {
      key = `ofx|${accountId}|${r.ref}`;
    } else {
      const base = `${accountId}|${r.date}|${r.amountCents}|${r.description.toLowerCase()}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      key = `${base}|${n}`;
    }
    return {
      workspace_id: workspaceId,
      entity_id: acct.entity_id,
      batch_id: batch.data.id,
      account_id: accountId,
      property_id: acct.property_id,
      txn_date: r.date,
      description: r.description,
      amount_cents: r.amountCents,
      raw: { source: "statement", ref: r.ref },
      dedupe_hash: createHash("sha1").update(key).digest("hex"),
    };
  });

  let imported = 0;
  for (let i = 0; i < staged.length; i += 400) {
    const { data, error } = await supabase
      .from("statement_lines")
      .upsert(staged.slice(i, i + 400), { onConflict: "entity_id,dedupe_hash", ignoreDuplicates: true })
      .select("id");
    if (error) return { error: error.message };
    imported += data?.length ?? 0;
  }

  refresh();
  return { result: { imported, duplicates: rows.length - imported, accountName: acct.name } };
}
