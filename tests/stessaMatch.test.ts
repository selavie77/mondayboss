import { describe, it, expect } from "vitest";
import type { StessaLedger, StessaRow } from "@/lib/import/stessa";
import { planStessaImport } from "@/lib/import/stessaEntries";
import { existingKey, newKey, parseNewKey } from "@/lib/import/stessaMapping";
import { categoryKey, describeSource, matchProperty, normalizeAddress, sourceKey, suggestSource } from "@/lib/import/stessaMatch";
import { buildStessaSetup, type AccountRow } from "@/lib/import/stessaSetup";

const row = (o: Partial<StessaRow> = {}): StessaRow => ({
  date: "2021-03-01",
  name: "Payment",
  notes: "",
  details: "",
  category: "Repairs & Maintenance",
  subCategory: "Plumbing Repairs",
  amountCents: -10000,
  property: "126 E Orchard Springs",
  portfolio: "",
  source: "",
  account: "",
  dedupeHash: Math.random().toString(36),
  ...o,
});
const ledger = (rows: StessaRow[]): StessaLedger => ({
  propertyName: "All Properties",
  properties: [...new Set(rows.map((r) => r.property).filter(Boolean))],
  rows,
  skippedRows: 0,
});

describe("property matching", () => {
  const mine = [
    { id: "p1", name: "126 E Orchard Springs Dr" },
    { id: "p2", name: "5310 Kohout St" },
  ];

  it("reads street suffixes and trailing city text as the same address", () => {
    expect(normalizeAddress("5310 Kohout Street, Maple Heights, OH 44137")).toBe("5310 kohout st");
  });

  it("matches the same name exactly, ignoring case and spacing", () => {
    expect(matchProperty("5310  kohout st", mine)).toMatchObject({ id: "p2", level: "exact" });
  });

  it("flags a near match instead of creating a duplicate", () => {
    expect(matchProperty("126 E Orchard Springs", mine)).toMatchObject({ id: "p1", level: "similar" });
    expect(matchProperty("5310 Kohout Street", mine)).toMatchObject({ id: "p2", level: "similar" });
  });

  it("does not match a different house number or an unrelated street", () => {
    expect(matchProperty("127 E Orchard Springs Dr", mine)).toBeNull();
    expect(matchProperty("19762 Maple Heights Blvd", mine)).toBeNull();
  });

  it("does not guess when two properties match equally well", () => {
    const twins = [{ id: "a", name: "12 Oak St Unit 1" }, { id: "b", name: "12 Oak St Unit 2" }];
    expect(matchProperty("12 Oak St", twins)).toBeNull();
  });
});

describe("data source suggestions", () => {
  const cash = [
    { id: "c1", name: "Operating Checking", last4: null },
    { id: "c2", name: "SecurityNational checking", last4: "9209" },
  ];

  it("turns Stessa's source and account into a readable name and last four", () => {
    expect(describeSource("SecurityNational", "125 Queen Joanna Ln Jackson, MS x9209")).toEqual({
      name: "SecurityNational – 125 Queen Joanna Ln Jackson, MS",
      last4: "9209",
      accountKind: "bank",
    });
  });

  it("tidies stray spaces in Stessa's text", () => {
    expect(describeSource("EquityTeam  Dayton", "Bamileke Holdings LLC").name).toBe("EquityTeam Dayton – Bamileke Holdings LLC");
  });

  it("suggests a new account tied to the property its name is an address of", () => {
    const s = suggestSource("IIP Management, LLC", "- 19762 Maple Heights Blvd", cash, ["19762 Maple Heights Blvd", "5310 Kohout St"]);
    expect(s).toMatchObject({ kind: "create", proposedName: "IIP Management, LLC – 19762 Maple Heights Blvd", tieToProperty: "19762 Maple Heights Blvd" });
  });

  it("matches an account you already have by its last four digits and asks for confirmation", () => {
    const s = suggestSource("SecurityNational", "125 Queen Joanna Ln Jackson, MS x9209", cash, []);
    expect(s).toMatchObject({ kind: "existing", existingId: "c2", level: "similar" });
  });

  it("treats uploaded and blank sources as no bank at all", () => {
    expect(suggestSource("Imported File", "Manual Upload", cash, []).kind).toBe("default");
    expect(suggestSource("", "", cash, []).kind).toBe("default");
  });
});

describe("the matching setup", () => {
  const accounts: AccountRow[] = [
    { id: "a-repairs", code: "5090", name: "Repairs", parentId: null, type: "expense", isCash: false, last4: null },
    { id: "a-plumb", code: "5090.02", name: "Plumbing Repairs", parentId: "a-repairs", type: "expense", isCash: false, last4: null },
    { id: "a-util", code: "5120", name: "Utilities", parentId: null, type: "expense", isCash: false, last4: null },
    { id: "a-chk", code: "1000", name: "Operating Checking", parentId: null, type: "asset", isCash: true, last4: null },
  ];
  const rows = [
    row(),
    row({ subCategory: "HVAC Repairs" }),
    row({ category: "Utilities", subCategory: null }),
    row({ category: "Mystery", subCategory: null }),
    row({ property: "5310 Kohout St", source: "IIP Management, LLC", account: "- 5310 Kohout Street, Maple Heights, OH" }),
  ];
  const setup = buildStessaSetup({
    ledgers: [ledger(rows)],
    properties: [{ id: "p1", name: "126 E Orchard Springs Dr" }],
    portfolios: [{ id: "pf1", name: "My portfolio" }],
    accounts,
    saved: { portfolio: new Map(), property: new Map(), source: new Map(), category: new Map() },
  });

  it("proposes a match, or a new property, for every Stessa property", () => {
    expect(setup.properties.find((p) => p.stessaName === "126 E Orchard Springs")?.suggestion).toMatchObject({ kind: "existing", id: "p1", level: "similar" });
    expect(setup.properties.find((p) => p.stessaName === "5310 Kohout St")?.suggestion).toEqual({ kind: "create" });
  });

  it("describes where each category would go, marking subcategories it would create", () => {
    const label = (cat: string, sub: string) => setup.categories.find((c) => c.key === `${cat}|${sub}`)?.defaultLabel;
    expect(label("Repairs & Maintenance", "Plumbing Repairs")).toBe("Repairs › Plumbing Repairs");
    expect(label("Repairs & Maintenance", "HVAC Repairs")).toBe("Repairs › HVAC Repairs (new)");
    expect(label("Utilities", "")).toBe("Utilities");
  });

  it("marks a category we cannot place so the user can choose", () => {
    const mystery = setup.categories.find((c) => c.key === "Mystery|");
    expect(mystery).toMatchObject({ unresolved: true, defaultLabel: "" });
  });

  it("lists data sources and only offers non-cash accounts for categories", () => {
    expect(setup.sources.find((s) => s.source === "IIP Management, LLC")?.suggestion).toMatchObject({ kind: "create", tieToProperty: "5310 Kohout St" });
    expect(setup.accountOptions.map((a) => a.id)).not.toContain("a-chk");
  });

  it("starts from the choices saved by an earlier import", () => {
    const again = buildStessaSetup({
      ledgers: [ledger(rows)],
      properties: [{ id: "p1", name: "126 E Orchard Springs Dr" }],
      portfolios: [],
      accounts,
      saved: { portfolio: new Map(), property: new Map([["126 E Orchard Springs", "p1"]]), source: new Map(), category: new Map([["Mystery|", "a-util"]]) },
    });
    expect(again.properties.find((p) => p.stessaName === "126 E Orchard Springs")?.suggestion).toMatchObject({ level: "saved" });
    expect(again.categories.find((c) => c.key === "Mystery|")?.savedAccountId).toBe("a-util");
  });
});

describe("category matches in the plan", () => {
  it("posts a category the user matched to the account they chose, instead of holding it", () => {
    const r = row({ category: "Mystery", subCategory: null });
    const before = planStessaImport([ledger([r])]);
    expect(before.unresolved).toHaveLength(1);

    const after = planStessaImport([ledger([r])], { categoryOverrides: new Map([[categoryKey(r), existingKey("acct-1")]]) });
    expect(after.unresolved).toHaveLength(0);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0].debitCode).toBe("id:acct-1"); // money out: debit the chosen account
    expect(after.entries[0].creditCode).toBe("1000");
  });

  it("applies a match to every row of that category and leaves the others alone", () => {
    const a = row({ category: "Utilities", subCategory: "Electric" });
    const b = row({ category: "Utilities", subCategory: "Gas" });
    const plan = planStessaImport([ledger([a, b])], { categoryOverrides: new Map([[categoryKey(a), existingKey("elec")]]) });
    expect(plan.entries.map((e) => e.debitCode)).toEqual(["id:elec", "5120::Gas"]);
  });

  it("round-trips a new category through its key", () => {
    const spec = { parentId: "p", type: "expense" as const, name: "Pest: control & more" };
    expect(parseNewKey(newKey(spec))).toEqual(spec);
    expect(parseNewKey("5090::x")).toBeNull();
  });

  it("keys sources the same way the setup does", () => {
    expect(sourceKey("A", "B")).toBe("A|B");
  });
});

describe("portfolios from the Stessa file", () => {
  const rows = [
    row({ property: "5310 Kohout St", portfolio: "Francis's Portfolio" }),
    row({ property: "5310 Kohout St", portfolio: "Francis's Portfolio" }),
    row({ property: "1371 Sorin Ave", portfolio: "Bamileke Asset Management" }),
    row({ property: "", portfolio: "Francis's Portfolio" }), // a transaction with no property still counts for its portfolio
  ];
  const setup = (existing: { id: string; name: string }[]) =>
    buildStessaSetup({
      ledgers: [ledger(rows)],
      properties: [],
      portfolios: existing,
      accounts: [],
      saved: { portfolio: new Map(), property: new Map(), source: new Map(), category: new Map() },
    });

  it("proposes creating each portfolio, and puts each property in the one its rows name", () => {
    const s = setup([{ id: "pf1", name: "My portfolio" }]);
    expect(s.portfolios.map((p) => [p.stessaName, p.suggestion.kind, p.properties])).toEqual([
      ["Francis's Portfolio", "create", 1],
      ["Bamileke Asset Management", "create", 1],
    ]);
    expect(s.properties.find((p) => p.stessaName === "1371 Sorin Ave")?.stessaPortfolio).toBe("Bamileke Asset Management");
  });

  it("matches a portfolio you already have by name", () => {
    const s = setup([{ id: "pf9", name: "francis's portfolio" }]);
    expect(s.portfolios.find((p) => p.stessaName === "Francis's Portfolio")?.suggestion).toMatchObject({ kind: "existing", id: "pf9", level: "exact" });
  });
});
