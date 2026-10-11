import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { isCashLike } from "@/lib/paidFrom";
import { dayBefore, type OpeningMode } from "@/lib/openingBalance";
import { getSession } from "@/lib/workspace";
import { OpeningBalancesForm, OpeningControls, type OpeningRow } from "./OpeningBalancesForm";

export const metadata: Metadata = { title: "Opening balances" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isOpeningMemo = (m: string | null) => /^(Reversal of )?Opening balance:/.test(m ?? "");

export default async function OpeningBalancesPage({ searchParams }: PageProps<"/opening-balances">) {
  const sp = await searchParams;
  const { supabase } = await getSession();

  const { data: entities } = await supabase.from("entities").select("id, name").order("name");
  const entity = (entities ?? []).find((e) => e.id === one(sp.entity)) ?? entities?.[0];

  const head = (
    <header className="rise">
      <h1 className="text-3xl font-semibold tracking-tight">Opening balances</h1>
      <p className="mt-1 max-w-2xl text-muted">
        What each account held on the day your records start. Without them, balances only reflect the transactions you imported. Reports on income and expenses are not affected.
      </p>
    </header>
  );
  if (!entity) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        {head}
        <Card className="p-8 text-center text-muted">Add an entity first.</Card>
      </div>
    );
  }

  const [{ data: first }, { data: last }] = await Promise.all([
    supabase.from("journal_entries").select("entry_date, memo").eq("entity_id", entity.id).order("entry_date").limit(50),
    supabase.from("journal_entries").select("entry_date, memo").eq("entity_id", entity.id).order("entry_date", { ascending: false }).limit(50),
  ]);
  const firstActivity = (first ?? []).find((e) => !isOpeningMemo(e.memo))?.entry_date ?? null;
  const lastActivity = (last ?? []).find((e) => !isOpeningMemo(e.memo))?.entry_date ?? null;

  const mode: OpeningMode = one(sp.mode) === "opening" ? "opening" : "statement";
  const asOf = isDate(one(sp.as_of)) ? one(sp.as_of) : firstActivity ? dayBefore(firstActivity) : `${new Date().getFullYear() - 1}-12-31`;
  const statementDate = isDate(one(sp.on)) ? one(sp.on) : (lastActivity ?? new Date().toISOString().slice(0, 10));

  const [{ data: accts }, { data: props }, { data: cands }] = await Promise.all([
    supabase.from("accounts").select("id, parent_id, code, name, type, subtype, is_bank, property_id, last4").eq("entity_id", entity.id).eq("is_active", true).in("type", ["asset", "liability"]).order("code"),
    supabase.from("properties").select("id, name").eq("entity_id", entity.id),
    supabase.rpc("opening_candidates", { p_entity_id: entity.id, p_through: statementDate }),
  ]);
  const accounts = accts ?? [];
  const byId = new Map(accounts.map((a) => [a.id as string, a]));
  // An opening balance goes on the main account; its subcategories roll up into it.
  const topOf = (id: string) => (byId.get(id)?.parent_id as string | null) ?? id;
  const propertyName = new Map((props ?? []).map((p) => [p.id as string, p.name as string]));

  // Opening balances already posted (and not reversed), by account and property.
  const { data: openLines } = accounts.length
    ? await supabase
        .from("journal_lines")
        .select("account_id, property_id, debit_cents, credit_cents, entry_id, journal_entries!inner(entry_date, memo, source)")
        .in("account_id", accounts.map((a) => a.id as string))
        .eq("journal_entries.source", "system")
        .like("journal_entries.memo", "Opening balance:%")
    : { data: [] };
  const openIds = [...new Set((openLines ?? []).map((l) => l.entry_id as string))];
  const { data: undone } = openIds.length ? await supabase.from("journal_entries").select("reverses_entry_id").in("reverses_entry_id", openIds) : { data: [] };
  const undoneIds = new Set((undone ?? []).map((u) => u.reverses_entry_id as string));
  const existing = new Map<string, { entryId: string; date: string; cents: number }>();
  for (const l of openLines ?? []) {
    if (undoneIds.has(l.entry_id as string)) continue;
    const a = byId.get(topOf(l.account_id as string));
    if (!a) continue;
    const debitNormal = a.type === "asset" && a.subtype !== "contra_asset";
    const net = Number(l.debit_cents) - Number(l.credit_cents);
    const je = l.journal_entries as unknown as { entry_date: string };
    const cash = isCashLike({ isBank: a.is_bank, subtype: a.subtype });
    existing.set(`${a.id}|${cash ? "" : (l.property_id ?? "")}`, { entryId: l.entry_id as string, date: je.entry_date, cents: debitNormal ? net : -net });
  }

  const movement = new Map<string, number>();
  const accountMovement = new Map<string, number>();
  const pairs: { accountId: string; propertyId: string | null }[] = [];
  for (const c of (cands ?? []) as { account_id: string; property_id: string | null; movement_cents: number | string }[]) {
    const top = topOf(c.account_id);
    const key = `${top}|${c.property_id ?? ""}`;
    movement.set(key, (movement.get(key) ?? 0) + Number(c.movement_cents));
    accountMovement.set(top, (accountMovement.get(top) ?? 0) + Number(c.movement_cents));
    pairs.push({ accountId: top, propertyId: c.property_id });
  }

  const rows: OpeningRow[] = [];
  const seen = new Set<string>();

  // Bank accounts and cards: one balance each.
  for (const a of accounts) {
    if (!isCashLike({ isBank: a.is_bank, subtype: a.subtype })) continue;
    const key = `${a.id}|`;
    seen.add(key);
    rows.push({
      key,
      accountId: a.id as string,
      scope: "account",
      propertyId: null,
      name: a.name as string,
      detail: [a.last4 ? `•••• ${a.last4}` : "", a.property_id ? (propertyName.get(a.property_id as string) ?? "") : ""].filter(Boolean).join(" · "),
      group: "cash",
      amountLabel: a.is_bank ? "Balance" : "Amount owed",
      movementCents: accountMovement.get(a.id as string) ?? 0,
      existing: existing.get(key) ?? null,
    });
  }

  // Everything else: one balance for each property that has activity in the account (or an opening balance already).
  const wanted = [...pairs, ...[...existing.keys()].map((k) => ({ accountId: k.split("|")[0], propertyId: k.split("|")[1] || null }))];
  for (const p of wanted) {
    const a = byId.get(p.accountId);
    if (!a || isCashLike({ isBank: a.is_bank, subtype: a.subtype })) continue;
    const key = `${p.accountId}|${p.propertyId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key,
      accountId: p.accountId,
      scope: "property",
      propertyId: p.propertyId,
      name: a.name as string,
      detail: p.propertyId ? (propertyName.get(p.propertyId) ?? "") : "No property",
      group: a.subtype === "loan" ? "loan" : "other",
      amountLabel: a.type === "liability" ? "Amount owed" : "Balance",
      movementCents: movement.get(key) ?? 0,
      existing: existing.get(key) ?? null,
    });
  }
  const order = (r: OpeningRow) => byId.get(r.accountId)?.code ?? "";
  rows.sort((x, y) => order(x).localeCompare(order(y), undefined, { numeric: true }) || x.detail.localeCompare(y.detail));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {head}

      {(entities?.length ?? 0) > 1 && (
        <nav aria-label="Entity" className="rise flex flex-wrap gap-2">
          {entities!.map((e) => (
            <Link
              key={e.id}
              href={`/opening-balances?entity=${e.id}`}
              aria-current={e.id === entity.id ? "true" : undefined}
              className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition ${e.id === entity.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-border bg-surface text-muted hover:text-foreground"}`}
            >
              {e.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="rise">
        <OpeningControls entityId={entity.id} mode={mode} asOf={asOf} statementDate={statementDate} firstActivity={firstActivity} />
      </div>

      <div className="rise">
        {rows.length === 0 ? (
          <Card className="p-8 text-center text-muted">No bank accounts or other balance sheet accounts yet. Import transactions or add an account in Categories first.</Card>
        ) : (
          <OpeningBalancesForm key={`${entity.id}|${mode}|${asOf}|${statementDate}`} entityId={entity.id} rows={rows} mode={mode} asOf={asOf} statementDate={statementDate} />
        )}
      </div>
    </div>
  );
}
