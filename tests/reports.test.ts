import { describe, it, expect } from "vitest";
import { buildIncomeStatement, buildNetCashFlow } from "@/lib/reports/build";
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
