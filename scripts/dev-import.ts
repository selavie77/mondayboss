/**
 * Local-only helper: sign up a dev user and load Stessa general-ledger exports into the
 * LOCAL Supabase so the UI can be tried with real data.
 *
 *   npx tsx --env-file=.env.local scripts/dev-import.ts <folder-or-xlsx> [more...]
 *
 * Each argument is an xlsx file, or a folder that is searched (one level deep) for
 * GeneralLedgerReport*.xlsx files. Refuses to run against a non-local Supabase URL.
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseStessaLedger } from "../src/lib/import/stessa";
import { planStessaImport } from "../src/lib/import/stessaEntries";
import { commitImportPlan } from "../src/lib/import/commit";
import { resolvePaidFrom } from "../src/lib/paidFrom";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const email = process.env.DEV_EMAIL!;
const password = process.env.DEV_PASSWORD!;

if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error(`Refusing to run against non-local Supabase: ${url}`);
}

function findFiles(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (!existsSync(a)) throw new Error(`Not found: ${a}`);
    if (statSync(a).isFile()) out.push(a);
    else {
      for (const d of readdirSync(a, { withFileTypes: true })) {
        if (d.isDirectory()) {
          for (const f of readdirSync(path.join(a, d.name))) {
            if (/^GeneralLedgerReport.*\.xlsx$/i.test(f)) out.push(path.join(a, d.name, f));
          }
        } else if (/^GeneralLedgerReport.*\.xlsx$/i.test(d.name)) out.push(path.join(a, d.name));
      }
    }
  }
  return out;
}

async function main() {
  const files = findFiles(process.argv.slice(2));
  if (files.length === 0) throw new Error("Pass at least one folder or xlsx file.");

  const supabase = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws as never } });
  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  let userId = signedIn.data.user?.id;
  if (signedIn.error) {
    const up = await supabase.auth.signUp({ email, password, options: { data: { full_name: "Dev", workspace_name: "Dev workspace" } } });
    if (up.error) throw up.error;
    userId = up.data.user?.id;
  }
  if (!userId) throw new Error("Could not sign in the dev user.");

  const { data: member } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", userId).single();
  const workspaceId = member!.workspace_id as string;
  const { data: portfolio } = await supabase.from("portfolios").select("id").eq("workspace_id", workspaceId).limit(1).single();

  const entityName = "Bamileke Holdings LLC";
  let { data: entity } = await supabase.from("entities").select("id").eq("name", entityName).maybeSingle();
  if (!entity) {
    const ins = await supabase.from("entities").insert({ workspace_id: workspaceId, name: entityName, type: "llc" }).select("id").single();
    if (ins.error) throw ins.error;
    entity = ins.data;
    const seeded = await supabase.rpc("seed_default_chart", { p_entity_id: entity.id });
    if (seeded.error) throw seeded.error;
  }
  const entityId = entity.id as string;

  const ledgers = await Promise.all(files.map((f) => parseStessaLedger(f)));
  const plan = planStessaImport(ledgers);

  const accounts = new Map<string, string>();
  const acc = await supabase.from("accounts").select("id, code").eq("entity_id", entityId);
  for (const a of acc.data ?? []) accounts.set(a.code, a.id);

  const props = new Map<string, string>();
  for (const l of ledgers) {
    const found = await supabase.from("properties").select("id").eq("name", l.propertyName).maybeSingle();
    if (found.data) {
      props.set(l.propertyName, found.data.id);
      continue;
    }
    const ins = await supabase
      .from("properties")
      .insert({ workspace_id: workspaceId, portfolio_id: portfolio!.id, entity_id: entityId, name: l.propertyName })
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    props.set(l.propertyName, ins.data.id);
  }

  const cash = await supabase.from("accounts").select("id, code, is_bank, subtype, property_id, portfolio_id").eq("entity_id", entityId);
  const cashAccounts = (cash.data ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    isBank: a.is_bank as boolean,
    subtype: a.subtype as string | null,
    propertyId: a.property_id as string | null,
    portfolioId: a.portfolio_id as string | null,
  }));
  const propRows = await supabase.from("properties").select("id, name, portfolio_id").eq("entity_id", entityId);
  const propByName = new Map((propRows.data ?? []).map((p) => [p.name as string, { id: p.id as string, portfolioId: p.portfolio_id as string | null }]));

  const result = await commitImportPlan(supabase, {
    cashAccountFor: (name) => resolvePaidFrom(propByName.get(name) ?? null, cashAccounts),
    workspaceId,
    entityId,
    source: "Stessa general ledger",
    filename: files.map((f) => path.basename(path.dirname(f))).join(", "),
    plan,
    accountIds: accounts,
    propertyIds: props,
  });
  console.log(
    `${ledgers.length} properties: ${result.imported} rows imported (${result.posted} posted, ${result.pending} waiting for review), ${result.duplicates} already imported.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
