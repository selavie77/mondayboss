import type {
  AccountInfo,
  AccountType,
  ActivityRow,
  BuildOptions,
  Column,
  ReportData,
  ReportNote,
  ReportRow,
} from "./types";

interface Input {
  accounts: AccountInfo[];
  activity: ActivityRow[];
  columns: Column[];
  options: BuildOptions;
  subtitle: string;
  /** Extra facts the point-in-time reports mention in their notes. */
  context?: { filtered?: boolean; firstEntryDate?: string; openingBalancesDate?: string };
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

const isSaleGain = (a: AccountInfo) => a.type === "income" && a.subtype === "sale_gain";
const isIncome = (a: AccountInfo) => a.type === "income" && a.subtype !== "sale_gain";
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
  private section: string | null = null;
  constructor(
    private n: number,
    private opts: BuildOptions,
  ) {}

  private vals(v: Vec): number[] {
    return this.opts.showTotal ? [...v, v.reduce((s, x) => s + x, 0)] : v;
  }

  heading(label: string) {
    this.section = label;
    this.rows.push({ kind: "heading", label, section: label });
  }
  gap() {
    this.section = null;
    this.rows.push({ kind: "gap", label: "" });
  }
  line(label: string, v: Vec, kind: "line" | "subline" | "total" | "grand" = "line", extra: Partial<ReportRow> = {}) {
    this.rows.push({ kind, label, values: this.vals(v), section: this.section ?? undefined, ...extra });
  }
  /** A section's total: stays visible when the section is collapsed. */
  summary(label: string, v: Vec, kind: "total" | "grand" = "grand") {
    this.line(label, v, kind, { summary: true });
  }
  ratio(label: string, numerator: Vec, denominator: Vec) {
    const r = (a: number, b: number) => (b > 0 ? a / b : null);
    const per = numerator.map((x, i) => r(x, denominator[i]));
    const total = this.opts.showTotal
      ? [r(numerator.reduce((s, x) => s + x, 0), denominator.reduce((s, x) => s + x, 0))]
      : [];
    this.rows.push({ kind: "ratio", label, values: [...per, ...total], section: this.section ?? undefined });
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
        if (!isZero(own)) this.line(`General ${c.name}`, own, "subline", { cat: c.name });
        for (const [name, v] of kids.sort((a, b) => a[0].localeCompare(b[0]))) {
          if (!isZero(v)) this.line(name, v, "subline", { cat: c.name });
        }
        this.line(`Total ${c.name}`, catTotal, "total", { cat: c.name, catName: c.name, catHead: true });
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
  const income = r.categories(L.categories(isIncome), -1);
  r.summary("TOTAL INCOME", income);
  r.gap();

  r.heading("OPERATING EXPENSES");
  const opex = r.categories(L.categories(isOpex), 1);
  r.summary("TOTAL OPERATING EXPENSES", opex);
  r.gap();

  const noi = sub(income, opex);
  r.line("NET OPERATING INCOME", noi, "grand");
  let net = noi;

  const below = L.categories((a) => isInterest(a) || isDepreciation(a));
  if (below.some((c) => !isZero(add(c.own, [...c.children.values()].reduce((s, v) => add(s, v), zeros(L.n)))))) {
    r.gap();
    r.heading("INTEREST & DEPRECIATION");
    const other = r.categories(below, 1);
    r.summary("TOTAL INTEREST & DEPRECIATION", other);
    r.gap();
    net = sub(noi, other);
    r.line("NET INCOME", net, "grand");
  }

  // A sale's gain or loss is reported on its own, not as rental income.
  const gains = L.categories(isSaleGain);
  if (gains.some((c) => !isZero(add(c.own, [...c.children.values()].reduce((s, v) => add(s, v), zeros(L.n)))))) {
    r.gap();
    r.heading("SALE OF PROPERTY");
    const gain = r.categories(gains, -1);
    r.summary("TOTAL GAIN (LOSS) ON SALE", gain);
    r.gap();
    r.line("NET INCOME INCLUDING SALES", add(net, gain), "grand");
  }
  return finish("Income Statement", input, r);
}

export function buildNetCashFlow(input: Input): ReportData {
  const L = new Ledger(input.accounts, input.activity, input.columns);
  const r = new Report(L.n, input.options);

  r.heading("INCOME");
  const income = r.categories(L.categories(isIncome), -1);
  r.summary("TOTAL INCOME", income);
  r.gap();

  r.heading("OPERATING EXPENSES");
  const opex = r.categories(L.categories(isOpex), 1);
  r.summary("TOTAL OPERATING EXPENSES", opex);
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
  r.summary("TOTAL MORTGAGES & LOANS", debtService, "total");
  r.ratio("Debt Service Coverage Ratio", noi, debtService);
  r.gap();

  r.heading("CAPITAL EXPENSES");
  const capex = L.sum(isFixedAsset);
  r.summary("TOTAL CAPITAL EXPENSES", capex, "total");
  r.gap();

  // Selling a property: its cost comes off capital expenses above, and the gain or loss makes up the rest of the cash.
  const saleGain = scale(L.sum(isSaleGain), -1);
  if (!isZero(saleGain)) {
    r.heading("SALE OF PROPERTY");
    r.line("Gain (loss) on sale", saleGain, "subline");
    r.summary("TOTAL SALE OF PROPERTY", saleGain, "total");
    r.gap();
  }

  const ncf = add(sub(sub(noi, debtService), capex), saleGain);
  r.line("NET CASH FLOW", ncf, "grand");
  r.line("NCF Before Principal Payments", add(ncf, principal), "total");
  r.gap();

  r.heading("TRANSFERS");
  // Cash effect: money that left (debits to these accounts) is negative.
  const transfers = r.categories(L.categories(isTransfer), -1);
  r.summary("TOTAL TRANSFERS", transfers, "total");
  r.gap();
  r.line("NET CHANGE IN CASH", add(ncf, transfers), "grand");

  return finish("Net Cash Flow", input, r);
}

const longDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function buildBalanceSheet(input: Input): ReportData {
  const L = new Ledger(input.accounts, input.activity, input.columns);
  const r = new Report(L.n, input.options);

  r.heading("ASSETS");
  const assets = r.categories(L.categories((a) => a.type === "asset"), 1);
  r.summary("TOTAL ASSETS", assets);
  r.gap();

  r.heading("LIABILITIES");
  const liabilities = r.categories(L.categories((a) => a.type === "liability"), -1);
  r.summary("TOTAL LIABILITIES", liabilities);
  r.gap();

  r.heading("EQUITY");
  const contributed = r.categories(L.categories((a) => a.type === "equity"), -1);
  // Books are not closed to retained earnings, so profit to date is shown as its own line.
  const profit = scale(L.sum((a) => a.type === "income" || a.type === "expense"), -1);
  if (!isZero(profit)) r.line("Net income to date", profit, "line");
  const equity = add(contributed, profit);
  r.summary("TOTAL EQUITY", equity, "total");
  r.gap();

  const liabilitiesAndEquity = add(liabilities, equity);
  r.line("TOTAL LIABILITIES & EQUITY", liabilitiesAndEquity, "grand");

  const out = sub(assets, liabilitiesAndEquity);
  const notes: ReportNote[] = [];
  if (isZero(out)) {
    notes.push({ tone: "ok", text: "Assets equal liabilities plus equity. The balance sheet balances." });
  } else {
    notes.push({
      tone: "warn",
      text: input.context?.filtered
        ? "Filtering by property can leave a balance sheet out of balance when an entry spans several properties."
        : "Assets do not equal liabilities plus equity. Check your entries.",
    });
  }
  if (input.context?.openingBalancesDate) {
    notes.push({
      tone: "info",
      text: `Includes the opening balances you entered on your accounts, starting ${longDate(input.context.openingBalancesDate)}.`,
      link: { href: "/categories", label: "View accounts" },
    });
  } else if (input.context?.firstEntryDate) {
    notes.push({
      tone: "info",
      text: `Based on the entries recorded in Mondayboss, starting ${longDate(input.context.firstEntryDate)}. Balances from before then, such as cash, property cost and loan balances, are not included until you add opening balances on your accounts.`,
      link: { href: "/categories", label: "Add opening balances" },
    });
  }
  const data = finish("Balance Sheet", input, r);
  return { ...data, notes };
}

const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "income", "expense"];
const TYPE_HEADING: Record<AccountType, string> = {
  asset: "ASSETS",
  liability: "LIABILITIES",
  equity: "OWNER EQUITY",
  income: "INCOME",
  expense: "EXPENSES",
};

/** One column of activity (cumulative to the as-of date) turned into debit and credit balances. */
export function buildTrialBalance(input: Input): ReportData {
  const L = new Ledger(input.accounts, input.activity, input.columns);
  const byId = new Map(input.accounts.map((a) => [a.id, a]));
  const rows: ReportRow[] = [];
  let debits = 0;
  let credits = 0;

  for (const type of TYPE_ORDER) {
    const accts = input.accounts
      .filter((a) => a.type === type && L.net(a.id)[0] !== 0)
      .sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
    if (accts.length === 0) continue;

    const heading = TYPE_HEADING[type];
    rows.push({ kind: "heading", label: heading, section: heading });
    let d = 0;
    let c = 0;
    for (const a of accts) {
      const net = L.net(a.id)[0];
      const parent = a.parentId ? byId.get(a.parentId) : undefined;
      const debit = net > 0 ? net : 0;
      const credit = net < 0 ? -net : 0;
      d += debit;
      c += credit;
      rows.push({
        kind: "line",
        label: `${a.code}  ${parent ? `${parent.name} › ` : ""}${a.name}`,
        values: [debit, credit],
        section: heading,
      });
    }
    debits += d;
    credits += c;
    rows.push({ kind: "total", label: `Total ${heading.toLowerCase()}`, values: [d, c], section: heading, summary: true });
    rows.push({ kind: "gap", label: "" });
  }
  rows.push({ kind: "grand", label: "TOTAL", values: [debits, credits] });

  const notes: ReportNote[] = [];
  const diff = debits - credits;
  if (diff === 0) {
    notes.push({ tone: "ok", text: "Debits equal credits. Your books are in balance." });
  } else {
    notes.push({
      tone: "warn",
      text: input.context?.filtered
        ? "Filtering by property can leave the trial balance out of balance when an entry spans several properties."
        : `Debits and credits differ by ${(Math.abs(diff) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}. Check your entries.`,
    });
  }
  return { title: "Trial Balance", subtitle: input.subtitle, notes, columns: ["Debit", "Credit"], rows, empty: rows.length <= 1 };
}
