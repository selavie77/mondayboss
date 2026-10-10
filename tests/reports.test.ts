import { describe, it, expect } from "vitest";
import { buildBalanceSheet, buildIncomeStatement, buildNetCashFlow, buildTrialBalance } from "@/lib/reports/build";
import { buildLedger } from "@/lib/reports/ledger";
import type { AccountInfo, ActivityRow, ReportData } from "@/lib/reports/types";

const acct = (id: string, code: string, name: string, type: AccountInfo["type"], subtype: string | null, parentId: string | null = null, isBank = false): AccountInfo =>
  ({ id, code, name, type, subtype, parentId, isBank });

const accounts: AccountInfo[] = [
  acct("cash", "1000", "Operating Checking", "asset", "cash", null, true),
  acct("escrow", "1100", "Escrow Held by Lender", "asset", "escrow"),
  acct("loan", "2100", "Mortgage Payable", "liability", "loan"),
  acct("rent", "4000", "Rental Income", "income", "rent"),
  acct("mgmt", "5060", "Management Fees", "expense", "management"),
  acct("mgmt-pm", "5060.01", "Property Management", "expense", "management", "mgmt"),
  acct("repairs", "5090", "Repairs", "expense", "repairs"),
  acct("util", "5120", "Utilities", "expense", "utilities"),
  acct("util-ws", "5120.01", "Water & Sewer", "expense", "utilities", "util"),
  acct("admin", "5140", "Bank Fees & Other Expenses", "expense", "other"),
  acct("interest", "5070", "Mortgage Interest", "expense", "interest"),
];

// 126 E Orchard Springs Dr, 2021, per the Stessa Income Statement / Net Cash Flow PDFs (debit minus credit, in cents).
const nets: Record<string, number> = {
  rent: -1155000,
  mgmt: 25700, // "General Management Fees" 257
  "mgmt-pm": 75600, // "Property Management" 756
  repairs: 149600,
  util: 0,
  "util-ws": 31500,
  admin: 2900,
  interest: 305700,
  loan: 107400, // principal paid
  escrow: 285000, // property tax escrow deposits
};
const cashNet = -Object.values(nets).reduce((s, v) => s + v, 0);
const activity: ActivityRow[] = [
  ...Object.entries(nets).map(([accountId, netCents]) => ({ columnKey: "p1", accountId, netCents })),
  { columnKey: "p1", accountId: "cash", netCents: cashNet },
];
const columns = [{ key: "p1", label: "126 E Orchard Springs Dr" }];

const base = { accounts, activity, columns, subtitle: "From January 1, 2021 through December 31, 2021" };
const row = (r: ReportData, label: string) => {
  const found = r.rows.find((x) => x.label === label);
  if (!found) throw new Error(`No row "${label}"`);
  return found.values!;
};

describe("Income Statement", () => {
  const r = buildIncomeStatement({ ...base, options: { detail: "sub", showTotal: true } });

  it("matches the Stessa figures for 126 E Orchard Springs", () => {
    expect(row(r, "TOTAL INCOME")).toEqual([1155000, 1155000]);
    expect(row(r, "TOTAL OPERATING EXPENSES")).toEqual([285300, 285300]);
    expect(row(r, "NET OPERATING INCOME")).toEqual([869700, 869700]);
  });

  it("rolls subcategories up to their category, with a General line for the category's own amount", () => {
    expect(row(r, "General Management Fees")).toEqual([25700, 25700]);
    expect(row(r, "Property Management")).toEqual([75600, 75600]);
    expect(row(r, "Total Management Fees")).toEqual([101300, 101300]);
    expect(row(r, "Total Utilities")).toEqual([31500, 31500]);
  });

  it("shows interest below net operating income", () => {
    expect(row(r, "Mortgage Interest")).toEqual([305700, 305700]);
    expect(row(r, "NET INCOME")).toEqual([564000, 564000]);
  });

  it("hides subcategory lines when detail is by category", () => {
    const c = buildIncomeStatement({ ...base, options: { detail: "category", showTotal: false } });
    expect(c.rows.find((x) => x.label === "Property Management")).toBeUndefined();
    expect(row(c, "Management Fees")).toEqual([101300]);
    expect(c.columns).toEqual(["126 E Orchard Springs Dr"]);
  });
});

describe("collapsible structure", () => {
  const r = buildIncomeStatement({ ...base, options: { detail: "sub", showTotal: true } });
  const find = (label: string) => r.rows.find((x) => x.label === label)!;

  it("tags section totals so they stay visible when a section is collapsed", () => {
    expect(find("TOTAL INCOME")).toMatchObject({ section: "INCOME", summary: true });
    expect(find("TOTAL OPERATING EXPENSES")).toMatchObject({ section: "OPERATING EXPENSES", summary: true });
    expect(find("NET OPERATING INCOME").section).toBeUndefined();
  });

  it("tags a category's lines and its total, which stays visible when the category is collapsed", () => {
    expect(find("Property Management")).toMatchObject({ section: "OPERATING EXPENSES", cat: "Management Fees" });
    expect(find("General Management Fees")).toMatchObject({ cat: "Management Fees" });
    expect(find("Total Management Fees")).toMatchObject({ cat: "Management Fees", catHead: true, catName: "Management Fees" });
  });

  it("does not make single-line categories collapsible", () => {
    expect(find("Repairs").cat).toBeUndefined();
  });
});

describe("Net Cash Flow", () => {
  const r = buildNetCashFlow({ ...base, options: { detail: "sub", showTotal: true } });

  it("matches the Stessa figures for 126 E Orchard Springs", () => {
    expect(row(r, "Interest")).toEqual([305700, 305700]);
    expect(row(r, "Principal")).toEqual([107400, 107400]);
    expect(row(r, "TOTAL MORTGAGES & LOANS")).toEqual([413100, 413100]);
    expect(row(r, "NET CASH FLOW")).toEqual([456600, 456600]);
    expect(row(r, "NCF Before Principal Payments")).toEqual([564000, 564000]);
    expect(row(r, "TOTAL TRANSFERS")).toEqual([-285000, -285000]);
  });

  it("computes the debt service coverage ratio like Stessa (2.11x)", () => {
    const dscr = row(r, "Debt Service Coverage Ratio")[0]!;
    expect(dscr.toFixed(2)).toBe("2.11");
  });

  it("net change in cash equals the movement in the cash account", () => {
    expect(row(r, "NET CHANGE IN CASH")).toEqual([cashNet, cashNet]);
  });
});

describe("period columns", () => {
  it("builds one column per period and a total", () => {
    const cols = [{ key: "2021-01", label: "Jan 2021" }, { key: "2021-02", label: "Feb 2021" }];
    const act: ActivityRow[] = [
      { columnKey: "2021-01", accountId: "rent", netCents: -100000 },
      { columnKey: "2021-02", accountId: "rent", netCents: -150000 },
    ];
    const r = buildIncomeStatement({ accounts, activity: act, columns: cols, subtitle: "", options: { detail: "category", showTotal: true } });
    expect(r.columns).toEqual(["Jan 2021", "Feb 2021", "Total"]);
    expect(row(r, "Rental Income")).toEqual([100000, 150000, 250000]);
  });
});

describe("Balance Sheet and Trial Balance", () => {
  const accts: AccountInfo[] = [
    acct("cash", "1000", "Operating Checking", "asset", "cash", null, true),
    acct("prop", "1200", "Rental Property (Cost)", "asset", "fixed_asset"),
    acct("loan", "2100", "Mortgage Payable", "liability", "loan"),
    acct("contrib", "3000", "Owner Contributions", "equity", "contributions"),
    acct("rent", "4000", "Rental Income", "income", "rent"),
    acct("repairs", "5090", "Repairs", "expense", "repairs"),
  ];
  // debit minus credit: owner puts in 100,000, buys a 90,000 property, collects 11,550 rent, pays 1,496 repairs
  const act: ActivityRow[] = [
    { columnKey: "all", accountId: "cash", netCents: 2005400 },
    { columnKey: "all", accountId: "prop", netCents: 9000000 },
    { columnKey: "all", accountId: "contrib", netCents: -10000000 },
    { columnKey: "all", accountId: "rent", netCents: -1155000 },
    { columnKey: "all", accountId: "repairs", netCents: 149600 },
  ];
  const input = { accounts: accts, activity: act, columns: [{ key: "all", label: "Total" }], subtitle: "As of December 31, 2021", options: { detail: "sub" as const, showTotal: false } };

  it("balance sheet: assets equal liabilities plus equity, with profit shown as its own equity line", () => {
    const bs = buildBalanceSheet({ ...input, context: { firstEntryDate: "2021-01-01" } });
    expect(row(bs, "TOTAL ASSETS")).toEqual([11005400]);
    expect(row(bs, "Owner Contributions")).toEqual([10000000]);
    expect(row(bs, "Net income to date")).toEqual([1005400]);
    expect(row(bs, "TOTAL EQUITY")).toEqual([11005400]);
    expect(row(bs, "TOTAL LIABILITIES & EQUITY")).toEqual([11005400]);
    expect(bs.notes?.[0]).toMatchObject({ tone: "ok" });
    expect(bs.notes?.some((n) => n.tone === "info" && /opening balances/.test(n.text))).toBe(true);
  });

  it("balance sheet: warns when the books do not balance", () => {
    const bad = buildBalanceSheet({ ...input, activity: act.filter((a) => a.accountId !== "rent") });
    expect(bad.notes?.[0]).toMatchObject({ tone: "warn" });
  });

  it("trial balance: debits equal credits and each account sits in its natural column", () => {
    const tb = buildTrialBalance(input);
    expect(tb.columns).toEqual(["Debit", "Credit"]);
    expect(row(tb, "TOTAL")).toEqual([11155000, 11155000]);
    expect(row(tb, "1000  Operating Checking")).toEqual([2005400, 0]);
    expect(row(tb, "3000  Owner Contributions")).toEqual([0, 10000000]);
    expect(tb.notes?.[0]).toMatchObject({ tone: "ok" });
    expect(row(tb, "Total assets")).toEqual([11005400, 0]);
  });

  it("trial balance: flags a difference", () => {
    const tb = buildTrialBalance({ ...input, activity: act.slice(0, 4) });
    expect(tb.notes?.[0]).toMatchObject({ tone: "warn" });
  });
});

describe("General ledger grouping", () => {
  const accts = [
    { id: "cash", code: "1000", name: "Operating Checking", type: "asset" as const, parentName: null },
    { id: "rent", code: "4000", name: "Rental Income", type: "income" as const, parentName: null },
    { id: "idle", code: "9999", name: "Unused", type: "expense" as const, parentName: null },
  ];
  const line = (accountId: string, date: string, order: string, debit: number, credit: number) => ({
    accountId, date, order, description: "x", property: "p", debitCents: debit, creditCents: credit,
  });

  it("builds running balances in each account's natural direction and sorts by date", () => {
    const groups = buildLedger(
      accts,
      [line("cash", "2021-02-01", "b", 0, 30000), line("cash", "2021-01-01", "a", 100000, 0), line("rent", "2021-01-01", "a", 0, 100000)],
      new Map([["cash", 50000]]),
    );
    const cash = groups.find((g) => g.account.id === "cash")!;
    expect(cash.openingCents).toBe(50000);
    expect(cash.entries.map((e) => e.balanceCents)).toEqual([150000, 120000]);
    expect(cash.closingCents).toBe(120000);
    expect(cash.debitsCents).toBe(100000);
    // Income is credit-natural: a credit increases the balance.
    expect(groups.find((g) => g.account.id === "rent")!.closingCents).toBe(100000);
  });

  it("leaves out accounts with no activity and no opening balance", () => {
    const groups = buildLedger(accts, [line("cash", "2021-01-01", "a", 100, 0)], new Map());
    expect(groups.map((g) => g.account.id)).toEqual(["cash"]);
  });
});
