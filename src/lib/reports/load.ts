import { getSession } from "@/lib/workspace";
import { buildBalanceSheet, buildIncomeStatement, buildNetCashFlow, buildTrialBalance } from "./build";
import { buildLedger, type LedgerAccount, type LedgerGroup, type LedgerLine } from "./ledger";
import { classifyEntry, type TransactionKind } from "./transactionType";
import { isCashLike } from "@/lib/paidFrom";
import { bpToPercent } from "@/lib/ownership";
import { AS_OF_REPORTS, describeRange, periodColumns, type ReportParams } from "./params";
import type { AccountInfo, ActivityRow, Column, ReportData } from "./types";

const PAGE = 1000;

interface PropertyRow {
  id: string;
  name: string;
  portfolio_id: string;
  entity_id: string;
  portfolios: { name: string } | null;
  /** Every owner and its share, in basis points. entity_id above is the owner that keeps the books. */
  property_owners: { entity_id: string; percent_bp: number }[];
}

/** Properties selected by the Property filter, plus a label for the report title. */
export async function selectProperties(property: string) {
  const { supabase } = await getSession();
  const { data } = await supabase
    .from("properties")
    .select("id, name, portfolio_id, entity_id, portfolios(name), property_owners(entity_id, percent_bp)")
    .order("name");
  const all = (data ?? []) as unknown as PropertyRow[];

  if (property.startsWith("p:")) {
    const p = all.filter((x) => x.id === property.slice(2));
    return { all, selected: p, label: p[0]?.name ?? "Unknown property", filtered: true };
  }
  if (property.startsWith("pf:")) {
    const p = all.filter((x) => x.portfolio_id === property.slice(3));
    const name = p[0]?.portfolios?.name;
    return { all, selected: p, label: name ? `${name} portfolio` : "Portfolio", filtered: true };
  }
  return { all, selected: all, label: "All Properties", filtered: false };
}

type SupabaseServer = Awaited<ReturnType<typeof getSession>>["supabase"];
type ActivityResult = { bucket: string; property_id: string | null; account_id: string; net_cents: number | string };

/** Read every page of the report_activity query (the API returns at most one page per call). */
async function fetchActivity(
  supabase: SupabaseServer,
  o: { from: string; to: string; group: string; propertyIds: string[] | null; entityIds?: string[] | null; allocate?: boolean },
): Promise<ActivityResult[]> {
  const rows: ActivityResult[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc("report_activity", { p_from: o.from, p_to: o.to, p_group: o.group, p_property_ids: o.propertyIds, p_entity_ids: o.entityIds ?? null, p_allocate: o.allocate ?? false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as ActivityResult[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

async function fetchAccounts(supabase: SupabaseServer, entityIds: string[]): Promise<AccountInfo[]> {
  if (entityIds.length === 0) return [];
  const { data } = await supabase
    .from("accounts")
    .select("id, parent_id, code, name, type, subtype, is_bank")
    .in("entity_id", entityIds);
  return (data ?? []).map((a) => ({
    id: a.id,
    parentId: a.parent_id,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    isBank: a.is_bank,
  }));
}

const longDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/**
 * Which businesses and properties a report covers. "All businesses" combines every entity, including ones
 * with no properties (a consulting business, say); choosing an entity limits the report to its books.
 */
export async function scopeFor(params: Pick<ReportParams, "property" | "entity">) {
  const { supabase } = await getSession();
  const [{ data: ents }, props] = await Promise.all([supabase.from("entities").select("id, name").order("name"), selectProperties(params.property)]);
  const allEntities = (ents ?? []) as { id: string; name: string }[];
  const entity = params.entity !== "all" ? allEntities.find((e) => e.id === params.entity) : undefined;

  const owns = (p: PropertyRow, entityId: string) => p.property_owners.some((o) => o.entity_id === entityId);
  const selected = entity ? props.selected.filter((p) => owns(p, entity.id)) : props.selected;
  let entities = entity ? [entity] : allEntities;
  if (props.filtered) {
    const inScope = new Set(selected.flatMap((p) => p.property_owners.map((o) => o.entity_id)));
    entities = entities.filter((e) => inScope.has(e.id));
  }
  const label = props.filtered ? props.label : entity ? entity.name : allEntities.length > 1 ? "All Businesses" : props.label;
  return { entities, selected, filtered: props.filtered, entityScoped: Boolean(entity), label, allEntities };
}

/** Load the data for a report and build it: income statement, net cash flow, balance sheet or trial balance. */
export async function loadReport(params: ReportParams): Promise<ReportData> {
  const { supabase } = await getSession();
  const scope = await scopeFor(params);
  const { selected, label, filtered } = scope;
  const asOf = AS_OF_REPORTS.includes(params.report);

  const entityIds = scope.entities.map((e) => e.id);
  // A co-owned property's activity is in the books of the owner that keeps them, so load every entity's accounts.
  const accounts = await fetchAccounts(supabase, scope.allEntities.map((e) => e.id));
  // Statements show each owner's share of a co-owned property. The trial balance shows the books as recorded.
  const allocate = params.report !== "trial-balance";

  // Point-in-time reports add up everything from the beginning to the as-of date.
  const from = asOf ? "1900-01-01" : params.from;
  const grouping =
    params.report === "trial-balance"
      ? "total"
      : params.report === "balance-sheet"
        ? params.columns === "property" || params.columns === "entity"
          ? params.columns
          : "total"
        : params.columns;

  const rows =
    entityIds.length > 0
      ? await fetchActivity(supabase, { from, to: params.to, group: grouping, propertyIds: filtered ? selected.map((p) => p.id) : null, entityIds, allocate })
      : [];

  const activity: ActivityRow[] = rows.map((r) => ({
    columnKey: grouping === "property" ? (r.property_id ?? "unassigned") : r.bucket,
    accountId: r.account_id,
    netCents: Number(r.net_cents),
  }));

  let columns: Column[];
  if (grouping === "property") {
    columns = selected.map((p) => ({ key: p.id, label: p.name }));
    if (activity.some((a) => a.columnKey === "unassigned")) {
      columns.push({ key: "unassigned", label: "Not assigned to a property" });
    }
  } else if (grouping === "entity") {
    columns = scope.entities.map((e) => ({ key: e.id, label: e.name }));
  } else if (grouping === "total") {
    columns = [{ key: "all", label: "Total" }];
  } else {
    columns = periodColumns(params.from, params.to, grouping as "month" | "quarter" | "year");
  }

  let firstEntryDate: string | undefined;
  let openingBalancesDate: string | undefined;
  if (params.report === "balance-sheet") {
    const { data } = await supabase.from("journal_entries").select("entry_date").order("entry_date").limit(1);
    firstEntryDate = data?.[0]?.entry_date ?? undefined;

    // An opening balances entry only counts while it has not been reversed.
    const { data: opening } = await supabase
      .from("journal_entries")
      .select("id, entry_date")
      .eq("source", "system")
      .like("memo", "Opening balance:%")
      .order("entry_date");
    const openingIds = (opening ?? []).map((o) => o.id);
    const { data: undone } = openingIds.length
      ? await supabase.from("journal_entries").select("reverses_entry_id").in("reverses_entry_id", openingIds)
      : { data: [] };
    const undoneIds = new Set((undone ?? []).map((u) => u.reverses_entry_id as string));
    openingBalancesDate = (opening ?? []).find((o) => !undoneIds.has(o.id))?.entry_date;
  }

  const input = {
    accounts,
    activity,
    columns,
    subtitle: asOf ? `As of ${longDate(params.to)}` : describeRange(params.from, params.to),
    options: { detail: params.detail, showTotal: grouping !== "total" },
    context: { filtered, firstEntryDate, openingBalancesDate },
  };
  const data =
    params.report === "net-cash-flow"
      ? buildNetCashFlow(input)
      : params.report === "balance-sheet"
        ? buildBalanceSheet(input)
        : params.report === "trial-balance"
          ? buildTrialBalance(input)
          : buildIncomeStatement(input);

  // Say so when a co-owned property is shown at an owner's share.
  const shared = allocate ? selected.filter((p) => p.property_owners.length > 1) : [];
  const notes = [...(data.notes ?? [])];
  if (shared.length > 0) {
    const entityName = new Map(scope.allEntities.map((e) => [e.id, e.name]));
    const detail = shared
      .slice(0, 3)
      .map((p) => `${p.name} (${p.property_owners.map((o) => `${entityName.get(o.entity_id) ?? ""} ${bpToPercent(o.percent_bp)}%`).join(", ")})`)
      .join("; ");
    notes.push({
      tone: "info",
      text: `Co-owned properties are shown at each owner's share: ${detail}${shared.length > 3 ? `, and ${shared.length - 3} more` : ""}. Transactions are recorded in full in the books of the owner that keeps them.`,
    });
  }
  return { ...data, notes, title: `${data.title} for ${label}` };
}

export interface LedgerReport {
  title: string;
  subtitle: string;
  groups: LedgerGroup[];
  accountOptions: { code: string; name: string }[];
  /** True when more lines matched than were loaded. */
  truncated: boolean;
  lineCount: number;
}

const LEDGER_LINE_CAP = 5000;

const dayBefore = (d: string) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/** Journal lines by account for the period, with opening balances and running balances. */
export async function loadLedger(params: ReportParams): Promise<LedgerReport> {
  const { supabase } = await getSession();
  const scope = await scopeFor(params);
  const { selected, label, filtered } = scope;
  const entityIds = scope.entities.map((e) => e.id);
  const accountsInfo = await fetchAccounts(supabase, entityIds);
  const propertyIds = filtered ? selected.map((p) => p.id) : null;

  const options = [...new Map(accountsInfo.map((a) => [a.code, { code: a.code, name: a.name }])).values()].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  );

  const chosen = accountsInfo.filter((a) => params.account === "all" || a.code === params.account);
  const byId = new Map(accountsInfo.map((a) => [a.id, a]));
  const ledgerAccounts: LedgerAccount[] = chosen.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    parentName: a.parentId ? (byId.get(a.parentId)?.name ?? null) : null,
  }));

  // Opening balances: balance-sheet accounts carry forward; income and expense restart each January.
  const opening = new Map<string, number>();
  if (entityIds.length > 0) {
    const before = dayBefore(params.from);
    const yearStart = `${params.from.slice(0, 4)}-01-01`;
    const carried = await fetchActivity(supabase, { from: "1900-01-01", to: before, group: "total", propertyIds, entityIds });
    for (const r of carried) {
      const t = byId.get(r.account_id)?.type;
      if (t && t !== "income" && t !== "expense") opening.set(r.account_id, Number(r.net_cents));
    }
    if (params.from > yearStart) {
      const ytd = await fetchActivity(supabase, { from: yearStart, to: before, group: "total", propertyIds, entityIds });
      for (const r of ytd) {
        const t = byId.get(r.account_id)?.type;
        if (t === "income" || t === "expense") opening.set(r.account_id, Number(r.net_cents));
      }
    }
  }

  const propertyName = new Map(selected.map((p) => [p.id, p.name]));
  const lines: LedgerLine[] = [];
  let truncated = false;
  const ids = chosen.map((a) => a.id);
  for (let from = 0; ids.length > 0; from += PAGE) {
    let q = supabase
      .from("journal_lines")
      .select("id, account_id, property_id, debit_cents, credit_cents, memo, journal_entries!inner(entry_date, memo, created_at)")
      .gte("journal_entries.entry_date", params.from)
      .lte("journal_entries.entry_date", params.to)
      .in("account_id", ids)
      .order("id")
      .range(from, from + PAGE - 1);
    if (filtered) {
      q = q.in(
        "property_id",
        selected.map((p) => p.id),
      );
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const l of data ?? []) {
      const e = l.journal_entries as unknown as { entry_date: string; memo: string | null; created_at: string };
      lines.push({
        accountId: l.account_id,
        date: e.entry_date,
        order: `${e.created_at}|${l.id}`,
        description: l.memo || e.memo || "",
        property: l.property_id ? (propertyName.get(l.property_id) ?? "") : "",
        debitCents: Number(l.debit_cents),
        creditCents: Number(l.credit_cents),
      });
    }
    if (lines.length >= LEDGER_LINE_CAP) {
      truncated = (data?.length ?? 0) === PAGE;
      break;
    }
    if ((data?.length ?? 0) < PAGE) break;
  }

  return {
    title: `General Ledger for ${label}`,
    subtitle: describeRange(params.from, params.to),
    groups: buildLedger(ledgerAccounts, lines, opening),
    accountOptions: options,
    truncated,
    lineCount: lines.length,
  };
}

/** Typical recovery period shown for items posted to the books (appliances and flooring: 5 years; the rest: 27.5). */
const lifeFor = (name: string) => (/appliance|carpet|flooring|furnish/i.test(name) ? 5 : 27.5);

/**
 * Purchases and improvements posted to Rental Property (Cost) or its subcategories. Opening balances are left
 * out: they are a starting balance, not a purchase, and are entered in the register with their own dates.
 */
async function capexFromBooks(
  supabase: SupabaseServer,
  selected: { id: string; name: string; entity_id: string; portfolios: { name: string } | null }[],
  entityIds: string[],
  filtered: boolean,
  to: string,
): Promise<CapexRow[]> {
  const accounts = await fetchAccounts(supabase, entityIds);
  const fixed = accounts.filter((a) => a.type === "asset" && a.subtype === "fixed_asset");
  if (fixed.length === 0) return [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const propertyById = new Map(selected.map((p) => [p.id, p]));

  const out: CapexRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("journal_lines")
      .select("id, account_id, property_id, debit_cents, credit_cents, memo, journal_entries!inner(entry_date, memo, source)")
      .in("account_id", fixed.map((a) => a.id))
      .neq("journal_entries.source", "system")
      .lte("journal_entries.entry_date", to)
      .order("id")
      .range(from, from + PAGE - 1);
    if (filtered) {
      q = q.in(
        "property_id",
        selected.map((p) => p.id),
      );
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const l of data ?? []) {
      const e = l.journal_entries as unknown as { entry_date: string; memo: string | null };
      const acct = byId.get(l.account_id as string);
      const cents = Number(l.debit_cents) - Number(l.credit_cents);
      if (!acct || cents === 0) continue;
      const prop = l.property_id ? propertyById.get(l.property_id as string) : undefined;
      out.push({
        id: l.id as string,
        name: (l.memo as string | null) || e.memo || acct.name,
        subCategory: acct.name,
        amountCents: cents,
        spentOn: e.entry_date,
        placedInService: e.entry_date,
        usefulLife: lifeFor(acct.name),
        property: prop?.name ?? "",
        portfolio: prop?.portfolios?.name ?? "",
        notes: null,
        source: "books",
      });
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

export interface CapexRow {
  id: string;
  name: string;
  subCategory: string;
  amountCents: number;
  spentOn: string;
  placedInService: string | null;
  usefulLife: number;
  property: string;
  portfolio: string;
  notes: string | null;
  /** "books" = posted to Rental Property (Cost); "manual" = added to the register by hand. */
  source: "books" | "manual";
}

/** Capital expenses up to the end of the period (it is a cumulative schedule). */
export async function loadCapex(params: ReportParams): Promise<{ title: string; subtitle: string; rows: CapexRow[] }> {
  const { supabase } = await getSession();
  const scope = await scopeFor(params);
  const { selected, label } = scope;
  // The register has no business column, so a business is limited through its properties.
  const restrict = scope.filtered || scope.entityScoped;

  let q = supabase
    .from("capital_expenses")
    .select("id, name, sub_category, amount_cents, spent_on, placed_in_service_on, useful_life_years, notes, properties(name, portfolios(name))")
    .lte("spent_on", params.to)
    .order("spent_on");
  if (restrict) {
    q = q.in(
      "property_id",
      selected.map((p) => p.id),
    );
  }
  const { data } = await q;

  const rows: CapexRow[] = (data ?? []).map((r) => {
    const prop = r.properties as unknown as { name: string; portfolios: { name: string } | null } | null;
    return {
      id: r.id,
      name: r.name,
      subCategory: r.sub_category,
      amountCents: Number(r.amount_cents),
      spentOn: r.spent_on,
      placedInService: r.placed_in_service_on,
      usefulLife: Number(r.useful_life_years),
      property: prop?.name ?? "",
      portfolio: prop?.portfolios?.name ?? "",
      notes: r.notes,
      source: "manual" as const,
    };
  });

  const fromBooks = await capexFromBooks(supabase, selected, scope.entities.map((e) => e.id), scope.filtered, params.to);
  const all = [...rows, ...fromBooks].sort((a, b) => a.spentOn.localeCompare(b.spentOn) || a.name.localeCompare(b.name));
  const through = new Date(params.to + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return { title: `Schedule of Capital Expense for ${label}`, subtitle: `Cumulative through ${through}`, rows: all };
}

// ---------------------------------------------------------------------------
// Account Transactions: every posting, listed by transaction, with both sides shown
// ---------------------------------------------------------------------------

export interface TxLineView {
  code: string;
  account: string;
  property: string;
  debitCents: number;
  creditCents: number;
  memo: string | null;
}

export interface TxEntryView {
  id: string;
  date: string;
  description: string;
  type: TransactionKind;
  business: string;
  lines: TxLineView[];
}

export interface AccountTransactionsReport {
  title: string;
  subtitle: string;
  entries: TxEntryView[];
  accountOptions: { code: string; name: string }[];
  showBusiness: boolean;
  /** True when more transactions matched than were loaded. */
  truncated: boolean;
  totalDebitsCents: number;
  totalCreditsCents: number;
}

const TX_ENTRY_CAP = 2500;

type EntryRow = {
  id: string;
  entry_date: string;
  memo: string | null;
  source: string;
  created_at: string;
  entity_id: string;
  journal_lines: { id: string; account_id: string; property_id: string | null; debit_cents: number | string; credit_cents: number | string; memo: string | null }[];
};

/**
 * The transactions in the period. Filtering by account or property finds the matching transactions first,
 * then shows every line of each one, so the other side of the entry is always visible.
 */
export async function loadAccountTransactions(params: ReportParams): Promise<AccountTransactionsReport> {
  const { supabase } = await getSession();
  const scope = await scopeFor(params);
  const { selected, label, filtered } = scope;
  const entityIds = scope.entities.map((e) => e.id);
  const accounts = await fetchAccounts(supabase, entityIds);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const entityName = new Map(scope.entities.map((e) => [e.id, e.name]));
  const propertyName = new Map(selected.map((p) => [p.id, p.name]));

  const accountOptions = [...new Map(accounts.map((a) => [a.code, { code: a.code, name: a.name }])).values()].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
  const chosen = accounts.filter((a) => params.account === "all" || a.code === params.account);

  // 1. Which transactions? (all of them, or those that touch the chosen account or property)
  let entryIds: string[] | null = null;
  if (params.account !== "all" || filtered) {
    const found = new Set<string>();
    for (let from = 0; chosen.length > 0 && found.size <= TX_ENTRY_CAP; from += PAGE) {
      let q = supabase
        .from("journal_lines")
        .select("id, entry_id, journal_entries!inner(entry_date)")
        .gte("journal_entries.entry_date", params.from)
        .lte("journal_entries.entry_date", params.to)
        .in("account_id", chosen.map((a) => a.id))
        .order("id")
        .range(from, from + PAGE - 1);
      if (filtered) {
        q = q.in(
          "property_id",
          selected.map((p) => p.id),
        );
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      for (const l of data ?? []) found.add(l.entry_id as string);
      if ((data?.length ?? 0) < PAGE) break;
    }
    entryIds = [...found];
  }

  // 2. Those transactions, each with all of its lines.
  const columns = "id, entry_date, memo, source, created_at, entity_id, journal_lines(id, account_id, property_id, debit_cents, credit_cents, memo)";
  const rows: EntryRow[] = [];
  if (entryIds) {
    for (let i = 0; i < entryIds.length; i += 100) {
      const { data, error } = await supabase.from("journal_entries").select(columns).in("id", entryIds.slice(i, i + 100));
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as EntryRow[]));
    }
  } else if (entityIds.length > 0) {
    for (let from = 0; rows.length <= TX_ENTRY_CAP; from += 500) {
      const { data, error } = await supabase
        .from("journal_entries")
        .select(columns)
        .in("entity_id", entityIds)
        .gte("entry_date", params.from)
        .lte("entry_date", params.to)
        .order("entry_date")
        .order("created_at")
        .range(from, from + 499);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as EntryRow[]));
      if ((data?.length ?? 0) < 500) break;
    }
  }

  rows.sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at));
  const truncated = rows.length > TX_ENTRY_CAP;

  const entries: TxEntryView[] = rows.slice(0, TX_ENTRY_CAP).map((r) => {
    const lines: TxLineView[] = r.journal_lines
      .map((l) => {
        const a = byId.get(l.account_id);
        const parent = a?.parentId ? byId.get(a.parentId) : undefined;
        return {
          code: a?.code ?? "",
          account: a ? `${parent ? `${parent.name} › ` : ""}${a.name}` : "(unknown account)",
          property: l.property_id ? (propertyName.get(l.property_id) ?? "") : "",
          debitCents: Number(l.debit_cents),
          creditCents: Number(l.credit_cents),
          memo: l.memo,
        };
      })
      .sort((x, y) => Number(y.debitCents > 0) - Number(x.debitCents > 0)); // debits first, then credits
    const kinds = r.journal_lines.flatMap((l) => {
      const a = byId.get(l.account_id);
      return a ? [{ type: a.type, cashLike: isCashLike(a), loan: a.subtype === "loan", debit: Number(l.debit_cents) > 0 }] : [];
    });
    return {
      id: r.id,
      date: r.entry_date,
      description: r.memo ?? "",
      type: classifyEntry(r.source, r.memo, kinds),
      business: entityName.get(r.entity_id) ?? "",
      lines,
    };
  });

  const sum = (pick: (l: TxLineView) => number) => entries.reduce((s, e) => s + e.lines.reduce((x, l) => x + pick(l), 0), 0);
  return {
    title: `Account Transactions for ${label}`,
    subtitle: describeRange(params.from, params.to),
    entries,
    accountOptions,
    showBusiness: scope.allEntities.length > 1,
    truncated,
    totalDebitsCents: sum((l) => l.debitCents),
    totalCreditsCents: sum((l) => l.creditCents),
  };
}
