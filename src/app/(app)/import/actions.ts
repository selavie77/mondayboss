"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { commitImportPlan } from "@/lib/import/commit";
import { loadImportContext } from "@/lib/import/context";
import { parseStessaBuffer, type StessaLedger } from "@/lib/import/stessa";
import { planStessaImport } from "@/lib/import/stessaEntries";
import { existingKey, newKey, type NewAccountSpec } from "@/lib/import/stessaMapping";
import { sourceKey } from "@/lib/import/stessaMatch";
import { buildStessaSetup, type AccountRow, type SavedMappings, type StessaSetup } from "@/lib/import/stessaSetup";
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
  /** Each Stessa property, data source and category with the match we suggest, for the user to confirm or change. */
  setup: StessaSetup;
}

export interface ImportResult {
  imported: number;
  posted: number;
  pending: number;
  duplicates: number;
  createdPortfolios: number;
  createdProperties: string[];
  createdAccounts: number;
  createdCategories: number;
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

const id = z.uuid();
const mappingSchema = z.object({
  portfolios: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("existing"), id }),
      z.object({ kind: z.literal("create"), name: z.string().trim().min(1, "Give each new portfolio a name.").max(60, "Keep portfolio names under 60 characters.") }),
    ]),
  ),
  properties: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("existing"), id }),
      // "stessa:<name>" follows the Stessa portfolio's match; a portfolio id picks one you have.
      z.object({ kind: z.literal("create"), portfolio: z.string().max(200).nullish() }),
    ]),
  ),
  sources: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("default") }),
      z.object({ kind: z.literal("existing"), id }),
      z.object({
        kind: z.literal("create"),
        name: z.string().trim().min(1, "Give each new account a name.").max(120),
        accountKind: z.enum(["bank", "credit_card"]),
        last4: z.string().regex(/^\d{4}$/).or(z.literal("")).optional(),
        tieToProperty: z.string().nullish(),
      }),
    ]),
  ),
  categories: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("default") }),
      z.object({ kind: z.literal("existing"), id }),
      z.object({
        kind: z.literal("create"),
        parentId: id.nullable(),
        type: z.enum(["asset", "liability", "equity", "income", "expense"]),
        name: z.string().trim().min(1, "Give each new category a name.").max(120),
      }),
    ]),
  ),
});
type Mapping = z.infer<typeof mappingSchema>;

type Supabase = Awaited<ReturnType<typeof getSession>>["supabase"];

async function loadAccounts(supabase: Supabase, entityId: string): Promise<AccountRow[]> {
  const { data } = await supabase.from("accounts").select("id, code, name, parent_id, type, is_bank, subtype, last4").eq("entity_id", entityId).eq("is_active", true);
  return (data ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    parentId: a.parent_id as string | null,
    type: a.type as AccountRow["type"],
    isCash: isCashLike({ isBank: a.is_bank as boolean, subtype: a.subtype as string | null }),
    last4: a.last4 as string | null,
  }));
}

async function loadSaved(supabase: Supabase, entityId: string): Promise<SavedMappings> {
  const { data } = await supabase.from("import_mappings").select("kind, stessa_key, target_id").eq("entity_id", entityId);
  const saved: SavedMappings = { portfolio: new Map(), property: new Map(), source: new Map(), category: new Map() };
  for (const r of data ?? []) saved[r.kind as keyof SavedMappings].set(r.stessa_key as string, r.target_id as string);
  return saved;
}

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
  // The API returns at most 1,000 rows per call, so read every page.
  const found = new Set<string>();
  for (let from = 0; hashes.length > 0; from += 1000) {
    const { data, error } = await supabase.rpc("existing_import_hashes", { p_entity_id: entity.data, p_hashes: hashes }).range(from, from + 999);
    if (error) return { error: error.message };
    for (const h of (data ?? []) as string[]) found.add(h);
    if ((data?.length ?? 0) < 1000) break;
  }
  const duplicates = found.size;

  const reasons = new Map<string, number>();
  for (const d of plan.review) reasons.set(d.warnings[0], (reasons.get(d.warnings[0]) ?? 0) + 1);
  for (const u of plan.unresolved) reasons.set(u.reason, (reasons.get(u.reason) ?? 0) + 1);

  const assumed = new Map<string, number>();
  for (const d of [...plan.entries, ...plan.review]) for (const n of d.notes) assumed.set(n, (assumed.get(n) ?? 0) + 1);

  const dates = [...plan.entries, ...plan.review].map((d) => d.date).concat(plan.unresolved.map((u) => u.row.date)).sort();
  const setup = buildStessaSetup({
    ledgers: read.ledgers.map((l) => l.ledger),
    properties: [...ctx.properties.values()].map((p) => ({ id: p.id, name: p.name })),
    portfolios: ((await supabase.from("portfolios").select("id, name").order("name")).data ?? []) as { id: string; name: string }[],
    accounts: await loadAccounts(supabase, entity.data),
    saved: await loadSaved(supabase, entity.data),
  });
  const willCreate = new Set(setup.properties.filter((p) => p.suggestion.kind === "create").map((p) => p.stessaName));
  const files = read.ledgers.map((l) => {
    const fresh = l.ledger.properties.filter((p) => willCreate.has(p));
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
      newProperties: [...willCreate],
      setup,
    },
  };
}

/** Import Stessa files: create any missing properties, post the clean rows, and queue the rest for review. */
export async function commitStessa(formData: FormData): Promise<{ error?: string; result?: ImportResult }> {
  const entity = entityId(formData);
  if (!entity.success) return { error: "Choose which entity these belong to." };

  let mapping: Mapping = { portfolios: {}, properties: {}, sources: {}, categories: {} };
  const rawMapping = formData.get("mapping");
  if (typeof rawMapping === "string" && rawMapping) {
    let json: unknown;
    try {
      json = JSON.parse(rawMapping);
    } catch {
      return { error: "Your matches could not be read. Go back and try again." };
    }
    const parsed = mappingSchema.safeParse(json);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Your matches could not be read." };
    mapping = parsed.data;
  }

  const read = await readStessaFiles(formData);
  if ("error" in read) return { error: read.error };
  if (read.ledgers.length === 0) return { error: read.unreadable[0]?.error ?? "No readable files." };

  const { supabase, workspaceId } = await getSession();
  const { data: ent } = await supabase.from("entities").select("id").eq("id", entity.data).maybeSingle();
  if (!ent) return { error: "That entity was not found." };

  let ctx = await loadImportContext(supabase, entity.data);
  let createdPortfolios = 0;
  const accounts = await loadAccounts(supabase, entity.data);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const propertyById = new Map([...ctx.properties.values()].map((p) => [p.id, p]));
  const stessaProperties = [...new Set(read.ledgers.flatMap((l) => l.ledger.properties))];

  // 0. Portfolios: matched to one you have, or created with the name Stessa uses.
  const { data: portfolioRows } = await supabase.from("portfolios").select("id, name").order("created_at");
  const myPortfolios = (portfolioRows ?? []) as { id: string; name: string }[];
  const portfolioIds = new Map<string, string>(); // Stessa portfolio name -> portfolio id
  const stessaPortfolios = [...new Set(read.ledgers.flatMap((l) => l.ledger.rows.map((r) => r.portfolio)).filter(Boolean))];
  for (const name of stessaPortfolios) {
    const sameName = myPortfolios.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const choice = mapping.portfolios[name] ?? (sameName ? { kind: "existing" as const, id: sameName.id } : { kind: "create" as const, name });
    if (choice.kind === "existing") {
      if (!myPortfolios.some((p) => p.id === choice.id)) return { error: `The portfolio you matched "${name}" to was not found.` };
      portfolioIds.set(name, choice.id);
    } else {
      const dup = myPortfolios.find((p) => p.name.toLowerCase() === choice.name.toLowerCase());
      if (dup) {
        portfolioIds.set(name, dup.id);
        continue;
      }
      const made = await supabase.from("portfolios").insert({ workspace_id: workspaceId, name: choice.name }).select("id, name").single();
      if (made.error) return { error: `Could not create the portfolio "${choice.name}": ${made.error.message}` };
      myPortfolios.push({ id: made.data.id as string, name: made.data.name as string });
      portfolioIds.set(name, made.data.id as string);
      createdPortfolios += 1;
    }
  }

  // 1. Properties: the one each Stessa property was matched to, or a new one in its portfolio.
  const propertyIds = new Map<string, string>(); // Stessa name -> property id
  const toCreate: { name: string; portfolioId: string | null }[] = [];
  const stessaPortfolioOf = new Map<string, string>();
  for (const r of read.ledgers.flatMap((l) => l.ledger.rows)) if (r.property && r.portfolio && !stessaPortfolioOf.has(r.property)) stessaPortfolioOf.set(r.property, r.portfolio);
  const portfolioFor = (name: string, chosen: string | null | undefined): string | null => {
    if (chosen?.startsWith("stessa:")) return portfolioIds.get(chosen.slice(7)) ?? null;
    if (chosen && myPortfolios.some((p) => p.id === chosen)) return chosen;
    const own = stessaPortfolioOf.get(name);
    return own ? (portfolioIds.get(own) ?? null) : null;
  };
  for (const name of stessaProperties) {
    const sameName = ctx.properties.get(name.toLowerCase());
    const choice = mapping.properties[name] ?? (sameName ? { kind: "existing" as const, id: sameName.id } : { kind: "create" as const, portfolio: null });
    if (choice.kind === "existing") {
      if (!propertyById.has(choice.id)) return { error: `The property you matched "${name}" to was not found.` };
      propertyIds.set(name, choice.id);
    } else {
      toCreate.push({ name, portfolioId: portfolioFor(name, choice.portfolio) });
    }
  }
  if (toCreate.length > 0) {
    const { data: first } = await supabase.from("portfolios").select("id").order("created_at").limit(1).maybeSingle();
    const fallback = first?.id ?? null;
    if (toCreate.some((c) => !(c.portfolioId ?? fallback))) return { error: "Choose a portfolio for the new properties." };
    const { data: made, error } = await supabase
      .from("properties")
      .insert(toCreate.map((c) => ({ workspace_id: workspaceId, portfolio_id: c.portfolioId ?? fallback, entity_id: entity.data, name: c.name })))
      .select("id, name");
    if (error) return { error: error.code === "23505" ? "A property with one of those names already exists. Match it to the existing property instead." : error.message };
    for (const p of made ?? []) propertyIds.set(p.name as string, p.id as string);
    ctx = await loadImportContext(supabase, entity.data);
  }
  const propertyInfo = new Map([...ctx.properties.values()].map((p) => [p.id, p]));
  const byName = new Map([...propertyIds].map(([name, pid]) => [name, { id: pid, portfolioId: propertyInfo.get(pid)?.portfolioId ?? null }]));

  // 2. Data sources: each one posts to the account it was matched to, or a new bank account / card.
  const sourceAccounts = new Map<string, string>(); // source key -> cash account id
  let createdAccounts = 0;
  for (const [key, choice] of Object.entries(mapping.sources)) {
    if (choice.kind === "existing") {
      if (!accountById.get(choice.id)?.isCash) return { error: "An account you matched a data source to was not found." };
      sourceAccounts.set(key, choice.id);
    } else if (choice.kind === "create") {
      const same = accounts.find((a) => a.isCash && a.name.toLowerCase() === choice.name.toLowerCase());
      if (same) {
        sourceAccounts.set(key, same.id);
        continue;
      }
      const tie = choice.tieToProperty ? propertyIds.get(choice.tieToProperty) : undefined;
      const made = await supabase.rpc("create_cash_account", {
        p_entity_id: entity.data,
        p_kind: choice.accountKind,
        p_name: choice.name,
        p_last4: choice.last4 || null,
        p_property_id: tie ?? null,
      });
      if (made.error) return { error: `Could not create "${choice.name}": ${made.error.message}` };
      sourceAccounts.set(key, made.data as string);
      createdAccounts += 1;
    }
  }

  // 3. Categories: where the user matched a Stessa category to an account (or asked for a new one).
  const overrides = new Map<string, string>();
  for (const [key, choice] of Object.entries(mapping.categories)) {
    if (choice.kind === "existing") {
      const a = accountById.get(choice.id);
      if (!a || a.isCash) return { error: "An account you matched a category to was not found." };
      overrides.set(key, existingKey(choice.id));
    } else if (choice.kind === "create") {
      const parent = choice.parentId ? accountById.get(choice.parentId) : undefined;
      if (choice.parentId && (!parent || parent.isCash)) return { error: "The parent category you chose was not found." };
      const spec: NewAccountSpec = { parentId: choice.parentId, type: parent?.type ?? choice.type, name: choice.name };
      overrides.set(key, newKey(spec));
    }
  }

  const plan = planStessaImport(read.ledgers.map((l) => l.ledger), { categoryOverrides: overrides });

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
      cashAccountForRow: (row) => sourceAccounts.get(sourceKey(row.source, row.account)) ?? null,
    });

    // Remember the matches so the next import starts from them.
    const remembered: { workspace_id: string; entity_id: string; kind: string; stessa_key: string; target_id: string }[] = [];
    const remember = (kind: string, stessa_key: string, target_id: string | undefined) => {
      if (target_id) remembered.push({ workspace_id: workspaceId, entity_id: entity.data, kind, stessa_key, target_id });
    };
    for (const [name, pid] of portfolioIds) remember("portfolio", name, pid);
    for (const [name, pid] of propertyIds) remember("property", name, pid);
    for (const [key, aid] of sourceAccounts) remember("source", key, aid);
    for (const [key, k] of overrides) remember("category", key, k.startsWith("id:") ? k.slice(3) : ctx.accountIds.get(k));
    if (remembered.length > 0) {
      await supabase.from("import_mappings").upsert(remembered, { onConflict: "entity_id,kind,stessa_key" });
    }

    refresh();
    return {
      result: {
        ...result,
        createdPortfolios,
        createdProperties: toCreate.map((c) => c.name),
        createdAccounts,
        createdCategories: [...overrides.values()].filter((k) => k.startsWith("new:")).length,
      },
    };
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
