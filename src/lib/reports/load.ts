import { getSession } from "@/lib/workspace";
import { buildIncomeStatement, buildNetCashFlow } from "./build";
import { describeRange, periodColumns, type ReportParams } from "./params";
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

/** Load the data for an income statement or net cash flow report and build it. */
export async function loadReport(params: ReportParams): Promise<ReportData> {
  const { supabase } = await getSession();
  const { selected, label, filtered } = await selectProperties(params.property);

  const entityIds = [...new Set(selected.map((p) => p.entity_id))];
  const { data: acc } = entityIds.length
    ? await supabase.from("accounts").select("id, parent_id, code, name, type, subtype, is_bank").in("entity_id", entityIds)
    : { data: [] };
  const accounts: AccountInfo[] = (acc ?? []).map((a) => ({
    id: a.id,
    parentId: a.parent_id,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    isBank: a.is_bank,
  }));

  // The report query returns at most one page per call, so read every page.
  type Row = { bucket: string; property_id: string | null; account_id: string; net_cents: number | string };
  const rows: Row[] = [];
  for (let from = 0; entityIds.length > 0; from += PAGE) {
    const { data, error } = await supabase
      .rpc("report_activity", {
        p_from: params.from,
        p_to: params.to,
        p_group: params.columns,
        p_property_ids: filtered ? selected.map((p) => p.id) : null,
      })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < PAGE) break;
  }

  const byProperty = params.columns === "property";
  const activity: ActivityRow[] = rows.map((r) => ({
    columnKey: byProperty ? (r.property_id ?? "unassigned") : r.bucket,
    accountId: r.account_id,
    netCents: Number(r.net_cents),
  }));

  let columns: Column[];
  if (params.columns === "property") {
    columns = selected.map((p) => ({ key: p.id, label: p.name }));
    if (activity.some((a) => a.columnKey === "unassigned")) {
      columns.push({ key: "unassigned", label: "Not assigned to a property" });
    }
  } else if (params.columns === "total") {
    columns = [{ key: "all", label: "Total" }];
  } else {
    columns = periodColumns(params.from, params.to, params.columns);
  }

  const input = {
    accounts,
    activity,
    columns,
    subtitle: describeRange(params.from, params.to),
    options: { detail: params.detail, showTotal: params.columns !== "total" },
  };
  const data = params.report === "net-cash-flow" ? buildNetCashFlow(input) : buildIncomeStatement(input);
  return { ...data, title: `${data.title} for ${label}` };
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
}

/** Capital expenses up to the end of the period (it is a cumulative schedule). */
export async function loadCapex(params: ReportParams): Promise<{ title: string; subtitle: string; rows: CapexRow[] }> {
  const { supabase } = await getSession();
  const { selected, label, filtered } = await selectProperties(params.property);

  let q = supabase
    .from("capital_expenses")
    .select("id, name, sub_category, amount_cents, spent_on, placed_in_service_on, useful_life_years, notes, properties(name, portfolios(name))")
    .lte("spent_on", params.to)
    .order("spent_on");
  if (filtered) {
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
    };
  });
  const through = new Date(params.to + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return { title: `Schedule of Capital Expense for ${label}`, subtitle: `Cumulative through ${through}`, rows };
}
