import type { ColumnGrouping, ReportKind } from "./types";

export interface ReportParams {
  report: ReportKind;
  from: string; // yyyy-mm-dd
  to: string;
  /** "all", "p:<propertyId>" or "pf:<portfolioId>" */
  property: string;
  columns: ColumnGrouping;
  detail: "category" | "sub";
  cents: boolean;
  /** General ledger only: "all" or an account code. */
  account: string;
  /** "all" (every business, combined) or one entity's id. */
  entity: string;
}

export const REPORTS: { kind: ReportKind; label: string; description: string }[] = [
  {
    kind: "income-statement",
    label: "Income Statement",
    description: "Income and operating expenses by category, down to net operating income and net income.",
  },
  {
    kind: "net-cash-flow",
    label: "Net Cash Flow",
    description: "Income and expenses by category, including debt service, capital expenses and transfers.",
  },
  {
    kind: "capital-expenses",
    label: "Capital Expenses",
    description: "Schedule of acquisitions and improvements, with when each was placed in service and its useful life.",
  },
  {
    kind: "balance-sheet",
    label: "Balance Sheet",
    description: "What you own and what you owe at a point in time, from your double-entry books.",
  },
  {
    kind: "trial-balance",
    label: "Trial Balance",
    description: "Every account's debit and credit balance, proving that your books balance.",
  },
  {
    kind: "general-ledger",
    label: "General Ledger",
    description: "Every journal entry line by account, with running balances.",
  },
];

/** Reports that describe a single date ("as of") instead of a period. */
export const AS_OF_REPORTS: ReportKind[] = ["balance-sheet", "trial-balance"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseParams(
  sp: Record<string, string | string[] | undefined>,
  defaultYear: number,
  forced?: ReportKind,
): ReportParams {
  const kind = forced ?? one(sp.report);
  const report = REPORTS.some((r) => r.kind === kind) ? (kind as ReportKind) : "income-statement";

  let from = one(sp.from);
  let to = one(sp.to);
  if (!from || !DATE.test(from)) from = `${defaultYear}-01-01`;
  if (!to || !DATE.test(to)) to = `${defaultYear}-12-31`;
  if (from > to) [from, to] = [to, from];

  const columnsRaw = one(sp.columns);
  const columns = (["property", "entity", "month", "quarter", "year", "total"] as const).find((c) => c === columnsRaw) ?? "property";

  return {
    report,
    from,
    to,
    property: one(sp.property) || "all",
    columns,
    detail: one(sp.detail) === "category" ? "category" : "sub",
    cents: one(sp.cents) === "1",
    account: one(sp.account) || "all",
    entity: one(sp.entity) || "all",
  };
}

export function toQuery(p: ReportParams, includeReport = true): string {
  const q = new URLSearchParams({
    from: p.from,
    to: p.to,
    property: p.property,
    columns: p.columns,
    detail: p.detail,
  });
  if (includeReport) q.set("report", p.report);
  if (p.cents) q.set("cents", "1");
  if (p.account !== "all") q.set("account", p.account);
  if (p.entity !== "all") q.set("entity", p.entity);
  return q.toString();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One column per month / quarter / year that overlaps [from, to], including empty periods. */
export function periodColumns(from: string, to: string, grouping: "month" | "quarter" | "year") {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const cols: { key: string; label: string }[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((m = 1), y++) : m++) {
    const key =
      grouping === "month"
        ? `${y}-${String(m).padStart(2, "0")}`
        : grouping === "quarter"
          ? `${y}-Q${Math.ceil(m / 3)}`
          : `${y}`;
    if (cols.at(-1)?.key === key) continue;
    const label =
      grouping === "month" ? `${MONTHS[m - 1]} ${y}` : grouping === "quarter" ? `Q${Math.ceil(m / 3)} ${y}` : `${y}`;
    cols.push({ key, label });
  }
  return cols;
}

export function describeRange(from: string, to: string) {
  const f = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `From ${f(from)} through ${f(to)}`;
}
