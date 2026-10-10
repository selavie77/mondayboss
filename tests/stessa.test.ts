import { describe, it, expect } from "vitest";
import { planStessaImport } from "@/lib/import/stessaEntries";
import type { StessaLedger, StessaRow } from "@/lib/import/stessa";

const row = (over: Partial<StessaRow>): StessaRow => ({
  date: "2021-03-01", name: "x", notes: "", details: "", category: "Income", subCategory: "Rents",
  amountCents: 105000, property: "1 Main St", source: "", account: "", dedupeHash: Math.random().toString(),
  ...over,
});
const plan = (...rows: StessaRow[]) =>
  planStessaImport([{ propertyName: "1 Main St", rows, skippedRows: 0 } as StessaLedger]);

describe("Stessa -> double-entry mapping", () => {
  it("books rent as Dr cash / Cr rental income", () => {
    const { entries } = plan(row({}));
    expect(entries[0].lines).toEqual([
      { accountCode: "1000", property: "1 Main St", debitCents: 105000, creditCents: 0 },
      { accountCode: "4000", property: "1 Main St", debitCents: 0, creditCents: 105000 },
    ]);
  });

  it("books an expense as Dr expense / Cr cash", () => {
    const { entries } = plan(row({ category: "Utilities", subCategory: "Water & Sewer", amountCents: -2622 }));
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "5120", debitCents: 2622 });
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "1000", creditCents: 2622 });
  });

  it("treats escrow deposits as an asset, not an expense", () => {
    const { entries } = plan(row({ category: "Transfers", subCategory: "Property Tax Escrows", amountCents: -23746 }));
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "1100", debitCents: 23746 });
  });

  it("expenses property tax paid out of escrow: Dr property tax / Cr escrow, no cash", () => {
    const { entries } = plan(row({
      category: "Transfers", subCategory: "General Escrow Payments", name: "Tax Disbursement",
      notes: "Tax Disbursement", amountCents: 137888,
    }));
    expect(entries[0].lines[0]).toMatchObject({ accountCode: "5110", debitCents: 137888 });
    expect(entries[0].lines[1]).toMatchObject({ accountCode: "1100", creditCents: 137888 });
  });

  it("refuses to guess an unsplit mortgage payment", () => {
    const { entries, unresolved } = plan(row({ category: "Mortgages & Loans", subCategory: null, amountCents: -55760 }));
    expect(entries).toHaveLength(0);
    expect(unresolved[0].reason).toMatch(/split/);
  });

  it("flags negative income for review", () => {
    const { entries } = plan(row({ amountCents: -36500 }));
    expect(entries[0].warnings.join()).toMatch(/Negative income/);
  });

  it("produces balanced entries", () => {
    const { entries } = plan(row({}), row({ category: "Transfers", subCategory: "Owner Distributions", amountCents: -89700 }));
    for (const e of entries) {
      const d = e.lines.reduce((s, l) => s + l.debitCents, 0);
      const c = e.lines.reduce((s, l) => s + l.creditCents, 0);
      expect(d).toBe(c);
    }
  });
});
