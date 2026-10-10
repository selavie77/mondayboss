import type {
  AccountInfo,
  ActivityRow,
  BuildOptions,
  Column,
  ReportData,
  ReportRow,
} from "./types";

interface Input {
  accounts: AccountInfo[];
  activity: ActivityRow[];
  columns: Column[];
  options: BuildOptions;
  subtitle: string;
}

type Vec = number[];
const zeros = (n: number): Vec => new Array(n).fill(0);
const add = (a: Vec, b: Vec): Vec => a.map((v, i) => v + b[i]);
const sub = (a: Vec, b: Vec): Vec => a.map((v, i) => v - b[i]);
const scale = (a: Vec, k: number): Vec => a.map((v) => v * k);
const isZero = (a: Vec) => a.every((v) => v === 0);

/** Everything a builder needs: per-account vectors (debit minus credit) and category grouping. */
class Ledger {
  private byAccount = new Map<string, Vec>();
  private info = new Map<string, AccountInfo>();
  readonly n: number;

  constructor(
    private accounts: AccountInfo[],
    activity: ActivityRow[],
    columns: Column[],
  ) {
    this.n = columns.length;
    const idx = new Map(columns.map((c, i) => [c.key, i]));
    for (const a of accounts) this.info.set(a.id, a);
    for (const r of activity) {
      const i = idx.get(r.columnKey);
      if (i === undefined) continue;
      const v = this.byAccount.get(r.accountId) ?? zeros(this.n);
      v[i] += r.netCents;
      this.byAccount.set(r.accountId, v);
    }
  }

  net(accountId: string): Vec {
    return this.byAccount.get(accountId) ?? zeros(this.n);
  }

  /** Sum of net (debit - credit) over the accounts matching the predicate. */
  sum(pred: (a: AccountInfo) => boolean): Vec {
    let total = zeros(this.n);
    for (const a of this.accounts) if (pred(a)) total = add(total, this.net(a.id));
    return total;
  }

  /**
   * Group matching accounts into categories. A top-level account and its children share a category;
   * categories with the same name across entities are merged.
   */
  categories(pred: (a: AccountInfo) => boolean): Category[] {
    const map = new Map<string, Category>();
    for (const a of this.accounts) {
      if (!pred(a)) continue;
      const top = a.parentId ? this.info.get(a.parentId) : a;
      if (!top) continue;
      const key = `${top.type}|${top.name.toLowerCase()}`;
      const cat = map.get(key) ?? { name: top.name, code: top.code, own: zeros(this.n), children: new Map<string, Vec>() };
      if (top.code < cat.code) cat.code = top.code;
      if (a.parentId) {
        const k = a.name;
        cat.children.set(k, add(cat.children.get(k) ?? zeros(this.n), this.net(a.id)));
      } else {
        cat.own = add(cat.own, this.net(a.id));
      }
      map.set(key, cat);
    }
    return [...map.values()].sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
  }
}

interface Category {
  name: string;
  code: string;
  own: Vec;
  children: Map<string, Vec>;
}

const isOpex = (a: AccountInfo) => a.type === "expense" && a.subtype !== "interest" && a.subtype !== "depreciation";
const isInterest = (a: AccountInfo) => a.type === "expense" && a.subtype === "interest";
const isDepreciation = (a: AccountInfo) => a.type === "expense" && a.subtype === "depreciation";
const isLoan = (a: AccountInfo) => a.type === "liability" && a.subtype === "loan";
const isFixedAsset = (a: AccountInfo) => a.type === "asset" && a.subtype === "fixed_asset";
const isTransfer = (a: AccountInfo) => {
  if (a.isBank || a.type === "income" || a.type === "expense") return false;
  if (isLoan(a) || isFixedAsset(a)) return false;
  if (a.type === "asset" && a.subtype === "contra_asset") return false; // accumulated depreciation
  return true;
};

class Report {
  rows: ReportRow[] = [];
  constructor(
    private n: number,
    private opts: BuildOptions,
  ) {}

  private vals(v: Vec): number[] {
    return this.opts.showTotal ? [...v, v.reduce((s, x) => s + x, 0)] : v;
  }

  heading(label: string) {
    this.rows.push({ kind: "heading", label });
  }
  gap() {
    this.rows.push({ kind: "gap", label: "" });
  }
  line(label: string, v: Vec, kind: "line" | "subline" | "total" | "grand" = "line") {
    this.rows.push({ kind, label, values: this.vals(v) });
  }
  ratio(label: string, numerator: Vec, denominator: Vec) {
    const r = (a: number, b: number) => (b > 0 ? a / b : null);
    const per = numerator.map((x, i) => r(x, denominator[i]));
    const total = this.opts.showTotal
      ? [r(numerator.reduce((s, x) => s + x, 0), denominator.reduce((s, x) => s + x, 0))]
      : [];
    this.rows.push({ kind: "ratio", label, values: [...per, ...total] });
  }

  /** Category lines (with subcategories when detail is "sub"). Returns the section total. */
  categories(cats: Category[], sign: 1 | -1): Vec {
    let total = zeros(this.n);
    for (const c of cats) {
      const own = scale(c.own, sign);
      const kids = [...c.children.entries()].map(([name, v]) => [name, scale(v, sign)] as const);
      const catTotal = kids.reduce((s, [, v]) => add(s, v), own);
      if (isZero(catTotal)) continue;
      total = add(total, catTotal);

      if (this.opts.detail === "sub" && kids.length > 0) {
        if (!isZero(own)) this.line(`General ${c.name}`, own, "subline");
        for (const [name, v] of kids.sort((a, b) => a[0].localeCompare(b[0]))) {
          if (!isZero(v)) this.line(name, v, "subline");
        }
        this.line(`Total ${c.name}`, catTotal, "total");
      } else {
        this.line(c.name, catTotal, "line");
      }
    }
    return total;
  }
}

function finish(title: string, input: Input, report: Report): ReportData {
  const columns = input.columns.map((c) => c.label);
  if (input.options.showTotal) columns.push("Total");
  const hasNumbers = report.rows.some((r) => r.values?.some((v) => v !== null && v !== 0 && r.kind !== "ratio"));
  return { title, subtitle: input.subtitle, columns, rows: report.rows, empty: !hasNumbers };
}

export function buildIncomeStatement(input: Input): ReportData {
  const L = new Ledger(input.accounts, input.activity, input.columns);
  const r = new Report(L.n, input.options);

  r.heading("INCOME");
  const income = r.categories(L.categories((a) => a.type === "income"), -1);
  r.line("TOTAL INCOME", income, "grand");
  r.gap();

  r.heading("OPERATING EXPENSES");
  const opex = r.categories(L.categories(isOpex), 1);
  r.line("TOTAL OPERATING EXPENSES", opex, "grand");
  r.gap();

  const noi = sub(income, opex);
  r.line("NET OPERATING INCOME", noi, "grand");

  const below = L.categories((a) => isInterest(a) || isDepreciation(a));
  if (below.some((c) => !isZero(add(c.own, [...c.children.values()].reduce((s, v) => add(s, v), zeros(L.n)))))) {
    r.gap();
    r.heading("INTEREST & DEPRECIATION");
    const other = r.categories(below, 1);
    r.line("TOTAL INTEREST & DEPRECIATION", other, "grand");
    r.gap();
    r.line("NET INCOME", sub(noi, other), "grand");
  }
  return finish("Income Statement", input, r);
}

export function buildNetCashFlow(input: Input): ReportData {
  const L = new Ledger(input.accounts, input.activity, input.columns);
  const r = new Report(L.n, input.options);

  r.heading("INCOME");
  const income = r.categories(L.categories((a) => a.type === "income"), -1);
  r.line("TOTAL INCOME", income, "grand");
  r.gap();

  r.heading("OPERATING EXPENSES");
  const opex = r.categories(L.categories(isOpex), 1);
  r.line("TOTAL OPERATING EXPENSES", opex, "grand");
  r.gap();

  const noi = sub(income, opex);
  r.line("NET OPERATING INCOME", noi, "grand");
  r.gap();

  r.heading("MORTGAGE & LOAN EXPENSES");
  const interest = L.sum(isInterest);
  const principal = L.sum(isLoan); // debits reduce the loan, so a payment is positive
  if (!isZero(interest)) r.line("Interest", interest, "subline");
  if (!isZero(principal)) r.line("Principal", principal, "subline");
  const debtService = add(interest, principal);
  r.line("TOTAL MORTGAGES & LOANS", debtService, "total");
  r.ratio("Debt Service Coverage Ratio", noi, debtService);
  r.gap();

  r.heading("CAPITAL EXPENSES");
  const capex = L.sum(isFixedAsset);
  r.line("TOTAL CAPITAL EXPENSES", capex, "total");
  r.gap();

  const ncf = sub(sub(noi, debtService), capex);
  r.line("NET CASH FLOW", ncf, "grand");
  r.line("NCF Before Principal Payments", add(ncf, principal), "total");
  r.gap();

  r.heading("TRANSFERS");
  // Cash effect: money that left (debits to these accounts) is negative.
  const transfers = r.categories(L.categories(isTransfer), -1);
  r.line("TOTAL TRANSFERS", transfers, "total");
  r.gap();
  r.line("NET CHANGE IN CASH", add(ncf, transfers), "grand");

  return finish("Net Cash Flow", input, r);
}
