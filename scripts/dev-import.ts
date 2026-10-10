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

  const existing = await supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("entity_id", entityId);
  if ((existing.count ?? 0) > 0) {
    console.log(`Entity already has ${existing.count} journal entries; nothing to do. Run \`npx supabase db reset\` to start over.`);
    return;
  }

  const ledgers = await Promise.all(files.map((f) => parseStessaLedger(f)));
  const plan = planStessaImport(ledgers);

  const accounts = new Map<string, string>();
  const acc = await supabase.from("accounts").select("id, code").eq("entity_id", entityId);
  for (const a of acc.data ?? []) accounts.set(a.code, a.id);

  const props = new Map<string, string>();
  for (const l of ledgers) {
    const ins = await supabase
      .from("properties")
      .insert({ workspace_id: workspaceId, portfolio_id: portfolio!.id, entity_id: entityId, name: l.propertyName })
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    props.set(l.propertyName, ins.data.id);
  }

  let posted = 0;
  for (const e of plan.entries) {
    const lines = e.lines.map((l) => ({
      account_id: accounts.get(l.accountCode),
      property_id: props.get(l.property),
      debit_cents: l.debitCents,
      credit_cents: l.creditCents,
    }));
    const r = await supabase.rpc("post_entry", {
      p_entity_id: entityId,
      p_entry_date: e.date,
      p_memo: e.memo,
      p_lines: lines,
      p_source: "import",
    });
    if (r.error) throw new Error(`${e.date} ${e.memo}: ${r.error.message}`);
    posted += 1;
  }

  console.log(`Loaded ${ledgers.length} properties, posted ${posted} entries, ${plan.unresolved.length} unresolved rows skipped.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
