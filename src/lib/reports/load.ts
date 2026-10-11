import { getSession } from "@/lib/workspace";
import { buildBalanceSheet, buildIncomeStatement, buildNetCashFlow, buildTrialBalance } from "./build";
import { buildLedger, type LedgerAccount, type LedgerGroup, type LedgerLine } from "./ledger";
import { AS_OF_REPORTS, describeRange, periodColumns, type ReportParams } from "./params";
import type { AccountInfo, ActivityRow, Column, ReportData } from "./types";

const PAGE = 1000;

interface PropertyRow {
  id: string;
  name: string;
  portfolio_id: string;
  entity_id: string;
  portfolios: { name: string } | null;
}

/** Properties selected by the Property filter, plus a label for the report title. */
export async function selectProperties(property: string) {
  const { supabase } = await getSession();
  const { data } = await supabase
    .from("properties")
    .select("id, name, portfolio_id, entity_id, portfolios(name)")
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
  o: { from: string; to: string; group: string; propertyIds: string[] | null; entityIds?: string[] | null },
): Promise<ActivityResult[]> {
  const rows: ActivityResult[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc("report_activity", { p_from: o.from, p_to: o.to, p_group: o.group, p_property_ids: o.propertyIds, p_entity_ids: o.entityIds ?? null })
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

  const selected = entity ? props.selected.filter((p) => p.entity_id === entity.id) : props.selected;
  let entities = entity ? [entity] : allEntities;
  if (props.filtered) {
    const inScope = new Set(selected.map((p) => p.entity_id));
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
  const accounts = await fetchAccounts(supabase, entityIds);

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
      ? await fetchActivity(supabase, { from, to: params.to, group: grouping, propertyIds: filtered ? selected.map((p) => p.id) : null, entityIds })
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
  return { ...data, title: `${data.title} for ${label}` };
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
